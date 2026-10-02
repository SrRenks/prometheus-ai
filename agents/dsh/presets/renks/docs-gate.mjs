/**
 * docs-gate: make the behavioural doc set a PRECONDITION of the first mutation
 * in a workspace, instead of a hint the model may skip.
 *
 * WHY (measured, not assumed). A 2026-10 audit over 96 recorded sessions in
 * `$DSH_HOME/sessions`, reproduced by `tools/audit-instruction-reads.mjs`,
 * found the instruction layer was largely advisory:
 *
 *   - 33% of transcripts had read AGENTS.md / CLAUDE.md / `.ai/*.md` at all;
 *   - 10% had read ANY core behavioural doc;
 *   - the `instruction-hint` plugin delivered its hint in 30 sessions, and 17
 *     of those still never opened an instruction file;
 *   - replayed against this gate's classifier, 83 of the 84 sessions that
 *     mutated anything (99%) made their first mutation before reading the set,
 *     at a median of 3 tool calls in. Numbers move as sessions accumulate;
 *     re-run tools/audit-instruction-reads.mjs rather than quoting these.
 *
 * WHAT THIS DOES. It observes `tools/pre-execute` and returns
 * `{ kind: 'deny' }` for a MUTATING call until the session has read each
 * required doc once. The denial reaches the model as the tool result, so the
 * corrective instruction arrives exactly where the model is looking.
 *
 * WHAT IT REFUSES TO GATE: read-only calls, targets outside the workspace, and
 * uninitialized workspaces. See the README for the full list.
 *
 * FAILURE POSTURE. A workspace that cannot be identified costs the project doc
 * and nothing else: the five shared docs are probed at canonical paths. Only a
 * config checkout that cannot be read at all denies, and that denial names the
 * underlying error chain so the cause is visible from the tool result.
 *
 * STATE. Credits live in a process-local `Map` keyed by ROOT session id, and a
 * subagent resolves its root through `agent.parentAgent`, so a delegated agent
 * inherits the parent's evidence. This is intentionally not the durable log: a
 * resumed session re-reads, which is the conservative direction for a gate
 * whose point is that the rules are in context.
 */

import {
  absolutePath,
  classifyCall,
  commandOf,
  cwdOf,
  defaultRepoRoots,
  denyMutation,
  denyUnresolved,
  describeError,
  docsForTier,
  findWorkspaceRoot,
  isMutationTool,
  languageForTarget,
  normalizePath,
  pathOf,
  requiredTier,
  resolveRequiredDocs,
  rootSessionId,
  tierCeiling,
  TIERS,
} from './docs-gate-policy.mjs'

export * from './docs-gate-policy.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'docs-gate'

/**
 * Build the per-root-session store.
 *
 * Two hazards shape it. Resolution is async, so concurrent tool calls must
 * share one in-flight promise instead of walking the filesystem twice. And a
 * failed resolution must stay retryable, so the promise is cleared on failure
 * and the caller can tell "resolved to nothing" from "could not resolve".
 *
 * @param options.resolveFor - builds the fs resolver for one call.
 * @param options.repoRoots - config checkout roots, in probe order.
 * @param options.log - records a warning once per process.
 * @returns the gate's state accessors.
 */
function createStore({ resolveFor, repoRoots, log }) {
  const sessions = new Map()

  /** Load or create the record for one root session. */
  const stateFor = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      state = {
        satisfied: new Set(), docs: undefined, root: undefined, boundary: undefined,
        pending: undefined, resolvedAt: undefined, failure: undefined,
      }
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
      // A workspace that cannot be identified is survivable: the config docs do
      // not need it. Only a failing CONFIG probe denies.
      const found = await findWorkspaceRoot(resolve, cwd, signal).catch((error) => {
        log(`workspace root walk failed, continuing without it: ${describeError(error)}`)
        return { root: cwd, found: false }
      })
      if (found.failure !== undefined) {
        log(`workspace marker probe failed, continuing: ${describeError(found.failure)}`)
      }
      // `state.root` serves the doc probes; `state.boundary` serves the
      // in-or-out decision and stays undefined unless a marker identified it.
      state.root = found.root === undefined ? undefined : normalizePath(found.root)
      state.boundary = found.found === true ? state.root : undefined

      const resolved = await resolveRequiredDocs({ resolve, workspaceRoot: state.root, repoRoots, signal })
      state.docs = [...(resolved.configDocs ?? []), ...(resolved.projectDocs ?? [])]
      // A checkout missing the code-tier files cannot gate on them.
      state.ceiling = tierCeiling(state.docs)
      state.resolvedAt = Date.now()
    })().catch((error) => {
      // The config probe itself failed. Keep the detail so the denial can name
      // it, and clear the promise so a later call retries.
      log(`config doc resolution failed: ${describeError(error)}`)
      state.pending = undefined
      state.docs = undefined
      state.resolvedAt = undefined
      state.failure = describeError(error)
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
 * the read is approved; waiting for `post-execute` would introduce an ordering
 * hazard, because a read arriving before the async resolution settles has no
 * cached doc set to match against and would be silently uncredited.
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
 * Path-taking mutations and any `bash` with a command can resolve to a
 * workspace target, so they qualify. Paying for resolution on unrelated
 * read-only traffic is waste.
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

  if (state.resolvedAt === undefined && needsResolution(exec)) {
    await store.resolveOnce(agent, state, exec.signal)
  }

  const call = classifyCall(exec, state.boundary)
  if (call === undefined) {
    if (exec.name === 'read') creditRead(store, agent, exec)
    return next()
  }
  if (state.resolvedAt === undefined) return denyUnresolved(exec, call.kind, state.failure ?? '')
  if (state.docs.length === 0) {
    log('no required docs found in this workspace; read-before-mutate gate inactive.')
    return next()
  }

  // The tier decides how much must be read. A prose or config change needs the
  // core rules only; source needs the code rules too. The ceiling keeps a
  // checkout that lacks the code-tier files from gating on them.
  const wanted = requiredTier(call.kind, call.target)
  const tier = state.ceiling !== undefined && tierOf(wanted) > tierOf(state.ceiling) ? state.ceiling : wanted
  const language = languageForTarget(call.target)
  const requiredDocs = docsForTier(tier, state.docs, language)
  const missing = requiredDocs.filter(doc => !state.satisfied.has(doc.id))
  if (missing.length === 0) return next()
  return denyMutation(exec, call.kind, missing)
}

/**
 * Rank one tier name for comparison.
 *
 * @param tier - a tier name.
 * @returns its index, or -1 when unknown.
 */
function tierOf(tier) {
  return TIERS.indexOf(tier)
}

/**
 * Register the read-before-mutate gate.
 *
 * @param ctx - the cordis context.
 * @param config - optional `disabled` and `repoRoots`.
 */
export function apply(ctx, config = {}) {
  if (config.disabled === true) return

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

  const repoRoots = [
    ...(Array.isArray(config.repoRoots) ? config.repoRoots : []),
    ...defaultRepoRoots(),
  ]
  const store = createStore({ resolveFor, repoRoots, log })

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      return await gateCall(store, log, exec, next)
    } catch (error) {
      // A gate bug must never block real work: fail open, loudly once.
      log(`gate evaluation failed; allowing the call: ${describeError(error)}`)
      return next()
    }
  })
}