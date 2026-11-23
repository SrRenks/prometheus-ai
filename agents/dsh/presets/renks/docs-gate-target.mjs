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
