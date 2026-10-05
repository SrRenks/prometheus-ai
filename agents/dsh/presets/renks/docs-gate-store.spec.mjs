/**
 * The optional credit store: a switch that trades context for a restart.
 *
 * WHY THESE CASES EXIST SEPARATELY FROM THE LEDGER'S. The ledger is always on and
 * its rules are settled. This store is OFF by default and weakens the gate's
 * meaning when it is on, so what needs pinning is the shape of that weakening:
 * exactly which credits come back, under what guard, and that nothing happens at
 * all when the switch is off.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLedger, fingerprint } from './docs-gate-credit.mjs'
import { loadStore, recordRead, seedLedger, storeEnabled, storeExists, storeHolds } from './docs-gate-store.mjs'

/**
 * Temp directories are removed at exit, so a test run does not leave one behind
 * per case.
 */
const scratchDirs = []
process.on('exit', () => {
  for (const dir of scratchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
})

const DOC = { id: 'principles', path: '/cfg/core/principles.md', tier: 'core' }
const CONTENT = 'the rules\n'

/** A temp store path that does not exist yet. */
const tempPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-store-'))
  scratchDirs.push(dir)
  return join(dir, 'credit.json')
}

/** A seam serving one document. */
const seamFor = (content) => ({ readText: async () => content })

test('the feature is off unless a path is configured', () => {
  assert.equal(storeEnabled(undefined), false)
  assert.equal(storeEnabled(''), false)
  assert.equal(storeEnabled('/tmp/x.json'), true)
  assert.deepEqual(loadStore(undefined), {}, 'nothing is read when off')
  assert.equal(recordRead(undefined, {}, DOC, CONTENT), false, 'and nothing is written')
})

test('a successful read is recorded with a content fingerprint', () => {
  const path = tempPath()
  assert.equal(storeExists(path), false)
  assert.equal(recordRead(path, {}, DOC, CONTENT), true)
  const store = loadStore(path)
  assert.equal(store[DOC.id].hash, fingerprint(CONTENT))
  assert.equal(typeof store[DOC.id].at, 'string', 'the read time is kept, so a reader can judge its age')
})

test('a document whose content changed does not come back', () => {
  const path = tempPath()
  recordRead(path, {}, DOC, CONTENT)
  const store = loadStore(path)
  assert.equal(storeHolds(store, DOC, CONTENT), true)
  assert.equal(storeHolds(store, DOC, 'rewritten rules\n'), false, 'a rewritten rule never reuses an old credit')
})

test('seeding restores exactly the documents that still match', async () => {
  const path = tempPath()
  const other = { id: 'complexity', path: '/cfg/core/docs/complexity.md', tier: 'code' }
  let docs = recordRead(path, {}, DOC, CONTENT) ? loadStore(path) : {}
  recordRead(path, docs, other, 'budgets\n')
  docs = loadStore(path)

  const ledger = createLedger()
  // The first document still matches; the second was rewritten on disk.
  const seeded = await seedLedger(path, seamFor(CONTENT), [DOC], ledger)
  assert.deepEqual(seeded, ['principles'])
  assert.equal(ledger.holds(DOC, CONTENT), true, 'the seeded credit behaves like a read credit')

  const stale = createLedger()
  const none = await seedLedger(path, seamFor('something else\n'), [DOC], stale)
  assert.deepEqual(none, [], 'a rewritten document seeds nothing')
  assert.equal(stale.holds(DOC, CONTENT), false)
})

test('an unreadable document seeds nothing rather than failing', async () => {
  const path = tempPath()
  recordRead(path, {}, DOC, CONTENT)
  const ledger = createLedger()
  const throwing = { readText: async () => { throw new Error('EACCES') } }
  assert.deepEqual(await seedLedger(path, throwing, [DOC], ledger), [])
  assert.equal(ledger.size(), 0)
})

