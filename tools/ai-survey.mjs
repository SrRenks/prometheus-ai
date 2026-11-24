/**
 * ai-survey - print computed facts about a project for an onboarding agent.
 *
 * The point is that an agent starting in a repository reads one short report
 * instead of the whole tree, and that every number in it comes from a command
 * (git or a filesystem walk), never from a guess. The report is agent-facing
 * markdown: headers and bullets, no tables, no bold.
 *
 * It is read-only. It writes no file, never fetches, and runs git with
 * GIT_OPTIONAL_LOCKS=0 so `git status` does not refresh the index either.
 * Remote URLs are never printed: they can carry credentials.
 *
 * Outside git it still reports files and markers from a depth-4 walk and says
 * that the git facts are unavailable; the exit code stays 0.
 *
 * Usage: ai-survey [--siblings <dir>] [--since <git date>] [--top N]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const USAGE = 'usage: ai-survey [--siblings <dir>] [--since <git date, default "6 months ago">] [--top N, default 15]'
const WALK_DEPTH = 4
const WALK_SKIP = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.venv'])
const MARKER_CAP = 10
const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle',
  'composer.json', 'Gemfile', 'serverless.yml'])
const CI_FILES = new Set(['.gitlab-ci.yml', 'Jenkinsfile', 'bitbucket-pipelines.yml'])
const DIR_MARKERS = { infra: new Set(['k8s', 'helm']), db: new Set(['db', 'migrations']),
  tests: new Set(['test', 'tests', '__tests__', 'spec']) }
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'Gemfile.lock', 'composer.lock'])
const AGENT_DOCS = ['AGENTS.md', 'CLAUDE.md', '.ai/project.md', 'README.md', 'docs/']
const STACKS = [['package.json', 'node'], ['pyproject.toml', 'python'], ['go.mod', 'go'], ['Cargo.toml', 'rust'],
  ['pom.xml', 'java'], ['build.gradle', 'jvm'], ['build.gradle.kts', 'jvm'], ['composer.json', 'php'],
  ['Gemfile', 'ruby'], ['serverless.yml', 'serverless']]

/** Run git in cwd; returns trimmed stdout, or null when git fails. */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  return r.status === 0 ? r.stdout.replace(/\n+$/, '') : null
}

/** Split command output into non-empty lines. */
const lines = (text) => (text ? text.split('\n').filter(Boolean) : [])

/**
 * Count dirty entries from `git status --porcelain=v1` output.
 * @param {string} porcelain
 * @returns {{staged: number, unstaged: number, untracked: number}}
 */
export function countDirty(porcelain) {
  const c = { staged: 0, unstaged: 0, untracked: 0 }
  for (const l of lines(porcelain)) {
    if (l.startsWith('??')) c.untracked++
    else {
      if (l[0] !== ' ') c.staged++
      if (l[1] !== ' ') c.unstaged++
    }
  }
  return c
}

/**
 * Parse `git worktree list --porcelain` into one record per worktree.
 * @param {string} text
 * @returns {{path: string, branch: string|null, locked: boolean, bare: boolean}[]}
 */
export function parseWorktrees(text) {
  const out = []
  for (const block of text.split(/\n\s*\n/)) {
    const rows = lines(block)
    const path = rows.find((r) => r.startsWith('worktree '))
    if (!path) continue
    const branch = rows.find((r) => r.startsWith('branch '))
    out.push({
      path: path.slice('worktree '.length),
      branch: branch ? branch.slice('branch '.length).replace(/^refs\/heads\//, '') : null,
      locked: rows.some((r) => r === 'locked' || r.startsWith('locked ')),
      bare: rows.includes('bare'),
    })
  }
  return out
}

/**
 * The most common file extensions, lowercased; files without one count as `(none)`.
 * @param {string[]} files - relative paths
 * @param {number} n - how many to keep
 * @returns {[string, number][]} sorted by count, then name
 */
export function topExtensions(files, n) {
  const counts = new Map()
  for (const f of files) {
    const ext = extname(basename(f)).toLowerCase() || '(none)'
    counts.set(ext, (counts.get(ext) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
}

/** The marker category of one file by its name, or null. */
function fileMarker(path) {
  const name = basename(path)
  if (MANIFESTS.has(name) || /^requirements.*\.txt$/.test(name)) return 'manifests'
  if (path.startsWith('.github/workflows/') || CI_FILES.has(name)) return 'ci'
  if (/^Dockerfile/.test(name) || /^docker-compose/.test(name) || name.endsWith('.tf')) return 'infra'
  if (/(_test|\.spec|\.test)\.[^.]+$/.test(name) || /^test_.+\.py$/.test(name)) return 'tests'
  return null
}

/**
 * Find project markers (manifests, CI, containers and IaC, db, tests) in a file list.
 * Directory markers are derived from the files' parent directories, shown with a trailing `/`.
 * @param {string[]} files - relative paths with `/` separators
 * @returns {{manifests: string[], ci: string[], infra: string[], db: string[], tests: string[]}}
 */
export function detectMarkers(files) {
  const found = { manifests: new Set(), ci: new Set(), infra: new Set(), db: new Set(), tests: new Set() }
  for (const f of files) {
    const kind = fileMarker(f)
    if (kind) found[kind].add(f)
    const parts = f.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      for (const [k, names] of Object.entries(DIR_MARKERS)) {
        if (names.has(parts[i])) found[k].add(`${parts.slice(0, i + 1).join('/')}/`)
      }
    }
  }
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v].sort()]))
}

