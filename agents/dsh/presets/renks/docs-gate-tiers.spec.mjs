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
  COMMIT_PATHS,
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

test('the commit trigger carries both commit-time docs, and only at a commit', async () => {
  // `ai-writing.md` was in the reference index with three callers - rule 9 of
  // AGENTS.md, the prose scan in `development-workflow.md`, and the `ship` skill -
  // and no enforcement anywhere. A session could write every README in a repo and
  // commit all of them without opening the rules for the prose it was shipping.
  //
  // It joins at the commit rather than up front for the reason the commit trigger
  // exists: the doc governs prose a human will read, and the review phase places
  // its check immediately before the commit. So the commit IS the trigger, and an
  // ordinary edit is not.
  assert.ok(COMMIT_PATHS.length >= 2, 'the commit trigger carries more than git workflow')
  assert.ok(
    COMMIT_PATHS.some(path => path.endsWith('ai-writing.md')),
    'the prose rules are demanded at the commit',
  )

  const h = mount()
  const agent = fakeAgent('s-commit-docs')
  const edit = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(edit.kind, 'deny')
  assert.doesNotMatch(edit.reason, /ai-writing/, 'an ordinary edit is not the commit act')

  const committing = await h.pre({ name: 'bash', arguments: { command: 'git commit -m "x"' }, agent })
  assert.equal(committing.kind, 'deny')
  assert.match(committing.reason, /ai-writing/, 'the commit must demand the prose rules')

  // The commit-time docs are independent: reading one leaves the other required.
  const [first] = COMMIT_PATHS
  await readDoc(h, agent, first)
  const afterOne = await h.pre({ name: 'bash', arguments: { command: 'git commit -m "x"' }, agent })
  assert.equal(afterOne.kind, 'deny', 'one commit-time doc does not satisfy the other')
})

test('a .ai/ write demands the top-level contract on top of the prose tier', async () => {
  // The contract is mostly an index, and gating it for every change would tax
  // sessions that never touch `.ai/`. Its own rules - ownership, memory files,
  // formatting by audience - apply exactly where the `.ai/` structure applies,
  // so the target path is the trigger.
  const h = mount()
  const agent = fakeAgent('s-ai-target')
  const write = { name: 'write', arguments: { file_path: `${WORKSPACE}/.ai/context/domain.md` } }
  const demandedOf = (decision) => (decision.reason ?? '').split('\n')
    .filter(line => /^\s+- /.test(line))
    .map(line => line.trim().slice(2))

  const denied = await h.pre({ ...write, agent })
  assert.equal(denied.kind, 'deny')
  const demanded = demandedOf(denied)
  assert.ok(demanded.some(path => path.endsWith('/AGENTS.md')), 'the .ai/ write must demand the contract')
  assert.ok(demanded.some(path => path.endsWith('core/principles.md')), 'and the core tier')
  assert.ok(!demanded.some(path => path.endsWith('complexity.md')), '.ai/ prose is still prose')

  // The contract is its own requirement: the prose tier alone does not lift it.
  for (const path of CORE_TIER_PATHS) await readDoc(h, agent, path)
  const stillDenied = await h.pre({ ...write, agent })
  assert.equal(stillDenied.kind, 'deny', 'reading the prose tier must not satisfy the contract')
  assert.ok(demandedOf(stillDenied).some(path => path.endsWith('/AGENTS.md')))

  await readDoc(h, agent, `${REPO}/AGENTS.md`)
  assert.deepEqual(await h.pre({ ...write, agent }), { kind: 'allow' })
})

test('outside .ai/ the contract is pointed at, not demanded', async () => {
  const h = mount()
  const agent = fakeAgent('s-index-pointer')
  const denied = await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/README.md` }, agent })
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /The contract those documents elaborate/, 'the denial carries the pointer')
  const demanded = denied.reason.split('\n').filter(line => /^\s+- /.test(line))
  assert.ok(!demanded.some(line => line.includes('AGENTS.md')), 'but it is not a requirement there')
})

test('a path that merely contains the letters .ai is not an .ai/ target', async () => {
  const h = mount()
  const agent = fakeAgent('s-not-ai')
  const denied = await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/.aix/notes.md` }, agent })
  assert.equal(denied.kind, 'deny')
  const demanded = denied.reason.split('\n').filter(line => /^\s+- /.test(line))
  assert.ok(!demanded.some(line => line.includes('AGENTS.md')), '.aix is not the .ai directory')
})
