/**
 * docs-gate policy: the filesystem seam, the doc resolution, and the denials.
 *
 * Two siblings hold what is not here: `docs-gate-target.mjs` owns path and
 * command parsing, `docs-gate-tiers.mjs` owns which docs a mutation needs. Both
 * are re-exported below, so `docs-gate.mjs`, the spec and the verifier keep
 * importing one module.
 *
 * See `docs-gate.mjs` for why the gate exists and what it refuses to gate.
 */

export * from './docs-gate-target.mjs'
export * from './docs-gate-tiers.mjs'

import {
  classifyBash,
  commandOf,
  isInside,
  joinPath,
  normalizePath,
  parentPath,
  pathOf,
  redirectTarget,
  workdirOf,
} from './docs-gate-target.mjs'

import { REQUIRED_DOCS } from './docs-gate-tiers.mjs'

/** Project-local doc required when the workspace has one. */
const PROJECT_DOC_REPO_PATH = '.ai/project.md'

/** Tools that write to the workspace and therefore require the doc set. */
const MUTATION_TOOLS = new Set(['edit', 'write', 'multi_edit', 'apply_patch', 'notebook_edit'])

/**
 * Error codes that mean the probe itself failed, as opposed to "this path is
 * not there".
 *
 * This is deliberately the SHORT list, and it is a deny-list rather than an
 * allow-list. A gate that walks a directory tree asking "does `.git` exist"
 * gets "no" almost every time; treating an unrecognised code as a hard failure
 * turns the common answer into a lockout, which is what happened in production
 * on 2026-10-02: the host reported absent paths with a code outside the previous
 * allow-list, every marker probe rethrew, the workspace root never resolved, and
 * every mutation was denied permanently. A backend that invents a new code now
 * degrades to the permissive reading instead of deadlocking the session.
 */
const REAL_FAILURE_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'FS_ABORTED', 'ABORT_ERR'])

/**
 * Recursively match an error's code chain against the real-failure codes.
 *
 * @param error - the thrown value.
 * @param depth - recursion guard for a cyclic `cause` chain.
 * @returns true only for a permission or cancellation failure.
 */
export function isFailureError(error, depth = 0) {
  if (error === null || typeof error !== 'object' || depth > 8) return false
  if (typeof error.code === 'string' && REAL_FAILURE_CODES.has(error.code)) return true
  return isFailureError(error.cause, depth + 1)
}

/**
 * Render an error and its `cause` chain as one short line, e.g.
 * `FS_ABORTED: resolve aborted <- ENOENT: no such file`.
 *
 * A bare `error.message` hides the code that decides whether the gate treats a
 * probe as absent or as failed, which is the distinction that matters when the
 * gate refuses a call.
 *
 * @param error - the thrown value.
 * @param depth - recursion guard for a cyclic `cause` chain.
 * @returns the rendered chain, or an empty string for a non-error.
 */
export function describeError(error, depth = 0) {
  if (error === null || typeof error !== 'object' || depth > 4) return ''
  const code = typeof error.code === 'string' ? `${error.code}: ` : ''
  const message = typeof error.message === 'string' ? error.message : String(error)
  const here = `${code}${message}`.slice(0, 120)
  const rest = describeError(error.cause, depth + 1)
  return rest.length > 0 ? `${here} <- ${rest}` : here
}

/**
 * Canonical locations of the shared config checkout, in probe order. Resolution
 * walks the filesystem rather than trusting the literal paths written in
 * AGENTS.md, so a relocated or renamed checkout still works.
 *
 * @param env - environment to read (`AGENT_CONFIG`, `HOME`/`USERPROFILE`).
 * @param home - explicit home directory, overriding the environment.
 * @returns candidate absolute roots, most specific first.
 */
export function defaultRepoRoots(env = process.env, home = undefined) {
  const roots = []
  const homeDir = home ?? env.HOME ?? env.USERPROFILE
  if (typeof env.AGENT_CONFIG === 'string' && env.AGENT_CONFIG.length > 0) roots.push(env.AGENT_CONFIG)
  if (typeof homeDir === 'string' && homeDir.length > 0) {
    roots.push(`${homeDir}/.config/agent-config`)
    roots.push(`${homeDir}/agent-config`)
  }
  return roots
}

/**
 * Is this tool one that writes to the workspace?
 *
 * @param toolName - the tool's registered name.
 * @returns true when the tool mutates the workspace.
 */
export function isMutationTool(toolName) {
  return MUTATION_TOOLS.has(toolName)
}

/**
 * Is this call a workspace mutation the gate should guard?
 *
 * `boundary` is the workspace root ONLY when a VCS marker identified it. A
 * guessed root must be passed as `undefined`: otherwise an edit to a real file
 * one directory above the session `cwd` looks like an edit outside the
 * workspace and passes unguarded.
 *
 * Returns the kind AND the target, because the tier a call must satisfy depends
 * on what is being changed: a Markdown file needs the core rules, a source file
 * needs the code rules.
 *
 * @param exec - the pending tool call (`name`, `arguments`).
 * @param boundary - the identified workspace root, or undefined when unknown.
 * @returns `{ kind, target }`, or undefined for a call the gate leaves open.
 */
