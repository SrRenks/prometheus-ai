/**
 * flow-router: the notes that start the right flow, and the branch-switch block.
 *
 * Notes are factual and short, said at session start from the repository's
 * state and when a prompt names a GitHub issue or PR. Switching a checkout's
 * branch is denied while ai-worktree tasks are running, because "do not" rules
 * held at 0 to 10% even with reminders (arXiv:2607.26819).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { branchSwitch, gatherFacts, isGitRef, parseWorktrees, promptHint, sessionHint, switchDenial } from './flow-router.mjs'

const BASE = { git: true, linked: false, task: undefined, busy: [], initialized: true, overlay: true, audited: true, history: true }

test('session notes follow the repository state', () => {
  assert.equal(sessionHint({ git: false }), undefined, 'no git, nothing to say')
  assert.equal(sessionHint(BASE), undefined, 'set up and audited, nothing to say')
  assert.match(sessionHint({ ...BASE, initialized: false }), /history but no \.ai\/project\.md.*ai-init.*audit skill/s)
  assert.match(sessionHint({ ...BASE, initialized: false, history: false }), /new repository.*ai-init.*plan the build-out/s)
  assert.match(sessionHint({ ...BASE, audited: false }), /no audited facts yet; the audit skill/)
  assert.match(sessionHint({ ...BASE, busy: [{ task: 'login', branch: 'fix/login' }] }), /login \(fix\/login\).*ai-worktree new/s)
  assert.match(sessionHint({ ...BASE, linked: true, task: 'login' }), /worktree of task login.*\.ai\/session\.md/)
})

test('prompt notes: GitHub issues and PRs point to kickoff, audit words to the audit skills', () => {
  assert.match(promptHint('start acme/shop#42 please').text, /acme\/shop#42.*kickoff/)
  assert.equal(promptHint('see https://github.com/acme/shop/issues/7').id, 'ticket:acme/shop#7')
  assert.equal(promptHint('review https://github.com/acme/shop/pull/9 now').id, 'ticket:acme/shop#9')
  assert.equal(promptHint('faça uma auditoria do repo').id, 'audit')
  assert.equal(promptHint('fix the typo in README'), undefined)
  assert.equal(promptHint('use C# and the #3 option'), undefined, 'a bare #3 is not a ticket')
  assert.equal(promptHint('path src/a.ts#L10'), undefined, 'a file anchor is not a ticket')
  for (const text of ['see node_modules/x#3', 'tag v1.2/3.4#5', 'read core/docs/audit.md', 'a/b/c#4', 'a plataforma de onboarding de um cliente']) assert.equal(promptHint(text), undefined, text)
  assert.equal(promptHint('vercel/next.js#123').id, 'ticket:vercel/next.js#123', 'a dotted repository name is valid')
  assert.equal(promptHint(''), undefined)
})

test('branchSwitch tells a branch switch from a file restore', () => {
  for (const cmd of ['git switch main', 'git switch -c feat/x', 'git checkout -b feat/x', 'git checkout develop',
    'cd sub && git checkout feat/y', 'git -C ../other switch main', 'git checkout --detach HEAD~1']) {
    assert.ok(branchSwitch(cmd), cmd)
  }
  for (const cmd of ['git checkout -- a.txt', 'git checkout main -- a.txt', 'git checkout .', 'git status',
    'echo "git switch main"', 'git log --oneline', 'git restore a.txt']) {
    assert.equal(branchSwitch(cmd), undefined, cmd)
  }
  assert.equal(branchSwitch('git checkout README.md', name => name !== 'README.md'), undefined, 'a name git reads as a path is a restore')
  assert.equal(branchSwitch('git checkout -p main'), undefined, 'patch mode edits files')
  assert.deepEqual(branchSwitch('git -C ../other switch main'), { dir: '../other' })
  assert.equal(branchSwitch('git switch --help'), undefined)
  assert.equal(branchSwitch('git checkout deleted.txt', () => false), undefined, 'restoring a deleted file: git reads it as a path')
})

test('switchDenial: only while ai-worktree tasks run', () => {
  assert.equal(switchDenial({ git: false }), undefined)
  assert.equal(switchDenial(BASE), undefined, 'no tasks, normal solo work')
  assert.match(switchDenial({ ...BASE, busy: [{ task: 'a', branch: 'feat/a' }] }), /tasks are running in other worktrees: a \(feat\/a\).*ai-worktree new/s)
  assert.match(switchDenial({ ...BASE, linked: true, task: 'a' }), /this is the worktree of task a/)
})

test('parseWorktrees reads paths, branches and ai-worktree locks', () => {
  const text = 'worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.worktrees/a\nHEAD 2\nbranch refs/heads/feat/a\nlocked ai-worktree: task a\n\nworktree /x\nHEAD 3\ndetached\nlocked by hand\n'
  assert.deepEqual(parseWorktrees(text), [
    { path: '/r', branch: 'main', task: undefined },
    { path: '/r/.worktrees/a', branch: 'feat/a', task: 'a' },
    { path: '/x', branch: undefined, task: undefined },
  ])
})

let repo
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 's', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 's', GIT_COMMITTER_EMAIL: 's@example.invalid' }
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' })
beforeEach(() => { repo = realpathSync(mkdtempSync(join(tmpdir(), 'flow-router-'))) })
afterEach(() => rmSync(repo, { recursive: true, force: true }))

test('gatherFacts on a real repository: new, set up, audited, and with a task worktree', async () => {
  assert.deepEqual(await gatherFacts(repo), { git: false })
  git('init', '-q', '-b', 'main')
  let facts = await gatherFacts(repo)
  assert.equal(facts.history, false)
  assert.equal(facts.initialized, false)
  git('commit', '-q', '--allow-empty', '-m', 'x')
  mkdirSync(join(repo, '.ai/context'), { recursive: true })
  writeFileSync(join(repo, '.ai/project.md'), '# p\n')
  facts = await gatherFacts(repo)
  assert.equal(facts.initialized, true)
  assert.equal(facts.audited, false)
  writeFileSync(join(repo, '.ai/context/domain.md'), '# Domain\n\nVerified at: abc123\n')
  assert.equal((await gatherFacts(repo)).audited, true)
  git('worktree', 'add', '-q', '-b', 'feat/t', join(repo, '.worktrees/t'))
  git('worktree', 'lock', '--reason', 'ai-worktree: task t', join(repo, '.worktrees/t'))
  facts = await gatherFacts(repo)
  assert.deepEqual(facts.busy.map(b => b.task), ['t'])
  git('worktree', 'add', '-q', '-b', 'feat/gone', join(repo, '.worktrees/gone'))
  git('worktree', 'lock', '--reason', 'ai-worktree: task gone', join(repo, '.worktrees/gone'))
  rmSync(join(repo, '.worktrees/gone'), { recursive: true, force: true })
  assert.deepEqual((await gatherFacts(repo)).busy.map(b => b.task), ['t'], 'a task whose directory is gone is not running')
  const inside = await gatherFacts(join(repo, '.worktrees/t'))
  assert.equal(inside.linked, true)
  assert.equal(inside.task, 't')
  assert.equal(inside.initialized, true, 'the main checkout\'s .ai/ counts')
})

test('isGitRef answers as git does: branches, commits and remote-only branches switch, files do not', () => {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'x\n')
  git('add', 'README.md')
  git('commit', '-q', '-m', 'x')
  git('branch', 'feat/a')
  git('update-ref', 'refs/remotes/origin/only-remote', 'HEAD')
  assert.equal(isGitRef(repo, 'feat/a'), true)
  assert.equal(isGitRef(repo, 'HEAD~0'), true)
  assert.equal(isGitRef(repo, 'only-remote'), true, 'git creates it from origin/only-remote')
  assert.equal(isGitRef(repo, 'README.md'), false)
  assert.equal(isGitRef(repo, 'no-such-name'), false)
  assert.equal(isGitRef(repo, '--orphan'), false)
})
