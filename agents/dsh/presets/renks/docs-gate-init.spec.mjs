/**
 * docs-gate init check: a git workspace needs `.ai/project.md` before its first
 * change, and nothing else is forced.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyCall, mainCheckoutRoot, needsInit, optOutPaths, setsUpInit } from './docs-gate-policy.mjs'
import { CORE_DOC_PATHS, REPO, WORKSPACE, fakeAgent, fakeResolve, mount, readDoc, resetFileContent, setFileContent } from './docs-gate.testkit.mjs'

const BASE_FILES = [...CORE_DOC_PATHS, `${WORKSPACE}/.git/HEAD`]
const WRITE = { name: 'write', arguments: { file_path: `${WORKSPACE}/README.md` } }

test('needsInit: only an identified, uninitialized workspace that is not the config repo', () => {
  const project = [{ id: 'project' }]
  assert.ok(needsInit({ boundary: '/w', docs: [] }))
  assert.ok(!needsInit({ boundary: '/w', docs: project }))
  assert.ok(!needsInit({ boundary: undefined, docs: [] }), 'a folder with no VCS marker is not a project')
  assert.ok(!needsInit({ boundary: '/w', docs: [], configRoot: '/w' }), 'the shared config itself')
  assert.ok(!needsInit({ boundary: '/w', docs: [], optedOut: true }))
  assert.ok(!needsInit({ boundary: '/w', docs: [], required: false }))
})

test('setsUpInit: setup writes under .ai/ only, judged by every path they touch', () => {
  const W = '/w'
  const bash = (command, workdir = W) => classifyCall({ name: 'bash', arguments: { command, workdir } }, W)
  const ok = (command, workdir) => setsUpInit(bash(command, workdir), W)
  assert.ok(setsUpInit({ kind: 'write', target: '/w/.ai/project.md' }, W))
  assert.ok(!setsUpInit({ kind: 'write', target: '/w/.ai-notes.md' }, W))
  for (const command of ["mkdir -p .ai && cat > .ai/project.md <<'EOF'\nx\nEOF", 'touch .ai/project.md', "cd .ai && cat > project.md <<'EOF'\nx\nEOF"]) {
    assert.ok(ok(command), command)
  }
  // From a subdirectory, through cd or the call's workdir.
  assert.ok(ok('cd .. && mkdir -p .ai && echo x > .ai/project.md', '/w/sub'))
  assert.ok(ok('mkdir -p .ai && echo x > .ai/project.md', '/w'))
  // Fresh-context review, round two: each of these writes outside .ai/.
  for (const command of [
    'touch .ai/x src/a.py', 'tee .ai/x src/a.py </dev/null', 'mv .ai/x src/a.py', "sed -i s/a/b/ .ai/x src/a.py",
    'cp .ai/x src/a.py', 'cp .ai/x .ai/y > src/log.py', 'ln -sfn ../src .ai/s', 'rm -r .ai', 'git commit -m x',
    'cd src && echo x > .ai/a.py', 'echo x > "$D/.ai/a"',
  ]) {
    assert.ok(!ok(command), command)
  }
  assert.ok(!ok('echo x > .ai/a.py', '/w/src'))
})

test('a symlink under .ai/ cannot carry a setup write out of it', () => {
  const real = { '/w/.ai/s': '/w/src', '/w/.ai': '/w/.ai', '/w': '/w', '/w/src': '/w/src' }
  const realpath = path => real[path]
  const call = classifyCall({ name: 'bash', arguments: { command: 'echo x > .ai/s/a.py', workdir: '/w' } }, '/w')
  assert.ok(setsUpInit(call, '/w'), 'lexically inside')
  assert.ok(!setsUpInit(call, '/w', { realpath }), 'really in src/')
})

test('optOutPaths finds the marker in a worktree or a submodule', () => {
  assert.deepEqual(optOutPaths('/w'), ['/w/.git/info/ai-optout'])
  assert.deepEqual(optOutPaths('/wt', 'gitdir: /main/.git/worktrees/wt\n'), ['/main/.git/worktrees/wt/info/ai-optout', '/main/.git/info/ai-optout'])
  assert.equal(optOutPaths('/sup/mod', 'gitdir: ../.git/modules/mod')[0], '/sup/.git/modules/mod/info/ai-optout')
  assert.deepEqual(optOutPaths('/w', 'garbage'), [])
})

test('a change in an uninitialized git workspace is denied with the ai-init steps', async () => {
  const h = mount({ files: [...BASE_FILES], config: { requireInit: true } })
  const agent = fakeAgent('s-init')
  for (const path of CORE_DOC_PATHS) await readDoc(h, agent, path)
  const denied = await h.pre({ ...WRITE, agent })
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /has no \.ai\/project\.md/)
  assert.match(denied.reason, /ai-init/)
  assert.match(denied.reason, /If the user declines, stop/)
  // Reading, `ai-init` itself and writes under .ai/ stay open.
  assert.deepEqual(await h.pre({ name: 'read', arguments: { file_path: `${WORKSPACE}/src/a.ts` }, agent }), { kind: 'allow' })
  assert.deepEqual(await h.pre({ name: 'bash', arguments: { command: 'ai-init' }, agent }), { kind: 'allow' })
  assert.deepEqual(await h.pre({ name: 'write', arguments: { file_path: `${WORKSPACE}/.ai/project.md` }, agent }), { kind: 'allow' })
})

test('running ai-init mid-session lifts the check, and project.md joins the docs to read', async () => {
  const files = [...BASE_FILES]
  // A filesystem read live, as dsh's is, so a file created mid-session shows up.
  const live = { resolve: p => fakeResolve(files).resolve(p), stat: t => fakeResolve(files).stat(t), readText: t => fakeResolve(files).readText(t) }
  const h = mount({ resolveImpl: live, config: { requireInit: true } })
  const agent = fakeAgent('s-init-lift')
  for (const path of CORE_DOC_PATHS) await readDoc(h, agent, path)
  assert.equal((await h.pre({ ...WRITE, agent })).kind, 'deny')
  files.push(`${WORKSPACE}/.ai/project.md`)
  const next = await h.pre({ ...WRITE, agent })
  assert.equal(next.kind, 'deny')
  assert.match(next.reason, /\.ai\/project\.md/)
  assert.doesNotMatch(next.reason, /has no \.ai/)
  await readDoc(h, agent, `${WORKSPACE}/.ai/project.md`)
  assert.deepEqual(await h.pre({ ...WRITE, agent }), { kind: 'allow' })
})

test('the per-clone opt-out marker and the config repo itself are exempt', async () => {
  const optedOut = mount({ files: [...BASE_FILES, `${WORKSPACE}/.git/info/ai-optout`], config: { requireInit: true } })
  const agent = fakeAgent('s-optout')
  for (const path of CORE_DOC_PATHS) await readDoc(optedOut, agent, path)
  assert.deepEqual(await optedOut.pre({ ...WRITE, agent }), { kind: 'allow' })
  // A session working on the config checkout itself.
  const own = mount({ files: [...CORE_DOC_PATHS, `${REPO}/.git/HEAD`], config: { requireInit: true } })
  const inRepo = fakeAgent('s-config', `${REPO}/tools`)
  for (const path of CORE_DOC_PATHS) await readDoc(own, inRepo, path)
  assert.deepEqual(await own.pre({ name: 'write', arguments: { file_path: `${REPO}/README.md` }, agent: inRepo }), { kind: 'allow' })
})

test('mainCheckoutRoot: a linked worktree shares the main checkout, a submodule does not', () => {
  assert.equal(mainCheckoutRoot('/r/.worktrees/t', 'gitdir: /r/.git/worktrees/t\n'), '/r')
  assert.equal(mainCheckoutRoot('/elsewhere/t', 'gitdir: ../../r/.git/worktrees/t'), '/r')
  assert.equal(mainCheckoutRoot('/r/sub', 'gitdir: ../.git/modules/sub'), undefined)
  assert.equal(mainCheckoutRoot('/w/t', 'gitdir: /srv/bare.git/worktrees/t'), undefined, 'a bare repository has no checkout')
  assert.equal(mainCheckoutRoot('/r', undefined), undefined)
})

test('a linked worktree uses the main checkout\'s .ai/project.md', async (t) => {
  const main = '/home/u/Projects/app'
  const tree = `${main}/.worktrees/task`
  setFileContent(`${tree}/.git`, `gitdir: ${main}/.git/worktrees/task\n`)
  t.after(() => resetFileContent())
  const h = mount({ files: [...CORE_DOC_PATHS, `${tree}/.git`, `${main}/.ai/project.md`], config: { requireInit: true } })
  const agent = fakeAgent('s-worktree', tree)
  for (const path of CORE_DOC_PATHS) await readDoc(h, agent, path)
  const write = { name: 'write', arguments: { file_path: `${tree}/README.md` }, agent }
  const denied = await h.pre(write)
  assert.equal(denied.kind, 'deny', 'the shared project doc is read like any other')
  assert.match(denied.reason, new RegExp(`${main}/\\.ai/project\\.md`))
  assert.doesNotMatch(denied.reason, /has no \.ai/)
  await readDoc(h, agent, `${main}/.ai/project.md`)
  assert.deepEqual(await h.pre(write), { kind: 'allow' })
})
