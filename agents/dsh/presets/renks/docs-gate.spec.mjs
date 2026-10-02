/**
 * Behavioural tests for `docs-gate.mjs`.
 *
 * They drive the plugin through a fake cordis context: the plugin is handed a
 * context exposing `on` (so the test can capture its listeners and call them in
 * the same waterfall shape `dsh-tools` uses) and `get` (the host `fs` seam,
 * stubbed over an in-memory file map). That is enough to pin the contract that
 * matters — what gets denied, what stays open, and when the gate lifts — without
 * booting a harness or spending a model call.
 *
 * Run: node --test agents/dsh/presets/renks/docs-gate.spec.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  REQUIRED_DOCS,
  apply,
  classifyBash,
  isAbsentError,
  defaultRepoRoots,
  findWorkspaceRoot,
  isInside,
  normalizePath,
  resolveRequiredDocs,
  rootSessionId,
} from './docs-gate.mjs'

const HOME = '/home/tester'
const REPO = `${HOME}/.config/agent-config`
const WORKSPACE = '/work/project'
const CWD = `${WORKSPACE}/src/deep`

/** Every doc in the required set, as absolute paths. */
const CORE_DOC_PATHS = [
  `${REPO}/core/principles.md`,
  `${REPO}/core/docs/complexity.md`,
  `${REPO}/core/docs/maintainability.md`,
  `${REPO}/core/docs/git-workflow.md`,
  `${REPO}/core/docs/development-workflow.md`,
]

/**
 * Build the host `fs` seam over an in-memory map of existing files.
 *
 * Models real `stat` semantics closely enough for the gate: a configured path
 * exists as a file, and any ancestor of a configured path exists as a
 * directory. That is what makes `.git` report as a directory while
 * `.ai/project.md` reports as a file.
 *
 * @param files - absolute paths treated as regular files.
 */
function fakeResolve(files) {
  const set = new Set(files.map(normalizePath))
  const isDir = (path) => [...set].some(file => file.startsWith(`${path}/`))
  return async (path) => {
    const normalized = normalizePath(path)
    return {
      // Mirrors `dsh-fs-local`: an absent path THROWS (an `FsError` wrapping
      // ENOENT), which is what forces the gate to tell "missing" apart from
      // "the probe itself failed".
      stat: async () => {
        if (set.has(normalized)) return { type: 'file' }
        if (isDir(normalized)) return { type: 'directory' }
        throw Object.assign(new Error(`ENOENT: ${normalized}`), {
          code: 'FS_NOT_FOUND',
          cause: Object.assign(new Error('enoent'), { code: 'ENOENT' }),
        })
      },
    }
  }
}

/**
 * Build an agent whose session reads as `sessionId` at `cwd`.
 * @param sessionId - live session id.
 * @param cwd - session working directory.
 * @param parentAgent - parent for subagent scenarios.
 */
function fakeAgent(sessionId, cwd = CWD, parentAgent = undefined) {
  return { session: { id: sessionId, header: { cwd } }, parentAgent }
}

/**
 * Mount the plugin and expose its captured listeners.
 *
 * `results` maps an event name to the extra argument the waterfall passes
 * alongside `exec` (the dispatch result for `tools/post-execute`, nothing for
 * `tools/pre-execute`), so each listener is invoked with a real `next`.
 *
 * @param options.files - paths the fake fs reports as present.
 * @param options.config - plugin config overrides.
 * @param options.failResolve - make the fs seam throw, simulating a read failure.
 */
