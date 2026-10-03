/**
 * Optional persistence for gate credits, OFF by default.
 *
 * THE PROBLEM IT SOLVES. Credits live in a process-local ledger, so every dsh
 * restart costs a session the reads it already did. That is the only friction
 * left in the gate, and it is felt on every restart.
 *
 * THE REASON IT IS NOT ENABLED. A credit means "this session has seen this
 * content", and the gate exists because guidance the agent does not have in
 * context is guidance it does not follow - measured at 0 percent for file reading
 * in arXiv:2605.01771 and at 99 percent first-mutation-before-reading in this
 * repo's own sessions. Reusing a record from an earlier session produces a session
 * that mutates WITHOUT the rules in its context while the gate reports them
 * satisfied. That is the precise failure the gate was built to stop, so this
 * cannot be a default. Du's survey (arXiv:2603.07670) is the counterweight worth
 * weighing against it: summarisation drift means important detail is lost across
 * compaction, and a store of RAW records is the recommended supplement. Both are
 * true, which is why this is a documented switch rather than a decision.
 *
 * WHAT MAKES IT SAFE ENOUGH TO OFFER. A record holds a CONTENT fingerprint, not a
 * path. A credit is honoured only when the document on disk still hashes to what
 * was read, so a rewritten rule never reuses an old credit, and the weakest thing
 * this can say is "this exact content was read on this machine at some point".
 * The record carries the time it was read so a reader can judge how old that is.
 *
 * Enable with `creditStore: '<path>'` in the plugin config. Nothing is written
 * until a read succeeds, and a store that cannot be parsed is ignored rather than
 * fatal.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fingerprint } from './docs-gate-credit.mjs'

/**
 * Load a store, ignoring anything unreadable.
 *
 * A corrupt store must not break the gate: this is an accelerator, and the
 * fallback is the behaviour that already worked.
 *
 * @param path - the store path, or undefined when the feature is off.
 * @returns `docId -> { hash, at }`, empty when off or unreadable.
 */
export function loadStore(path) {
  if (path === undefined) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed?.docs !== undefined && typeof parsed.docs === 'object' ? parsed.docs : {}
  } catch {
    return {}
  }
}

/**
 * Record one successfully read document.
 *
 * @param path - the store path, or undefined when the feature is off.
 * @param docs - the current store contents.
 * @param doc - the document that was read.
 * @param content - its content, as the seam returned it.
 * @returns true when the store was written.
 */
export function recordRead(path, docs, doc, content) {
  if (path === undefined || content === undefined) return false
  const next = { ...docs, [doc.id]: { hash: fingerprint(content), at: new Date().toISOString() } }
  try {
    writeFileSync(path, `${JSON.stringify({ version: 1, docs: next }, null, 2)}\n`)
    return true
  } catch {
    // A read-only home, a full disk: the gate keeps working without this.
    return false
  }
}

/**
 * Does the store hold this document's current content?
 *
 * @param docs - the store contents.
 * @param doc - the document to check.
 * @param content - its content now.
 * @returns true when a previous session read exactly this.
 */
export function storeHolds(docs, doc, content) {
  const entry = docs[doc.id]
  return entry !== undefined && content !== undefined && entry.hash === fingerprint(content)
}

/**
 * Seed a ledger from the store for the documents whose content still matches.
 *
 * @param path - the store path, or undefined when the feature is off.
 * @param seam - the fs seam, for reading current content.
 * @param available - the resolved document set.
 * @param ledger - the ledger to seed.
 * @returns the documents that were seeded.
 */
export async function seedLedger(path, seam, available, ledger) {
  const docs = loadStore(path)
  if (Object.keys(docs).length === 0) return []
  const seeded = []
  for (const doc of available) {
    const entry = docs[doc.id]
    if (entry === undefined) continue
    try {
      const content = await seam.readText(doc.path)
      if (!storeHolds(docs, doc, content)) continue
      ledger.adopt(doc, entry.hash)
      seeded.push(doc.id)
    } catch {
      // An unreadable document is not seeded, which is the safe direction.
    }
  }
  return seeded
}

/** Is the feature configured at all? */
export function storeEnabled(path) {
  return typeof path === 'string' && path.length > 0
}

/** Whether the store file exists yet, for a report that wants to say so. */
export function storeExists(path) {
  return storeEnabled(path) && existsSync(path)
}
