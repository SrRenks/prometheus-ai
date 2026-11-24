/**
 * ai-worktree, run in throwaway repositories.
 *
 * Two agents in one checkout share HEAD and the index, so one agent's branch
 * switch moves the files under the other. Each task gets its own worktree and
 * branch, locked while it runs, with the project's .ai/ knowledge shared from
 * the main checkout and its session notes kept apart.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let repo

const run = (cmd, args, cwd = repo) => spawnSync(cmd, args, { cwd, encoding: 'utf8' })
const git = (...args) => run('git', args)
const wt = (args, cwd = repo) => run('bash', [join(ROOT, 'ai-worktree'), ...args], cwd)

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'ai-worktree-spec-')))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'spec@example.invalid')
  git('config', 'user.name', 'spec')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'init')
})

afterEach(() => rmSync(repo, { recursive: true, force: true }))

test('new makes a locked worktree on its own branch, ignored and out of the main status', () => {
  const r = wt(['new', 'login-fix', '--type', 'fix'])
  assert.equal(r.status, 0, r.stderr)
  const dir = join(repo, '.worktrees/login-fix')
  assert.equal(run('git', ['branch', '--show-current'], dir).stdout.trim(), 'fix/login-fix')
  assert.equal(git('branch', '--show-current').stdout.trim(), 'main', 'the main checkout did not move')
  assert.equal(git('status', '--porcelain').stdout, '')
  assert.match(git('worktree', 'list', '--porcelain').stdout, /locked ai-worktree: task login-fix/)
  assert.match(wt(['list']).stdout, /fix\/login-fix  locked/)
})

test('the main checkout\'s .ai/ is shared, and the notes are the task\'s own', () => {
  mkdirSync(join(repo, '.ai/context'), { recursive: true })
  writeFileSync(join(repo, '.ai/project.md'), '# p\n')
  writeFileSync(join(repo, '.ai/session.md'), 'main session\n')
  writeFileSync(join(repo, '.git/info/exclude'), '.ai/\n')
  assert.equal(wt(['new', 'feature-a']).status, 0)
  const ai = join(repo, '.worktrees/feature-a/.ai')
  assert.ok(lstatSync(join(ai, 'project.md')).isSymbolicLink())
  assert.ok(lstatSync(join(ai, 'context')).isSymbolicLink())
  assert.ok(!lstatSync(join(ai, 'session.md')).isSymbolicLink())
  assert.match(readFileSync(join(ai, 'session.md'), 'utf8'), /Branch: feat\/feature-a/)
  assert.equal(run('git', ['status', '--porcelain'], dirname(ai)).stdout, '', '.ai/ is ignored there too')
})

test('two tasks run side by side, and a branch is never checked out twice', () => {
  assert.equal(wt(['new', 'one']).status, 0)
  assert.equal(wt(['new', 'two']).status, 0)
  assert.equal(wt(['new', 'one']).status, 2, 'the same task twice is refused')
  const twice = wt(['new', 'other', '--branch', 'feat/one'])
  assert.notEqual(twice.status, 0, 'git refuses a branch checked out in another worktree')
})

test('it works from inside a worktree too, and finds the main checkout', () => {
  assert.equal(wt(['new', 'one']).status, 0)
  const r = wt(['new', 'two'], join(repo, '.worktrees/one'))
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(repo, '.worktrees/two/a.txt')))
})

test('.worktreeinclude copies ignored files such as .env, and the worktree still removes', () => {
  writeFileSync(join(repo, '.gitignore'), '.env\nconfig/local/\n')
  mkdirSync(join(repo, 'config/local'), { recursive: true })
  writeFileSync(join(repo, 'config/local/db.env'), 'DB=x\n')
  writeFileSync(join(repo, '.env'), 'KEY=local\n')
  writeFileSync(join(repo, '.worktreeinclude'), '# local files\n.env\nconfig/local/\n')
  git('add', '.gitignore', '.worktreeinclude')
  git('commit', '-q', '-m', 'ignore')
  assert.equal(wt(['new', 'env']).status, 0)
  assert.equal(readFileSync(join(repo, '.worktrees/env/.env'), 'utf8'), 'KEY=local\n')
  assert.equal(readFileSync(join(repo, '.worktrees/env/config/local/db.env'), 'utf8'), 'DB=x\n', 'gitignore syntax: a directory line')
  const r = wt(['remove', 'env'])
  assert.equal(r.status, 0, r.stderr)
})

test('.worktreeinclude never reaches outside the repository, nor copies a tracked file', () => {
  const outside = join(dirname(repo), `${repo.split('/').pop()}-secret.txt`)
  writeFileSync(outside, 'secret\n')
  try {
    writeFileSync(join(repo, 'a.txt'), 'edited\n')
    writeFileSync(join(repo, '.worktreeinclude'), `../${outside.split('/').pop()}\n${outside}\nx ${outside}\na.txt\n`)
    assert.equal(wt(['new', 'safe']).status, 0)
    assert.ok(!existsSync(join(repo, outside.split('/').pop())), 'nothing lands in the main checkout')
    assert.equal(readFileSync(join(repo, '.worktrees/safe/a.txt'), 'utf8'), 'a\n', 'the committed file, not the edit')
    assert.equal(run('git', ['status', '--porcelain'], join(repo, '.worktrees/safe')).stdout, '')
  } finally {
    rmSync(outside, { force: true })
  }
})

test('a worktree deleted by hand is forgotten, and its branch is free again', () => {
  assert.equal(wt(['new', 'gone']).status, 0)
  rmSync(join(repo, '.worktrees/gone'), { recursive: true, force: true })
  const r = wt(['remove', 'gone', '--delete-branch'])
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(git('worktree', 'list').stdout, /gone/)
  assert.equal(git('branch', '--list', 'feat/gone').stdout, '')
  assert.equal(wt(['new', 'gone']).status, 0, 'the name can be used again')
})

test('ticket-style names work, and an unmerged branch is kept with a note', () => {
  assert.equal(wt(['new', 'PROJ-123']).status, 0)
  const dir = join(repo, '.worktrees/PROJ-123')
  writeFileSync(join(dir, 'b.txt'), 'b\n')
  run('git', ['add', 'b.txt'], dir)
  run('git', ['-c', 'user.email=s@example.invalid', '-c', 'user.name=s', 'commit', '-q', '-m', 'b'], dir)
  const r = wt(['remove', 'PROJ-123', '--delete-branch'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /kept branch feat\/PROJ-123/)
})

test('remove refuses uncommitted work, then removes a clean worktree and a merged branch', () => {
  assert.equal(wt(['new', 'done']).status, 0)
  const dir = join(repo, '.worktrees/done')
  writeFileSync(join(dir, 'b.txt'), 'b\n')
  assert.equal(wt(['remove', 'done']).status, 2)
  rmSync(join(dir, 'b.txt'))
  const r = wt(['remove', 'done', '--delete-branch'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!existsSync(dir))
  assert.equal(git('branch', '--list', 'feat/done').stdout, '')
})

test('task names that could escape the directory are refused', () => {
  for (const name of ['../x', '.hidden', 'a/b', 'a..b', 'a b']) assert.equal(wt(['new', name]).status, 2, name)
})
