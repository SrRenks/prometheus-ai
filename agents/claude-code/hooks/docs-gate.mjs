#!/usr/bin/env node
/**
 * docs-gate for Claude Code: the dsh read-before-mutate gate, as a hook.
 *
 * WHAT IT ENFORCES. A mutating tool call (Edit, Write, MultiEdit, NotebookEdit,
 * or a Bash command that changes the workspace) is denied until this session
 * has read the behavioural docs that call's tier needs, plus the workspace's
 * `.ai/project.md`. The rules for what counts as a mutation, which tier a change
 * needs, where the workspace ends and what a credit means are NOT restated
 * here: they are imported from the dsh preset, so both harnesses enforce one
 * rule set. See `agents/dsh/presets/renks/README.md`.
 *
 * WHAT DIFFERS FROM DSH, and why.
 *   - The ledger is on disk (`docs-gate-ledger.mjs`), because a hook is a new
 *     process per call.
 *   - Compaction and /clear reset it, the optional store included. A compacted
 *     session keeps a summary, not the rules, so a credit earned before would
 *     vouch for text that is no longer in context.
 *   - `cat` of a whole doc credits it, but only when the doc's full current
 *     content is in the command's stdout. That is the same proof the Read tool
 *     gives: the bytes reached the transcript.
 *   - The denial names absolute paths, which the Read tool accepts as written.
 *
 * WIRING (agents/claude-code/settings.json): PreToolUse on the mutating tools
 * and Bash, PostToolUse on Read and Bash, SessionStart on `startup`, `compact`
 * and `clear`. It costs no model tokens until it denies.
 *
 * FAILURE POSTURE, as in dsh: a coding error or unreadable input fails open and
 * says so to the user; an unreadable config checkout fails closed for
 * mutations, and read-only calls stay open so the session can look into it.
 * `DOCS_GATE_DISABLED=1` turns it off; `DOCS_GATE_CREDIT_STORE=<path>` enables
 * the optional cross-session store, off by default for the reason the dsh
 * README gives.
 */
import { readFileSync, realpathSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  classifyCall,
  defaultRepoRoots,
  denyUnresolved,
  describeError,
  findWorkspaceRoot,
  isCodingError,
  normalizePath,
  requiredDocsFor,
  resolveRequiredDocs,
} from '../../dsh/presets/renks/docs-gate-policy.mjs'
import { createSeamFor } from '../../dsh/presets/renks/docs-gate-seam.mjs'
import { loadStore, recordRead, storeEnabled, storeHolds } from '../../dsh/presets/renks/docs-gate-store.mjs'
import { openLedger, pruneStale, sessionKey, withLock } from './docs-gate-ledger.mjs'

/** Claude Code tool names mapped to the dsh names the classifier knows. */
const MUTATING_TOOLS = { Edit: 'edit', Write: 'write', MultiEdit: 'multi_edit', NotebookEdit: 'notebook_edit' }

/** The node:fs seam: no host service, so the dsh fallback applies. */
const seam = createSeamFor({ get: () => undefined })()

/**
 * Translate one Claude Code tool call into the dsh call shape.
 *
 * @param input - the hook payload.
 * @returns `{ name, arguments }`, or undefined for a tool the gate ignores.
 */
export function toExec(input) {
  const args = input.tool_input ?? {}
  const name = MUTATING_TOOLS[input.tool_name]
  if (name !== undefined) return { name, arguments: { file_path: args.file_path ?? args.notebook_path } }
  if (input.tool_name === 'Bash') return { name: 'bash', arguments: { command: args.command, workdir: input.cwd } }
  return undefined
}

/** File content, or undefined when it cannot be read. */
function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The real path, or the path itself when it does not resolve. */
function realOrSelf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Find the workspace boundary and the doc set for one working directory.
 *
 * @param cwd - the session working directory.
 * @param env - the environment, for the config checkout location.
 * @returns `{ boundary, docs }`. Throws only when the config probe fails.
 */
async function resolveDocs(cwd, env) {
  const found = await findWorkspaceRoot(seam, cwd)
  const root = found.root === undefined ? undefined : normalizePath(found.root)
  const { configDocs, projectDocs } = await resolveRequiredDocs({
    seam, workspaceRoot: root, repoRoots: defaultRepoRoots(env),
  })
  return { boundary: found.found === true ? root : undefined, docs: [...configDocs, ...projectDocs] }
}

/** A PreToolUse denial carrying the reason Claude reads. */
function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}

/** The denial for docs this session has not read. */
function missingReason(toolName, kind, missing) {
  return [
    `${toolName} is blocked by docs-gate (${kind}): this session has not read the rules this change needs.`,
    '',
    'Read each file below with the Read tool, then retry. The gate lifts as the reads land; a cat of the whole file counts too:',
    missing.map(doc => `  - ${doc.path}`).join('\n'),
    '',
    'The shared config is the source of truth for coding standards and the git workflow. Read them even if the task looks routine.',
  ].join('\n')
}

/**
 * Does this session hold the doc's current content, from its own ledger or
 * from the optional store? A store hit is adopted into the ledger and reported.
 *
 * @param ctx - the per-call context.
 * @param doc - the required document.
 * @param reused - collects the ids taken from the store.
 * @returns true when the doc is satisfied.
 */
