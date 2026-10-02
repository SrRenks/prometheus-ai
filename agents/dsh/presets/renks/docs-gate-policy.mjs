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
 * load-bearing subset — the rules that change what a diff looks like. Language
 * guides, `coupling.md`, `testing.md` and the rest stay on-demand reading:
 * gating them would tax every session for occasional value.
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
 * Is this tool one that writes to the workspace?
 *
 * Exposed separately from {@link classifyCall} because the caller needs to know
 * whether resolution is worth paying for BEFORE the workspace root is known.
 *
 * @param toolName - the tool's registered name.
 * @returns true when the tool mutates the workspace.
 */
export function isMutationTool(toolName) {
  return MUTATION_TOOLS.has(toolName)
}

/**
 * `bash` effects that change tracked state. Each pattern either carries a
 * redirect/target path (checked against the workspace) or is a whole-command
 * mutation whose target IS the workspace (a commit, a package install, an
 * in-place edit).
 */
const BASH_WRITE_PATTERNS = [
  // A file redirection: `>` / `>>` / `1>` / `2>`, but never `>&` (an fd dup).
  // The optional leading digit keeps `2>/dev/null` matched (and therefore
  // workspace-checked) instead of silently ignored.
  { id: 'redirect', re: /[0-9]?>>?(?!&)\s*("[^"]+"|'[^']+'|[^\s;|&)>]+)/g, targetGroup: 1 },
  { id: 'tee', re: /\btee\b(?:\s+-\w+)*\s*("[^"]+"|'[^']+'|[^\s;|&]+)/g, targetGroup: 1 },
  { id: 'in-place', re: /\b(?:sed|perl)\b[^\n;|&]*\s-i\b/g, targetGroup: -1 },
  { id: 'git-write', re: /\bgit\s+(?:add|commit|push|merge|rebase|reset|checkout|switch|restore|stash|clean|tag|cherry-pick|revert|am|apply|init|rm|mv|filter-branch|filter-repo)\b/g, targetGroup: -1 },
  { id: 'pkg-write', re: /\b(?:npm|pnpm|yarn|bun|cargo|pip|pip3|poetry|uv|go|gem|composer|apt|apt-get|dnf|pacman|brew)\s+(?:i|in|install|add|remove|rm|uninstall|upgrade|update|get|tidy)\b/g, targetGroup: -1 },
  { id: 'fs-write', re: /\b(?:rm|rmdir|mv|cp|mkdir|touch|truncate|chmod|chown|ln|dd|install)\b/g, targetGroup: -1 },
  { id: 'build-write', re: /\b(?:make|cmake|ninja|gradle|mvn)\b[^\n;|&]*\b(?:build|install|clean|package)\b/g, targetGroup: -1 },
]

/**
 * Error codes that mean "this path is not there", as opposed to "the probe
 * itself failed". `dsh-fs-local` wraps ENOENT/ENOTDIR in an `FsError` while
 * keeping the original as `cause`, and a sandboxed or remote backend may use a
 * code of its own, so the whole cause chain is inspected.
 */
const ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR', 'FS_NOT_FOUND'])

/**
 * Does this error mean the path is absent?
 *
 * The distinction is load-bearing: "absent" is a normal answer that keeps a
 * probe walking, while any other failure must reach the caller so the gate can
 * fail closed instead of reading a broken probe as an uninitialized workspace.
 *
 * @param error - the thrown value.
 * @param depth - recursion guard for a cyclic `cause` chain.
 * @returns true only when the path is genuinely missing.
 */
export function isAbsentError(error, depth = 0) {
  if (error === null || typeof error !== 'object' || depth > 8) return false
  if (typeof error.code === 'string' && ABSENT_CODES.has(error.code)) return true
  return isAbsentError(error.cause, depth + 1)
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
 * @returns true when the path is inside the root (or the root is unknown).
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
 * is not a mutation for this gate; patterns whose whole purpose is mutation
 * (a commit, a package install, `sed -i`) count regardless of path, because the
 * state they change is the workspace's.
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

/** Read one target path out of a path-taking tool call. */
export function pathOf(args) {
  if (args === null || typeof args !== 'object') return undefined
  const path = args.file_path ?? args.filePath ?? args.path
  return typeof path === 'string' && path.length > 0 ? path : undefined
}

/** Read the command text out of a `bash` call. */
export function commandOf(args) {
  if (args === null || typeof args !== 'object') return undefined
  return typeof args.command === 'string' ? args.command : undefined
}

/** Read the `workdir` of a `bash` call, when the model set one. */
export function workdirOf(args) {
  if (args === null || typeof args !== 'object') return undefined
  const workdir = args.workdir
  return typeof workdir === 'string' && workdir.length > 0 ? workdir : undefined
}

/**
 * Is this call a workspace mutation the gate should guard?
 *
 * @param exec - the pending tool call (`name`, `arguments`).
 * @param workspaceRoot - normalized absolute workspace root, or undefined.
 * @returns the mutation kind, or undefined for a call the gate leaves open.
 */
export function classifyCall(exec, workspaceRoot) {
  if (MUTATION_TOOLS.has(exec.name)) {
    const target = pathOf(exec.arguments)
    if (target !== undefined && target.startsWith('/') && workspaceRoot !== undefined) {
      if (!isInside(normalizePath(target), workspaceRoot)) return undefined
    }
    return exec.name
  }
  if (exec.name === 'bash') {
    const workdir = workdirOf(exec.arguments)
    const base = workdir === undefined
      ? workspaceRoot
      : workdir.startsWith('/') ? workdir : joinPath(workspaceRoot ?? '/', workdir)
    return classifyBash(commandOf(exec.arguments), base, workspaceRoot)
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

/** Probe one absolute path for a regular file. */
async function fileExists(resolve, path, signal) {
  try {
    const target = await resolve(path)
    const info = await target.stat(signal)
    return info !== undefined && info.type === 'file'
  } catch (error) {
    if (isAbsentError(error)) return false
    throw error
  }
}

/** Probe one absolute path of any kind (file or directory). */
async function pathExists(resolve, path, signal) {
  try {
    const target = await resolve(path)
    return await target.stat(signal) !== undefined
  } catch (error) {
    if (isAbsentError(error)) return false
    throw error
  }
}

/**
 * Find the workspace root: the first ancestor of `cwd` holding a VCS marker.
 * Mirrors `instruction-hint.mjs` so both plugins agree on where a project
 * begins; falls back to `cwd` when no marker exists.
 *
 * A probe FAILURE propagates (see `isAbsentError`) so the caller treats an
 * unreadable workspace as unknown rather than as rootless.
 *
 * @param resolve - async absolute-path resolver (the host fs seam).
 * @param cwd - the session working directory.
 * @param signal - cancellation signal.
 * @returns the absolute workspace root.
 */
export async function findWorkspaceRoot(resolve, cwd, signal) {
  let current = cwd
  for (;;) {
    for (const marker of ['.git', '.hg', '.svn']) {
      // `pathExists`, not `fileExists`: a normal checkout has a `.git`
      // DIRECTORY, while a worktree or submodule uses a `.git` FILE.
      if (await pathExists(resolve, joinPath(current, marker), signal)) return current
    }
    const parent = parentPath(current)
    if (parent === current || parent.length === 0) return cwd
    current = parent
  }
}

/**
 * Resolve the doc set this session must read before mutating.
 *
 * @param options.resolve - async absolute-path resolver.
 * @param options.workspaceRoot - absolute workspace root.
 * @param options.repoRoots - candidate config checkout roots, in probe order.
 * @param options.extraDocs - extra repo-relative paths, when configured.
 * @param options.signal - cancellation signal.
 * @returns the required docs that EXIST, plus the resolved repo root when found.
 */
export async function resolveRequiredDocs({ resolve, workspaceRoot, repoRoots, extraDocs = [], signal }) {
  const docs = []
  let repoRoot
  for (const root of repoRoots) {
    const found = []
    for (const doc of REQUIRED_DOCS) {
      const path = normalizePath(joinPath(root, doc.repoPath))
      if (await fileExists(resolve, path, signal)) {
        found.push({ id: doc.id, path, display: `~/.config/agent-config/${doc.repoPath}` })
      }
    }
    if (found.length > 0) {
      docs.push(...found)
      repoRoot = normalizePath(root)
      break
    }
  }
  const projectDoc = normalizePath(joinPath(workspaceRoot, PROJECT_DOC_REPO_PATH))
  if (await fileExists(resolve, projectDoc, signal)) {
    docs.push({ id: 'project', path: projectDoc, display: `${normalizePath(workspaceRoot)}/.ai/project.md` })
  }
  for (const extra of extraDocs) {
    const path = normalizePath(joinPath(repoRoot ?? workspaceRoot, extra))
    if (await fileExists(resolve, path, signal)) docs.push({ id: `extra:${extra}`, path, display: extra })
  }
  return { docs, repoRoot }
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
 * The denial for a mutation in a workspace whose doc set could not be resolved.
 * Unknown is not the same as uninitialized: fail CLOSED, so a broken probe
 * cannot become the bypass.
 *
 * @param exec - the denied call.
 * @param kind - the mutation kind the classifier reported.
 * @returns a `deny` decision.
 */
export function denyUnresolved(exec, kind) {
  return {
    kind: 'deny',
    reason: [
      `${exec.name} is blocked: the workspace doc set could not be resolved (${kind}).`,
      '',
      'The gate could not read the workspace root or the shared config checkout. Fix the underlying read failure and retry, or read the docs directly:',
      REQUIRED_DOCS.map(doc => `  - ~/.config/agent-config/${doc.repoPath}`).join('\n'),
    ].join('\n'),
  }
}
