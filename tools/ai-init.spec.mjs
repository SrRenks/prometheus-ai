/**
 * ai-init, run in throwaway directories.
 *
 * It must leave a team repository's tracked files alone: `.ai/` is ignored
 * through `.git/info/exclude`, which is local to the clone, and no
 * `./AGENTS.md` is linked unless asked, because Claude Code (2.1.277+) loads a
 * project AGENTS.md whenever the project has no CLAUDE.md, which would put the
 * whole shared rule set back into token-mode sessions.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-init-spec-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(cmd, args, cwd = dir) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, AGENT_CONFIG_DIR: ROOT, AGENT_CONFIG_LOCAL: join(tmpdir(), 'ai-init-spec-no-local') } })
}

const aiInit = (...args) => run('bash', [join(ROOT, 'ai-init'), ...args])
const exclude = () => readFileSync(join(dir, '.git/info/exclude'), 'utf8')

test('in a git repo it creates .ai/, ignores it locally, and touches no tracked file', () => {
  run('git', ['init', '-q'])
  const r = aiInit()
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(dir, '.ai/project.md')))
  assert.match(exclude(), /^\.ai\/$/m)
  assert.ok(!existsSync(join(dir, '.gitignore')), 'the team .gitignore is not edited')
  assert.ok(!existsSync(join(dir, 'AGENTS.md')), 'no AGENTS.md link by default')
  assert.equal(run('git', ['status', '--porcelain']).stdout, '', 'nothing untracked shows up')
})

test('a re-run adds nothing twice', () => {
  run('git', ['init', '-q'])
  aiInit()
  aiInit()
  assert.equal(exclude().match(/^\.ai\/$/gm).length, 1)
})

test('--link-agents links ./AGENTS.md for Cursor and ignores the link too', () => {
  run('git', ['init', '-q'])
  assert.equal(aiInit('--link-agents').status, 0)
  assert.ok(lstatSync(join(dir, 'AGENTS.md')).isSymbolicLink())
  assert.equal(readlinkSync(join(dir, 'AGENTS.md')), join(ROOT, 'AGENTS.md'))
  assert.match(exclude(), /^\/AGENTS\.md$/m)
  assert.equal(run('git', ['status', '--porcelain']).stdout, '')
})

test('--team writes a short AGENTS.md meant to be committed', () => {
  run('git', ['init', '-q'])
  assert.equal(aiInit('--team').status, 0)
  assert.ok(!lstatSync(join(dir, 'AGENTS.md')).isSymbolicLink())
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /## Commands/)
  assert.match(run('git', ['status', '--porcelain']).stdout, /AGENTS\.md/, 'it shows up to be committed')
  // An existing team file is never overwritten.
  assert.match(aiInit('--team').stdout, /skip: \.\/AGENTS\.md/)
})

test('--team and --link-agents together are refused', () => {
  run('git', ['init', '-q'])
  const r = aiInit('--team', '--link-agents')
  assert.notEqual(r.status, 0)
  assert.ok(!existsSync(join(dir, '.ai')))
})

test('outside git it still creates .ai/ and writes no ignore file', () => {
  const r = aiInit()
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(dir, '.ai/project.md')))
  assert.ok(!existsSync(join(dir, '.gitignore')))
})

// Fresh-context review, round two.
test('from a subdirectory it sets up the repository root, where the gate looks', () => {
  run('git', ['init', '-q'])
  mkdirSync(join(dir, 'sub'))
  const r = run('bash', [join(ROOT, 'ai-init'), '--link-agents'], join(dir, 'sub'))
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(dir, '.ai/project.md')))
  assert.ok(!existsSync(join(dir, 'sub/.ai')))
  assert.ok(lstatSync(join(dir, 'AGENTS.md')).isSymbolicLink())
  assert.equal(run('git', ['status', '--porcelain']).stdout, '')
})

test('--team replaces an old link to the shared rules instead of pointing at it', () => {
  run('git', ['init', '-q'])
  symlinkSync(join(ROOT, 'AGENTS.md'), join(dir, 'AGENTS.md'))
  const r = aiInit('--team')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!lstatSync(join(dir, 'AGENTS.md')).isSymbolicLink())
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /## Commands/)
  assert.ok(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').startsWith('# AGENTS.md - v'), 'the shared rules are untouched')
})

test('an exclude file without a final newline keeps its last rule', () => {
  run('git', ['init', '-q'])
  mkdirSync(join(dir, '.git/info'), { recursive: true })
  writeFileSync(join(dir, '.git/info/exclude'), '*.log')
  aiInit()
  assert.match(exclude(), /^\*\.log$/m)
  assert.match(exclude(), /^\.ai\/$/m)
})

test('in a linked worktree it sets up the main checkout, whose .ai/ worktrees share', () => {
  run('git', ['init', '-q', '-b', 'main'])
  run('git', ['-c', 'user.email=s@example.invalid', '-c', 'user.name=s', 'commit', '-q', '--allow-empty', '-m', 'x'])
  run('git', ['worktree', 'add', '-q', '-b', 'feat/x', join(dir, '.worktrees/x')])
  const r = run('bash', [join(ROOT, 'ai-init')], join(dir, '.worktrees/x'))
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(dir, '.ai/project.md')))
  assert.ok(!existsSync(join(dir, '.worktrees/x/.ai')))
})

test('.ai/overlay.md links the shipped default, or a named overlay of the user', () => {
  const local = join(dir, 'local')
  mkdirSync(join(local, 'overlays'), { recursive: true })
  writeFileSync(join(local, 'overlays/acme.md'), '# Overlay - acme\n')
  const env = { ...process.env, AGENT_CONFIG_DIR: ROOT, AGENT_CONFIG_LOCAL: local }
  const init = (...args) => spawnSync('bash', [join(ROOT, 'ai-init'), ...args], { cwd: dir, encoding: 'utf8', env })
  run('git', ['init', '-q'])
  assert.equal(init().status, 0)
  assert.equal(readlinkSync(join(dir, '.ai/overlay.md')), join(ROOT, 'core/overlays/default.md'))
  assert.equal(init('--overlay', 'acme').status, 0)
  assert.equal(readlinkSync(join(dir, '.ai/overlay.md')), join(local, 'overlays/acme.md'))
  assert.equal(init('--overlay', 'missing').status, 2)
  assert.equal(init('--overlay', '../x').status, 2)
  assert.equal(readlinkSync(join(dir, '.ai/overlay.md')), join(local, 'overlays/acme.md'), 'a failed pick keeps the link')
})

test('--help prints the usage and no code', () => {
  const r = aiInit('--help')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /--team/)
  assert.doesNotMatch(r.stdout, /set -euo/)
})

test('a hand-written .ai/overlay.md is never replaced', () => {
  run('git', ['init', '-q'])
  mkdirSync(join(dir, '.ai'))
  writeFileSync(join(dir, '.ai/overlay.md'), '# mine\n')
  assert.equal(aiInit('--overlay', 'default').status, 0)
  assert.equal(readFileSync(join(dir, '.ai/overlay.md'), 'utf8'), '# mine\n')
})
