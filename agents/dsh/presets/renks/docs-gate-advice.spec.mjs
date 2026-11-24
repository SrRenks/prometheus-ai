/**
 * docs-gate denials: partial reads, repeated calls, and the stop advice.
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { coversWhole } from './docs-gate-credit.mjs'
import { CORE_TIER_PATHS, WORKSPACE, fakeAgent, mount, resetFileContent, setFileContent } from './docs-gate.testkit.mjs'

const PROSE = { name: 'write', arguments: { file_path: `${WORKSPACE}/README.md` } }
const TEN_LINES = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

afterEach(() => resetFileContent())

test('coversWhole tells a whole read from a slice', () => {
  assert.ok(coversWhole({ file_path: '/a' }, TEN_LINES))
  assert.ok(coversWhole({ offset: 1, limit: 10 }, TEN_LINES))
  assert.ok(coversWhole('{"limit": 2000}', TEN_LINES))
  assert.ok(!coversWhole({ offset: 5 }, TEN_LINES))
  assert.ok(!coversWhole({ limit: 4 }, TEN_LINES))
  assert.ok(!coversWhole('{"offset": 3, "limit": 2}', TEN_LINES))
})

test('a read of part of a doc does not credit it, and the denial says why', async () => {
  for (const path of CORE_TIER_PATHS) setFileContent(path, TEN_LINES)
  const h = mount()
  const agent = fakeAgent('s-partial')
  for (const path of CORE_TIER_PATHS) await h.pre({ name: 'read', arguments: { file_path: path, limit: 3 }, agent })
  const denied = await h.pre({ ...PROSE, agent })
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /read in part earlier/)
  // Reading the whole file lifts it, and clears the note.
  for (const path of CORE_TIER_PATHS) await h.pre({ name: 'read', arguments: { file_path: path }, agent })
  assert.deepEqual(await h.pre({ ...PROSE, agent }), { kind: 'allow' })
})

test('a slice is said next to that read result only', async () => {
  const [path] = CORE_TIER_PATHS
  setFileContent(path, TEN_LINES)
  setFileContent(`${WORKSPACE}/notes.md`, TEN_LINES)
  const h = mount()
  const agent = fakeAgent('s-partial-note')
  const slice = { name: 'read', arguments: { file_path: path, limit: 3 }, agent }
  await h.pre(slice)
  const noted = await h.post(slice)
  assert.equal(noted.kind, 'accept', 'the result itself is kept')
  assert.match(noted.additionalContexts[0].content[0].text, /covered part of it \(offset or limit set\)/)
  assert.ok(Object.isFrozen(noted.additionalContexts[0].content[0]))
  // A whole read, even one issued while the slice is pending, gets no note.
  const whole = { name: 'read', arguments: { file_path: path }, agent }
  await h.pre(whole)
  assert.deepEqual(await h.post(whole), { kind: 'accept' })
  // A failed read, a non-gated file, and a call that never passed pre-execute say nothing.
  assert.deepEqual(await h.post(slice, { isError: true }), { kind: 'accept' })
  const other = { name: 'read', arguments: { file_path: `${WORKSPACE}/notes.md`, limit: 3 }, agent }
  await h.pre(other)
  assert.deepEqual(await h.post(other), { kind: 'accept' })
  assert.deepEqual(await h.post({ ...slice }), { kind: 'accept' })
})

test('the note keeps what later post-execute handlers attached', async () => {
  const [path] = CORE_TIER_PATHS
  setFileContent(path, TEN_LINES)
  const h = mount()
  const theirs = { id: 'x', role: 'user', content: [] }
  h.listeners.get('tools/post-execute').push(async () => ({ kind: 'accept', additionalContexts: [theirs] }))
  const slice = { name: 'read', arguments: { file_path: path, offset: 4 }, agent: fakeAgent('s-chain') }
  await h.pre(slice)
  const out = await h.post(slice)
  assert.equal(out.additionalContexts.length, 2)
  assert.equal(out.additionalContexts[1], theirs)
})

test('every denial names the stop exit; the third identical one says to stop retrying', async () => {
  const h = mount()
  const agent = fakeAgent('s-repeat')
  const first = await h.pre({ ...PROSE, agent })
  assert.match(first.reason, /tell the user what failed and stop/)
  assert.doesNotMatch(first.reason, /denied \d+ times/)
  await h.pre({ ...PROSE, agent })
  const third = await h.pre({ ...PROSE, agent })
  assert.match(third.reason, /This exact call has been denied 3 times/)
  // A different call starts its own count.
  const other = await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/OTHER.md` }, agent })
  assert.doesNotMatch(other.reason, /denied \d+ times/)
})
