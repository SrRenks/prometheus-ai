/**
 * docs-gate init check: a git workspace is set up with the shared standard
 * before its first change.
 *
 * WHAT IT REQUIRES. Only that `.ai/project.md` exists, which is what `ai-init`
 * creates. It does not require the onboarding survey: the ETH Zurich study of
 * context files (arXiv:2602.11988) found that pushing agents into more
 * exploration raised cost by about a fifth without raising task success, and
 * Anthropic's guidance is that agents find layout and conventions on their own.
 * What the init step buys is a place for the facts the code cannot show, the
 * build and test commands and the local rules, which the gate then requires to
 * be read like any other doc.
 *
 * WHAT IT LEAVES OPEN. Reading and exploring; `ai-init` itself, which the bash
 * rules read as an unknown, read-only command; and a setup write: every path
 * it touches is known and under `.ai/`, and the command only creates or fills
 * files (`mkdir`, `touch`, `cp`, a redirect, `tee`, `sed -i`, the write tools).
 * `ln`, `mv` and `rm` are not setup: a link under `.ai/` can point anywhere.
 *
 * WHO IS EXEMPT. A directory with no VCS marker (a scratch folder), the shared
 * config checkout itself, a repository the user opted out with `info/ai-optout`
 * in its git directory (local to the clone, never committed; in a worktree or
 * a submodule `.git` is a file naming that directory), and every workspace
 * when the check is switched off.
 */
import { absolutePath, isInside, normalizePath } from './docs-gate-target.mjs'

/** The per-clone opt-out marker, relative to the git directory. */
export const OPT_OUT_MARKER = 'info/ai-optout'

/** Commands whose writes can set `.ai/` up. */
const SETUP_OPS = new Set(['mkdir', 'touch', 'cp', 'install', 'redirect', 'tee', 'sed'])

/** The file `ai-init` creates and the check looks for. */
export const INIT_DOC = '.ai/project.md'

/**
 * Must this workspace be initialized before the call may run?
 *
 * @param options.boundary - the workspace root a VCS marker identified, or undefined.
 * @param options.docs - the resolved doc set; it holds `project` once initialized.
 * @param options.configRoot - the shared config checkout, exempt from the check.
 * @param options.optedOut - whether the opt-out marker exists.
 * @param options.required - false when the check is switched off.
 * @returns true when the workspace still needs `ai-init`.
 */
export function needsInit({ boundary, docs, configRoot = undefined, optedOut = false, required = true }) {
  if (!required || boundary === undefined || optedOut) return false
  if (configRoot !== undefined && normalizePath(configRoot) === normalizePath(boundary)) return false
  return !docs.some(doc => doc.id === 'project')
}

/**
 * Where the opt-out marker may live for this workspace.
 *
 * @param boundary - the workspace root.
 * @param dotGit - the text of `<boundary>/.git` when it is a FILE (a worktree or
 *   a submodule), or undefined when `.git` is a directory.
 * @returns candidate absolute paths: the git directory's, and for a worktree the
 *   shared one, where `git rev-parse --git-path info/...` points.
 */
export function optOutPaths(boundary, dotGit = undefined) {
  const root = normalizePath(boundary)
  if (dotGit === undefined) return [`${root}/.git/${OPT_OUT_MARKER}`]
  const match = /^gitdir:\s*(.+)$/m.exec(dotGit)
  if (match === null) return []
  const gitDir = absolutePath(match[1].trim(), root)
  return [`${gitDir}/${OPT_OUT_MARKER}`, `${normalizePath(`${gitDir}/../..`)}/${OPT_OUT_MARKER}`]
}

/**
 * The main checkout of a linked worktree, whose `.ai/` the worktree shares.
 *
 * `.ai/` is never committed, so a new worktree has none of its own. Its `.git`
 * file names `<common>/worktrees/<name>`; the main checkout is the parent of a
 * `<common>` called `.git`. A submodule's gitdir has no `worktrees` segment and
 * a bare repository's common dir is not `.git`: both have no main checkout.
 *
 * @param boundary - the workspace root.
 * @param dotGit - the text of `<boundary>/.git` when it is a file, or undefined.
 * @returns the main checkout's absolute root, or undefined.
 */
export function mainCheckoutRoot(boundary, dotGit) {
  const match = dotGit === undefined ? null : /^gitdir:\s*(.+)$/m.exec(dotGit)
  if (match === null) return undefined
  const gitDir = absolutePath(match[1].trim(), normalizePath(boundary))
  if (!/\/worktrees\/[^/]+$/.test(gitDir)) return undefined
  const common = normalizePath(`${gitDir}/../..`)
  return common.endsWith('/.git') ? normalizePath(`${common}/..`) : undefined
}

/** The real path of `path`: its nearest existing ancestor resolved, plus the rest. */
function realOf(path, realpath) {
  let current = path
  let rest = ''
  while (current !== '/' && current.length > 0) {
    const real = realpath(current)
    if (real !== undefined) return normalizePath(`${real}${rest}`)
    rest = `/${current.split('/').pop()}${rest}`
    current = normalizePath(`${current}/..`)
  }
  return path
}

/**
 * Does this call only set `.ai/` up?
 *
 * @param call - `{ kind, target, hits? }` from `classifyCall`; bash calls carry
 *   `hits` with every resolved path they write.
 * @param boundary - the workspace root.
 * @param options.realpath - resolves an existing path, or returns undefined; when
 *   given, a path is judged by where it really lands, so a symlink under `.ai/`
 *   cannot carry a write out of it.
 * @returns true when every write is a setup write under `<boundary>/.ai`.
 */
export function setsUpInit(call, boundary, { realpath = undefined } = {}) {
  const dir = `${normalizePath(boundary)}/.ai`
  const inside = path => isInside(path, dir) && (realpath === undefined || isInside(realOf(path, realpath), realOf(dir, realpath)))
  if (!Array.isArray(call.hits)) {
    return typeof call.target === 'string' && call.target.length > 0 && inside(absolutePath(call.target, boundary))
  }
  return call.hits.length > 0 && call.hits.every(hit => SETUP_OPS.has(hit.op)
    && Array.isArray(hit.paths) && hit.paths.length > 0
    && hit.paths.every(path => typeof path === 'string' && inside(path)))
}

/** The exit an uninitialized-workspace denial names, in place of the read advice. */
export const INIT_EXIT = 'If the user declines, stop and tell them. They can opt this clone out themselves with `touch "$(git rev-parse --git-path info/ai-optout)"`; do not create it, and do not make the change another way.'

/**
 * The body of the denial for a workspace that has not been initialized.
 *
 * @param toolName - the denied tool, as the harness names it.
 * @param kind - the mutation kind.
 * @param boundary - the workspace root.
 * @returns the reason lines, without the closing advice.
 */
export function uninitializedLines(toolName, kind, boundary) {
  return [
    `${toolName} is blocked by docs-gate (${kind}): ${boundary} has no ${INIT_DOC}, so this project is not set up with the shared standard yet.`,
    '',
    'Before the first change:',
    '  1. Classify it (AGENTS.md section 1): NEW if empty or scaffold-only, EXISTING if it has source, build files or history.',
    '  2. Ask the user to approve `ai-init`, then run it in the project root. Reading and exploring stay open meanwhile.',
    '  3. Write into .ai/project.md only what the code cannot show: build, test and lint commands, and local rules the user confirms. Files under .ai/ can be written now.',
  ]
}
