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
 *   - 17 of the 30 sessions the old hint plugin counted as "delivered" still
 *     never opened an instruction file (and on 2026-10-02 that plugin was
 *     found never to have reached a live session at all, so treat "delivered"
 *     as unverified rather than as a fact);
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
 * STATE. Credits live in a process-local ledger keyed by ROOT session id, and a
 * subagent resolves its root through `agent.parentAgent`, so a delegated agent
 * inherits the parent's evidence. A credit means "this exact content was read
 * here", not "a read named this path": the ledger stores a content fingerprint,
 * so a failed read credits nothing and a document edited after the read loses
 * its credit. Persisting the ledger is blocked by the session API (see
 * `docs-gate-credit.mjs`), and a resumed session re-reads, which is the
 * conservative direction for a gate whose point is that the rules are in
 * context.
 */

import { createLedger, isReadCall, wantedDoc } from './docs-gate-credit.mjs'
import { createSeamFor } from './docs-gate-seam.mjs'
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
  isCommitCommand,
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

/** Mutation kinds that can carry the commit act. */
const COMMIT_KINDS = new Set(['git-write', 'gh-write', 'lazygit'])

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
 * @param options.seamFor - builds the fs seam for one call.
 * @param options.repoRoots - config checkout roots, in probe order.
 * @param options.log - records a warning once per process.
 * @returns the gate's state accessors.
 */
function createStore({ seamFor, repoRoots, extraDocs, log }) {
  const sessions = new Map()

  /** Load or create the record for one root session. */
  const stateFor = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      state = {
        ledger: createLedger(), docs: undefined, root: undefined, boundary: undefined,
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
    const seam = seamFor(cwd, signal)
    state.pending = (async () => {
      // A workspace that cannot be identified is survivable: the config docs do
      // not need it. Only a failing CONFIG probe denies.
      const found = await findWorkspaceRoot(seam, cwd, signal).catch((error) => {
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

      const resolved = await resolveRequiredDocs({ seam, workspaceRoot: state.root, repoRoots, extraDocs, signal })
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

  return { stateFor, resolveOnce, seamFor }
}

/**
 * Credit a `read` that actually returned content.
 *
 * Runs AFTER the waterfall approved the call, so the content is real. The
 * earlier version credited in front of `next()`, which meant a read that failed
 * - a wrong path, a missing file - still counted, and the denial message then
 * claimed the agent had read rules it never saw. A session on this machine did
 * exactly that: it read a literal `~/.config/...`, got "not found", and would
 * have been credited.
 *
 * The content comes from the seam rather than the tool result, so the ledger
 * fingerprints the bytes the gate would later compare against. A read that
 * cannot be re-read here credits nothing: unverifiable is not the same as read.
 *
 * @param store - the gate's state accessors.
 * @param agent - the calling agent.
 * @param exec - the `read` call that just ran.
 * @param seam - the fs seam for this call.
 */
async function creditRead(store, agent, exec, seam) {
  if (!isReadCall(exec)) return
  const state = store.stateFor(rootSessionId(agent))
  if (state?.docs === undefined) return
  const absolute = absolutePath(pathOf(exec.arguments) ?? '', cwdOf(agent) ?? state.root ?? '/')
  const doc = wantedDoc(state.docs, absolute)
  if (doc === undefined) return
  let content
  try {
    content = await seam.readText(doc.path)
  } catch {
    return
  }
  state.ledger.record(exec, content, state.docs)
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
    const decision = await next()
    if (isReadCall(exec)) await creditRead(store, agent, exec, store.seamFor(cwdOf(agent) ?? process.cwd(), exec.signal))
    return decision
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
  // Three independent selectors: the tier ladder, the language of the file
  // being changed, and whether this call is the commit act itself.
  const requiredDocs = docsForTier(tier, state.docs, {
    language: languageForTarget(call.target),
    commits: COMMIT_KINDS.has(call.kind) && isCommitCommand(commandOf(exec.arguments)),
  })
  // A credit counts only while the document still holds the content that was
  // read. A doc edited mid-session invalidates its credit on purpose: the agent
  // read the old rules, and the old rules are not what governs the change.
  const seam = store.seamFor(cwdOf(agent) ?? process.cwd(), exec.signal)
  const missing = []
  for (const doc of requiredDocs) {
    if (await holdsContent(state, doc, seam)) continue
    missing.push(doc)
  }
  if (missing.length === 0) return next()
  return denyMutation(exec, call.kind, missing)
}

/**
 * Does the ledger hold this document's CURRENT content?
 *
 * A read that cannot be re-read here counts as not held: the gate cannot verify
 * what it cannot see, and guessing in the agent's favour is how a gate becomes
 * decorative.
 *
 * @param state - the session state.
 * @param doc - the required document.
 * @param seam - the fs seam for this call.
 * @returns true when the content matches what this session read.
 */
async function holdsContent(state, doc, seam) {
  try {
    return state.ledger.holds(doc, await seam.readText(doc.path))
  } catch {
    return false
  }
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

  const seamFor = createSeamFor(ctx)
  const repoRoots = [
    ...(Array.isArray(config.repoRoots) ? config.repoRoots : []),
    ...defaultRepoRoots(),
  ]
  const store = createStore({ seamFor, repoRoots, extraDocs: config.extraDocs ?? [], log })

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