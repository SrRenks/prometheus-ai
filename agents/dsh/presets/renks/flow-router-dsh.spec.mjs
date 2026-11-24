/**
 * flow-router in dsh: the session note on agent/created, the prompt note on
 * agent/pre-step (once per session, root agents only), and the branch-switch
 * block on tools/pre-execute, against a real throwaway repository.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { registerFlowRouter } from './flow-router-dsh.mjs'

let repo
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 's', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 's', GIT_COMMITTER_EMAIL: 's@example.invalid' }
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' })

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'flow-dsh-')))
  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'x')
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

function mount() {
  const listeners = new Map()
  const logs = []
  registerFlowRouter({ on: (name, fn) => listeners.set(name, fn) }, m => logs.push(m))
  return { on: name => listeners.get(name), logs }
}

const agentAt = (cwd, extra = {}) => {
  const injected = []
  return { session: { id: 's1', header: { cwd } }, inject: m => injected.push(m), injected, ...extra }
}
const user = text => [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }]

test('a new root session in an uninitialized repo gets the ai-init note; a subagent gets none', async () => {
  const h = mount()
  const agent = agentAt(repo)
  await h.on('agent/created')({ agent })
  assert.equal(agent.injected.length, 1)
  assert.match(agent.injected[0].content[0].text, /no \.ai\/project\.md.*ai-init/s)
  assert.equal(agent.injected[0].role, 'user')
  const resumed = agentAt(repo)
  await h.on('agent/created')({ agent: resumed, source: 'resume' })
  assert.equal(resumed.injected.length, 0, 'a resume keeps the note it already has')
  const child = agentAt(repo, { parentAgent: agent })
  await h.on('agent/created')({ agent: child })
  assert.equal(child.injected.length, 0)
})

test('a prompt naming a GitHub issue adds the kickoff note once, after the step is entered', async () => {
  const h = mount()
  const agent = agentAt(repo)
  const step = h.on('agent/pre-step')
  const enter = async () => ({ kind: 'enter', messages: [] })
  const first = await step({ agent, messages: user('start acme/shop#42') }, enter)
  assert.match(first.messages[0].content[0].text, /acme\/shop#42.*kickoff/)
  const again = await step({ agent, messages: user('acme/shop#42 again') }, enter)
  assert.equal(again.messages.length, 0, 'once per session')
  const rejected = await step({ agent, messages: user('acme/shop#43') }, async () => ({ kind: 'reject' }))
  assert.deepEqual(rejected, { kind: 'reject' }, 'a rejected step is left alone')
  assert.match((await step({ agent, messages: user('acme/shop#43') }, enter)).messages[0].content[0].text, /#43/, 'and its note is still said later')
  const injected = [{ role: 'user', source: { kind: 'flow-router' }, content: [{ type: 'text', text: 'the audit skill builds them' }] }]
  assert.equal((await step({ agent, messages: injected }, enter)).messages.length, 0, 'injected notes and skill bodies are not the user typing')
})

test('a branch switch is denied while an ai-worktree task runs, and passes through otherwise', async () => {
  const h = mount()
  const pre = h.on('tools/pre-execute')
  const allow = async () => ({ kind: 'allow' })
  const agent = agentAt(repo)
  const bash = command => ({ name: 'bash', arguments: { command }, agent })
  assert.deepEqual(await pre(bash('git switch -c feat/x'), allow), { kind: 'allow' })
  mkdirSync(join(repo, '.ai'))
  writeFileSync(join(repo, '.ai/project.md'), '# p\n')
  git('worktree', 'add', '-q', '-b', 'feat/t', join(repo, '.worktrees/t'))
  git('worktree', 'lock', '--reason', 'ai-worktree: task t', join(repo, '.worktrees/t'))
  git('branch', 'develop')
  const denied = await pre(bash('git checkout develop'), allow)
  assert.deepEqual(await pre(bash('git checkout no-such-branch'), allow), { kind: 'allow' }, 'git reads an unknown name as a path')
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /tasks are running in other worktrees: t/)
  assert.deepEqual(await pre(bash('git checkout -- a.txt'), allow), { kind: 'allow' })
  assert.deepEqual(await pre({ name: 'read', arguments: { file_path: 'a' }, agent }, allow), { kind: 'allow' })
  assert.deepEqual(h.logs, [])
})
