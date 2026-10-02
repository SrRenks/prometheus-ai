/**
 * docs-gate policy: the decisions behind the read-before-mutate gate, with no
 * cordis dependency.
 *
 * Split from `docs-gate.mjs` so the plugin half stays thin and both halves fit
 * the repo's file-length budget (core/docs/complexity.md). Everything here is
 * pure or takes the host filesystem seam as a parameter, which is also what
 * makes it directly testable.
 *
 * See `docs-gate.mjs` for why the gate exists and what it deliberately refuses
 * to gate.
 */

/**
 * The behavioural doc set, single-sourced from the shared config repo.
 *
 * `repoPath` is relative to the agent-config checkout root. This is the
 * load-bearing subset: the rules that change what a diff looks like. Language
 * guides, `coupling.md`, `testing.md` and the rest stay on-demand reading,
 * because gating them would tax every session for occasional value.
 */
export const REQUIRED_DOCS = [
  { id: 'principles', repoPath: 'core/principles.md' },
  { id: 'complexity', repoPath: 'core/docs/complexity.md' },
  { id: 'maintainability', repoPath: 'core/docs/maintainability.md' },
  { id: 'git-workflow', repoPath: 'core/docs/git-workflow.md' },
  { id: 'development-workflow', repoPath: 'core/docs/development-workflow.md' },
]

/** Project-local doc required when the workspace has one. */
const PROJECT_DOC_REPO_PATH = '.ai/project.md'

/** Tools that write to the workspace and therefore require the doc set. */
const MUTATION_TOOLS = new Set(['edit', 'write', 'multi_edit', 'apply_patch', 'notebook_edit'])

/**
 * `bash` effects that change tracked state. Each pattern either carries a
 * redirect/target path, checked against the workspace, or is a whole-command
 * mutation whose target IS the workspace: a commit, a package install, an
 * in-place edit.
 */
const BASH_WRITE_PATTERNS = [
  // A file redirection: `>`, `>>`, `1>`, `2>`, but never `>&` (an fd dup). The
  // optional leading digit keeps `2>/dev/null` matched, so its target is
  // workspace-checked instead of silently ignored.
  // A file redirection, and ONLY one whose target looks like a path: `>` in a
  // comparison or a heredoc (`depth > 6`, `<<'EOF'`) is not a redirect, and
  // treating it as one blocked ordinary diagnostic commands. A bare relative
  // filename with no separator and no dot is deliberately not gated, because a
  // false positive blocks real work while a false negative only misses a write
  // that `edit` or `write` would have caught anyway.
  { id: 'redirect', re: /[0-9]?>>?(?!&)\s*("[^"]+"|'[^']+'|(?=[^;|&\s]*[./])[^\s;|&)>]+)/g, targetGroup: 1 },
  { id: 'tee', re: /\btee\b(?:\s+-\w+)*\s*("[^"]+"|'[^']+'|[^\s;|&]+)/g, targetGroup: 1 },
  { id: 'in-place', re: /\b(?:sed|perl)\b[^\n;|&]*\s-i\b/g, targetGroup: -1 },
  { id: 'git-write', re: /\bgit\s+(?:add|commit|push|merge|rebase|reset|checkout|switch|restore|stash|clean|tag|cherry-pick|revert|am|apply|init|rm|mv|filter-branch|filter-repo)\b/g, targetGroup: -1 },
  { id: 'pkg-write', re: /\b(?:npm|pnpm|yarn|bun|cargo|pip|pip3|poetry|uv|go|gem|composer|apt|apt-get|dnf|pacman|brew)\s+(?:i|in|install|add|remove|rm|uninstall|upgrade|update|get|tidy)\b/g, targetGroup: -1 },
  { id: 'fs-write', re: /\b(?:rm|rmdir|mv|cp|mkdir|touch|truncate|chmod|chown|ln|dd|install)\b/g, targetGroup: -1 },
  { id: 'build-write', re: /\b(?:make|cmake|ninja|gradle|mvn)\b[^\n;|&]*\b(?:build|install|clean|package)\b/g, targetGroup: -1 },
]

/**
 * Error codes that mean the probe itself failed, as opposed to "this path is
 * not there".
 *
 * This list is deliberately the SHORT one, and it is a deny-list rather than an
 * allow-list. A gate that walks a directory tree asking "does `.git` exist"
 * gets "no" almost every time; treating an unrecognised code as a hard failure
 * turns the common answer into a lockout, which is exactly what happened in
 * production on 2026-10-02: `dsh-fs-local` reported absent paths with a code
 * outside the previous allow-list, every marker probe rethrew, the workspace
 * root never resolved, and every mutation was denied permanently.
 *
 * So: a known permission or cancellation failure is real, and anything else is
 * the path being absent. A backend that invents a new code degrades to the
 * old behaviour instead of deadlocking the session.
 */
const REAL_FAILURE_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'FS_ABORTED', 'ABORT_ERR'])

