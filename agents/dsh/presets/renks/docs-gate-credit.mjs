/**
 * Credit rules for the read-before-mutate gate.
 *
 * WHAT A CREDIT MEANS. Not "a read call named this path", but "this exact
 * content of this document was successfully read in this session". Everything
 * here exists to keep that sentence true, because a credit that means less than
 * that turns the gate into theatre: it denies work while permitting the same
 * work to be done on rules the agent never saw.
 *
 * WHY A LEDGER AND NOT THE SESSION LOG. A durable credit was the goal, and the
 * two obvious routes are both closed:
 *
 *   - writing our own event is impossible: an out-of-repo event type needs the
 *     envelope's `ignorable` marker or a future runtime refuses to reconstruct
 *     the session at all, and the public `session.append()` only accepts surface
 *     metadata, so the marker cannot be set;
 *   - deriving the credit by replaying the log needs `eventAt()`,
 *     `snapshotEvents()` or `ownEvents()`, all three prohibited for new
 *     production code.
 *
 * So the ledger is per-process and honest about it: it holds what this process
 * watched succeed. Content binding is what makes that acceptable, and it also
 * fixes two defects the old credit had regardless of persistence.
 */
import { createHash } from 'node:crypto'

/** Argument keys a read tool may use for the path it was asked to open. */
const PATH_KEYS = ['file_path', 'path']

/**
 * Is this call the read tool?
 *
 * @param exec - the pending tool call.
 * @returns true when it is a read.
 */
export function isReadCall(exec) {
  return exec?.name === 'read'
}

/**
 * The absolute path a read call names, or undefined.
 *
 * Reads outside the configuration (a relative path, a malformed payload) are
 * not our business, so they resolve to undefined rather than to a guess.
 *
 * @param exec - the pending `read` call, whose `arguments` may be a JSON string
 *   (as the host records it) or an object (as a test harness passes it).
 * @returns the absolute path, or undefined.
 */
export function readPathOf(exec) {
  if (!isReadCall(exec)) return undefined
  // The host records `arguments` as a JSON STRING; a unit test harness passes an
  // object. Accepting only one of the two silently credits nothing on the other
  // side, which is the failure mode this module exists to remove.
  const raw = exec.arguments
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  for (const key of PATH_KEYS) {
    const value = parsed?.[key]
    if (typeof value === 'string' && value.startsWith('/')) return value
  }
  return undefined
}

/**
 * The tracked document at an absolute path, or undefined.
 *
 * @param docs - the resolved document set.
 * @param absolute - the absolute path to match.
 * @returns the document, or undefined when the path is not tracked.
 */
export function wantedDoc(docs, absolute) {
  if (absolute === undefined) return undefined
  return docs.find(doc => doc.path === absolute)
}

/**
 * A stable fingerprint of document content.
 *
 * Content, not mtime: a checkout operation, a rebase, or a rewrite that leaves
 * the bytes identical must not invalidate a credit, and a rewrite that changes
 * a byte must invalidate it even if the timestamp is preserved.
 *
 * @param text - the file content.
 * @returns a hex digest.
 */
export function fingerprint(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Build the per-session credit ledger.
 *
 * @returns the ledger surface the gate uses.
 */
export function createLedger() {
  /** docId -> content fingerprint that was successfully read. */
  const held = new Map()

  return {
    /**
     * Record one read outcome. A read that produced no content records nothing,
     * and a read that failed after an earlier success leaves the earlier credit
     * standing: retrying and failing does not un-read what was already read.
     *
     * @param exec - the read call that ran.
     * @param content - the content it returned, or undefined when it failed.
     * @param docs - the resolved document set.
     * @returns true when the call credited something.
     */
    record(exec, content, docs) {
      if (content === undefined) return false
      const doc = wantedDoc(docs, readPathOf(exec))
      if (doc === undefined) return false
      held.set(doc.id, fingerprint(content))
      return true
    },
    /**
     * Does a document's CURRENT content match what was read here?
     *
     * @param doc - the tracked document.
     * @param content - its content right now.
     * @returns true when this session read exactly this content.
     */
    holds(doc, content) {
      const recorded = held.get(doc.id)
      return recorded !== undefined && content !== undefined && recorded === fingerprint(content)
    },
    /** How many documents the ledger holds, for tests and diagnostics. */
    size() {
      return held.size
    },
  }
}
