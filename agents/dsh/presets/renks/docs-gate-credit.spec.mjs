/**
 * Credit rules for the read-before-mutate gate.
 *
 * WHY THIS FILE EXISTS. The gate used to credit a document the moment a `read`
 * call NAMED its path, before the read had even executed. Three consequences,
 * all observed rather than imagined:
 *
 *   1. a read that FAILED still credited (a test session read
 *      `~/.config/...` literally, got "not found", and was credited);
 *   2. nothing bound the credit to the CONTENT, so one line of a 500-line file
 *      counted the same as the whole file;
 *   3. a document edited mid-session kept its stale credit.
 *
 * A durable credit was the original goal, and it is blocked: the public append
 * API cannot mark an event `ignorable`, and the synchronous log readers are
 * prohibited for new production code. Persisting a credit that does not mean
 * "the content arrived" would have made the gate worse, not better, so the
 * meaning is fixed first and persistence stays open.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createLedger, fingerprint, isReadCall, readPathOf, wantedDoc } from './docs-gate-credit.mjs'

const DOC = { id: 'principles', path: '/cfg/core/principles.md', tier: 'core' }

/** A read call as the host records it: `arguments` is a JSON string. */
const call = (filePath, name = 'read') => ({ name, arguments: JSON.stringify({ file_path: filePath }) })

test('a successful read credits the document it names', () => {
  const ledger = createLedger()
  ledger.record(call(DOC.path), 'v1', [DOC])
  assert.equal(ledger.holds(DOC, 'v1'), true)
})

test('a read that named the document but produced an error credits nothing', () => {
  // The defect this pins: credit was granted before the read executed, so a
  // failed read counted. The caller must pass the failure through.
  const ledger = createLedger()
  ledger.record(call(DOC.path), undefined, [DOC])
  assert.equal(ledger.holds(DOC, 'v1'), false, 'no content means no credit')
})

test('a read of a different file credits nothing', () => {
  const ledger = createLedger()
  ledger.record(call('/cfg/core/testing.md'), 'v1', [DOC])
  assert.equal(ledger.holds(DOC, 'v1'), false)
})

test('a read that is not the read tool credits nothing', () => {
  const ledger = createLedger()
  ledger.record(call(DOC.path, 'bash'), 'v1', [DOC])
  assert.equal(ledger.holds(DOC, 'v1'), false)
  assert.equal(isReadCall({ name: 'grep', arguments: '{}' }), false)
})

test('a document edited after the read loses its credit', () => {
  // The point of binding credit to content: the agent read the OLD text, so the
  // rules it holds in context are not the rules on disk.
  const ledger = createLedger()
  ledger.record(call(DOC.path), 'v1', [DOC])
  assert.equal(ledger.holds(DOC, 'v1'), true)
  assert.equal(ledger.holds(DOC, 'v2'), false, 'content changed, so the credit is stale')
})

test('a second successful read replaces the first fingerprint', () => {
  const ledger = createLedger()
  ledger.record(call(DOC.path), 'v1', [DOC])
  ledger.record(call(DOC.path), 'v2', [DOC])
  assert.equal(ledger.holds(DOC, 'v2'), true)
  assert.equal(ledger.holds(DOC, 'v1'), false, 'only the newest read is held')
})

test('a failed read after a successful one does not revoke the credit', () => {
  // Retrying a read and failing to open the file does not un-read what was
  // already read in this session.
  const ledger = createLedger()
  ledger.record(call(DOC.path), 'v1', [DOC])
  ledger.record(call(DOC.path), undefined, [DOC])
  assert.equal(ledger.holds(DOC, 'v1'), true)
})

test('a read written with a path argument instead of file_path still credits', () => {
  const ledger = createLedger()
  ledger.record({ name: 'read', arguments: JSON.stringify({ path: DOC.path }) }, 'v1', [DOC])
  assert.equal(ledger.holds(DOC, 'v1'), true)
})

test('relative and non-JSON arguments are handled without throwing', () => {
  assert.equal(readPathOf({ name: 'read', arguments: 'not json' }), undefined)
  assert.equal(readPathOf({ name: 'read' }), undefined)
  assert.equal(readPathOf({ name: 'read', arguments: JSON.stringify({ file_path: 'relative/x.md' }) }), undefined)
})

test('the ledger counts what is held, for the denial message', () => {
  const ledger = createLedger()
  assert.equal(ledger.size(), 0)
  ledger.record(call(DOC.path), 'v1', [DOC])
  assert.equal(ledger.size(), 1)
  ledger.record(call('/cfg/core/other.md'), 'v1', [DOC])
  assert.equal(ledger.size(), 1, 'an unrelated read adds nothing')
})

test('fingerprint distinguishes content and is stable for identical content', () => {
  assert.equal(fingerprint('abc'), fingerprint('abc'))
  assert.notEqual(fingerprint('abc'), fingerprint('abd'))
  assert.equal(fingerprint(''), fingerprint(''))
})

test('wantedDoc matches by absolute path only', () => {
  assert.equal(wantedDoc([DOC], DOC.path), DOC)
  assert.equal(wantedDoc([DOC], '/cfg/core/other.md'), undefined)
  assert.equal(wantedDoc([DOC], undefined), undefined)
})
