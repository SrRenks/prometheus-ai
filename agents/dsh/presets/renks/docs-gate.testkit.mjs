/**
 * Test harness and fixtures for `docs-gate.spec.mjs`.
 *
 * Split out so the spec file stays inside the repo's file-length budget
 * (core/docs/complexity.md) and so the fixture definitions have one home: the
 * fake filesystem, the fake agent, and the waterfall driver are shared by every
 * case, and editing them in one place is what keeps the cases comparable.
 *
 * The harness deliberately drives the plugin through its real entry point
 * (`apply`) with a fake cordis context, rather than calling the policy
 * functions directly, so a wiring mistake cannot pass the suite.
 */
import { apply, normalizePath, REQUIRED_DOCS } from './docs-gate.mjs'

export const HOME = '/home/tester'
export const REPO = `${HOME}/.config/agent-config`
export const WORKSPACE = '/work/project'
export const CWD = `${WORKSPACE}/src/deep`

/**
 * Every doc in the registry, as absolute paths, in registry order.
 *
 * Derived from the registry on purpose: a hand-kept list here would leave the
 * fake filesystem without a file the gate expects, and the failure would read as
 * a gate bug instead of a fixture gap.
 */
export const ALL_DOC_PATHS = REQUIRED_DOCS.map(doc => `${REPO}/${doc.repoPath}`)

/** Kept as an alias: several cases read the whole set. */
export const CORE_DOC_PATHS = ALL_DOC_PATHS

/** The core-tier subset: what any change needs, prose included. */
export const CORE_TIER_PATHS = REQUIRED_DOCS
  .filter(doc => doc.tier === 'core')
  .map(doc => `${REPO}/${doc.repoPath}`)

/** The code-tier subset: what only a source change needs. */
export const CODE_TIER_PATHS = REQUIRED_DOCS
  .filter(doc => doc.tier === 'code')
  .map(doc => `${REPO}/${doc.repoPath}`)

/**
 * The commit-time subset: gated only when the call is the commit act. Also part
 * of the ladder, so they appear in the tier lists above as well.
 */
export const COMMIT_PATHS = REQUIRED_DOCS
  .filter(doc => doc.commits === true)
  .map(doc => `${REPO}/${doc.repoPath}`)

/** The language guides, by language name. */
export const LANGUAGE_PATHS = Object.fromEntries(
  REQUIRED_DOCS.filter(doc => doc.tier === 'language').map(doc => [doc.language, `${REPO}/${doc.repoPath}`]),
)

/**
 * Build the host `fs` seam over an in-memory map of existing files.
 *
 * Models real `stat` semantics closely enough for the gate: a configured path
 * exists as a file, and any ancestor of a configured path exists as a
 * directory. That is what makes `.git` report as a directory while
 * `.ai/project.md` reports as a file.
 *
 * An absent path THROWS with a code no allow-list would know, mirroring the
 * host backend. That is the shape that broke production, so the harness keeps
 * emitting it: a gate that only copes with the codes it expects is the bug.
 *
 * @param files - absolute paths treated as regular files.
 * @returns a resolver for the fake seam.
 */
export function fakeResolve(files) {
  const set = new Set(files.map(normalizePath))
  const isDir = (path) => [...set].some(file => file.startsWith(`${path}/`))
  const typeOf = (path) => {
    if (set.has(path)) return 'file'
    return isDir(path) ? 'directory' : undefined
  }
  // A faithful stand-in for the SERVICE, not for a target. The real surface is
  // two calls with an opaque token between them:
  //
  //     stat(path, signal) <- resolve(path) -> { targetKey, displayPath }
  //
  // `resolve` returns a target with NO methods, and `stat` is a method of the
  // service. Getting that backwards is what silently disabled the gate in
  // production on 2026-10-02: `target.stat()` threw a TypeError on every probe,
  // every probe then read as "absent", and the gate found no docs to enforce. A
  // fake that invented `target.stat()` certified the broken contract instead of
  // catching it, so this one models both halves and neither convenience.
  return {
    resolve: async (path) => ({ targetKey: normalizePath(path), displayPath: path }),
    stat: async (targetOrPath) => {
      const type = typeOf(pathOfTarget(targetOrPath))
      return type === undefined ? undefined : { type }
    },
  }
}

