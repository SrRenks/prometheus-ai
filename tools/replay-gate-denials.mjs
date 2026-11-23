#!/usr/bin/env node
/**
 * Replay every `bash` call docs-gate denied in recorded sessions through the
 * CURRENT classifier, and report how many it would still deny, and as what.
 *
 * This is the benchmark behind the shell parser (core/docs/sources.md,
 * "Classifier replay"). A change to the bash rules should not raise the share
 * of recorded queries that are denied, and should not let a recorded write
 * through: run this before and after, and read the `--allowed` list for writes.
 *
 * WHAT IT READS. dsh: every `session*.jsonl.zstd` (or plain `.jsonl`) under
 * `$DSH_HOME/sessions`, or `--sessions <dir>`; `.zstd` needs the `zstd` CLI.
 * Claude Code, with `--claude`: every `*.jsonl` under `~/.claude/projects`.
 * A call counts as denied when its result carries the gate's denial text.
 *
 * Usage: node tools/replay-gate-denials.mjs [--claude] [--sessions <dir>] [--json] [--allowed]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { classifyBash } from '../agents/dsh/presets/renks/docs-gate-policy.mjs'

/**
 * Both denial formats, dsh's and the Claude Code hook's, at the START of the
 * result: a `cat` of the gate's own source carries the same words mid-output.
 */
export const DENIAL_RE = /^\s*(?:(?:Error|PreToolUse:\w+ hook error):\s*)*\w+ is blocked (?:once per session|by docs-gate)/

/** Transcript files under a directory, recursively. */
function* transcripts(dir, claude) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* transcripts(path, claude)
    else if (claude ? entry.endsWith('.jsonl') : /^session.*\.jsonl(\.zstd)?$/.test(entry)) yield path
  }
}

/** A transcript's text, decompressed when it needs it. */
function load(path) {
  if (!path.endsWith('.zstd')) return readFileSync(path, 'utf8')
  return execFileSync('zstd', ['-dc', path], { maxBuffer: 1 << 30 }).toString()
}

/** The nearest directory holding a VCS marker, as the gate finds its boundary. */
function workspaceOf(dir) {
  for (let path = dir; path && path !== '/'; path = dirname(path)) {
    if (existsSync(join(path, '.git'))) return path
  }
  return undefined
}

/** Text of a tool result, in either transcript format. */
function textOf(content) {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.map(part => part.text ?? textOf(part.content) ?? '').join('') : ''
}

/**
 * The denied `bash` calls of one transcript.
 *
 * @param text - the JSONL transcript.
 * @returns `[{ command, cwd }]`.
 */
export function deniedCalls(text) {
  const calls = new Map()
  const denied = []
  let cwd
  for (const line of text.split('\n')) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    cwd = record.cwd ?? cwd
    collect(record, calls, denied, cwd)
  }
  return denied
}

/** Record one transcript line's bash calls and denied results. */
function collect(record, calls, denied, cwd) {
  // dsh: `tool/call` and `tool/result` events.
  if (record.type === 'tool/call' && record.data?.name === 'bash') {
    try {
      calls.set(record.data.callId, { ...JSON.parse(record.data.arguments), cwd })
    } catch {
      // A call whose arguments do not parse cannot be replayed.
    }
  }
  if (record.type === 'tool/result') note(calls.get(record.data?.message?.toolCallId), textOf(record.data?.message?.content), denied)
  // Claude Code: `tool_use` blocks in assistant messages, `tool_result` in user ones.
  for (const part of Array.isArray(record.message?.content) ? record.message.content : []) {
    if (part.type === 'tool_use' && part.name === 'Bash') calls.set(part.id, { ...part.input, cwd })
    if (part.type === 'tool_result') note(calls.get(part.tool_use_id), textOf(part.content), denied)
  }
}

/** Keep a call whose result is a docs-gate denial. */
function note(call, text, denied) {
  if (call !== undefined && typeof call.command === 'string' && DENIAL_RE.test(text)) denied.push({ command: call.command, cwd: call.cwd })
}

/**
 * Classify the denied calls again with the current rules.
 *
 * @param calls - `[{ command, cwd }]`.
 * @returns `{ total, allowed, byKind, allowedCommands }`.
 */
export function replay(calls) {
  const byKind = {}
  const allowedCommands = []
  for (const { command, cwd } of calls) {
    const kind = classifyBash(command, cwd, cwd === undefined ? undefined : workspaceOf(cwd))
    if (kind === undefined) allowedCommands.push(command)
    else byKind[kind] = (byKind[kind] ?? 0) + 1
  }
  return { total: calls.length, allowed: allowedCommands.length, byKind, allowedCommands }
}

/** Parse the command line. */
function parseArgs(argv) {
  const out = { claude: argv.includes('--claude'), json: argv.includes('--json'), allowed: argv.includes('--allowed'), sessions: undefined }
  const at = argv.indexOf('--sessions')
  if (at >= 0) out.sessions = argv[at + 1]
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const home = homedir()
  const root = args.sessions ?? (args.claude ? join(home, '.claude/projects') : join(process.env.DSH_HOME ?? join(home, '.dsh'), 'sessions'))
  const calls = []
  for (const path of transcripts(root, args.claude)) {
    try {
      calls.push(...deniedCalls(load(path)))
    } catch {
      // An unreadable transcript is skipped, not fatal.
    }
  }
  const result = replay(calls)
  if (args.json) {
    console.log(JSON.stringify(args.allowed ? result : { ...result, allowedCommands: undefined }, null, 1))
    return
  }
  console.log(`sessions root          : ${root}`)
  console.log(`denied bash calls      : ${result.total}`)
  console.log(`allowed by current rules: ${result.allowed}`)
  for (const [kind, count] of Object.entries(result.byKind).sort((a, b) => b[1] - a[1])) console.log(`  still denied  ${String(count).padStart(4)}  ${kind}`)
  if (args.allowed) for (const command of result.allowedCommands) console.log(`---\n${command}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