/** Relative file paths under root, to WALK_DEPTH directories deep, skipping vendored dirs. */
function walkFiles(root, rel = '', depth = 0) {
  const out = []
  let entries
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const path = rel ? `${rel}/${e.name}` : e.name
    if (e.isFile()) out.push(path)
    else if (e.isDirectory() && !WALK_SKIP.has(e.name) && depth < WALK_DEPTH) out.push(...walkFiles(root, path, depth + 1))
  }
  return out
}

/** Upstream line: name plus ahead/behind, or none. Never fetches. */
function upstreamLine(root) {
  const up = git(root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  if (!up) return '- upstream: none'
  const counts = git(root, 'rev-list', '--left-right', '--count', 'HEAD...@{u}')
  if (!counts) return `- upstream: ${up}, ahead/behind unknown`
  const [ahead, behind] = counts.split(/\s+/)
  return `- upstream: ${up}, ${ahead} ahead, ${behind} behind`
}

/** The worktree bullets, the current one marked `(this)`. */
function worktreeLines(root) {
  const text = git(root, 'worktree', 'list', '--porcelain')
  if (text === null) return ['- worktrees: unavailable']
  const out = ['- worktrees:']
  for (const w of parseWorktrees(text)) {
    const tags = [w.branch ? `branch ${w.branch}` : w.bare ? 'bare' : 'detached']
    if (w.locked) tags.push('locked')
    out.push(`  - ${w.path}: ${tags.join(', ')}${w.path === root ? ' (this)' : ''}`)
  }
  return out
}

/** The git state section for a repository root. */
function gitSection(root) {
  const branch = git(root, 'symbolic-ref', '--short', '-q', 'HEAD')
  const head = git(root, 'rev-parse', '--short', 'HEAD')
  const d = countDirty(git(root, 'status', '--porcelain=v1') ?? '')
  const dirs = lines(git(root, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'))
  const commits = lines(git(root, 'log', '-n', '10', '--format=%h %cs %s'))
  return [
    '## Git',
    `- root: ${root}`,
    `- branch: ${branch ?? (head ? `detached at ${head}` : 'unknown')}`,
    upstreamLine(root),
    `- dirty: ${d.staged} staged, ${d.unstaged} unstaged, ${d.untracked} untracked`,
    `- stashes: ${lines(git(root, 'stash', 'list')).length}`,
    `- checkout: ${dirs.length === 2 && dirs[0] === dirs[1] ? 'main checkout' : 'linked worktree'}`,
    '- last commits:',
    ...(commits.length ? commits.map((c) => `  - ${c}`) : ['  - none']),
    ...worktreeLines(root),
  ]
}

/** The files section: a count and the top extensions. */
function filesSection(files, countLabel) {
  return [
    '## Files',
    `- ${countLabel}: ${files.length}`,
    '',
    '### Top extensions',
    ...topExtensions(files, 10).map(([ext, n]) => `- ${ext}: ${n}`),
  ]
}

/** One bullet per marker category, capped, plus the agent docs present at root. */
function markersSection(files, root) {
  const m = detectMarkers(files)
  const labels = { manifests: 'manifests', ci: 'ci', infra: 'containers and iac', db: 'db and migrations',
    tests: 'tests' }
  const out = ['## Markers']
  for (const [k, label] of Object.entries(labels)) {
    const shown = m[k].slice(0, MARKER_CAP).join(', ')
    const more = m[k].length > MARKER_CAP ? ` (+${m[k].length - MARKER_CAP} more, ${m[k].length} total)` : ''
    out.push(`- ${label}: ${m[k].length ? shown + more : 'none'}`)
  }
  const present = AGENT_DOCS.filter((p) => existsSync(join(root, p)))
  const missing = AGENT_DOCS.filter((p) => !present.includes(p))
  out.push(`- agent docs present: ${present.join(', ') || 'none'}`)
  out.push(`- agent docs missing: ${missing.join(', ') || 'none'}`)
  return out
}

/** The churn section: top files by commit count since a date, lockfiles excluded. */
function churnSection(root, since, top) {
  const out = [`## Churn since ${since}`]
  const commits = Number(git(root, 'rev-list', '--count', `--since=${since}`, 'HEAD') ?? 0)
  if (!commits) return [...out, `- no commits since ${since}`]
  out.push(`- commits: ${commits}`)
  const counts = new Map()
  for (const f of lines(git(root, 'log', `--since=${since}`, '--format=', '--name-only'))) {
    if (!LOCKFILES.has(basename(f))) counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top)
  for (const [f, n] of ranked) out.push(`- ${n} commit${n === 1 ? '' : 's'}: ${f}`)
  return out
}

/** Stack names from the manifests directly in dir. */
function stackNames(dir) {
  const names = new Set(STACKS.filter(([f]) => existsSync(join(dir, f))).map(([, s]) => s))
  try {
    if (readdirSync(dir).some((f) => /^requirements.*\.txt$/.test(f))) names.add('python')
  } catch { /* unreadable: no stack */ }
  return names
}

/** The detected stack of a repo: its root manifests, else those one level down (monorepos). */
function detectStack(dir) {
  const root = stackNames(dir)
  if (root.size) return [...root].join('+')
  const subs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !WALK_SKIP.has(e.name))
    .map((e) => e.name).sort()
  const names = new Set(subs.flatMap((s) => [...stackNames(join(dir, s))]))
  return names.size ? `${[...names].join('+')} (in subdirs)` : 'unknown stack'
}

/** One line per direct subdirectory that is a git repository. Never prints remotes. */
function siblingsSection(dir) {
  const out = [`## Siblings in ${resolve(dir)}`]
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort()
  for (const name of names) {
    const sub = join(dir, name)
    let isDir = false
    try { isDir = statSync(sub).isDirectory() } catch { /* dangling link */ }
    if (!isDir || !existsSync(join(sub, '.git'))) continue
    const date = git(sub, 'log', '-1', '--format=%cs')
    const ai = existsSync(join(sub, '.ai/project.md')) ? 'present' : 'missing'
    out.push(`- ${name}: ${detectStack(sub)}, ${date ? `last commit ${date}` : 'no commits'}, .ai/project.md ${ai}`)
  }
  if (out.length === 1) out.push('- no git repositories')
  return out
}

/**
 * Build the survey report for a directory.
 * @param {{cwd: string, since: string, top: number, siblings?: string}} options
 * @returns {string} agent-facing markdown
 */
export function survey({ cwd, since, top, siblings }) {
  const root = git(cwd, 'rev-parse', '--show-toplevel')
  const base = root ?? resolve(cwd)
  const sections = [[`# Survey of ${basename(base)}`,
    '- computed by ai-survey from git and the filesystem; nothing was written or fetched']]
  if (root) {
    const files = (git(root, 'ls-files', '-z') ?? '').split('\0').filter(Boolean)
    sections.push(gitSection(root), filesSection(files, 'tracked files'), markersSection(files, root),
      churnSection(root, since, top))
  } else {
    const files = walkFiles(base)
    sections.push(['## Git', `- git facts unavailable: ${base} is not inside a git repository`],
      filesSection(files, `files (walk, depth ${WALK_DEPTH})`), markersSection(files, base))
  }
  if (siblings) sections.push(siblingsSection(siblings))
  return `${sections.map((s) => s.join('\n')).join('\n\n')}\n`
}

/** Parse argv into survey options; throws with a message on bad input. */
function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { siblings: { type: 'string' }, since: { type: 'string', default: '6 months ago' },
      top: { type: 'string', default: '15' }, help: { type: 'boolean', short: 'h' } },
  })
  if (positionals.length) throw new Error(`unexpected argument: ${positionals[0]}`)
  if (!/^[1-9]\d*$/.test(values.top)) throw new Error(`--top must be a positive integer, got ${values.top}`)
  if (values.siblings !== undefined && !(existsSync(values.siblings) && statSync(values.siblings).isDirectory())) {
    throw new Error(`--siblings ${values.siblings} is not a directory`)
  }
  return { ...values, top: Number(values.top) }
}

function main(argv) {
  let opts
  try {
    opts = parseOptions(argv)
  } catch (e) {
    console.error(`ai-survey: ${e.message}\n${USAGE}`)
    return 2
  }
  if (opts.help) {
    console.log(USAGE)
    return 0
  }
  process.stdout.write(survey({ cwd: process.cwd(), since: opts.since, top: opts.top, siblings: opts.siblings }))
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