function mount({ files = [...CORE_DOC_PATHS, `${WORKSPACE}/.git/HEAD`], config = {}, failResolve = false } = {}) {
  const listeners = new Map()
  const ctx = {
    logger: { warn() {} },
    on(name, handler) {
      const list = listeners.get(name) ?? []
      list.push(handler)
      listeners.set(name, list)
      return () => {}
    },
    get(name) {
      if (name !== 'fs') return undefined
      if (failResolve) return { resolve: () => { throw new Error('fs unavailable') } }
      return {
        resolve: (path, { cwd }) => fakeResolve(files)(path.startsWith('/') ? path : `${cwd}/${path}`),
      }
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
  }
}

/** One `read` call: the gate credits it while allowing it. */
async function readDoc(h, agent, path) {
  await h.pre({ name: 'read', arguments: { file_path: path }, agent })
}

/** The mutation under test, in every shape the gate must guard. */
const MUTATIONS = [
  { name: 'edit', arguments: { file_path: `${WORKSPACE}/src/a.ts` } },
  { name: 'write', arguments: { file_path: `${WORKSPACE}/src/b.ts` } },
  { name: 'bash', arguments: { command: `echo hi > ${WORKSPACE}/out.txt`, description: 'write a file' } },
  { name: 'bash', arguments: { command: 'git commit -m "x"', description: 'commit' } },
  { name: 'bash', arguments: { command: 'npm install left-pad', description: 'install a dep' } },
]

test('isAbsentError recognises a wrapped missing-path error only', () => {
  assert.equal(isAbsentError(Object.assign(new Error('x'), { code: 'ENOENT' })), true)
  assert.equal(isAbsentError(Object.assign(new Error('x'), {
    code: 'FS_NOT_FOUND',
    cause: Object.assign(new Error('y'), { code: 'ENOENT' }),
  })), true)
  assert.equal(isAbsentError(Object.assign(new Error('x'), { code: 'EACCES' })), false)
  assert.equal(isAbsentError(new Error('plain')), false)
  assert.equal(isAbsentError(undefined), false)
})

test('normalizePath collapses relative segments', () => {
  assert.equal(normalizePath('/a/b/../c/./d/'), '/a/c/d')
  assert.equal(normalizePath('//a//b'), '/a/b')
})

test('isInside treats the root itself and descendants as inside', () => {
  assert.equal(isInside('/a/b', '/a'), true)
  assert.equal(isInside('/a', '/a'), true)
  assert.equal(isInside('/ab', '/a'), false)
  assert.equal(isInside('/a/b', undefined), true)
})

test('defaultRepoRoots prefers AGENT_CONFIG then the home config dir', () => {
  assert.deepEqual(defaultRepoRoots({ HOME: HOME }, HOME), [`${HOME}/.config/agent-config`, `${HOME}/agent-config`])
  assert.deepEqual(
    defaultRepoRoots({ HOME: HOME, AGENT_CONFIG: '/opt/cfg' }, HOME),
    ['/opt/cfg', `${HOME}/.config/agent-config`, `${HOME}/agent-config`],
  )
})

test('findWorkspaceRoot walks up to the VCS marker', async () => {
  const root = await findWorkspaceRoot(fakeResolve([`${WORKSPACE}/.git/HEAD`]), CWD, undefined)
  assert.equal(root, WORKSPACE)
})

test('findWorkspaceRoot falls back to cwd without a marker', async () => {
  const root = await findWorkspaceRoot(fakeResolve([]), CWD, undefined)
  assert.equal(root, CWD)
})

test('resolveRequiredDocs returns only docs that exist, plus the project doc', async () => {
  const resolved = await resolveRequiredDocs({
    resolve: fakeResolve([`${REPO}/core/principles.md`, `${WORKSPACE}/.ai/project.md`]),
    workspaceRoot: WORKSPACE,
    repoRoots: [REPO],
    signal: undefined,
  })
  assert.deepEqual(resolved.docs.map(doc => doc.id), ['principles', 'project'])
  assert.equal(resolved.repoRoot, REPO)
})

test('rootSessionId resolves through the parent chain to the root session', () => {
  const root = fakeAgent('root-1')
  const child = fakeAgent('child-1', CWD, root)
  const grandchild = fakeAgent('grand-1', CWD, child)
  assert.equal(rootSessionId(root), 'root-1')
  assert.equal(rootSessionId(grandchild), 'root-1')
  assert.equal(rootSessionId({ session: {} }), undefined)
})

test('classifyBash separates workspace writes from read-only commands', () => {
  assert.equal(classifyBash('git status --short', WORKSPACE, WORKSPACE), undefined)
  assert.equal(classifyBash('git diff HEAD', WORKSPACE, WORKSPACE), undefined)
  assert.equal(classifyBash('npm test', WORKSPACE, WORKSPACE), undefined)
  assert.equal(classifyBash('npx tsc --noEmit', WORKSPACE, WORKSPACE), undefined)
  assert.equal(classifyBash('ls -la src', WORKSPACE, WORKSPACE), undefined)
  assert.equal(classifyBash(`cat ${WORKSPACE}/a.txt 2>/dev/null`, WORKSPACE, WORKSPACE), undefined)
  assert.equal(classifyBash('echo x > /tmp/scratch.log', WORKSPACE, WORKSPACE), undefined)

  assert.equal(classifyBash(`echo x > ${WORKSPACE}/out.txt`, WORKSPACE, WORKSPACE), 'redirect')
  assert.equal(classifyBash('echo x > out.txt', WORKSPACE, WORKSPACE), 'redirect')
  assert.equal(classifyBash('git commit -m "x"', WORKSPACE, WORKSPACE), 'git-write')
  assert.equal(classifyBash('npm install left-pad', WORKSPACE, WORKSPACE), 'pkg-write')
  assert.equal(classifyBash('sed -i s/a/b/ src/a.ts', WORKSPACE, WORKSPACE), 'in-place')
  assert.equal(classifyBash('rm -rf build', WORKSPACE, WORKSPACE), 'fs-write')
})

test('an uninitialized workspace is never gated', async () => {
  const h = mount({ files: [`${WORKSPACE}/.git/HEAD`] })
  const agent = fakeAgent('s-none')
  for (const exec of MUTATIONS) {
    assert.deepEqual(await h.pre({ ...exec, agent }), { kind: 'allow' }, `${exec.name} must stay open`)
  }
})

test('a read-only session is never gated, even with docs present', async () => {
  const h = mount()
  const agent = fakeAgent('s-readonly')
  const reads = [
    { name: 'read', arguments: { file_path: `${WORKSPACE}/src/a.ts` } },
    { name: 'grep', arguments: { pattern: 'foo', path: WORKSPACE } },
    { name: 'glob', arguments: { pattern: '**/*.ts' } },
    { name: 'bash', arguments: { command: 'git status --short' } },
    { name: 'bash', arguments: { command: 'npm test' } },
    { name: 'todo_write', arguments: { todos: [] } },
    { name: 'subagent', arguments: { prompt: 'survey the repo' } },
  ]
  for (const exec of reads) {
    assert.deepEqual(await h.pre({ ...exec, agent }), { kind: 'allow' }, `${exec.name} must stay open`)
  }
})

test('every mutation is denied until the whole doc set is read', async () => {
  const h = mount()
  const agent = fakeAgent('s-gate')

  for (const exec of MUTATIONS) {
    const decision = await h.pre({ ...exec, agent })
    assert.equal(decision.kind, 'deny', `${exec.name} must be denied while docs are unread`)
    assert.match(decision.reason, /blocked once per session/)
    assert.match(decision.reason, /core\/docs\/complexity\.md/)
    assert.match(decision.reason, /core\/docs\/git-workflow\.md/)
  }

  // Reading the docs one at a time lifts the gate only at the end.
  for (const [index, path] of CORE_DOC_PATHS.entries()) {
    await readDoc(h, agent, path)
    const decision = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
    const last = index === CORE_DOC_PATHS.length - 1
    assert.equal(decision.kind, last ? 'allow' : 'deny', `after ${index + 1} read(s)`)
  }
})

test('the project doc joins the required set when the workspace has one', async () => {
  const h = mount({ files: [...CORE_DOC_PATHS, `${WORKSPACE}/.git/HEAD`, `${WORKSPACE}/.ai/project.md`] })
  const agent = fakeAgent('s-project')
  for (const path of CORE_DOC_PATHS) await readDoc(h, agent, path)

  const stillBlocked = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(stillBlocked.kind, 'deny')
  assert.match(stillBlocked.reason, /\.ai\/project\.md/)

  await readDoc(h, agent, `${WORKSPACE}/.ai/project.md`)
  assert.deepEqual(
    await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent }),
    { kind: 'allow' },
  )
})

