/**
 * docs-gate tier and language rules.
 *
 * Split from `docs-gate.spec.mjs` so each file keeps one subject and both stay
 * inside the repo's file-length budget (core/docs/complexity.md). The sibling
 * covers the gate's own behaviour; this one covers which docs a call is asked
 * for, including the language guide picked from the file extension.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CODE_TIER_PATHS,
  CORE_TIER_PATHS,
  REPO,
  WORKSPACE,
  fakeAgent,
  mount,
  readDoc,
} from './docs-gate.testkit.mjs'

test('a prose change needs only the core rules', async () => {
  // The friction this tier exists to remove: editing a README should not require
  // a complexity budget to have been read first.
  const h = mount()
  const agent = fakeAgent('s-prose')
  const blocked = await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/README.md` }, agent })
  assert.equal(blocked.kind, 'deny')
  assert.match(blocked.reason, /core\/principles\.md/)
  assert.doesNotMatch(blocked.reason, /complexity\.md/, 'prose must not demand the code rules')
  assert.doesNotMatch(blocked.reason, /maintainability\.md/, 'prose must not demand the code rules')
  assert.doesNotMatch(blocked.reason, /git-workflow\.md/, 'prose that is not committing needs no commit procedure')
  assert.doesNotMatch(blocked.reason, /development-workflow\.md/, 'prose must not demand the code workflow')

  // Reading the core tier lifts it.
  for (const doc of CORE_TIER_PATHS) await readDoc(h, agent, doc)
  assert.deepEqual(
    await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/README.md` }, agent }),
    { kind: 'allow' },
  )

  // …and the code tier is still unread, so source stays blocked.
  const stillBlocked = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(stillBlocked.kind, 'deny', 'reading the core tier must not unlock the code tier')
  assert.match(stillBlocked.reason, /complexity\.md/)
})

test('configuration counts as prose, an unknown extension does not', async () => {
  const h = mount()
  const agent = fakeAgent('s-config')
  const config = await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/settings.yaml` }, agent })
  assert.equal(config.kind, 'deny')
  assert.doesNotMatch(config.reason, /complexity\.md/, 'YAML is not source')

  const unknown = await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/thing.zig` }, agent })
  assert.equal(unknown.kind, 'deny')
  assert.match(unknown.reason, /complexity\.md/, 'an unfamiliar language is gated, not waved through')

  const noExtension = await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/Makefile` }, agent })
  assert.equal(noExtension.kind, 'deny')
  assert.match(noExtension.reason, /complexity\.md/, 'no extension means source')
})

test('a source change also requires the guide for that language', async () => {
  // complexity.md states the budgets; the guide states how they are checked.
  const h = mount()
  const agent = fakeAgent('s-lang')

  const py = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/tool.py` }, agent })
  assert.equal(py.kind, 'deny')
  assert.match(py.reason, /languages\/python\.md/, 'a Python edit must require the Python guide')
  assert.doesNotMatch(py.reason, /languages\/go\.md/, 'and must not demand an unrelated guide')

  const go = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/main.go` }, agent })
  assert.match(go.reason, /languages\/go\.md/)
  assert.doesNotMatch(go.reason, /languages\/python\.md/)

  // A language with no guide asks for none.
  const ts = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(ts.kind, 'deny')
  assert.doesNotMatch(ts.reason, /languages\//, 'no guide exists for TypeScript, so none is demanded')
})

test('the language guide is the only extra a Python edit needs', async () => {
  const h = mount()
  const agent = fakeAgent('s-python')
  for (const doc of [...CORE_TIER_PATHS, ...CODE_TIER_PATHS]) await readDoc(h, agent, doc)
  const beforeGuide = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/tool.py` }, agent })
  assert.equal(beforeGuide.kind, 'deny', 'the tier alone is not enough for a language with a guide')
  assert.match(beforeGuide.reason, /languages\/python\.md/, 'and the only thing missing is the guide')
  await readDoc(h, agent, `${REPO}/core/docs/languages/python.md`)
  assert.deepEqual(
    await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/tool.py` }, agent }),
    { kind: 'allow' },
  )
})
