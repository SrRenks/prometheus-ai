/**
 * ai-lint - lint the agent-facing `.ai/**\/*.md` files of a project.
 *
 * `.ai/` is read by agents, so it follows the agent-facing format (AGENTS.md
 * section 0 rule 8): headers and bullets, no tables, no bold. It also catches
 * what goes stale: template placeholders nobody filled and `path:line`
 * citations whose file or line no longer exists.
 *
 * Errors: table, bold, placeholder, citation, broken-link. Warning: long-file.
 * Output is one `file:line: rule: text` line per finding; the exit code is 1
 * when any error is found, 2 on a usage error, 0 otherwise.
 *
 * Symlinked files are followed, except `agents.md` at the `.ai/` root: it is
 * the shared AGENTS.md, linted where it lives. Symlinked directories are not
 * descended into, so a link cycle cannot loop; a dangling link of any kind is
 * still reported.
 *
 * Usage: ai-lint [dir, default .ai]
 */
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const LONG_FILE = 150
const USAGE = 'usage: ai-lint [dir, default .ai]'
const PLACEHOLDERS = [
  /<[a-z][a-z0-9]*(?:-[a-z0-9]+)+>/g,
  /\{describe\b[^}]*\}/gi,
  /\bTBD\b/g,
  /\bTODO:\s*fill\b/gi,
]
// A `**` glued to a word, a `/` or another `*` is a glob such as `secrets/**`, not emphasis.
const BOLD = /(?<![\w/*])\*\*(?=[^\s*/,.;:])(?:.*?[^\s*])?\*\*(?![\w*/])/g
const CODE_SPAN = /(`+)(.+?)\1/g
const CITATION = /^([^\s:]+):(\d+)(?:-(\d+))?$/

/** Split file text into lines, without the empty one a final newline leaves. */
function splitLines(text) {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** True when a line is a GFM table delimiter row such as `|---|:--:|`. */
function isTableSeparator(line) {
  const t = line.trim()
  if (!t.includes('|') || !/^[|:\-\s]+$/.test(t)) return false
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|')
  if (!t.startsWith('|') && cells.length < 2) return false
  return cells.every((c) => /^\s*:?-+:?\s*$/.test(c))
}

/**
 * The file a citation names. Paths are relative to the project root; evidence in
 * a related repository is written `<repo>/<path>` and resolves next to the
 * project, when no such path exists here and `<repo>` is a git checkout there.
 */
function citedFile(root, path) {
  const here = resolve(root, path)
  if (existsSync(here) || !path.includes('/')) return here
  const home = dirname(mainCheckout(root))
  const sibling = resolve(home, path.split('/')[0])
  return existsSync(join(sibling, '.git')) && sibling !== mainCheckout(root) ? resolve(home, path) : here
}

/** The main checkout of a linked worktree, so siblings are looked up next to it; else root. */
function mainCheckout(root) {
  let text
  try {
    text = readFileSync(join(root, '.git'), 'utf8')
  } catch {
    return root
  }
  const gitDir = /^gitdir:\s*(.+)$/m.exec(text)?.[1].trim()
  const match = gitDir === undefined ? null : /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(resolve(root, gitDir))
  return match === null ? root : match[1]
}

/** Is a cited path inside the project or a sibling repository, not an absolute or `..` escape? */
function inBounds(root, path) {
  if (path.startsWith('/') || path.startsWith('~')) return false
  const rel = relative(dirname(mainCheckout(root)), citedFile(root, path))
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/** Check one backticked span as a `path:line[-line]` citation; null when fine or not one. */
function checkCitation(span, root) {
  const s = span.trim()
  if (s.includes('://')) return null
  const m = CITATION.exec(s)
  if (!m) return null
  const [, path, a, b] = m
  if (!path.includes('/') && !/\.[A-Za-z][A-Za-z0-9]*$/.test(basename(path))) return null
  const start = Number(a)
  const end = b === undefined ? start : Number(b)
  if (!inBounds(root, path)) return `${s} (outside the project; cite project paths, or <repo>/<path> for a sibling)`
  const file = citedFile(root, path)
  if (!existsSync(file) || !statSync(file).isFile()) return `${s} (no such file)`
  if (start < 1 || end < start) return `${s} (invalid line range)`
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch (error) {
    return `${s} (unreadable: ${error.code ?? error.message})`
  }
  const count = splitLines(content).length
  return end > count ? `${s} (${path} has ${count} lines)` : null
}

/** Findings for one prose line (not inside a fence). */
function lintLine(line, root) {
  const found = []
  const spans = [...line.matchAll(CODE_SPAN)].map((m) => m[2])
  const prose = line.replace(CODE_SPAN, ' ')
  if (isTableSeparator(prose)) found.push({ rule: 'table', text: line.trim() })
  for (const m of prose.matchAll(BOLD)) found.push({ rule: 'bold', text: m[0] })
  for (const re of PLACEHOLDERS) {
    for (const m of prose.matchAll(re)) found.push({ rule: 'placeholder', text: m[0] })
  }
  for (const span of spans) {
    const text = checkCitation(span, root)
    if (text) found.push({ rule: 'citation', text })
  }
  return found
}

/**
 * Lint the text of one agent-facing markdown file.
 * @param {string} text - the file content
 * @param {{root: string}} options - root is the project root citations resolve against
 * @returns {{line: number, rule: string, text: string, level: 'error'|'warning'}[]}
 */
export function lintText(text, { root }) {
  const lines = splitLines(text)
  const findings = []
  let fence = null
  lines.forEach((line, i) => {
    const open = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null
      return
    }
    if (open) {
      fence = open[1]
      return
    }
    for (const f of lintLine(line, root)) findings.push({ line: i + 1, level: 'error', ...f })
  })
  if (lines.length > LONG_FILE) {
    findings.push({ line: LONG_FILE + 1, rule: 'long-file', level: 'warning',
      text: `warning: ${lines.length} lines, over ${LONG_FILE}` })
  }
  return findings
}

/**
 * Yield every entry under dir, sorted. A symlinked directory is followed too,
 * since a worktree's `.ai/context` links to the main checkout's; each real
 * directory is visited once, so a link cycle ends.
 */
function* walk(dir, rel = '', seen = new Set([realpathSync(dir)])) {
  const entries = readdirSync(join(dir, rel), { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))
  for (const e of entries) {
    const path = join(rel, e.name)
    yield path
    const abs = join(dir, path)
    const isDir = e.isDirectory() || (e.isSymbolicLink() && existsSync(abs) && statSync(abs).isDirectory())
    if (!isDir || seen.has(realpathSync(abs))) continue
    seen.add(realpathSync(abs))
    yield* walk(dir, path, seen)
  }
}

/** Findings for one entry: a dangling link, a skipped link, or a markdown file's lint. */
function lintEntry(aiDir, rel, root) {
  const abs = join(aiDir, rel)
  const isLink = lstatSync(abs).isSymbolicLink()
  if (isLink && !existsSync(abs)) {
    return [{ line: 1, rule: 'broken-link', level: 'error', text: `-> ${readlinkSync(abs)}` }]
  }
  if (isLink && rel === 'agents.md') return []
  if (!rel.endsWith('.md') || !statSync(abs).isFile()) return []
  return lintText(readFileSync(abs, 'utf8'), { root })
}

/**
 * Lint every markdown file under an `.ai/` directory.
 * @param {string} aiDir - the `.ai/` directory; its parent is the project root
 * @param {string} [display] - the prefix printed for each file (default aiDir)
 * @returns {{file: string, line: number, rule: string, text: string, level: string}[]}
 */
export function lintDir(aiDir, display = aiDir) {
  const root = dirname(resolve(aiDir))
  const findings = []
  for (const rel of walk(aiDir)) {
    for (const f of lintEntry(aiDir, rel, root)) findings.push({ file: join(display, rel), ...f })
  }
  return findings
}

/** Format a finding as `file:line: rule: text`. */
export function formatFinding(f) {
  return `${f.file}:${f.line}: ${f.rule}: ${f.text}`
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  if (argv.length > 1 || argv.some((a) => a.startsWith('-'))) {
    console.error(USAGE)
    return 2
  }
  const dir = argv[0] ?? '.ai'
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`ai-lint: ${dir} is not a directory\n${USAGE}`)
    return 2
  }
  const findings = lintDir(dir)
  for (const f of findings) console.log(formatFinding(f))
  return findings.some((f) => f.level === 'error') ? 1 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
