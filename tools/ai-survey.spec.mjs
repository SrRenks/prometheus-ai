/**
 * ai-survey, run against throwaway repositories.
 *
 * The report is read by an onboarding agent instead of the whole repository,
 * so each fact must be computed, the format must stay agent-facing (no tables,
 * no bold), nothing may be written, and remote URLs never appear: they can
 * carry tokens.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { countDirty, detectMarkers, parseWorktrees, topExtensions } from './ai-survey.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'spec',
  GIT_AUTHOR_EMAIL: 'spec@example.invalid',
  GIT_COMMITTER_NAME: 'spec',
  GIT_COMMITTER_EMAIL: 'spec@example.invalid',
  AGENT_CONFIG_DIR: ROOT,
}
let dir

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ai-survey-spec-')))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(cmd, args, cwd = dir) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: ENV })
}

const git = (cwd, ...args) => run('git', args, cwd)
const survey = (cwd = dir, ...args) => run('bash', [join(ROOT, 'ai-survey'), ...args], cwd)

function write(base, rel, text = 'x\n') {
  mkdirSync(dirname(join(base, rel)), { recursive: true })
  writeFileSync(join(base, rel), text)
}

function commit(base, rel, text) {
  write(base, rel, text)
  git(base, 'add', rel)
  git(base, 'commit', '-qm', `touch ${rel}`)
}

function seedRepo(base) {
  git(base, 'init', '-q', '-b', 'main')
  for (const rel of ['package.json', '.github/workflows/ci.yml', 'Dockerfile', 'db/migrations/001.sql',
    'tests/unit/a_test.go', 'src/app.spec.ts', 'README.md', 'infra/main.tf']) commit(base, rel)
  for (let i = 0; i < 3; i++) commit(base, 'src/hot.js', `v${i}\n`)
  for (let i = 0; i < 5; i++) commit(base, 'package-lock.json', `v${i}\n`)
}

test('a git repo gets the git state, files, markers and churn, in agent-facing markdown', () => {
  seedRepo(dir)
  write(dir, 'untracked.txt')
  write(dir, 'README.md', 'changed\n')
  const r = survey()
  assert.equal(r.status, 0, r.stderr)
  const out = r.stdout
  assert.match(out, new RegExp(`^- root: ${dir}$`, 'm'))
  assert.match(out, /^- branch: main$/m)
  assert.match(out, /^- upstream: none$/m)
  assert.match(out, /^- dirty: 0 staged, 1 unstaged, 1 untracked$/m)
  assert.match(out, /^- stashes: 0$/m)
  assert.match(out, /^- checkout: main checkout$/m)
  assert.match(out, /touch package-lock\.json/)
  assert.match(out, /^- tracked files: 10$/m)
  assert.match(out, /^- \.json: 2$/m)
  for (const marker of ['package.json', '.github/workflows/ci.yml', 'Dockerfile', 'infra/main.tf', 'db/',
    'db/migrations/', 'tests/', 'tests/unit/a_test.go', 'src/app.spec.ts', 'README.md'])
    assert.ok(out.includes(marker), `marker ${marker}`)
  assert.match(out, /^- 3 commits: src\/hot\.js$/m)
  assert.doesNotMatch(out, /commits: package-lock\.json/, 'lockfiles are not churn')
  assert.doesNotMatch(out, /\*\*|^\s*\|.*\|\s*$/m, 'no bold, no tables')
})

test('it writes no file and changes no git state', () => {
  seedRepo(dir)
  const before = git(dir, 'status', '--porcelain', '--ignored').stdout
  assert.equal(survey().status, 0)
  assert.equal(git(dir, 'status', '--porcelain', '--ignored').stdout, before)
})

test('--top limits the churn list and --since narrows it', () => {
  seedRepo(dir)
  const top = survey(dir, '--top', '1').stdout
  assert.equal(top.match(/^- \d+ commits?: /gm).length, 1)
  const future = survey(dir, '--since', '2099-01-01').stdout
  assert.equal(future.match(/^- \d+ commits?: /gm), null)
  assert.match(future, /no commits since 2099-01-01/)
})

test('an upstream reports ahead and behind without fetching', () => {
  seedRepo(dir)
  const clone = join(dir, 'clone')
  git(dir, 'clone', '-q', dir, clone)
  commit(clone, 'local.txt')
  const out = survey(clone).stdout
  assert.match(out, /^- upstream: origin\/main, 1 ahead, 0 behind$/m)
  assert.doesNotMatch(out, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!/clone)'), 'no remote URL')
})

test('a detached HEAD and a linked worktree are named as such', () => {
  seedRepo(dir)
  const wt = join(dir, '..', `${dir.split('/').pop()}-wt`)
  git(dir, 'worktree', 'add', '-q', '--detach', wt)
  try {
    git(dir, 'worktree', 'lock', wt)
    const out = survey(wt).stdout
    assert.match(out, /^- branch: detached at [0-9a-f]{7,}$/m)
    assert.match(out, /^- checkout: linked worktree$/m)
    assert.ok(out.includes(`- ${wt}: detached, locked (this)`), out)
    assert.ok(out.includes(`- ${dir}: branch main`))
  } finally {
    git(dir, 'worktree', 'unlock', wt)
    git(dir, 'worktree', 'remove', '--force', wt)
  }
})

test('--siblings lists each direct git repo with stack, date and .ai state, and never a remote URL', () => {
  const secret = 'https://user:s3cr3t-token@example.invalid/repo.git'
  const api = join(dir, 'api')
  mkdirSync(api)
  git(api, 'init', '-q', '-b', 'main')
  commit(api, 'go.mod', 'module x\n')
  git(api, 'remote', 'add', 'origin', secret)
  write(api, '.ai/project.md')
  const web = join(dir, 'web')
  mkdirSync(web)
  git(web, 'init', '-q', '-b', 'main')
  write(web, 'package.json', '{}\n')
  mkdirSync(join(dir, 'plain'))
  const mono = join(dir, 'mono')
  mkdirSync(mono)
  git(mono, 'init', '-q', '-b', 'main')
  write(mono, 'svc/requirements.txt')
  write(mono, 'ui/package.json', '{}\n')
  const r = survey(dir, '--siblings', dir)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^- api: go, last commit \d{4}-\d\d-\d\d, \.ai\/project\.md present$/m)
  assert.match(r.stdout, /^- web: node, no commits, \.ai\/project\.md missing$/m)
  assert.match(r.stdout, /^- mono: python\+node \(in subdirs\), no commits, \.ai\/project\.md missing$/m)
  assert.doesNotMatch(r.stdout, /plain/)
  assert.doesNotMatch(r.stdout, /s3cr3t|example\.invalid/)
})

test('outside git it walks to depth 4, skips vendored dirs, says git is unavailable and exits 0', () => {
  write(dir, 'pyproject.toml')
  write(dir, 'a/b/c/d/deep.py')
  write(dir, 'a/b/c/d/e/too-deep.py')
  write(dir, 'node_modules/pkg/package.json')
  const r = survey()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /git facts unavailable/)
  assert.match(r.stdout, /^- files \(walk, depth 4\): 2$/m)
  assert.match(r.stdout, /pyproject\.toml/)
  assert.doesNotMatch(r.stdout, /node_modules/)
})

test('bad arguments are refused with the usage', () => {
  const r = survey(dir, '--top', 'many')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /usage: ai-survey/)
})

test('countDirty splits porcelain v1 into staged, unstaged and untracked', () => {
  assert.deepEqual(countDirty('M  a\n M b\nMM c\n?? d\nR  e -> f\n'), { staged: 3, unstaged: 2, untracked: 1 })
  assert.deepEqual(countDirty(''), { staged: 0, unstaged: 0, untracked: 0 })
})

test('parseWorktrees reads path, branch, detached and locked', () => {
  const text = 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /w\nHEAD def\ndetached\nlocked why\n\n'
  assert.deepEqual(parseWorktrees(text), [
    { path: '/r', branch: 'main', locked: false, bare: false },
    { path: '/w', branch: null, locked: true, bare: false },
  ])
})

test('topExtensions counts extensions, names files without one, and caps the list', () => {
  const files = ['a.js', 'b.js', 'c.JS', 'Makefile', 'x.md', '.gitignore']
  assert.deepEqual(topExtensions(files, 2), [['.js', 3], ['(none)', 2]])
})

test('detectMarkers keeps generics apart from markers', () => {
  const m = detectMarkers(['requirements-dev.txt', 'src/test_utils.py', 'k8s/deploy.yaml', 'web/__tests__/x.js'])
  assert.deepEqual(m.manifests, ['requirements-dev.txt'])
  assert.deepEqual(m.infra, ['k8s/'])
  assert.deepEqual([...m.tests].sort(), ['src/test_utils.py', 'web/__tests__/'], 'pytest names test_*.py')
})