export function classifyCall(exec, boundary) {
  if (MUTATION_TOOLS.has(exec.name)) {
    const target = pathOf(exec.arguments)
    // An absolute target outside a KNOWN boundary belongs to another project.
    // With no boundary everything is in scope: over-gating is visible and
    // correctable, under-gating is silent.
    if (target !== undefined && target.startsWith('/') && boundary !== undefined) {
      if (!isInside(normalizePath(target), boundary)) return undefined
    }
    return { kind: exec.name, target }
  }
  if (exec.name === 'bash') {
    const command = commandOf(exec.arguments)
    const workdir = workdirOf(exec.arguments)
    const base = workdir === undefined
      ? boundary
      : workdir.startsWith('/') ? workdir : joinPath(boundary ?? '/', workdir)
    const kind = classifyBash(command, base, boundary)
    if (kind === undefined) return undefined
    // A redirect names its target; a commit or an install does not, and is
    // code-tier regardless.
    return { kind, target: redirectTarget(command) }
  }
  return undefined
}

/**
 * Resolve the ROOT session id for an agent, so a subagent inherits the parent's
 * read evidence instead of re-reading the doc set.
 *
 * @param agent - the calling agent.
 * @returns the root session id, or undefined when none can be read.
 */
export function rootSessionId(agent) {
  let current = agent
  for (let hop = 0; hop < 32 && current !== undefined; hop++) {
    if (current.parentAgent === undefined) return readSessionId(current)
    current = current.parentAgent
  }
  return readSessionId(agent)
}

