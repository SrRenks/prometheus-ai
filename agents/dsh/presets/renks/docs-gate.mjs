/**
 * docs-gate: make the behavioural doc set a PRECONDITION of the first mutation
 * in a workspace, instead of a hint the model may skip.
 *
 * WHY (measured, not assumed). A 2026-10 audit over 96 recorded sessions in
 * `$DSH_HOME/sessions` — reproduced by `tools/audit-instruction-reads.mjs` —
 * found the instruction layer was largely advisory:
 *
 *   - 33% of transcripts had read AGENTS.md / CLAUDE.md / `.ai/*.md` at all;
 *   - 8% had read ANY core behavioural doc (complexity, maintainability,
 *     git-workflow, development-workflow, coding-standards, ...);
 *   - the `instruction-hint` plugin DID deliver its hint in 30 sessions, and 17
 *     of those still never opened an instruction file;
 *   - replaying those transcripts against this gate's classifier, 83 of the 84
 *     sessions that mutated anything (99%) made their FIRST mutation before
 *     reading the set, at a median of 3 tool calls in.
 *
 * Those figures are an upper bound: naming a path in a tool call is not proof
 * the content reached the context.
 *
 * WHAT THIS DOES. It observes `tools/pre-execute` — the waterfall `dsh-tools`
 * runs before every tool body — and returns `{ kind: 'deny' }` for a MUTATING
 * call until the session has read each required doc once. The denial reason
 * reaches the model as the tool result, so the corrective instruction arrives
 * exactly where the model is looking, and the gate lifts by itself the moment
 * the reads land. No prompt text can be ignored into a bypass.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *  - It never gates a read-only call. `read`, `grep`, `glob`, `web_search`,
 *    `todo_write`, `ask_user_question`, `skill_load`, subagent dispatch and
 *    read-only `bash` (`git status`, `git diff`, test runners) stay open — the
 *    agent must be able to explore and to satisfy the gate.
 *  - It never gates a target outside the workspace. An `edit` at an absolute
 *    path elsewhere, or a `bash` redirection into `/tmp`, is outside this
 *    gate's authority.
 *  - It never gates an uninitialized workspace. If none of the required docs
 *    exist — a fresh scaffold, a scratch directory, a machine without the
 *    config checkout — the gate opens and says so once. A missing doc set is a
 *    configuration state, not a reason to deadlock a session.
 *  - It never re-gates. Once every doc is satisfied the check collapses to one
 *    `Set` lookup for the rest of the session.
 *  - It never fights another blocker: the decision is computed before `next()`,
 *    and only a decisive path denies.
 *
 * STATE. Credits live in a process-local `Map` keyed by ROOT session id, and a
 * subagent resolves its root through `agent.parentAgent`, so a delegated agent
 * inherits the parent's evidence instead of re-reading five files. This is
 * intentionally NOT the durable log: a resumed session re-reads, which is the
 * conservative direction for a gate whose whole point is that the rules are in
 * context.
 *
 * The decisions themselves live in `docs-gate-policy.mjs`; this file is the
 * cordis wiring, and re-exports the policy so one import reaches both.
 */

import {
  absolutePath,
  classifyCall,
  commandOf,
  cwdOf,
  defaultRepoRoots,
  denyMutation,
  denyUnresolved,
  findWorkspaceRoot,
  isMutationTool,
  normalizePath,
  pathOf,
  resolveRequiredDocs,
  rootSessionId,
} from './docs-gate-policy.mjs'

export * from './docs-gate-policy.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'docs-gate'

/**
 * Build the per-root-session store.
 *
 * Two hazards shape it. Resolution is async, so concurrent tool calls must share
 * one in-flight promise instead of walking the filesystem twice. And a FAILED
 * resolution must stay retryable, so the promise is cleared on failure and the
 * caller can tell "resolved to nothing" (`docs` is an array) apart from "could
 * not resolve" (`resolvedAt` is undefined).
 *
 * @param options.resolveFor - builds the fs resolver for one call.
 * @param options.repoRoots - config checkout roots, in probe order.
 * @param options.extraDocs - additional repo-relative docs to require.
 * @param options.log - records a warning once per process.
 * @returns the gate's state accessors.
 */
function createStore({ resolveFor, repoRoots, extraDocs, log }) {
  const sessions = new Map()

  /** Load or create the record for one root session. */
  const stateFor = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      state = { satisfied: new Set(), docs: undefined, root: undefined, pending: undefined, resolvedAt: undefined }
      sessions.set(id, state)
    }
    return state
  }

  /** Resolve workspace root and doc set once per session. */
  const resolveOnce = (agent, state, signal) => {
    if (state.resolvedAt !== undefined) return Promise.resolve()
    if (state.pending !== undefined) return state.pending
    const cwd = cwdOf(agent) ?? process.cwd()
    const resolve = resolveFor(cwd, signal)
    state.pending = (async () => {
      const root = normalizePath(await findWorkspaceRoot(resolve, cwd, signal))
      const resolved = await resolveRequiredDocs({ resolve, workspaceRoot: root, repoRoots, extraDocs, signal })
      state.root = root
      state.docs = resolved.docs
      state.resolvedAt = Date.now()
    })().catch((error) => {
      log(`doc resolution failed; the gate stays open: ${String(error?.message ?? error)}`)
      state.pending = undefined
      state.docs = undefined
      state.resolvedAt = undefined
    })
    return state.pending
  }

  return { stateFor, resolveOnce }
}

