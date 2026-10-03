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
  CODE_TIER_PATHS,
  COMMIT_PATHS,
  CORE_DOC_PATHS,
  CORE_TIER_PATHS,
  CWD,
  HOME,
  MUTATIONS,
  REPO,
  WORKSPACE,
  fakeAgent,
  fakeResolve,
  mount,
  pathOfTarget,
  readDoc,
  resetFileContent,
  setFileContent,
} from './docs-gate.testkit.mjs'

test('isFailureError flags only permission and cancellation failures', () => {
  // The 2026-10-02 outage came from the INVERSE convention: an allow-list of
  // "absent" codes that missed the one the host throws. The default must be
  // "absent", because that is what a probe for a missing file answers.
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
  // The 2026-10-02 outage: every probe threw, so every mutation was denied.
  const throwing = {
    resolve: async (path) => ({ targetKey: path, displayPath: path }),
    stat: async () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }) },
  }
  const found = await findWorkspaceRoot(throwing, CWD, undefined)
  assert.equal(found.root, CWD, 'must fall back to cwd instead of throwing')
  assert.notEqual(found.failure, undefined, 'the probe failure is reported, not swallowed')
})

test('resolveRequiredDocs returns only docs that exist, plus the project doc', async () => {
  const resolved = await resolveRequiredDocs({
    seam: fakeResolve([`${REPO}/core/principles.md`, `${WORKSPACE}/.ai/project.md`]),
    workspaceRoot: WORKSPACE,
    repoRoots: [REPO],
    signal: undefined,
  })
  assert.deepEqual(resolved.configDocs.map(doc => doc.id), ['principles'])
  assert.deepEqual(resolved.projectDocs.map(doc => doc.id), ['project'])
  assert.equal(resolved.repoRoot, REPO)
})

test('the config doc set resolves even when the workspace root is unknown', async () => {
  // The shared rules need no workspace, so an unidentifiable one costs only the
  // project doc.
  const resolved = await resolveRequiredDocs({
    seam: fakeResolve([...CORE_DOC_PATHS, `${WORKSPACE}/.ai/project.md`]),
    workspaceRoot: undefined,
    repoRoots: [REPO],
    signal: undefined,
  })
  assert.equal(resolved.configDocs.length, REQUIRED_DOCS.length, 'every registry doc must still resolve')
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

test('a source change is denied until the whole doc set is read', async () => {
  const h = mount()
  const agent = fakeAgent('s-gate')

  for (const exec of MUTATIONS) {
    const decision = await h.pre({ ...exec, agent })
    assert.equal(decision.kind, 'deny', `${exec.name} must be denied while docs are unread`)
    assert.match(decision.reason, /blocked once per session/)
    // The commit is the one mutation that does NOT climb to the code tier: the
    // change it lands was gated when this session made it, and loading
    // complexity and maintainability to commit teaches nothing. Asserted both
    // ways so the separation cannot quietly collapse back.
    const isCommit = exec.name === 'bash' && String(exec.arguments.command).startsWith('git commit')
    if (isCommit) {
      assert.doesNotMatch(decision.reason, /core\/docs\/complexity\.md/, 'a commit must not demand the code tier')
      assert.match(decision.reason, /core\/docs\/git-workflow\.md/, 'but it must demand commit procedure')
    } else {
      assert.match(decision.reason, /core\/docs\/complexity\.md/)
    }
  }

  // A .ts file has no language guide and this is not a commit, so the ladder is
  // the whole requirement, and reading the docs one at a time lifts the gate
  // only at the end.
  const requiredForTs = [...CORE_TIER_PATHS, ...CODE_TIER_PATHS]
  for (const [index, path] of requiredForTs.entries()) {
    await readDoc(h, agent, path)
    const decision = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
    const last = index === requiredForTs.length - 1
    assert.equal(decision.kind, last ? 'allow' : 'deny', `after ${index + 1} read(s)`)
  }
})

test('the commit docs are gated at the commit, not before it', async () => {
  // A session that never commits has no use for commit and pull-request
  // procedure, so requiring it up front spends context on the subset that
  // reaches a commit. This is the whole reason `commits` is a trigger.
  const h = mount()
  const agent = fakeAgent('s-commit')
  const [commitDoc] = COMMIT_PATHS
  assert.notEqual(commitDoc, undefined, 'the registry must mark a commit-time doc')

  const notCommitting = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(notCommitting.kind, 'deny')
  assert.doesNotMatch(notCommitting.reason, /git-workflow\.md/, 'an edit must not demand commit procedure')

  const committing = await h.pre({ name: 'bash', arguments: { command: 'git commit -m "x"' }, agent })
  assert.equal(committing.kind, 'deny')
  assert.match(committing.reason, /git-workflow\.md/, 'the commit must demand it')

  // Reading commit procedure satisfies no other requirement.
  await readDoc(h, agent, commitDoc)
  const stillBlocked = await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent })
  assert.equal(stillBlocked.kind, 'deny', 'the commit doc satisfies only its own trigger')

  // Reading the ladder lifts the edit, and the commit too: its other docs are
  // the ladder ones, already read.
  for (const path of [...CORE_TIER_PATHS, ...CODE_TIER_PATHS]) await readDoc(h, agent, path)
  assert.deepEqual(
    await h.pre({ name: 'edit', arguments: { file_path: `${WORKSPACE}/a.ts` }, agent }),
    { kind: 'allow' },
  )
})

test('only the commit-class commands trip the commit trigger', async () => {
  const h = mount()
  const agent = fakeAgent('s-commit-cmd')
  const readOnly = [
    { command: 'git status --short' },
    { command: 'git diff HEAD' },
    { command: 'npm test' },
  ]
  for (const args of readOnly) {
    const decision = await h.pre({ name: 'bash', arguments: args, agent })
    assert.deepEqual(decision, { kind: 'allow' }, `${args.command} is read-only`)
  }
  // The pull request is part of the commit path this repo mandates, so it trips
  // the same trigger. A release does not: `git-workflow.md` governs tags, not
  // release procedure.
  for (const command of ['git commit -m "x"', 'git push origin main', 'gh pr create']) {
    const decision = await h.pre({ name: 'bash', arguments: { command }, agent })
    assert.equal(decision.kind, 'deny', `${command} must be gated`)
    assert.match(decision.reason, /git-workflow\.md/, `${command} must demand commit procedure`)
  }
  const release = await h.pre({ name: 'bash', arguments: { command: 'gh release create v1' }, agent })
  assert.equal(release.kind, 'deny', 'a release writes, so it is gated')
  assert.doesNotMatch(release.reason, /git-workflow\.md/, 'but it is not the commit act')
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
    get: (name) => (name === 'fs' ? { stat: () => { throw new Error('fs exploded') } } : undefined),
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
      resolve: async (path) => ({ targetKey: normalizePath(path), displayPath: path }),
      stat: async (targetOrPath) => {
        if (pathOfTarget(targetOrPath) === `${REPO}/core/principles.md`) {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        }
        return undefined
      },
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