/** Recursively match an error's code chain against the real-failure codes. */
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
 * Collapse `.`/`..` segments and trailing slashes without touching the fs.
 *
 * @param path - any POSIX-ish path.
 * @returns the normalized absolute-style path.
 */
export function normalizePath(path) {
  const parts = []
  for (const segment of String(path).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else parts.push('..')
      continue
    }
    parts.push(segment)
  }
  return `/${parts.join('/')}`
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
 * Is `path` the root itself or underneath it?
 *
 * @param path - normalized absolute path.
 * @param root - normalized absolute workspace root, or undefined when unknown.
 * @returns true when the path is inside the root, or the root is unknown.
 */
export function isInside(path, root) {
  if (root === undefined) return true
  return path === root || path.startsWith(`${root}/`)
}

/**
 * Decide whether one `bash` command mutates the workspace.
 *
 * Conservative by construction. A pattern carrying a target path only counts
 * when that target resolves inside the workspace, so a redirection into `/tmp`
 * is not a mutation for this gate; patterns whose whole purpose is mutation, a
 * commit or a package install or `sed -i`, count regardless of path, because
 * the state they change is the workspace's.
 *
 * @param command - the raw command text.
 * @param base - directory relative targets resolve against (the call's
 *   `workdir`, else the workspace root).
 * @param workspaceRoot - absolute workspace root, or undefined when unknown.
 * @returns the matching pattern id, or undefined when the command is read-only.
 */
