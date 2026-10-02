/**
 * What a credit MEANS: the read-before-mutate gate's evidence rules, end to end.
 *
 * The unit rules live in `docs-gate-credit.spec.mjs`. These cases drive the real
 * plugin so the wiring is covered too, because the defect they pin was a wiring
 * defect: the credit was granted in front of the read instead of after it, so a
 * read that failed still counted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CORE_DOC_PATHS,
  WORKSPACE,
  fakeAgent,
  mount,
  readDoc,
  resetFileContent,
  setFileContent,
} from './docs-gate.testkit.mjs'

test('a successful read is credited and the rest stay required', async () => {
  // The tier ladder does not collapse because one doc was read: reading
  // `principles.md` satisfies the core tier and leaves the code tier's docs
  // named in the denial.
  const h = mount()
  const agent = fakeAgent('s-credit')
  await readDoc(h, agent, CORE_DOC_PATHS[0])
  const decision = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(decision.kind, 'deny')
  assert.doesNotMatch(decision.reason, /core\/principles\.md/, 'the read doc must be credited')
  assert.match(decision.reason, /core\/docs\/complexity\.md/, 'the unread docs must remain')
})

test('editing a tracked doc mid-session revokes its credit', async () => {
  // A credit means "this CONTENT was read". If the rules change under the
  // session, the agent holds stale text, and the gate must say so rather than
  // let the change land against rules that are no longer on disk.
  resetFileContent()
  const h = mount({ files: [...CORE_DOC_PATHS] })
  const agent = fakeAgent('s-stale')
  await readDoc(h, agent, CORE_DOC_PATHS[0])
  assert.doesNotMatch(
    (await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })).reason,
    /core\/principles\.md/,
    'read and unchanged: credited',
  )

  setFileContent(CORE_DOC_PATHS[0], 'rewritten rules\n')
  const after = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.match(after.reason, /core\/principles\.md/, 'rewritten content revokes the credit')
  resetFileContent()
})