test('naming a doc without reading it does not satisfy the gate', async () => {
  const h = mount()
  const agent = fakeAgent('s-grep')
  await h.pre({ name: 'grep', arguments: { pattern: 'complexity', path: `${REPO}/core/docs` }, agent })
  assert.equal((await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })).kind, 'deny')
})

test('a read is credited when allowed, before its result exists', async () => {
  // Deliberate: the credit lands in pre-execute, so a doc read in the same turn
  // as the mutation it enables cannot lose the race against async resolution.
  const h = mount()
  const agent = fakeAgent('s-credit')
  await h.pre({ name: 'read', arguments: { file_path: CORE_DOC_PATHS[0] }, agent })
  const decision = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(decision.kind, 'deny')
  assert.doesNotMatch(decision.reason, /core\/principles\.md/, 'the read doc must be credited')
  assert.match(decision.reason, /core\/docs\/complexity\.md/, 'the unread docs must remain')
})

test('a subagent inherits the root session credit instead of re-reading', async () => {
  const h = mount()
  const root = fakeAgent('s-root')
  for (const path of CORE_DOC_PATHS) await readDoc(h, root, path)
  const child = fakeAgent('s-child', CWD, root)
  assert.deepEqual(
    await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent: child }),
    { kind: 'allow' },
  )
})