test('a corrupt or absent store is ignored, not fatal', async () => {
  const path = tempPath()
  writeFileSync(path, 'not json at all')
  assert.deepEqual(loadStore(path), {}, 'an unparsable store reads as empty')
  const ledger = createLedger()
  assert.deepEqual(await seedLedger(path, seamFor(CONTENT), [DOC], ledger), [])
  assert.deepEqual(loadStore(join(tmpdir(), 'definitely-absent-store.json')), {})
})

test('a store that cannot be written leaves the gate working', () => {
  // A read-only home or a full disk must not break the gate: this is an
  // accelerator whose fallback is the behaviour that already worked.
  const blocked = '/proc/definitely/not/writable/credit.json'
  assert.equal(recordRead(blocked, {}, DOC, CONTENT), false)
})

test('the store holds fingerprints, never content', () => {
  // The record must not become a second copy of the rules: a copy could drift
  // from the file, while a fingerprint can only match or not match.
  const path = tempPath()
  recordRead(path, {}, DOC, CONTENT)
  const raw = readFileSync(path, 'utf8')
  assert.equal(raw.includes('the rules'), false, 'the content itself is not in the store')
  assert.equal(raw.includes(fingerprint(CONTENT)), true)
})

test('the plugin writes the store when a read succeeds and the switch is on', async () => {
  // The end-to-end case the unit tests above cannot cover, and the gap that let a
  // renamed method sit in the plugin: `store.creditStore()` no longer existed, no
  // test mounted the plugin with the store configured, and the suite stayed green.
  //
  // The repository root is DERIVED, not written out. A literal `/home/renks` here
  // made the test pass only on a machine whose home is that, which is the same
  // shape of defect as a check that looks somewhere nothing happens.
  const { apply } = await import('./docs-gate.mjs')
  const { stat, readFile } = await import('node:fs/promises')
  // Four levels up: this file lives at agents/dsh/presets/renks/, so three would
  // land on `agents/` and the doc probe would look for a path that does not exist.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  const docPath = join(repoRoot, 'core/principles.md')
  const path = tempPath()

  const service = {
    async resolve(p) { return { targetKey: p, displayPath: p } },
    async stat(t) {
      try {
        const i = await stat(t.targetKey)
        return { type: i.isFile() ? 'file' : i.isDirectory() ? 'directory' : 'other' }
      } catch { return undefined }
    },
    async readText(t) { return await readFile(t.targetKey, 'utf8') },
  }
  const listeners = new Map()
  apply({
    logger: { warn: () => {} },
    on: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    get: (name) => (name === 'fs' ? service : undefined),
  }, { repoRoots: [repoRoot], creditStore: path })

  // The workspace is the repository itself, derived rather than written out. An
  // earlier version pointed this at the home directory by literal path and at
  // tmpdir() when that was removed; both were guesses about a machine rather than
  // a fact about the checkout.
  const agent = { session: { id: 'store-e2e', header: { cwd: repoRoot } }, parentAgent: undefined }
  const call = async (exec) => {
    let index = -1
    const next = async () => {
      index += 1
      const handlers = listeners.get('tools/pre-execute') ?? []
      return index >= handlers.length ? { kind: 'allow' } : handlers[index]({ ...exec, agent }, next)
    }
    return next()
  }

  const read = await call({ name: 'read', arguments: { file_path: docPath } })
  assert.equal(read.kind, 'allow', 'reading is never blocked')
  assert.equal(storeExists(path), true, 'a successful read is written to the store')

  // And the write is usable: a fresh plugin instance seeds from it.
  const store = loadStore(path)
  assert.ok(store.principles !== undefined, 'the document is recorded by id')
  const ledger = createLedger()
  const seeded = await seedLedger(path, {
    readText: () => readFile(docPath, 'utf8'),
  }, [{ id: 'principles', path: docPath }], ledger)
  assert.deepEqual(seeded, ['principles'], 'a later session can reuse it')
})
