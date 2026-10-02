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
  isFailureError,
  defaultRepoRoots,
  findWorkspaceRoot,
  isInside,
  normalizePath,
  resolveRequiredDocs,
  rootSessionId,
} from './docs-gate.mjs'
import {
  CORE_DOC_PATHS,
  CWD,
  HOME,
  MUTATIONS,
  REPO,
  WORKSPACE,
  fakeAgent,
  fakeResolve,
  mount,
  readDoc,
} from './docs-gate.testkit.mjs'

test('isFailureError flags only permission and cancellation failures', () => {
  // The production outage of 2026-10-02 came from the INVERSE convention: an
  // allow-list of "absent" codes that missed the one the host actually throws,
  // so every marker probe rethrew and no workspace ever resolved. The default
  // must be "absent", because that is what a probe for a missing file answers.
  assert.equal(isFailureError(Object.assign(new Error('x'), { code: 'EACCES' })), true)
  assert.equal(isFailureError(Object.assign(new Error('x'), {
    code: 'FS_ABORTED',
    cause: Object.assign(new Error('y'), { code: 'ENOENT' }),
  })), true)
  assert.equal(isFailureError(Object.assign(new Error('x'), { code: 'EROFS' })), true)
  // Everything else, including codes this build has never seen, is "absent".
  assert.equal(isFailureError(Object.assign(new Error('x'), { code: 'ENOENT' })), false)
  assert.equal(isFailureError(Object.assign(new Error('x'), { code: 'FS_NOT_FOUND' })), false)
  assert.equal(isFailureError(Object.assign(new Error('x'), { code: 'A_BACKEND_WE_NEVER_MET' })), false)
  assert.equal(isFailureError(new Error('plain')), false)
  assert.equal(isFailureError(undefined), false)
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
  const found = await findWorkspaceRoot(fakeResolve([`${WORKSPACE}/.git/HEAD`]), CWD, undefined)
  assert.equal(found.root, WORKSPACE)
  assert.equal(found.found, true, 'a marker identifies the boundary')
  assert.equal(found.failure, undefined)
})

test('findWorkspaceRoot falls back to cwd without a marker', async () => {
  const found = await findWorkspaceRoot(fakeResolve([]), CWD, undefined)
  assert.equal(found.root, CWD)
  assert.equal(found.found, false, 'a fallback is NOT a boundary')
})

test('an edit above the session cwd is still gated when no marker exists', async () => {
  // The silent-escape bug: the root fallback became a boundary, so an edit to a
  // real file above `cwd` looked like another project's and passed unguarded.
  // With no marker the boundary is unknown, so the gate keeps the call.
  const h = mount({ files: [...CORE_DOC_PATHS] })
  const agent = fakeAgent('s-nomarker')
  const above = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(above.kind, 'deny', 'a sibling of cwd must not escape the gate')
  assert.match(above.reason, /blocked once per session/)
})

test('an edit outside a KNOWN workspace boundary stays open', async () => {
  // With a real marker the boundary is trusted, so another checkout's file is
  // genuinely outside this gate's authority.
  const h = mount()
  const agent = fakeAgent('s-boundary')
  const outside = await h.pre({ name: 'edit', arguments: { file_path: '/elsewhere/a.ts' }, agent })
  assert.deepEqual(outside, { kind: 'allow' })
})

test('findWorkspaceRoot survives a resolver that fails on every marker', async () => {
  // The 2026-10-02 outage: every marker probe threw, the root never resolved,
  // and every mutation was denied. An unreadable workspace settles on cwd.
  const throwing = async () => ({
    stat: async () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }) },
  })
  const found = await findWorkspaceRoot(throwing, CWD, undefined)
  assert.equal(found.root, CWD, 'must fall back to cwd instead of throwing')
  assert.notEqual(found.failure, undefined, 'the probe failure is reported, not swallowed')
})

test('resolveRequiredDocs returns only docs that exist, plus the project doc', async () => {
  const resolved = await resolveRequiredDocs({
    resolve: fakeResolve([`${REPO}/core/principles.md`, `${WORKSPACE}/.ai/project.md`]),
    workspaceRoot: WORKSPACE,
    repoRoots: [REPO],
    signal: undefined,
  })
  assert.deepEqual(resolved.configDocs.map(doc => doc.id), ['principles'])
  assert.deepEqual(resolved.projectDocs.map(doc => doc.id), ['project'])
  assert.equal(resolved.repoRoot, REPO)
})

test('the config doc set resolves even when the workspace root is unknown', async () => {
  // The five shared rules need no workspace at all, so a workspace that cannot
  // be identified must cost the project doc and nothing else.
  const resolved = await resolveRequiredDocs({
    resolve: fakeResolve([...CORE_DOC_PATHS, `${WORKSPACE}/.ai/project.md`]),
    workspaceRoot: undefined,
    repoRoots: [REPO],
    signal: undefined,
  })
  assert.equal(resolved.configDocs.length, 5, 'all five shared docs must still resolve')
  assert.deepEqual(resolved.projectDocs, [], 'only the workspace-local doc is skipped')
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

test('a mutation outside a KNOWN workspace boundary is not gated', async () => {
  // With a real marker the boundary is trusted, so another checkout's file is
  // genuinely outside this gate's authority. Contrast the no-marker case above,
  // where the boundary is unknown and the gate keeps the call.
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

test('an unreadable filesystem does not disable the gate', async () => {
  // Before the 2026-10-02 fix this denied, because a broken workspace walk took
  // the doc set down with it. Config docs are probed at canonical paths, so a
  // workspace the gate cannot identify costs the project doc and nothing else.
  // Here even the filesystem seam is gone, so nothing resolves and the gate
  // reports "nothing to gate" rather than inventing a block.
  const broken = mount({ failResolve: true })
  const agent = fakeAgent('s-broken-fs')
  const first = await broken.pre({ name: 'read', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.deepEqual(first, { kind: 'allow' })
  const second = await broken.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.deepEqual(second, { kind: 'allow' }, 'a blind gate must not block work')
})

test('a config checkout that cannot be read fails closed', async () => {
  // Genuinely unknown, as opposed to "found nothing": the docs exist but the
  // probe is DENIED. A permission failure is the one answer the gate refuses to
  // read as "absent", so it blocks rather than silently disabling itself.
  const listeners = new Map()
  const ctx = {
    logger: { warn() {} },
    on(name, handler) {
      listeners.set(name, [...(listeners.get(name) ?? []), handler])
      return () => {}
    },
    get: () => ({
      resolve: async (path) => ({
        stat: async () => {
          if (normalizePath(path) === `${REPO}/core/principles.md`) {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
          }
          return undefined
        },
      }),
    }),
  }
  apply(ctx, { repoRoots: [REPO] })
  const agent = fakeAgent('s-eacces')
  let index = -1
  const exec = { name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent }
  const dispatch = async () => {
    index += 1
    const handlers = listeners.get('tools/pre-execute') ?? []
    if (index >= handlers.length) return { kind: 'allow' }
    return handlers[index](exec, dispatch)
  }
  const decision = await dispatch()
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /could not be resolved/)
  assert.match(decision.reason, /EACCES/, 'the denial must name the underlying failure')
})

test('a workspace with no docs to find opens the gate', async () => {
  // Resolution SUCCEEDED and found nothing: a scratch directory. A configuration
  // state, not a bypass, and it must not deadlock the session.
  const h = mount({ files: [], config: { repoRoots: [] } })
  const agent = fakeAgent('s-scratch')
  const first = await h.pre({ name: 'read', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.deepEqual(first, { kind: 'allow' })
  const second = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.deepEqual(second, { kind: 'allow' })
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
