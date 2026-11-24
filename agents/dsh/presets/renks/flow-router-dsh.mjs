/**
 * flow-router in dsh: the same notes and branch-switch block as the Claude Code
 * hook, through dsh's own events.
 *
 *   - `agent/created` (root agents only): the session-start note, injected.
 *   - `agent/pre-step`: a note when the user's message names a GitHub issue or
 *     PR, or asks for an audit; each note once per session, never a block.
 *   - `tools/pre-execute`: a branch switch is denied while ai-worktree tasks run.
 *
 * Any failure here lets the call or the turn through and is logged once: a
 * note is a convenience, and only the switch block is a rule.
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { branchSwitch, gatherFacts, isGitRef, promptHint, sessionHint, switchDenial } from './flow-router.mjs'
import { commandOf, cwdOf, rootSessionId } from './docs-gate-policy.mjs'

/** A frozen user-role context message, in the shape dsh's hook bridge uses. */
function contextMessage(text) {
  const part = Object.freeze({ type: 'text', text })
  return Object.freeze({ id: randomUUID(), role: 'user', source: Object.freeze({ kind: 'flow-router' }), content: Object.freeze([part]) })
}

/** The text the user typed in this step: injected notes and skill bodies are user-role too, so the source decides. */
function promptText(messages) {
  return messages.filter(m => m?.role === 'user' && m?.source?.kind === 'user').flatMap(m => m.content ?? [])
    .filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
}

/** Deny a branch switch while tasks run; undefined lets the waterfall continue. */
async function switchCheck(exec) {
  if (exec.name !== 'bash') return undefined
  const command = commandOf(exec.arguments)
  if (typeof command !== 'string') return undefined
  const base = cwdOf(exec.agent) ?? process.cwd()
  const cwd = typeof exec.arguments?.workdir === 'string' ? resolve(base, exec.arguments.workdir) : base
  const found = branchSwitch(command, (name, dir) => isGitRef(dir === undefined ? cwd : resolve(cwd, dir), name))
  if (found === undefined) return undefined
  const reason = switchDenial(await gatherFacts(found.dir === undefined ? cwd : resolve(cwd, found.dir)))
  return reason === undefined ? undefined : { kind: 'deny', reason }
}

/**
 * Register the router on a cordis context.
 * @param ctx - the cordis context.
 * @param log - logs a message once.
 */
export function registerFlowRouter(ctx, log) {
  const noted = new Map()
  const firstTime = (agent, id) => {
    const key = rootSessionId(agent) ?? 'default'
    const seen = noted.get(key) ?? new Set()
    noted.set(key, seen)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }

  ctx.on('agent/created', async ({ agent, source }) => {
    try {
      // Said on a new session only, as in Claude Code: a resume or a compaction keeps it in history.
      if (source !== undefined && source !== 'startup') return
      if (agent?.parentAgent !== undefined || typeof agent?.inject !== 'function') return
      const note = sessionHint(await gatherFacts(cwdOf(agent) ?? process.cwd()))
      if (note !== undefined) agent.inject(contextMessage(note))
    } catch (error) {
      log(`flow-router: session note failed: ${error?.message ?? error}`)
    }
  })

  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    let hint
    try {
      hint = agent?.parentAgent === undefined && Array.isArray(messages) ? promptHint(promptText(messages)) : undefined
    } catch (error) {
      log(`flow-router: prompt note failed: ${error?.message ?? error}`)
    }
    const downstream = await next()
    // Marked as said only once it is actually added to an entered step.
    if (hint === undefined || downstream?.kind !== 'enter' || !firstTime(agent, hint.id)) return downstream
    return { ...downstream, messages: [...(downstream.messages ?? []), contextMessage(hint.text)] }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const denial = await switchCheck(exec)
      if (denial !== undefined) return denial
    } catch (error) {
      log(`flow-router: switch check failed; allowing the call: ${error?.message ?? error}`)
    }
    return next()
  })
}