export function classifyBash(command, base, workspaceRoot) {
  if (typeof command !== 'string' || command.length === 0) return undefined
  const root = workspaceRoot === undefined ? undefined : normalizePath(workspaceRoot)
  for (const pattern of BASH_WRITE_PATTERNS) {
    pattern.re.lastIndex = 0
    let match
    while ((match = pattern.re.exec(command)) !== null) {
      if (pattern.targetGroup === -1) return pattern.id
      const raw = match[pattern.targetGroup]
      if (raw === undefined || raw.length === 0) return pattern.id
      const target = raw.replace(/^["']|["']$/g, '')
      if (target.length === 0 || root === undefined) return pattern.id
      const baseDir = base === undefined ? root : normalizePath(base)
      const absolute = target.startsWith('/') ? target : `${baseDir}/${target}`
      if (isInside(normalizePath(absolute), root)) return pattern.id
    }
  }
  return undefined
}

/**
 * Read the call's own fields, defensively: the model may omit any of them.
 *
 * @param args - the parsed tool arguments.
 * @returns the target path, the command text, or the `bash` workdir.
 */
export function pathOf(args) {
  if (args === null || typeof args !== 'object') return undefined
  const path = args.file_path ?? args.filePath ?? args.path
  return typeof path === 'string' && path.length > 0 ? path : undefined
}

export function commandOf(args) {
  if (args === null || typeof args !== 'object') return undefined
  return typeof args.command === 'string' ? args.command : undefined
}

export function workdirOf(args) {
  if (args === null || typeof args !== 'object') return undefined
  const workdir = args.workdir
  return typeof workdir === 'string' && workdir.length > 0 ? workdir : undefined
}

/**
 * Is this tool one that writes to the workspace?
 *
 * Exposed separately from {@link classifyCall} because the caller needs to know
 * whether resolution is worth paying for before the workspace root is known.
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
 * `boundary` is the workspace root ONLY when a VCS marker actually identified
 * it. A guessed root must be passed as `undefined`: otherwise an edit to a real
 * file one directory above the session `cwd` looks like an edit outside the
 * workspace and passes unguarded.
 *
 * @param exec - the pending tool call (`name`, `arguments`).
 * @param boundary - the identified workspace root, or undefined when unknown.
 * @returns the mutation kind, or undefined for a call the gate leaves open.
 */
export function classifyCall(exec, boundary) {
  if (MUTATION_TOOLS.has(exec.name)) {
    const target = pathOf(exec.arguments)
    // An absolute target outside a KNOWN boundary belongs to another project.
    // With no boundary, everything is in scope: over-gating is visible and
    // correctable, while under-gating is silent.
    if (target !== undefined && target.startsWith('/') && boundary !== undefined) {
      if (!isInside(normalizePath(target), boundary)) return undefined
    }
    return exec.name
  }
  if (exec.name === 'bash') {
    const workdir = workdirOf(exec.arguments)
    const base = workdir === undefined
      ? boundary
      : workdir.startsWith('/') ? workdir : joinPath(boundary ?? '/', workdir)
    return classifyBash(commandOf(exec.arguments), base, boundary)
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
 * Resolve one call path against the session cwd into a normalized absolute path.
 *
 * @param path - the path as the model wrote it.
 * @param base - the directory a relative path resolves against.
 * @returns the normalized absolute path.
 */
export function absolutePath(path, base) {
  return normalizePath(path.startsWith('/') ? path : joinPath(base, path))
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
 * begins; falls back to `cwd` when no marker exists.
 *
 * A marker probe that fails outright still means "no marker here": the walk
 * continues upward and, at worst, settles on `cwd`. The gate's job is to make
 * the agent read five docs, not to certify the workspace's VCS identity, so a
 * confusing filesystem must not be able to block every mutation.
 *
 * @param resolve - async absolute-path resolver (the host fs seam).
 * @param cwd - the session working directory.
 * @param signal - cancellation signal.
 * @returns the workspace root or the `cwd` fallback, whether a marker was
 *   actually found, and the first probe failure seen.
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
 * are probed first and independently: a workspace that cannot be identified
 * costs the project doc, never the five behavioural rules. Only `.ai/project.md`
 * depends on the root, and it is skipped when the root is unknown.
 *
 * @param options.resolve - async absolute-path resolver.
 * @param options.workspaceRoot - absolute workspace root, or undefined.
 * @param options.repoRoots - candidate config checkout roots, in probe order.
 * @param options.extraDocs - extra repo-relative paths, when configured.
 * @param options.signal - cancellation signal.
 * @returns the required docs that EXIST, plus the resolved repo root and any
 *   workspace-root probe failure.
 */
export async function resolveRequiredDocs({ resolve, workspaceRoot, repoRoots, extraDocs = [], signal }) {
  return {
    ...await resolveWorkspaceDocs({ resolve, workspaceRoot, extraDocs, signal }),
    ...await resolveConfigDocs({ resolve, repoRoots, signal }),
  }
}

/**
 * Resolve the workspace-local docs: the project's `.ai/project.md` and any
 * configured extras.
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
 * them.
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
        found.push({ id: doc.id, path, display: `~/.config/agent-config/${doc.repoPath}` })
      }
    }
    if (found.length > 0) return { configDocs: found, repoRoot: normalizePath(root) }
  }
  return { configDocs: [], repoRoot: undefined }
}

/**
 * The denial for a mutation whose doc set is not satisfied.
 *
 * @param exec - the denied call.
 * @param kind - the mutation kind the classifier reported.
 * @param missing - the docs still unread.
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
      'Why this gate exists: the shared config is the single source of truth for coding standards and the git workflow, and a change made without it is a change made against it. An audit of 96 recorded sessions found only 8% had read any of these files, so a hint was not enough.',
      'Read them even if the task looks routine. If a listed rule genuinely does not apply, read the file anyway and say in your reply which parts you deliberately did not follow.',
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