function holdsNow(ctx, doc, reused) {
  const content = readText(doc.path)
  if (ctx.ledger.holds(doc, content)) return true
  // After compaction the store would vouch for reads whose text left the context.
  if (ctx.store === undefined || ctx.ledger.compacted() || !storeHolds(ctx.store, doc, content)) return false
  ctx.ledger.adopt(doc, ctx.store[doc.id].hash)
  reused.push(doc.id)
  return true
}

/** PreToolUse: allow, or deny with the docs still unread. */
async function preToolUse(input, ctx) {
  const exec = toExec(input)
  if (exec === undefined) return {}
  let resolved
  try {
    resolved = await resolveDocs(ctx.cwd, ctx.env)
  } catch (error) {
    if (isCodingError(error)) throw error
    // Closed for mutations only, judged with no boundary: denying `ls` as well
    // would leave the session no way to inspect, or fix, the failure.
    const call = classifyCall(exec, undefined)
    if (call === undefined) return {}
    return deny(denyUnresolved({ name: input.tool_name }, call.kind, describeError(error)).reason)
  }
  const call = classifyCall(exec, resolved.boundary)
  if (call === undefined || resolved.docs.length === 0) return {}

  const reused = []
  const required = requiredDocsFor(call, exec.arguments.command, resolved.docs)
  const missing = required.filter(doc => !holdsNow(ctx, doc, reused))
  const out = missing.length > 0 ? deny(missingReason(input.tool_name, call.kind, missing)) : {}
  if (reused.length > 0) out.systemMessage = `docs-gate credit store: reused ${reused.length} read(s): ${reused.join(', ')}`
  return out
}

/** Credit one doc, in the ledger and, when enabled, in the store. */
function credit(ctx, doc, content) {
  ctx.ledger.record(doc, content)
  if (!storeEnabled(ctx.storePath)) return
  withLock(ctx.storePath, () => recordRead(ctx.storePath, loadStore(ctx.storePath), doc, content))
}

/** The tracked doc a read path names, through symlinks too. */
function docAt(docs, path) {
  const absolute = normalizePath(path)
  const real = realOrSelf(absolute)
  return docs.find(doc => doc.path === absolute || realOrSelf(doc.path) === real)
}

/** PostToolUse: credit a successful Read, or a Bash whose stdout holds a whole doc. */
async function postToolUse(input, ctx) {
  const resolved = await resolveDocs(ctx.cwd, ctx.env).catch(() => undefined)
  if (resolved === undefined) return {}
  if (input.tool_name === 'Read') {
    const path = input.tool_input?.file_path
    const doc = typeof path === 'string' && path.startsWith('/') ? docAt(resolved.docs, path) : undefined
    const content = doc === undefined ? undefined : readText(doc.path)
    if (content !== undefined) credit(ctx, doc, content)
    return {}
  }
  const stdout = input.tool_response?.stdout
  if (input.tool_name !== 'Bash' || typeof stdout !== 'string' || stdout.length === 0) return {}
  for (const doc of resolved.docs) {
    const content = readText(doc.path)
    const body = content?.trimEnd()
    if (body === undefined || body.length === 0 || !stdout.includes(body)) continue
    if (!ctx.ledger.holds(doc, content)) credit(ctx, doc, content)
  }
  return {}
}

/** SessionStart: prune old ledgers; after compaction or /clear, forget this session's reads. */
function sessionStart(input, ctx) {
  pruneStale(ctx.stateDir)
  if (input.source === 'compact' || input.source === 'clear') ctx.ledger.reset()
  return {}
}

/** Where the ledgers live. */
function stateDirOf(env) {
  if (env.DOCS_GATE_STATE_DIR) return env.DOCS_GATE_STATE_DIR
  return join(env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), '.claude'), 'state', 'docs-gate')
}

/** The fail-open answer: allow, and tell the user why the gate stood down. */
function failOpen(detail) {
  return { systemMessage: `docs-gate: allowing the call, the gate could not evaluate it (${detail})` }
}

/**
 * Decide one hook event.
 *
 * @param raw - the hook payload as read from stdin.
 * @param env - the environment.
 * @returns the JSON object to print, empty for a plain allow.
 */
export async function main(raw, env) {
  if (env.DOCS_GATE_DISABLED === '1') return {}
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return failOpen('unreadable hook input')
  }
  const session = sessionKey(input?.session_id)
  if (session === undefined) return {}
  const stateDir = stateDirOf(env)
  const storePath = storeEnabled(env.DOCS_GATE_CREDIT_STORE) ? env.DOCS_GATE_CREDIT_STORE : undefined
  const ctx = {
    env, stateDir, storePath,
    cwd: typeof input.cwd === 'string' && input.cwd.length > 0 ? input.cwd : process.cwd(),
    ledger: openLedger(stateDir, session),
    store: storePath === undefined ? undefined : loadStore(storePath),
  }
  if (input.hook_event_name === 'PreToolUse') return preToolUse(input, ctx)
  if (input.hook_event_name === 'PostToolUse') return postToolUse(input, ctx)
  if (input.hook_event_name === 'SessionStart') return sessionStart(input, ctx)
  return {}
}

/** Read all of stdin. */
async function stdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// Run only as the hook entry point. `~/.claude/hooks` is a symlink into this
// repo, so compare against the resolved path, as a URL.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realOrSelf(process.argv[1])).href) {
  const out = await main(await stdin(), process.env).catch(error => failOpen(describeError(error)))
  // Synchronous, so a deny is fully written before exit: a truncated reply
  // would read as no reply, and no reply is an allow.
  if (Object.keys(out).length > 0) writeSync(1, `${JSON.stringify(out)}\n`)
  process.exit(0)
}
