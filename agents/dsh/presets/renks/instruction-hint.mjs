/**
 * instruction-hint: replace `dsh-agent-instructions`' full AGENTS.md/CLAUDE.md
 * injection with a minimal "these files exist" hint.
 *
 * WHY: the full workspace-instruction digest is a large injected block. After
 * the session's promotion signal (the anchored bootstrap's promote in the
 * liangshen preset, or simply the first durable tool call elsewhere), we want
 * the model to KNOW the instruction files exist (so it reads them before
 * acting) without dumping their content into every request. The model reads
 * the files itself via the filesystem tools when it needs them.
 *
 * Behavior:
 *  - After the session records its first durable promotion signal
 *    (`promoteOn`, default `either`), ONE hint message is injected (once per
 *    session; durable event scan, resume-safe), listing which instruction
 *    files were found:
 *      - user-global: `$DSH_HOME/AGENTS.md`
 *      - project chain: AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md
 *        walking up from the session cwd to the project root (a directory
 *        containing `.git`, or the cwd itself).
 *  - The hint also NAMES the behavioural doc set the shared config depends on
 *    (`core/principles.md`, `core/docs/complexity.md`, `maintainability.md`,
 *    `git-workflow.md`, `development-workflow.md`) and the project's
 *    `.ai/project.md`. A hint saying only "instruction files exist" loads none
 *    of them: AGENTS.md references them from a read-on-demand index, and a
 *    2026-10 audit of 96 recorded sessions found 8% had read any of them. The
 *    hint names them; `docs-gate.mjs` enforces them.
 *  - The hint tells the model that mutating tools are gated until those docs
 *    are read, so the requirement is stated BEFORE the denial arrives rather
 *    than discovered from it.
 *  - Files are probed via `ctx.fs` (the host filesystem seam); a missing fs
 *    service or an unreadable probe yields no hint.
 *  - Pre-promotion requests get NO hint (matches the anchored bootstrap).
 *
 * ROW ORDER: this plugin registers its `agent/pre-step` handler with
 * `prepend: true` and after `tool-bootstrap`, so it runs inside the
 * bootstrap's outermost strip, but it emits AFTER promotion, when the strip
 * is inactive. The hint source kind is `instruction-hint`, which is NOT in
 * `suppressedContextSources`, so it is never stripped.
 */

import { createEpochPromotion } from './compaction-epoch.mjs'
import { REQUIRED_DOCS as GATE_DOCS, TIERS } from './docs-gate-tiers.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'instruction-hint'

/** Durable session event types that count as a promotion signal per mode. */
const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
}

/**
 * Behavioural docs the hint names by path, derived from the gate's own registry.
 *
 * Derived, not copied: a list maintained here would drift, and a hint that names
 * files the gate does not enforce (or misses ones it does) is worse than no hint.
 * `docs-gate-tiers.mjs` is the single source, and the two tiers are the whole
 * point — a prose change needs the core rules, source needs all of them.
 */
export const REQUIRED_DOCS = configDocsByTier()

/** The gate's doc registry, grouped by tier, as repo-relative paths. */
function configDocsByTier() {
  const grouped = {}
  for (const doc of GATE_DOCS) {
    grouped[doc.tier] ??= []
    grouped[doc.tier].push(doc.repoPath)
  }
  return grouped
}

/** Gated docs that only matter at the moment of committing. */
const COMMIT_DOCS = GATE_DOCS.filter(doc => doc.commits === true).map(doc => doc.repoPath)

/** Candidate file names, in probe order, for the project chain and user-global. */
const PROJECT_CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']
const USER_GLOBAL_CANDIDATE = 'AGENTS.md'

function parsePromoteOn(value) {
  if (value === undefined || value === 'either') return PROMOTE_EVENTS.either
  if (value === 'tool-call' || value === 'assistant-message') return PROMOTE_EVENTS[value]
  throw new TypeError(`${name}: promoteOn must be one of "tool-call", "assistant-message", "either"; got ${JSON.stringify(value)}`)
}

/** Find the project root: first ancestor containing any root marker (e.g. .git). */
async function findProjectRoot(fs, cwd, signal, probeFailed = { value: false }) {
  let current = cwd
  for (;;) {
    for (const marker of ['.git', '.hg', '.svn']) {
      try {
        const target = await fs.resolve(joinPath(current, marker), { cwd, signal })
        const info = await fs.stat(target, signal)
        if (info !== undefined) return current
      } catch {
        // A missing marker and an unreadable filesystem are indistinguishable
        // here, so record that a probe failed and let the caller decide whether
        // "found nothing" is a fact or an artefact.
        probeFailed.value = true
      }
    }
    const parent = parentPath(current)
    if (parent === current || parent.length === 0) return cwd
    current = parent
  }
}

/** List instruction files present in one directory (project candidates). */
async function presentInDir(fs, dir, candidates, signal, probeFailed = { value: false }) {
  const found = []
  for (const candidate of candidates) {
    try {
      const target = await fs.resolve(joinPath(dir, candidate), { cwd: dir, signal })
      const info = await fs.stat(target, signal)
      if (info !== undefined && info.type === 'file') found.push(candidate)
    } catch {
      // Absent or unreadable: skip, and record which it might have been.
      probeFailed.value = true
    }
  }
  return found
}

/** Join one path segment onto a directory (platform-agnostic string join). */
function joinPath(dir, segment) {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + segment
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir + sep + segment
}

/** Parent of an absolute Windows or POSIX path. */
function parentPath(path) {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (idx <= 0) return path
  const parent = path.slice(0, idx)
  return parent.length === 0 ? path : parent
}