/**
 * The path a service `stat` call refers to.
 *
 * The real service contract is `stat(target, signal)` where `target` came from
 * `resolve(path)` — an opaque `{ targetKey, displayPath }`. Test stubs that
 * assumed `stat(path)` silently disagreed with the plugin and made a failing
 * probe look like an absent file. Accepting both keeps the stub honest without
 * forcing every case to build a target.
 *
 * @param targetOrPath - the value the service handed to `stat`.
 * @returns the normalized path.
 */
export function pathOfTarget(targetOrPath) {
  if (typeof targetOrPath === 'string') return normalizePath(targetOrPath)
  return normalizePath(targetOrPath?.targetKey ?? targetOrPath?.displayPath ?? '')
}

/**
 * Build an agent whose session reads as `sessionId` at `cwd`.
 *
 * @param sessionId - live session id.
 * @param cwd - session working directory.
 * @param parentAgent - parent for subagent scenarios.
 * @returns an agent-shaped object.
 */
export function fakeAgent(sessionId, cwd = CWD, parentAgent = undefined) {
  return { session: { id: sessionId, header: { cwd } }, parentAgent }
}

/**
 * Mount the plugin and expose its `pre-execute` waterfall.
 *
 * @param options.files - paths the fake fs reports as present.
 * @param options.config - plugin config overrides.
 * @param options.failResolve - make the fs seam throw on every resolve.
 * @param options.resolveImpl - replace the fs seam outright.
 * @param options.warns - collects logger warnings.
 * @returns `{ pre, warns, listeners }`.
 */
export function mount({
  files = [...CORE_DOC_PATHS, `${WORKSPACE}/.git/HEAD`],
  config = {},
  failResolve = false,
  resolveImpl = undefined,
  warns = [],
} = {}) {
  const listeners = new Map()
  const ctx = {
    logger: { warn: (message) => warns.push(message) },
    on(name, handler) {
      listeners.set(name, [...(listeners.get(name) ?? []), handler])
      return () => {}
    },
    get(name) {
      if (name !== 'fs') return undefined
      if (resolveImpl !== undefined) return resolveImpl
      if (failResolve) return { stat: () => { throw new Error('fs unavailable') } }
      return fakeResolve(files)
    },
  }
  apply(ctx, { repoRoots: [REPO], ...config })

  /** Run one waterfall: listeners outermost-first, then the built-in tail. */
  const call = async (name, exec, tail) => {
    const handlers = listeners.get(name) ?? []
    let index = -1
    const dispatch = async () => {
      index += 1
      if (index >= handlers.length) return await tail()
      return await handlers[index](exec, dispatch)
    }
    return dispatch()
  }
  return {
    pre: (exec) => call('tools/pre-execute', exec, async () => ({ kind: 'allow' })),
    warns,
    listeners,
  }
}

/** One `read` call: the gate credits it while allowing it. */
export async function readDoc(h, agent, path) {
  await h.pre({ name: 'read', arguments: { file_path: path }, agent })
}

/** The mutation under test, in every shape the gate must guard. */
export const MUTATIONS = [
  { name: 'edit', arguments: { file_path: `${WORKSPACE}/src/a.ts` } },
  { name: 'write', arguments: { file_path: `${WORKSPACE}/src/b.ts` } },
  { name: 'bash', arguments: { command: `echo hi > ${WORKSPACE}/out.txt`, description: 'write a file' } },
  { name: 'bash', arguments: { command: 'git commit -m "x"', description: 'commit' } },
  { name: 'bash', arguments: { command: 'npm install left-pad', description: 'install a dep' } },
]
