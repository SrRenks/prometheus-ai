/**
 * Epoch-aware promotion tracker shared by the bootstrap and baseline-gate
 * plugins of the anchored presets.
 *
 * A compaction rewrites the model-visible surface: the pre-compaction
 * conversation collapses into one synthetic summary message, and the
 * workspace-instruction baseline is re-injected from scratch. The first
 * post-compaction request is therefore a "second first request": the same
 * first-token conditions the anchored presets exist to control. Promotion is
 * epoch-aware: only a durable promotion signal (`tool/call` and/or
 * `assistant/message`, per the caller's `promoteEvents`) recorded AFTER the
 * last `compaction/end` boundary counts as promoted. Before any compaction
 * the boundary is -1, which preserves the original one-shot semantics.
 *
 * State is memoized per session id and maintained incrementally through
 * `observe()`; a cold session scans its durable log once (so resume and
 * reload reconstruct the same phase), then O(1).
 *
 * By default subagents (`delegationDepth > 0`) are treated as already
 * promoted so their first request can use tools. Set `includeSubagents: true`
 * to make subagents follow the same bootstrap/anchor phase as top-level
 * sessions.
 */

/** Build one epoch-aware promotion tracker. */
export function createEpochPromotion(promoteEvents, options = {}) {
  const includeSubagents = options.includeSubagents === true
  const promote = new Set(promoteEvents)
  /** sessionId -> { boundary, promoted, seen } */
  const state = new Map()

  /**
   * Scan a session's durable log from scratch (cold start / resume), recording
   * how many events the answer was based on.
   *
   * @param session - the live session.
   * @returns the entry stored for it.
   */
  const scan = (session) => {
    let boundary = -1
    let promoted = false
    for (const event of session.events) {
      const seq = event.seq ?? 0 // events without a seq are treated as post-boundary
      if (event.type === 'compaction/end') {
        boundary = seq
        promoted = false
        continue
      }
      if (promote.has(event.type) && seq > boundary) promoted = true
    }
    const entry = { boundary, promoted, seen: session.events.length }
    state.set(session.id, entry)
    return entry
  }

  return {
    /**
     * Current phase of the agent's session.
     *
     * SELF-SUFFICIENT ON PURPOSE. This re-reads the durable log whenever it has
     * grown, instead of trusting the incremental `observe()` feed. That feed
     * depends on the host dispatching `session/event` to this plugin, and the
     * `instruction-hint` plugin sat mute in every live session while the log
     * itself was complete and the module rendered correctly in isolation. A
     * promotion signal that never fires in production is worse than none, so the
     * durable log is the source of truth and the incremental feed is only an
     * optimisation for recording a compaction boundary promptly.
     *
     * The `seen` count bounds the cost: the log is re-walked only after it has
     * actually grown.
     *
     * @param agent - the assembly/pre-step agent, or undefined outside an agent.
     * @returns { boundary, promoted } where `boundary` is the last compaction/end
     *   seq (-1 before any compaction); `promoted` is true when a durable
     *   promotion signal exists after that boundary.
     */
    status(agent) {
      if (agent === undefined) return { boundary: -1, promoted: true }
      const session = agent.session
      if (session === undefined) return { boundary: -1, promoted: true }
      // By default subagents keep the full catalog from their very first
      // request; includeSubagents makes them follow the normal bootstrap phase.
      if (!includeSubagents && (session.header?.delegationDepth ?? 0) > 0) return { boundary: -1, promoted: true }
      const entry = state.get(session.id)
      // Rescan only while still unpromoted: once a promotion signal is on
      // record it cannot be revoked by later events, so the log walk stops.
      if (entry === undefined || (!entry.promoted && entry.seen !== session.events.length)) return scan(session)
      return entry
    },
    /**
     * Incremental feed: call on every `session/event`.
     *
     * Best-effort only. {@link status} does not depend on it, so a host that
     * never dispatches the event still gets correct answers.
     */
    observe(session, event) {
      const entry = state.get(session.id)
      if (entry === undefined) return
      const seq = event.seq ?? 0
      if (event.type === 'compaction/end') {
        state.set(session.id, { boundary: seq, promoted: false, seen: session.events.length })
        return
      }
      if (promote.has(event.type) && seq > entry.boundary && !entry.promoted) {
        // Advance `seen` too: the rescan in `status()` is keyed on it, and a
        // promotion applied without it would be undone by the next rescan.
        state.set(session.id, { ...entry, promoted: true, seen: session.events.length })
      }
    },
  }
}