/** Read `session.id` defensively; treat a missing id as "cannot gate". */
function readSessionId(agent) {
  const id = agent?.session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Read the session working directory defensively. */
export function cwdOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * Probe one absolute path.
 *
 * A permission or cancellation failure is rethrown so the caller can fail
 * closed; every other error is the path being absent, which is the answer this
 * probe exists to give.
 *
 * @param resolve - async absolute-path resolver (the host fs seam).
 * @param path - the absolute path to probe.
 * @param signal - cancellation signal.
 * @returns the stat result, or undefined when the path is not there.
 */
async function statOrUndefined(resolve, path, signal) {
  try {
    const target = await resolve(path)
    return await target.stat(signal)
  } catch (error) {
    if (isFailureError(error)) throw error
    return undefined
  }
}

/** Probe one absolute path for a regular file. */
async function fileExists(resolve, path, signal) {
  const info = await statOrUndefined(resolve, path, signal)
  return info !== undefined && info.type === 'file'
}

/**
 * Find the workspace root: the first ancestor of `cwd` holding a VCS marker.
 * Mirrors `instruction-hint.mjs` so both plugins agree on where a project
 * begins.
 *
 * A marker probe that fails outright still means "no marker here": the walk
 * continues upward and settles on `cwd`. The gate's job is to make the agent
 * read a few docs, not to certify the workspace's VCS identity, so a confusing
 * filesystem must not be able to block every mutation.
 *
 * @param resolve - async absolute-path resolver (the host fs seam).
 * @param cwd - the session working directory.
 * @param signal - cancellation signal.
 * @returns the root or the `cwd` fallback, whether a marker was actually found,
 *   and the first probe failure seen.
 */
export async function findWorkspaceRoot(resolve, cwd, signal) {
  let current = cwd
  let firstFailure
  for (;;) {
    for (const marker of ['.git', '.hg', '.svn']) {
      try {
        // Any kind of entry counts: a checkout has a `.git` DIRECTORY, while a
        // worktree or submodule uses a `.git` FILE.
        if (await statOrUndefined(resolve, joinPath(current, marker), signal) !== undefined) {
          return { root: current, found: true }
        }
      } catch (error) {
        firstFailure ??= error
      }
    }
    const parent = parentPath(current)
    if (parent === current || parent.length === 0) {
      // `found: false` is load-bearing. Falling back to `cwd` keeps the doc
      // probes working, but the boundary is unknown, so the gate must not use
      // the fallback to decide a target lies "outside the workspace" — doing
      // that let an edit anywhere above `cwd` escape the gate silently.
      return { root: cwd, found: false, failure: firstFailure }
    }
    current = parent
  }
}

/**
 * Resolve the doc set this session must read before mutating.
 *
 * The config docs live at canonical paths and need no workspace at all, so they
 * are probed independently: a workspace that cannot be identified costs the
 * project doc, never the behavioural rules. Only `.ai/project.md` depends on the
 * root, and it is skipped when the root is unknown.
 *
 * Each doc carries its `tier`, so the gate can require the core rules for a
 * prose change and the full set for a source change.
 *
 * @param options.resolve - async absolute-path resolver.
 * @param options.workspaceRoot - absolute workspace root, or undefined.
 * @param options.repoRoots - candidate config checkout roots, in probe order.
 * @param options.extraDocs - extra repo-relative paths, when configured.
 * @param options.signal - cancellation signal.
 * @returns `{ configDocs, projectDocs, repoRoot }`.
 */
export async function resolveRequiredDocs({ resolve, workspaceRoot, repoRoots, extraDocs = [], signal }) {
  return {
    ...await resolveWorkspaceDocs({ resolve, workspaceRoot, extraDocs, signal }),
    ...await resolveConfigDocs({ resolve, repoRoots, signal }),
  }
}

/**
 * Resolve the workspace-local docs: `.ai/project.md` and any configured extras.
 *
 * @param options.resolve - async absolute-path resolver.
 * @param options.workspaceRoot - absolute workspace root, or undefined.
 * @param options.extraDocs - extra repo-relative paths.
 * @param options.signal - cancellation signal.
 * @returns `{ projectDocs }`, empty when the root is unknown.
 */
async function resolveWorkspaceDocs({ resolve, workspaceRoot, extraDocs, signal }) {
  if (workspaceRoot === undefined) return { projectDocs: [] }
  const projectDocs = []
  const projectDoc = normalizePath(joinPath(workspaceRoot, PROJECT_DOC_REPO_PATH))
  if (await fileExists(resolve, projectDoc, signal)) {
    projectDocs.push({ id: 'project', path: projectDoc, display: `${normalizePath(workspaceRoot)}/.ai/project.md` })
  }
  for (const extra of extraDocs) {
    const path = normalizePath(joinPath(workspaceRoot, extra))
    if (await fileExists(resolve, path, signal)) projectDocs.push({ id: `extra:${extra}`, path, display: extra })
  }
  return { projectDocs }
}

/**
 * Resolve the shared behavioural docs from the first config checkout that has
 * them, preserving each doc's tier.
 *
 * @param options.resolve - async absolute-path resolver.
 * @param options.repoRoots - candidate checkout roots, in probe order.
 * @param options.signal - cancellation signal.
 * @returns `{ configDocs, repoRoot }`.
 */
async function resolveConfigDocs({ resolve, repoRoots, signal }) {
  for (const root of repoRoots) {
    const found = []
    for (const doc of REQUIRED_DOCS) {
      const path = normalizePath(joinPath(root, doc.repoPath))
      if (await fileExists(resolve, path, signal)) {
        found.push({
          id: doc.id,
          path,
          tier: doc.tier,
          language: doc.language,
          display: `~/.config/agent-config/${doc.repoPath}`,
        })
      }
    }
    if (found.length > 0) return { configDocs: found, repoRoot: normalizePath(root) }
  }
  return { configDocs: [], repoRoot: undefined }
}

/**
 * The denial for a mutation whose required docs are not satisfied.
 *
 * @param exec - the denied call.
 * @param kind - the mutation kind the classifier reported.
 * @param missing - the docs still unread for this call's tier.
 * @returns a `deny` decision carrying the actionable message.
 */
export function denyMutation(exec, kind, missing) {
  return {
    kind: 'deny',
    reason: [
      `${exec.name} is blocked once per session (${kind}): the behavioural rules for this workspace have not been read yet.`,
      '',
      'Read each of these with the `read` tool, then repeat the call. The gate lifts by itself as the reads land:',
      missing.map(doc => `  - ${doc.display}`).join('\n'),
      '',
      'Why this gate exists: the shared config is the single source of truth for coding standards and the git workflow, and a change made without it is a change made against it. An audit of the recorded sessions found only about a tenth had read any of these files, so a hint was not enough.',
      'Read them even if the task looks routine.',
    ].join('\n'),
  }
}

/**
 * The denial for a mutation when the config doc set is genuinely unreachable.
 *
 * Unknown is not the same as uninitialized, so this fails closed rather than
 * silently disabling the gate. It is reachable only when the config checkout
 * itself cannot be probed, because a workspace that cannot be identified no
 * longer blocks the config docs.
 *
 * @param exec - the denied call.
 * @param kind - the mutation kind the classifier reported.
 * @param detail - the rendered error chain, when one was captured.
 * @returns a `deny` decision.
 */
export function denyUnresolved(exec, kind, detail = '') {
  return {
    kind: 'deny',
    reason: [
      `${exec.name} is blocked: the shared config doc set could not be resolved (${kind}).`,
      ...(detail.length > 0 ? ['', `Underlying failure: ${detail}`] : []),
      '',
      'The gate could not read the shared config checkout. Fix the underlying read failure and retry, or read the docs directly:',
      REQUIRED_DOCS.map(doc => `  - ~/.config/agent-config/${doc.repoPath}`).join('\n'),
    ].join('\n'),
  }
}
