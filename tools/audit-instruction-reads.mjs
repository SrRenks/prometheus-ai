/**
 * Audit instruction-read compliance across recorded dsh sessions.
 *
 * WHY THIS EXISTS. The `docs-gate` plugin exists because a hint was not enough:
 * only a small share of sessions ever opened the behavioural docs. Those numbers
 * drive a design decision, so the measurement has to be reproducible rather than
 * remembered. `core/docs/sources.md` cites this script as its method.
 *
 * WHAT IT READS. Every `session*.jsonl.zstd` under `$DSH_HOME/sessions` (or
 * `--sessions <dir>`), decompressed with the `zstd` CLI. Transcripts are JSONL;
 * a line is a session event, and tool calls carry their arguments inline.
 *
 * WHAT IT REPORTS.
 *   - sessions that read an instruction file (AGENTS.md / CLAUDE.md / .ai/*.md)
 *   - sessions that read any core behavioural doc
 *   - per-doc read counts
 *
 * It used to measure how many tool calls passed between the removed
 * `instruction-hint` and the first instruction-file read. That measurement went
 * with the plugin: it counted a signal that never reached a live session.
 *
 * CAVEAT. "Read" means a tool call named a path; it does not prove the content
 * reached the model's context. Treat the numbers as an upper bound on
 * compliance, which is the conservative direction for a gate's justification.
 *
 * Usage: node tools/audit-instruction-reads.mjs [--sessions <dir>] [--json]
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Behavioural docs whose reading counts as "the rules were loaded". */
export const CORE_DOCS = [
  'core/principles.md',
  'core/docs/complexity.md',
  'core/docs/maintainability.md',
  'core/docs/git-workflow.md',
  'core/docs/development-workflow.md',
  'core/docs/coding-standards.md',
  'core/docs/validation-checklist.md',
  'core/docs/coupling.md',
  'core/docs/testing.md',
  'core/docs/architecture.md',
]

/** Any of these appearing in a tool call counts as an instruction-file read. */
const INSTRUCTION_FILE_RE = /AGENTS\.md|CLAUDE\.md|\.ai\/(project|session|assumptions)\.md/

/** Tool names whose arguments can name a read target. */
const READ_TOOLS_RE = /"name":"(read|grep|glob|bash)"/

/** Parse `--flag value` arguments. */
function parseArgs(argv) {
  const out = { sessions: undefined, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sessions') out.sessions = argv[++i]
    else if (argv[i] === '--json') out.json = true
  }
  return out
}

/** Yield every `*zstd` transcript below `dir`, three levels deep. */
function* transcripts(dir, depth = 0) {
  if (depth > 3) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* transcripts(path, depth + 1)
    else if (entry.name.endsWith('.zstd')) yield path
  }
}

/** Decompress one transcript, or return '' when it cannot be read. */
function loadTranscript(path) {
  try {
    return execFileSync('zstd', ['-dc', path], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
  } catch {
    return ''
  }
}

/** Collect the readable tool-call text of one transcript. */
function readCalls(text) {
  const calls = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    if (!READ_TOOLS_RE.test(line)) continue
    calls.push(line)
  }
  return calls
}

/** Analyse one transcript. */
function analyse(text) {
  const calls = readCalls(text)
  if (calls.length === 0) return undefined
  const blob = calls.join('\n')
  const core = CORE_DOCS.filter(doc => blob.includes(doc))
  return {
    toolCalls: calls.length,
    instructionFile: INSTRUCTION_FILE_RE.test(blob),
    coreDocs: core,
  }
}

function main() {
  const { sessions, json } = parseArgs(process.argv.slice(2))
  const root = sessions ?? join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), 'sessions')
  const rows = []
  for (const path of transcripts(root)) {
    const result = analyse(loadTranscript(path))
    if (result !== undefined) rows.push({ path, ...result })
  }
  const total = rows.length
  const summary = {
    sessionsRoot: root,
    transcripts: total,
    readInstructionFile: rows.filter(r => r.instructionFile).length,
    readAnyCoreDoc: rows.filter(r => r.coreDocs.length > 0).length,
    perDoc: Object.fromEntries(CORE_DOCS.map(doc => [doc, rows.filter(r => r.coreDocs.includes(doc)).length])),
  }
  if (json) {
    console.log(JSON.stringify({ summary, rows }, null, 2))
    return
  }
  const pct = (n) => total === 0 ? '0%' : `${Math.round(n / total * 100)}%`
  console.log(`sessions root            : ${root}`)
  console.log(`transcripts with reads   : ${total}`)
  console.log(`read an instruction file : ${summary.readInstructionFile} (${pct(summary.readInstructionFile)})`)
  console.log(`read any core doc        : ${summary.readAnyCoreDoc} (${pct(summary.readAnyCoreDoc)})`)
  console.log('per-doc read counts:')
  for (const [doc, count] of Object.entries(summary.perDoc)) console.log(`  ${String(count).padStart(4)}  ${doc}`)
}

main()