/**
 * The sentence naming the doc set, tier by tier.
 *
 * Stating both tiers is what stops the hint from over-promising: the model is
 * told that a prose change needs two files and a source change needs all five,
 * which is exactly what the gate enforces.
 *
 * @returns one sentence naming the required docs.
 */
function docSetSentence() {
  const here = docs => docs.map(doc => `~/.config/agent-config/${doc}`).join(', ')
  // The commit-time docs sit in the core tier but only apply at a commit, so
  // they are stated separately rather than listed as always-on.
  const commitSet = new Set(COMMIT_DOCS)
  const parts = []
  for (const tier of TIERS) {
    const docs = (REQUIRED_DOCS[tier] ?? []).filter(doc => !commitSet.has(doc))
    if (docs.length === 0) continue
    parts.push(tier === 'core'
      ? `always, before the first edit, write, or mutating shell command: ${here(docs)}`
      : `and when the change touches source code: ${here(docs)}`)
  }
  if (COMMIT_DOCS.length > 0) parts.push(`and before committing: ${here(COMMIT_DOCS)}`)
  const guides = REQUIRED_DOCS.language
  if (guides !== undefined && guides.length > 0) {
    const names = guides.map(doc => doc.split('/').pop().replace(/\.md$/, '')).join(', ')
    parts.push(`plus the guide for the changed file's language, one of: ${names} (under core/docs/languages/)`)
  }
  parts.push("plus this project's `.ai/project.md` when it exists")
  return `Read the behavioural rules the instruction files depend on — ${parts.join('; ')}. The docs-gate plugin blocks mutating tools until the reads a change needs have landed, so reading first is faster than being denied.`
}

/** Register the post-promotion instruction-hint injector. */
export function apply(ctx, config) {
  const promoteEvents = parsePromoteOn(config.promoteOn)
  if (config.includeSubagents !== undefined && typeof config.includeSubagents !== 'boolean') {
    throw new TypeError(`${name}: includeSubagents must be a boolean`)
  }
  const promotion = createEpochPromotion(promoteEvents, { includeSubagents: config.includeSubagents === true })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  /** Sessions that already received the hint. */
  const hinted = new Set()
  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable; the guard exists only to avoid spamming.
    }
  }

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try {
      if (promotion.status(agent).promoted !== true) return decision
      const session = agent.session
      if (session === undefined || hinted.has(session.id)) return decision

      // An earlier request in this process already decided what to do with this
      // session (durable scan below). The claim is NOT taken here: taking it
      // before the hint is built meant a probe that could not complete silenced
      // the session permanently, with no log and no retry. Transient conditions
      // must not consume the one chance a session gets.
      if (session.events.some(
        event => event.type === 'user/message' && event.data?.source?.kind === 'instruction-hint',
      )) {
        hinted.add(session.id)
        return decision
      }

      const fs = ctx.get('fs')
      if (fs === undefined) {
        // Permanent for this process: no filesystem means no hint, ever. Claim
        // so later requests stop paying for the check.
        hinted.add(session.id)
        return decision
      }
      const cwd = session.header.cwd ?? process.cwd()

      // Track probe failures so an empty result can be told from an unreadable
      // one. "There are no instruction files" is a fact worth claiming;
      // "I could not read the filesystem" is not, and must stay retryable.
      const probeFailed = { value: false }
      const projectFiles = []
      const root = await findProjectRoot(fs, cwd, signal, probeFailed)
      projectFiles.push(...await presentInDir(fs, root, PROJECT_CANDIDATES, signal, probeFailed))

      const userGlobalFiles = []
      try {
        const dshHome = process.env.DSH_HOME ?? (process.env.USERPROFILE ? `${process.env.USERPROFILE}\\.dsh` : undefined)
        if (dshHome !== undefined) {
          userGlobalFiles.push(...await presentInDir(fs, dshHome, [USER_GLOBAL_CANDIDATE], signal, probeFailed))
        }
      } catch {
        // Unreadable home probe: ignore.
      }

      const sections = []
      if (projectFiles.length > 0) {
        sections.push(`Workspace instruction files exist: ${projectFiles.join(', ')} (project root: ${root}).`)
      }
      if (userGlobalFiles.length > 0) {
        sections.push(`A user-global instruction file exists: ${USER_GLOBAL_CANDIDATE}.`)
      }
      if (sections.length === 0) {
        if (probeFailed.value) {
          // Unreadable, not empty. Leave the session unclaimed so the next
          // request retries instead of losing the hint for good.
          warnOnce(`${name}: instruction files could not be probed; will retry on the next request.`)
          return decision
        }
        // Definitively nothing to report: claim so later requests stop walking.
        hinted.add(session.id)
        return decision
      }

      const text = [
        ...sections,
        'Do NOT assume their content. When a task touches this workspace, read the relevant instruction files first and follow them.',
        docSetSentence(),
      ].join(' ')

      // Claim only now: the hint is built, so this is the one emission. A throw
      // above leaves the session unclaimed and the next request retries.
      hinted.add(session.id)
      return {
        ...decision,
        messages: [...decision.messages, {
          id: `instruction-hint-${session.id}`,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'instruction-hint', form: 'hint' },
        }],
      }
    } catch (error) {
      // A hint bug must never hurt the session: skip the hint.
      warnOnce(`${name}: hint injection failed, skipping: ${String((error && error.message) || error)}`)
      return decision
    }
  }, { prepend: true })
}
