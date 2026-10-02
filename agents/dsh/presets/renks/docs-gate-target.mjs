/**
 * docs-gate targets: paths, commands, and the boundary that decides whether a
 * call is inside the workspace at all.
 *
 * All of this is pure text handling. It lives apart from the doc registry so
 * each module keeps one responsibility and both stay inside the repo's
 * file-length budget (core/docs/complexity.md).
 */

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
export function joinPath(dir, segment) {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + segment
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir + sep + segment
}

/** Parent of an absolute Windows or POSIX path. */
export function parentPath(path) {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (idx <= 0) return path
  const parent = path.slice(0, idx)
  return parent.length === 0 ? path : parent
}

/**
 * Is `path` the root itself or underneath it?
 *
 * @param path - normalized absolute path.
 * @param root - normalized root, or undefined when unknown.
 * @returns true when inside, or when the root is unknown.
 */
export function isInside(path, root) {
  if (root === undefined) return true
  return path === root || path.startsWith(`${root}/`)
}

/**
 * Resolve one call path against a base directory.
 *
 * @param path - the path as the model wrote it.
 * @param base - the directory a relative path resolves against.
 * @returns the normalized absolute path.
 */
export function absolutePath(path, base) {
  return normalizePath(path.startsWith('/') ? path : joinPath(base, path))
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
 * `bash` effects that change tracked state. A pattern either carries a
 * redirect/target path, workspace-checked, or is a whole-command mutation whose
 * target IS the workspace: a commit, an install, an in-place edit.
 */
const BASH_WRITE_PATTERNS = [
  // A file redirection, and ONLY one whose target looks like a path: `>` in a
  // comparison or a heredoc (`if (a > 6)`, `<<'EOF'`) is not a redirect, and
  // treating it as one blocked ordinary diagnostic commands. A bare relative
  // filename with no separator and no dot is deliberately not gated, because a
  // false positive blocks real work while a false negative only misses a write
  // that `edit` or `write` would have caught anyway.
  { id: 'redirect', re: /[0-9]?>>?(?!&)\s*("[^"]+"|'[^']+'|(?=[^;|&\s]*[./])[^\s;|&)>]+)/g, targetGroup: 1 },
  { id: 'tee', re: /\btee\b(?:\s+-\w+)*\s*("[^"]+"|'[^']+'|[^\s;|&]+)/g, targetGroup: 1 },
  { id: 'in-place', re: /\b(?:sed|perl)\b[^\n;|&]*\s-i\b/g, targetGroup: -1 },
  { id: 'git-write', re: /\bgit\s+(?:add|commit|push|merge|rebase|reset|checkout|switch|restore|stash|clean|tag|cherry-pick|revert|am|apply|init|rm|mv|filter-branch|filter-repo)\b/g, targetGroup: -1 },
  // Remote acts that the local `git` patterns miss. `gh pr create` opens the
  // pull request this repo's workflow mandates, so leaving it unclassified let
  // the entire commit path run unguarded. Only the mutating subcommands match:
  // `gh pr view` and `gh pr checks` stay read-only.
  { id: 'gh-write', re: /\bgh\s+(?:pr\s+(?:create|merge|close|reopen|edit|comment|review)|release\s+(?:create|edit|delete|upload)|issue\s+(?:create|close|reopen|edit|comment)|repo\s+(?:create|delete|fork|edit|rename|archive))\b/g, targetGroup: -1 },
  { id: 'lazygit', re: /(?:^|[;&|]\s*)lazygit\b/g, targetGroup: -1 },
  { id: 'pkg-write', re: /\b(?:npm|pnpm|yarn|bun|cargo|pip|pip3|poetry|uv|go|gem|composer|apt|apt-get|dnf|pacman|brew)\s+(?:i|in|install|add|remove|rm|uninstall|upgrade|update|get|tidy)\b/g, targetGroup: -1 },
  { id: 'fs-write', re: /\b(?:rm|rmdir|mv|cp|mkdir|touch|truncate|chmod|chown|ln|dd|install)\b/g, targetGroup: -1 },
  { id: 'build-write', re: /\b(?:make|cmake|ninja|gradle|mvn)\b[^\n;|&]*\b(?:build|install|clean|package)\b/g, targetGroup: -1 },
]

/** First file redirection in a command, used to attribute a target. */
const REDIRECT_TARGET_RE = /[0-9]?>>?(?!&)\s*("[^"]+"|'[^']+'|(?=[^;|&\s]*[./])[^\s;|&)>]+)/

/**
 * Decide whether one `bash` command mutates the workspace.
 *
 * A pattern carrying a target only counts when that target resolves inside the
 * workspace, so a redirection into `/tmp` is not a mutation; patterns whose
 * whole purpose is mutation (a commit, an install, `sed -i`) count regardless
 * of path, because the state they change is the workspace's.
 *
 * @param command - the raw command text.
 * @param base - directory relative targets resolve against.
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
 * The path a redirection writes to, when the command has one.
 *
 * Used only to pick a doc tier, never to decide whether the call is a mutation,
 * so a miss costs a stricter tier rather than an unguarded write.
 *
 * @param command - the raw command text.
 * @returns the target path, or undefined when the command names no file.
 */
export function redirectTarget(command) {
  if (typeof command !== 'string') return undefined
  const match = REDIRECT_TARGET_RE.exec(command)
  if (match === null) return undefined
  return match[1].replace(/^["']|["']$/g, '')
}