test('a mutation outside the workspace is not gated', async () => {
  const h = mount()
  const agent = fakeAgent('s-outside')
  assert.deepEqual(
    await h.pre({ name: 'edit', arguments: { file_path: '/elsewhere/a.ts' }, agent }),
    { kind: 'allow' },
  )
  assert.deepEqual(
    await h.pre({ name: 'bash', arguments: { command: 'echo x > /tmp/out.txt' }, agent }),
    { kind: 'allow' },
  )
})

test('bash resolves relative targets against the call workdir', async () => {
  const h = mount()
  const agent = fakeAgent('s-workdir')
  const outside = await h.pre({ name: 'bash', arguments: { command: 'echo x > out.txt', workdir: '/tmp' }, agent })
  assert.deepEqual(outside, { kind: 'allow' }, 'a redirection under /tmp is outside the workspace')
  const inside = await h.pre({ name: 'bash', arguments: { command: 'echo x > out.txt', workdir: 'src' }, agent })
  assert.equal(inside.kind, 'deny')
})

test('a cached doc set is reused across calls in one session', async () => {
  let stats = 0
  const files = new Set([...CORE_DOC_PATHS, `${WORKSPACE}/.git/HEAD`])
  const listeners = new Map()
  apply({
    logger: { warn() {} },
    on: (name, handler) => {
      listeners.set(name, [...(listeners.get(name) ?? []), handler])
      return () => {}
    },
    get: () => ({
      resolve: async (path) => ({
        stat: async () => {
          stats += 1
          return files.has(normalizePath(path)) ? { type: 'file' } : undefined
        },
      }),
    }),
  }, { repoRoots: [REPO] })

  const agent = fakeAgent('s-cache')
  const run = async (exec) => {
    let index = -1
    const dispatch = async () => {
      index += 1
      const handlers = listeners.get('tools/pre-execute') ?? []
      if (index >= handlers.length) return { kind: 'allow' }
      return handlers[index](exec, dispatch)
    }
    return dispatch()
  }

  await run({ name: 'read', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  const afterWarm = stats
  await run({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  await run({ name: 'edit', arguments: { file_path: `${WORKSPACE}/b.ts` }, agent })
  assert.equal(stats, afterWarm, 'later calls must not re-walk the filesystem')
})

test('a read-only call stays open even when the fs seam is broken', async () => {
  const listeners = new Map()
  apply({
    logger: { warn() {} },
    on: (name, handler) => {
      listeners.set(name, [...(listeners.get(name) ?? []), handler])
      return () => {}
    },
    get: (name) => (name === 'fs' ? { resolve: () => { throw new Error('fs exploded') } } : undefined),
  }, { repoRoots: [REPO] })

  const agent = fakeAgent('s-broken')
  let index = -1
  const exec = { name: 'todo_write', arguments: { todos: [] }, agent }
  const dispatch = async () => {
    index += 1
    const handlers = listeners.get('tools/pre-execute') ?? []
    if (index >= handlers.length) return { kind: 'allow' }
    return handlers[index](exec, dispatch)
  }
  assert.deepEqual(await dispatch(), { kind: 'allow' })
})

test('a mutation fails closed when the workspace cannot be resolved', async () => {
  const h = mount({ files: [] })
  const agent = fakeAgent('s-unknown')
  // Uninitialized (resolution succeeded, nothing found) stays open…
  assert.deepEqual(
    await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent }),
    { kind: 'allow' },
  )

  // …while an unresolvable workspace does not.
  const broken = mount({ failResolve: true })
  const decision = await broken.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /could not be resolved/)
})

test('the enforced doc set and the hinted doc set cannot drift apart', async () => {
  // `instruction-hint` tells the model which files to read; the gate decides
  // which reads lift the block. If those two lists diverge, the agent is either
  // blocked for a file it was never told about, or told to read a file that
  // does not matter. Pin them together.
  const { REQUIRED_DOCS: HINTED } = await import('./instruction-hint.mjs')
  assert.deepEqual(
    HINTED,
    REQUIRED_DOCS.map(doc => doc.repoPath),
    'instruction-hint.REQUIRED_DOCS must equal docs-gate REQUIRED_DOCS repoPaths, in order',
  )
})
