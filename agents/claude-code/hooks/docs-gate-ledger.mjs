/**
 * The docs-gate credit ledger for Claude Code, kept on disk.
 *
 * The dsh plugin holds its ledger in process memory. A Claude Code hook is a
 * new process per tool call, so the same ledger lives in files instead: one
 * directory per session, one file per document, holding the content
 * fingerprint that was read. A credit still means what it means in dsh, "this
 * exact content was read in this session", because the fingerprint comes from
 * `docs-gate-credit.mjs` and is compared against the file as it is now.
 *
 * One file per document, written by rename, because Claude Code runs the hooks
 * of parallel tool calls concurrently. A single JSON file rewritten by each
 * process would lose updates; a rename of a whole file cannot.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fingerprint } from '../../dsh/presets/renks/docs-gate-credit.mjs'

/** Session directories untouched for this long are removed at session start. */
const STALE_MS = 14 * 24 * 60 * 60 * 1000

/** Marker file: this session's context was compacted or cleared. */
const COMPACTED = '.compacted'

/** Lock timing for {@link withLock}: up to about two seconds of waiting. */
const LOCK_ATTEMPTS = 200
const LOCK_PAUSE_MS = 10
const LOCK_STALE_MS = 5000

/**
 * A session id safe to use as one path segment.
 *
 * @param id - the raw `session_id` from the hook payload.
 * @returns the sanitized id, or undefined when there is none.
 */
export function sessionKey(id) {
  if (typeof id !== 'string' || id.length === 0) return undefined
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** A doc id safe to use as a file name (`extra:docs/x.md` has a slash). */
function docKey(id) {
  return encodeURIComponent(id)
}

/**
 * Open the ledger of one session.
 *
 * @param stateDir - the root directory holding every session's ledger.
 * @param session - a key from {@link sessionKey}.
 * @returns the ledger surface the hook uses.
 */
export function openLedger(stateDir, session) {
  const dir = join(stateDir, session)
  const fileOf = doc => join(dir, docKey(doc.id))

  const read = (doc) => {
    try {
      return readFileSync(fileOf(doc), 'utf8').trim()
    } catch {
      return undefined
    }
  }

  return {
    /** Record a document by an already computed fingerprint. */
    adopt(doc, hash) {
      if (typeof hash !== 'string' || hash.length === 0) return
      mkdirSync(dir, { recursive: true })
      const tmp = `${fileOf(doc)}.${process.pid}.tmp`
      writeFileSync(tmp, `${hash}\n`)
      renameSync(tmp, fileOf(doc))
    },
    /** Record the content that was just read. */
    record(doc, content) {
      if (typeof content !== 'string') return
      this.adopt(doc, fingerprint(content))
    },
    /** Does the ledger hold this document's CURRENT content? */
    holds(doc, content) {
      const recorded = read(doc)
      return recorded !== undefined && typeof content === 'string' && recorded === fingerprint(content)
    },
    /**
     * Drop every credit of this session and remember that it happened, so the
     * optional cross-session store cannot hand the credits straight back.
     */
    reset() {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, COMPACTED), '')
    },
    /** Has this session lost its context since it started? */
    compacted() {
      return existsSync(join(dir, COMPACTED))
    },
  }
}

/**
 * Run `fn` while holding a lock beside `path`, across processes.
 *
 * The credit store is one JSON file merged by load-modify-write, and the hooks
 * of a batched Read run concurrently: without the lock, 7 parallel reads kept 6
 * docs in 7 of 10 trials. `mkdir` is atomic, so it is the lock. A lock older
 * than the stale limit belongs to a killed process and is taken over. If the
 * lock cannot be had in time the write is skipped: the store is an optional
 * convenience, and a hook that hangs is worse than a credit not reused.
 *
 * @param path - the file the lock protects.
 * @param fn - the critical section.
 */
export function withLock(path, fn) {
  const lock = `${path}.lock`
  const pause = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      mkdirSync(lock)
    } catch (error) {
      // Only a held lock is worth waiting for; a missing parent never clears.
      if (error?.code !== 'EEXIST') return undefined
      if (lockIsStale(lock)) rmSync(lock, { recursive: true, force: true })
      Atomics.wait(pause, 0, 0, LOCK_PAUSE_MS)
      continue
    }
    try {
      return fn()
    } finally {
      rmSync(lock, { recursive: true, force: true })
    }
  }
  return undefined
}

/** Is a lock directory older than any live holder could make it? */
function lockIsStale(lock) {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
  } catch {
    return false
  }
}

/**
 * Remove session ledgers nobody has touched in two weeks.
 *
 * Best effort: a ledger is a few bytes, and failing a session start over one
 * would be the wrong trade.
 *
 * @param stateDir - the root directory holding every session's ledger.
 * @param now - the current time, for tests.
 */
export function pruneStale(stateDir, now = Date.now()) {
  let entries
  try {
    entries = readdirSync(stateDir)
  } catch {
    return
  }
  for (const entry of entries) {
    try {
      const path = join(stateDir, entry)
      if (now - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true })
    } catch {
      // Removed concurrently, or unreadable: either way, not this run's problem.
    }
  }
}