/**
 * Credit a `read` whose call is about to be allowed.
 *
 * The credit happens in `pre-execute` rather than after the result on purpose.
 * The only caller that reaches here is one the waterfall has already allowed, so
 * the read is approved; waiting for `post-execute` would instead introduce an
 * ordering hazard, because a read arriving before the async doc resolution
 * settles has no cached doc set to match against and would be silently
 * uncredited.
 *
 * @param store - the gate's state accessors.
 * @param agent - the calling agent.
 * @param exec - the pending `read` call.
 */
function creditRead(store, agent, exec) {
  const path = pathOf(exec.arguments)
  if (path === undefined) return
  const state = store.stateFor(rootSessionId(agent))
  if (state.docs === undefined) return
  const absolute = absolutePath(path, cwdOf(agent) ?? state.root ?? '/')
  for (const doc of state.docs) {
    if (doc.path === absolute) state.satisfied.add(doc.id)
  }
}

/**
 * Does this call need the workspace root before it can be classified?
 *
 * Paying for resolution on read-only traffic is waste; skipping it on a
 * mutation would let the first edit through. Path-taking mutations and any
 * `bash` can resolve to a workspace target, so they qualify.
 *
 * @param exec - the pending call.
 * @returns true when resolution is on the critical path.
 */
function needsResolution(exec) {
  if (exec.name === 'read') return true
  if (isMutationTool(exec.name)) return true
  return exec.name === 'bash' && commandOf(exec.arguments) !== undefined
}

/**
 * Decide one pending call.
 *
 * @param store - the gate's state accessors.
 * @param log - records the "uninitialized workspace" note once.
 * @param exec - the pending call.
 * @param next - the rest of the waterfall.
 * @returns the waterfall's decision.
 */
async function gateCall(store, log, exec, next) {
  const agent = exec.agent
  const id = rootSessionId(agent)
  if (id === undefined) return next()
  const state = store.stateFor(id)

  // Resolution first: every decision below needs the workspace root, because
  // that is what tells an in-workspace target from an outside one.
  if (state.resolvedAt === undefined && needsResolution(exec)) {
    await store.resolveOnce(agent, state, exec.signal)
  }

  const kind = classifyCall(exec, state.root)
  if (kind === undefined) {
    if (exec.name === 'read') creditRead(store, agent, exec)
    return next()
  }
  if (state.resolvedAt === undefined) return denyUnresolved(exec, kind)
  if (state.docs.length === 0) {
    // Resolution succeeded and found NOTHING: an uninitialized workspace, or a
    // machine without the config checkout. A configuration state, not a bypass.
    log('no required docs found in this workspace; read-before-mutate gate inactive.')
    return next()
  }
  const missing = state.docs.filter(doc => !state.satisfied.has(doc.id))
  if (missing.length === 0) return next()
  return denyMutation(exec, kind, missing)
}

/**
 * Register the read-before-mutate gate.
 *
 * @param ctx - the cordis context.
 * @param config - optional `disabled`, `repoRoots` and `extraDocs`.
 */
export function apply(ctx, config = {}) {
  if (config.disabled === true) return
  if (config.extraDocs !== undefined && !Array.isArray(config.extraDocs)) {
    throw new TypeError(`${name}: extraDocs must be an array of repo-relative paths`)
  }

  let warned = false
  const log = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger?.warn?.(`${name}: ${message}`)
    } catch {
      // Logging is best-effort; the gate must never fail on it.
    }
  }

  /** The host filesystem seam, or a `node:fs` stand-in when absent. */
  const resolveFor = (cwd, signal) => {
    const fs = ctx.get('fs')
    if (fs !== undefined) return path => fs.resolve(path, { cwd, signal })
    return async (path) => {
      const { stat } = await import('node:fs/promises')
      return {
        stat: async () => {
          const info = await stat(path)
          return { type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other' }
        },
      }
    }
  }

  // Configured roots win; the discovered locations are the fallback.
  const repoRoots = [
    ...(Array.isArray(config.repoRoots) ? config.repoRoots : []),
    ...defaultRepoRoots(),
  ]
  const store = createStore({ resolveFor, repoRoots, extraDocs: config.extraDocs ?? [], log })

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      return await gateCall(store, log, exec, next)
    } catch (error) {
      // A gate bug must never block real work: fail open, loudly once.
      log(`gate evaluation failed; allowing the call: ${String(error?.message ?? error)}`)
      return next()
    }
  })
}
