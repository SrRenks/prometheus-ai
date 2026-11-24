/**
 * ai-skeleton - print the definitions of source files with their line numbers,
 * without their bodies.
 *
 * WHY. Agentless measured function-level localization at 58.33% from a
 * signatures-only view of each file against 53.67% from the full contents, at
 * about a seventh of the cost (arXiv:2407.01489), and the localization tools
 * that followed (LocAgent, CoSIL) narrow the same way: files, then symbols,
 * then lines. This is the middle step. An agent reads the skeleton, picks the
 * definitions that matter, and opens only those line ranges.
 *
 * HOW. Patterns per language, no parser and no dependency, so it can miss a
 * definition written in unusual syntax or list a line that only looks like
 * one. Each line printed is `L<n>: <the definition line, trimmed>`; indentation
 * is kept so methods sit under their class.
 *
 * Usage: ai-skeleton <file or directory>... [--max N lines per file, default 200]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const USAGE = 'usage: ai-skeleton <file or directory>... [--max N lines per file, default 200]'
const WIDTH = 160
const MAX_BYTES = 2_000_000
const WALK_DEPTH = 6
const WALK_SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', '__pycache__'])
const NOT_METHODS = /^(if|for|while|switch|catch|return|function|else|do|try|with|new|typeof|await|super|this)\b/

const JS = [
  /^\s*(export\s+)?(default\s+)?(declare\s+)?(async\s+)?function\b\*?\s*[\w$]*\s*[<(]/,
  /^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?class\s+[\w$]+/,
  /^\s*(export\s+)?(declare\s+)?(const\s+)?(interface|type|enum|namespace|module)\s+[\w$'"]+/,
  // Arrow functions and wrapped components, also when the parameters wrap to the next lines.
  /^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*(:[^=]+)?=\s*(async\s+)?(<[^>]*>\s*)?(\([^)]*\)|[\w$]+)\s*(:[^=]+)?=>/,
  /^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*(:[^=]+)?=\s*(async\s+)?(<[^>]*>\s*)?\(\s*(\{\s*)?$/,
  /^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*(:[^=]+)?=\s*(React\.)?(memo|forwardRef|useCallback)\s*[(<]/,
  // Class methods: on one line with their body brace, or with modifiers and wrapped parameters.
  /^\s+(public\s+|private\s+|protected\s+|static\s+|readonly\s+|override\s+|async\s+|get\s+|set\s+)*\*?#?[\w$]+\s*(<[^>]*>)?\s*\([^)]*\)\s*(:[^{]+)?\{\s*$/,
  /^\s+((public|private|protected|static|override|async)\s+)+\*?#?[\w$]+\s*(<[^>]*>)?\s*\(/,
  /^\s+constructor\s*\(/,
]

/** Definition patterns by file extension. */
const LANGUAGES = {
  py: [/^\s*(async\s+)?def\s+\w+/, /^\s*class\s+\w+/],
  js: JS, jsx: JS, mjs: JS, cjs: JS, ts: JS, tsx: JS,
  go: [/^func\s/, /^type\s+\w+\s+\S/, /^type\s*\(\s*$/, /^\t\w+\s+(struct|interface)\s*\{/],
  java: [
    /^\s*((public|protected|private|abstract|final|static|sealed)\s+)*(class|interface|enum|record)\s+\w+/,
    /^\s*(public|protected|private)\s+((static|final|abstract|synchronized)\s+)*[\w<>[\],.]+(\s*[\w<>[\],.]+)*\s+\w+\s*\(/,
  ],
  kt: [/^\s*(\w+\s+)*(class|interface|object)\s+\w+/, /^\s*(\w+\s+)*fun\s+/],
  php: [/^\s*((abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+\w+/, /^\s*((abstract|final|public|private|protected|static)\s+)*function\s+&?\w+/],
  prg: [/^\s*(static\s+|init\s+|exit\s+)?(function|procedure|func|proc)\s+\w+/i, /^\s*(create\s+)?class\s+\w+/i, /^\s*method\s+\w+/i],
  // A `CREATE TABLE #temp` inside a procedure body is a local temporary, not a definition.
  sql: [/^\s*(create|alter)\s+(or\s+(replace|alter)\s+)?(definer\s*=\s*\S+\s+)?((global\s+)?temporary\s+)?(procedure|proc|function|trigger|view|package|type|schema|sequence|synonym|materialized\s+view|table(?!\s+[#@]))\b/i],
  rb: [/^\s*def\s+/, /^\s*(class|module)\s+[A-Z]/],
  rs: [/^\s*(pub(\([^)]*\))?\s+)?(async\s+)?fn\s+\w+/, /^\s*(pub(\([^)]*\))?\s+)?(struct|enum|trait|impl)\b/],
  cs: [/^\s*(public|internal|private|protected)\s+((static|abstract|sealed|partial|readonly)\s+)*(class|interface|enum|record|struct)\s+\w+/, /^\s*(public|internal|private|protected)\s+((static|async|virtual|override|abstract)\s+)*[\w<>[\],.?]+\s+\w+\s*\(/],
}

/**
 * The definition lines of one source text.
 * @param {string} text - the file content
 * @param {string} ext - the extension without the dot, any case
 * @returns {{line: number, text: string}[] | undefined} undefined when the language is not known
 */
export function skeletonOf(text, ext) {
  const patterns = LANGUAGES[ext.toLowerCase()]
  if (patterns === undefined) return undefined
  const found = []
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!patterns.some(re => re.test(raw))) return
    const trimmed = raw.trimEnd()
    if (NOT_METHODS.test(trimmed.trim()) && !/^\s*function\b/.test(trimmed)) return
    const indent = trimmed.length - trimmed.trimStart().length
    const body = trimmed.trim()
    found.push({ line: i + 1, text: `${' '.repeat(Math.min(indent, 12))}${body.length > WIDTH ? `${body.slice(0, WIDTH)}...` : body}` })
  })
  return found
}

/** The files a path names: itself, or the tracked files under a directory (git), else none. */
function filesUnder(path) {
  if (!statSync(path).isDirectory()) return [path]
  // Tracked and new files alike: a new file is often the one a task is about.
  const r = spawnSync('git', ['-C', path, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status === 0) return [...new Set(r.stdout.split('\0').filter(Boolean))].map(rel => resolve(path, rel))
  return walk(path, 0)
}

/** Files under a directory outside git, skipping dependency and build trees. */
function walk(dir, depth) {
  if (depth > WALK_DEPTH) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (WALK_SKIP.has(e.name) || e.name.startsWith('.')) return []
    const path = join(dir, e.name)
    if (e.isDirectory()) return walk(path, depth + 1)
    return e.isFile() ? [path] : []
  })
}

/**
 * A source file's text, or undefined when it is too large or binary. Bytes that
 * are not valid UTF-8 are read as Latin-1, the usual encoding of xBase sources.
 */
function sourceText(file) {
  if (statSync(file).size > MAX_BYTES) return undefined
  const bytes = readFileSync(file)
  if (bytes.subarray(0, 8192).includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

/** Render one file's skeleton, or undefined when it has no known language or no definition. */
function render(file, max) {
  if (LANGUAGES[extname(file).slice(1).toLowerCase()] === undefined) return undefined
  const text = sourceText(file)
  if (text === undefined) return undefined
  const defs = skeletonOf(text, extname(file).slice(1))
  if (defs === undefined || defs.length === 0) return undefined
  const shown = defs.slice(0, max).map(d => `  L${d.line}: ${d.text}`)
  if (defs.length > max) shown.push(`  (+${defs.length - max} more definitions)`)
  return [`${relative(process.cwd(), file) || file}`, ...shown].join('\n')
}

function main(argv) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { max: { type: 'string', default: '200' }, help: { type: 'boolean', short: 'h' } } })
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`)
    return 2
  }
  if (parsed.values.help) { console.log(USAGE); return 0 }
  const max = Number(parsed.values.max)
  if (parsed.positionals.length === 0 || !Number.isInteger(max) || max < 1) { console.error(USAGE); return 2 }
  const blocks = []
  for (const arg of parsed.positionals) {
    if (!existsSync(arg)) { console.error(`ai-skeleton: no such path: ${arg}`); return 2 }
    for (const file of filesUnder(resolve(arg))) {
      try {
        const block = render(file, max)
        if (block !== undefined) blocks.push(block)
      } catch (error) {
        // A file that cannot be read is said once on stderr; the others still print.
        if (!['EACCES', 'ENOENT', 'EISDIR', 'ELOOP', 'EPERM'].includes(error.code)) throw error
        console.error(`ai-skeleton: skipped ${relative(process.cwd(), file)}: ${error.code}`)
      }
    }
  }
  if (blocks.length > 0) console.log(blocks.join('\n\n'))
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
