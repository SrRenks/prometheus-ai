/**
 * End-to-end tests for the Claude Code port of docs-gate.
 *
 * Each case spawns the real hook with the JSON Claude Code sends, against a
 * throwaway config checkout and workspace, so the suite exercises the same
 * process boundary, state files and filesystem the live hook uses. The tier
 * rules themselves are covered by the dsh spec; these cases pin the adapter:
 * tool-name mapping, the file-backed ledger, the credit paths, and the reset
 * after compaction.
 *
 * Run: node --test tools/claude-docs-gate.spec.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(ROOT, 'agents/claude-code/hooks/docs-gate.mjs')

const DOCS = {
  principles: 'core/principles.md',
  'git-workflow': 'core/docs/git-workflow.md',
  'ai-writing': 'core/docs/ai-writing.md',
  'development-workflow': 'core/docs/development-workflow.md',
  complexity: 'core/docs/complexity.md',
  maintainability: 'core/docs/maintainability.md',
  'lang-python': 'core/docs/languages/python.md',
}
const CODE_TIER = ['principles', 'development-workflow', 'complexity', 'maintainability']

const scratch = []
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** A fresh config checkout, workspace, home and state dir for one case. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'claude-gate-'))
  scratch.push(base)
  const cfg = join(base, 'cfg')
  for (const [id, path] of Object.entries(DOCS)) {
    mkdirSync(dirname(join(cfg, path)), { recursive: true })
    writeFileSync(join(cfg, path), `# ${id}\n\nRules for ${id}.\n`)
  }
  const ws = join(base, 'ws')
  mkdirSync(join(ws, '.git'), { recursive: true })
  mkdirSync(join(ws, '.ai'), { recursive: true })
  writeFileSync(join(ws, '.ai/project.md'), '# project\n')
  const bare = join(base, 'bare')
  mkdirSync(bare)
  const env = {
    PATH: process.env.PATH,
    HOME: join(base, 'home'),
    AGENT_CONFIG: cfg,
    DOCS_GATE_STATE_DIR: join(base, 'state'),
  }
  return { base, cfg, ws, bare, env, doc: id => join(cfg, DOCS[id]) }
}

/** Run the hook once with one payload. */
function hook(fx, payload, extraEnv = {}) {
  const run = spawnSync('node', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify({ session_id: 's1', cwd: fx.ws, ...payload }),
    encoding: 'utf8',
    env: { ...fx.env, ...extraEnv },
  })
  let json
  try {
    json = run.stdout.trim().length > 0 ? JSON.parse(run.stdout) : undefined
  } catch {
    json = undefined
  }
  return { code: run.status, stdout: run.stdout, stderr: run.stderr, json }
}

const pre = (tool_name, tool_input, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input, ...extra })
const read = (fx, path, extra = {}) => hook(fx, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path }, tool_response: {}, ...extra })
const denied = r => r.json?.hookSpecificOutput?.permissionDecision === 'deny'
const reason = r => r.json?.hookSpecificOutput?.permissionDecisionReason ?? ''
const readAll = (fx, ids, extra = {}) => {
  for (const id of ids) read(fx, fx.doc(id), extra)
  read(fx, join(fx.ws, '.ai/project.md'), extra)
}

describe('denial and tiers', () => {
  let fx
  beforeEach(() => { fx = fixture() })

  test('a source write is denied until the code tier, its language guide and project.md are read', () => {
    const r = hook(fx, pre('Write', { file_path: join(fx.ws, 'src/a.py') }))
    assert.equal(r.code, 0)
    assert.ok(denied(r), r.stdout)
    for (const id of [...CODE_TIER, 'lang-python']) assert.ok(reason(r).includes(fx.doc(id)), `${id} missing from: ${reason(r)}`)
    assert.ok(reason(r).includes(join(fx.ws, '.ai/project.md')))
    assert.ok(!reason(r).includes('git-workflow'), 'commit docs must not be required for a write')
  })

  test('the denial names absolute paths the Read tool accepts', () => {
    const r = hook(fx, pre('Edit', { file_path: join(fx.ws, 'a.go') }))
    for (const line of reason(r).split('\n').filter(l => l.startsWith('  - '))) {
      assert.ok(line.slice(4).startsWith('/'), line)
    }
  })

  test('a prose write needs only the core tier', () => {
    const r = hook(fx, pre('Write', { file_path: join(fx.ws, 'README.md') }))
    assert.ok(denied(r))
    assert.ok(reason(r).includes(fx.doc('principles')))
    assert.ok(!reason(r).includes('complexity'), reason(r))
  })

  test('reading the required docs lifts the gate', () => {
    readAll(fx, [...CODE_TIER, 'lang-python'])
    const r = hook(fx, pre('Write', { file_path: join(fx.ws, 'src/a.py') }))
    assert.ok(!denied(r), r.stdout)
    assert.equal(r.code, 0)
  })

  test('a read of part of a doc is not a credit, and both the read and the denial say so', () => {
    // The fixture docs are three lines long, so a one-line limit is a slice.
    const slices = CODE_TIER.map(id => read(fx, fx.doc(id), { tool_input: { file_path: fx.doc(id), offset: 1, limit: 1 } }))
    for (const r of slices) assert.match(r.json?.hookSpecificOutput?.additionalContext ?? '', /covered part of it/)
    read(fx, join(fx.ws, '.ai/project.md'))
    const r = hook(fx, pre('Edit', { file_path: join(fx.ws, 'x.ts') }))
    assert.ok(denied(r))
    assert.match(reason(r), /read in part earlier/)
    // A whole read lifts it, and a limit past the end counts as whole.
    for (const id of CODE_TIER) read(fx, fx.doc(id), { tool_input: { file_path: fx.doc(id), limit: 2000 } })
    const lifted = hook(fx, pre('Edit', { file_path: join(fx.ws, 'x.ts') }))
    assert.ok(!denied(lifted), reason(lifted))
  })

  test('every denial names the stop exit, and the third identical one says to stop retrying', () => {
    const call = pre('Write', { file_path: join(fx.ws, 'README.md') })
    const first = hook(fx, call)
    assert.match(reason(first), /tell the user what failed and stop/)
    assert.doesNotMatch(reason(first), /denied \d+ times/)
    hook(fx, call)
    assert.match(reason(hook(fx, call)), /This exact call has been denied 3 times/)
    assert.doesNotMatch(reason(hook(fx, pre('Write', { file_path: join(fx.ws, 'OTHER.md') }))), /denied \d+ times/)
  })

  test('an unwritable state directory still denies: the counter is best effort', { skip: process.getuid?.() === 0 }, () => {
    const locked = join(fx.base, 'locked')
    mkdirSync(locked)
    spawnSync('chmod', ['555', locked])
    try {
      const r = hook(fx, pre('Bash', { command: 'touch x.py' }), { DOCS_GATE_STATE_DIR: join(locked, 'state') })
      assert.ok(denied(r), r.stdout)
    } finally {
      spawnSync('chmod', ['755', locked])
    }
  })

  test('token mode also requires AGENTS.md, which it no longer injects', () => {
    writeFileSync(join(fx.cfg, 'AGENTS.md'), '# AGENTS\n')
    const claudeDir = join(fx.base, 'claude')
    mkdirSync(claudeDir)
    writeFileSync(join(fx.base, 'CLAUDE.token.md'), 'pointer\n')
    symlinkSync(join(fx.base, 'CLAUDE.token.md'), join(claudeDir, 'CLAUDE.md'))
    const token = { CLAUDE_CONFIG_DIR: claudeDir }
    const write = pre('Write', { file_path: join(fx.ws, 'README.md') })
    assert.ok(reason(hook(fx, write, token)).includes(join(fx.cfg, 'AGENTS.md')))
    assert.ok(!reason(hook(fx, write)).includes('AGENTS.md'), 'subscription mode injects it, so it is not gated')
    readAll(fx, ['principles'], {})
    assert.ok(denied(hook(fx, write, token)))
    hook(fx, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: join(fx.cfg, 'AGENTS.md') }, tool_response: {} }, token)
    assert.ok(!denied(hook(fx, write, token)))
  })

  test('a doc edited after the read loses its credit', () => {
    readAll(fx, CODE_TIER)
    writeFileSync(fx.doc('complexity'), '# complexity\n\nNew budget.\n')
    const r = hook(fx, pre('Edit', { file_path: join(fx.ws, 'x.ts') }))
    assert.ok(denied(r))
    assert.ok(reason(r).includes(fx.doc('complexity')))
    assert.ok(!reason(r).includes(fx.doc('principles')), 'unchanged docs keep their credit')
  })

  test('reading an unrelated file credits nothing', () => {
    read(fx, join(fx.ws, 'notes.md'))
    assert.ok(denied(hook(fx, pre('Write', { file_path: join(fx.ws, 'README.md') }))))
  })

  test('NotebookEdit is gated at the code tier through notebook_path', () => {
    const r = hook(fx, pre('NotebookEdit', { notebook_path: join(fx.ws, 'n.ipynb') }))
    assert.ok(denied(r))
    assert.ok(reason(r).includes(fx.doc('complexity')))
  })

  test('a target outside the identified workspace is not gated', () => {
    assert.ok(!denied(hook(fx, pre('Write', { file_path: join(fx.base, 'elsewhere/x.py') }))))
  })

  test('tools the gate does not cover pass', () => {
    assert.ok(!denied(hook(fx, pre('Grep', { pattern: 'x' }))))
  })
})

describe('bash', () => {
  let fx
  beforeEach(() => { fx = fixture() })
  const bash = command => pre('Bash', { command })

  test('read-only commands pass without any read', () => {
    for (const command of ['ls -la', 'git status --short', 'grep -rn foo .', 'cat README.md']) {
      assert.ok(!denied(hook(fx, bash(command))), command)
    }
  })

  test('a redirect into the workspace is a code-tier mutation', () => {
    const r = hook(fx, bash(`echo x > ${join(fx.ws, 'out.txt')}`))
    assert.ok(denied(r))
    assert.ok(reason(r).includes(fx.doc('complexity')))
  })

  test('a redirect outside the workspace passes', () => {
    assert.ok(!denied(hook(fx, bash(`echo x > ${join(fx.base, 'out.txt')}`))))
  })

  test('discarding output to /dev/null is not a mutation, even with no workspace boundary', () => {
    const r = hook(fx, { ...bash('ls missing 2>/dev/null; echo ok >/dev/stderr'), cwd: fx.bare })
    assert.ok(!denied(r), reason(r))
  })

  test('a commit needs the commit docs and the core tier, not the code tier', () => {
    const r = hook(fx, bash('git commit -m "docs: x"'))
    assert.ok(denied(r))
    for (const id of ['principles', 'git-workflow', 'ai-writing']) assert.ok(reason(r).includes(fx.doc(id)), id)
    assert.ok(!reason(r).includes(fx.doc('complexity')), reason(r))
  })

  test('cat of a whole doc credits it, because its content reached the transcript', () => {
    const content = readFileSync(fx.doc('principles'), 'utf8')
    hook(fx, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: `cat ${fx.doc('principles')}` }, tool_response: { stdout: content.trimEnd(), stderr: '' } })
    read(fx, join(fx.ws, '.ai/project.md'))
    assert.ok(!denied(hook(fx, pre('Write', { file_path: join(fx.ws, 'README.md') }))))
  })

  test('output that holds only part of a doc credits nothing', () => {
    hook(fx, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: `head -1 ${fx.doc('principles')}` }, tool_response: { stdout: '# principles', stderr: '' } })
    read(fx, join(fx.ws, '.ai/project.md'))
    assert.ok(denied(hook(fx, pre('Write', { file_path: join(fx.ws, 'README.md') }))))
  })
})

describe('session state', () => {
  let fx
  beforeEach(() => { fx = fixture() })
  const target = () => pre('Write', { file_path: join(fx.ws, 'README.md') })

  test('a subagent in the same session inherits the credit', () => {
    readAll(fx, ['principles'])
    assert.ok(!denied(hook(fx, { ...target(), agent_id: 'sub-1', agent_type: 'Explore' })))
  })

  test('another session does not', () => {
    readAll(fx, ['principles'])
    assert.ok(denied(hook(fx, { ...target(), session_id: 's2' })))
  })

  test('compaction clears the credit, because the docs left the context', () => {
    readAll(fx, ['principles'])
    hook(fx, { hook_event_name: 'SessionStart', source: 'compact' })
    assert.ok(denied(hook(fx, target())))
  })

  test('a resume keeps the credit', () => {
    readAll(fx, ['principles'])
    hook(fx, { hook_event_name: 'SessionStart', source: 'resume' })
    assert.ok(!denied(hook(fx, target())))
  })

  test('a hostile session id cannot escape the state directory', () => {
    for (const session_id of ['../../escape', '..']) read(fx, fx.doc('principles'), { session_id })
    const state = fx.env.DOCS_GATE_STATE_DIR
    assert.deepEqual(readdirSync(state).sort(), ['__', '______escape'])
    assert.ok(!existsSync(join(fx.base, 'escape')))
    assert.ok(!existsSync(join(dirname(fx.base), 'escape')))
  })

  test('/clear also resets, in case it ever keeps the session id', () => {
    readAll(fx, ['principles'])
    hook(fx, { hook_event_name: 'SessionStart', source: 'clear' })
    assert.ok(denied(hook(fx, target())))
  })

  test('compaction wins over the credit store: a compacted session reads again', () => {
    const store = join(fx.base, 'credit.json')
    const withStore = { DOCS_GATE_CREDIT_STORE: store }
    for (const file_path of [fx.doc('principles'), join(fx.ws, '.ai/project.md')]) {
      hook(fx, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path }, tool_response: {} }, withStore)
    }
    hook(fx, { hook_event_name: 'SessionStart', source: 'compact' }, withStore)
    assert.ok(denied(hook(fx, target(), withStore)))
    // And reading again after compaction lifts it, as without the store.
    for (const file_path of [fx.doc('principles'), join(fx.ws, '.ai/project.md')]) {
      hook(fx, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path }, tool_response: {} }, withStore)
    }
    assert.ok(!denied(hook(fx, target(), withStore)))
  })

  test('parallel reads all reach the credit store', async () => {
    // Claude Code runs the hooks of a batched Read concurrently. A load-modify-
    // write store without a lock kept 6 of 7 docs in 7 of 10 trials.
    const store = join(fx.base, 'credit.json')
    const ids = Object.keys(DOCS)
    for (let trial = 0; trial < 3; trial++) {
      rmSync(store, { force: true })
      await Promise.all(ids.map(id => hookAsync(fx, {
        hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: fx.doc(id) }, tool_response: {}, session_id: `p${trial}`,
      }, { DOCS_GATE_CREDIT_STORE: store })))
      const held = Object.keys(JSON.parse(readFileSync(store, 'utf8')).docs).sort()
      assert.deepEqual(held, [...ids].sort(), `trial ${trial}`)
    }
  })

  test('the optional credit store reuses a read across sessions, and says so', () => {
    const store = join(fx.base, 'credit.json')
    readWithStore(fx, store, [fx.doc('principles'), join(fx.ws, '.ai/project.md')])
    const r = hook(fx, { ...target(), session_id: 'new' }, { DOCS_GATE_CREDIT_STORE: store })
    assert.ok(!denied(r), reason(r))
    assert.ok((r.json?.systemMessage ?? '').includes('credit store'), r.stdout)
  })

  test('without the store switched on, a new session reads again', () => {
    readAll(fx, ['principles'], { session_id: 'old' })
    assert.ok(denied(hook(fx, { ...target(), session_id: 'new' })))
  })

  test('a store entry for content that changed since is not reused', () => {
    const store = join(fx.base, 'credit.json')
    readWithStore(fx, store, [fx.doc('principles'), join(fx.ws, '.ai/project.md')])
    writeFileSync(fx.doc('principles'), '# principles\n\nRewritten.\n')
    assert.ok(denied(hook(fx, { ...target(), session_id: 'new' }, { DOCS_GATE_CREDIT_STORE: store })))
  })
})

describe('failure posture', () => {
  let fx
  beforeEach(() => { fx = fixture() })

  test('DOCS_GATE_DISABLED=1 opens the gate', () => {
    assert.ok(!denied(hook(fx, pre('Write', { file_path: join(fx.ws, 'a.py') }), { DOCS_GATE_DISABLED: '1' })))
  })

  test('malformed input fails open and says so to the user', () => {
    const r = hook(fx, 'not json')
    assert.equal(r.code, 0)
    assert.ok(!denied(r))
    assert.ok((r.json?.systemMessage ?? '').includes('docs-gate'), r.stdout)
  })

  test('with no config checkout, only the project doc is required, as in dsh', () => {
    const none = { AGENT_CONFIG: join(fx.base, 'none') }
    const r = hook(fx, pre('Write', { file_path: join(fx.ws, 'a.py') }), none)
    assert.ok(denied(r))
    assert.deepEqual(reason(r).split('\n').filter(l => l.startsWith('  - ')), [`  - ${join(fx.ws, '.ai/project.md')}`])
  })

  test('with no config checkout and no project doc, there is no gate', () => {
    const r = hook(fx, { ...pre('Write', { file_path: join(fx.bare, 'a.py') }), cwd: fx.bare }, { AGENT_CONFIG: join(fx.base, 'none') })
    assert.ok(!denied(r), reason(r))
  })

  test('an unreadable config checkout fails closed and names the failure', { skip: process.getuid?.() === 0 }, () => {
    spawnSync('chmod', ['000', join(fx.cfg, 'core')])
    try {
      const r = hook(fx, pre('Write', { file_path: join(fx.ws, 'a.py') }))
      assert.ok(denied(r))
      assert.match(reason(r), /could not be resolved/)
      assert.match(reason(r), /EACCES/)
      // Closed for mutations only. Denying `ls` too would leave no way to look
      // at, or fix, the permissions from inside the session.
      for (const command of ['ls -la', `stat ${fx.cfg}/core`]) {
        assert.ok(!denied(hook(fx, pre('Bash', { command }))), command)
      }
    } finally {
      spawnSync('chmod', ['755', join(fx.cfg, 'core')])
    }
  })

  test('the hook runs when reached through a symlinked hooks directory with a URL-hostile name', () => {
    const linked = join(fx.base, 'odd dir@x', 'hooks')
    mkdirSync(dirname(linked), { recursive: true })
    symlinkSync(dirname(HOOK), linked)
    const run = spawnSync('node', [join(linked, 'docs-gate.mjs')], {
      input: JSON.stringify({ session_id: 's1', cwd: fx.ws, ...pre('Write', { file_path: join(fx.ws, 'a.py') }) }),
      encoding: 'utf8',
      env: fx.env,
    })
    assert.match(run.stdout, /"permissionDecision":"deny"/, run.stderr)
  })

  test('a payload with no session id is not gated', () => {
    const r = hook(fx, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(fx.ws, 'a.py') }, cwd: fx.ws }))
    assert.ok(!denied(r))
  })
})

/** Run the hook without waiting, so several can race as Claude Code runs them. */
function hookAsync(fx, payload, extraEnv = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('node', [HOOK], { env: { ...fx.env, ...extraEnv } })
    child.on('error', reject)
    child.on('close', resolveRun)
    child.stdin.end(JSON.stringify({ session_id: 's1', cwd: fx.ws, ...payload }))
  })
}

/** Read files in an earlier session that has the credit store switched on. */
function readWithStore(fx, store, paths) {
  for (const file_path of paths) {
    hook(fx, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path }, tool_response: {}, session_id: 'old' }, { DOCS_GATE_CREDIT_STORE: store })
  }
}

describe('init check', () => {
  let fx
  let fresh
  beforeEach(() => {
    fx = fixture()
    fresh = join(fx.base, 'fresh')
    mkdirSync(join(fresh, '.git'), { recursive: true })
    for (const id of ['principles', ...CODE_TIER]) read(fx, fx.doc(id), { cwd: fresh })
  })
  const inFresh = (payload, env) => hook(fx, { ...payload, cwd: fresh }, env)

  test('a change in a git repo with no .ai/project.md is denied with the ai-init steps', () => {
    const r = inFresh(pre('Write', { file_path: join(fresh, 'README.md') }))
    assert.ok(denied(r), r.stdout)
    assert.match(reason(r), /has no \.ai\/project\.md/)
    assert.match(reason(r), /If the user declines, stop/)
  })

  test('ai-init itself, reads and writes under .ai/ stay open', () => {
    assert.ok(!denied(inFresh(pre('Bash', { command: 'ai-init' }))))
    assert.ok(!denied(inFresh(pre('Bash', { command: 'git log --oneline -5' }))))
    assert.ok(!denied(inFresh(pre('Write', { file_path: join(fresh, '.ai/project.md') }))))
  })

  test('creating .ai/project.md lifts it, and the doc is then required like the others', () => {
    mkdirSync(join(fresh, '.ai'))
    writeFileSync(join(fresh, '.ai/project.md'), '# p\n')
    const r = inFresh(pre('Write', { file_path: join(fresh, 'README.md') }))
    assert.ok(denied(r))
    assert.doesNotMatch(reason(r), /has no \.ai/)
    read(fx, join(fresh, '.ai/project.md'), { cwd: fresh })
    assert.ok(!denied(inFresh(pre('Write', { file_path: join(fresh, 'README.md') }))))
  })

  test('the opt-out marker and DOCS_GATE_REQUIRE_INIT=0 switch it off', () => {
    assert.ok(!denied(inFresh(pre('Write', { file_path: join(fresh, 'README.md') }), { DOCS_GATE_REQUIRE_INIT: '0' })))
    mkdirSync(join(fresh, '.git/info'), { recursive: true })
    writeFileSync(join(fresh, '.git/info/ai-optout'), '')
    assert.ok(!denied(inFresh(pre('Write', { file_path: join(fresh, 'README.md') }))))
  })

  test('in a worktree the opt-out lives in the git directory .git points to', () => {
    const main = join(fx.base, 'main')
    const wt = join(fx.base, 'wt')
    mkdirSync(join(main, '.git/worktrees/wt'), { recursive: true })
    mkdirSync(wt)
    writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git/worktrees/wt')}\n`)
    const write = { ...pre('Write', { file_path: join(wt, 'README.md') }), cwd: wt }
    assert.ok(denied(hook(fx, write)))
    mkdirSync(join(main, '.git/info'), { recursive: true })
    writeFileSync(join(main, '.git/info/ai-optout'), '')
    assert.ok(!denied(hook(fx, write)))
  })

  test('a linked worktree uses the main checkout\'s .ai/project.md', () => {
    const main = join(fx.base, 'app')
    const wt = join(main, '.worktrees/task')
    mkdirSync(join(main, '.git/worktrees/task'), { recursive: true })
    mkdirSync(join(main, '.ai'))
    writeFileSync(join(main, '.ai/project.md'), '# p\n')
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git/worktrees/task')}\n`)
    const write = { ...pre('Write', { file_path: join(wt, 'README.md') }), cwd: wt }
    for (const id of ['principles', ...CODE_TIER]) read(fx, fx.doc(id), { cwd: wt })
    const r = hook(fx, write)
    assert.ok(denied(r))
    assert.doesNotMatch(reason(r), /has no \.ai/)
    assert.match(reason(r), /app\/\.ai\/project\.md/)
    read(fx, join(main, '.ai/project.md'), { cwd: wt })
    assert.ok(!denied(hook(fx, write)))
  })

  test('a symlink under .ai/ cannot carry a setup write out of it', () => {
    mkdirSync(join(fresh, '.ai'))
    mkdirSync(join(fresh, 'src'))
    symlinkSync(join(fresh, 'src'), join(fresh, '.ai/s'))
    assert.ok(denied(inFresh(pre('Bash', { command: 'echo x > .ai/s/a.py' }))))
    assert.ok(denied(inFresh(pre('Write', { file_path: join(fresh, '.ai/s/a.py') }))))
    assert.ok(!denied(inFresh(pre('Write', { file_path: join(fresh, '.ai/project.md') }))))
  })

  test('session start in such a repo states the fact; an initialized one says nothing', () => {
    const note = inFresh({ hook_event_name: 'SessionStart', source: 'startup' }).json?.hookSpecificOutput?.additionalContext ?? ''
    assert.match(note, /no \.ai\/project\.md/)
    assert.equal(hook(fx, { hook_event_name: 'SessionStart', source: 'startup' }).json, undefined)
  })
})

describe('flow-router', () => {
  let fx
  let repo
  const gitIn = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 's', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 's', GIT_COMMITTER_EMAIL: 's@example.invalid' } })
  beforeEach(() => {
    fx = fixture()
    repo = join(fx.base, 'app')
    mkdirSync(join(repo, '.ai/context'), { recursive: true })
    gitIn(repo, 'init', '-q', '-b', 'main')
    gitIn(repo, 'commit', '-q', '--allow-empty', '-m', 'x')
    writeFileSync(join(repo, '.ai/project.md'), '# p\n')
  })
  const note = r => r.json?.hookSpecificOutput?.additionalContext ?? ''

  test('session start names the next step from the repository state', () => {
    assert.match(note(hook(fx, { hook_event_name: 'SessionStart', source: 'startup', cwd: repo })), /no audited facts yet; the audit skill/)
    writeFileSync(join(repo, '.ai/context/domain.md'), 'Verified at: abc\n')
    assert.equal(hook(fx, { hook_event_name: 'SessionStart', source: 'startup', cwd: repo }).json, undefined, 'nothing to say')
  })

  test('a prompt naming a GitHub issue points to kickoff once per session, and never blocks', () => {
    const ask = prompt => hook(fx, { hook_event_name: 'UserPromptSubmit', prompt, cwd: repo })
    const first = ask('please start acme/shop#42')
    assert.equal(first.code, 0)
    assert.match(note(first), /acme\/shop#42.*kickoff/)
    assert.equal(first.json?.decision, undefined)
    assert.equal(ask('again acme/shop#42').json, undefined, 'said once')
    assert.match(note(ask('now https://github.com/acme/shop/pull/7')), /acme\/shop#7/)
    assert.equal(ask('fix the typo').json, undefined)
  })

  test('a branch switch is denied while an ai-worktree task runs, and allowed when none does', () => {
    const sw = (command, cwd = repo) => hook(fx, { ...pre('Bash', { command }), cwd })
    assert.doesNotMatch(reason(sw('git switch -c feat/other')) ?? '', /flow-router/, 'no task running: the router lets it through (docs-gate may still ask for the git docs)')
    gitIn(repo, 'worktree', 'add', '-q', '-b', 'feat/t', join(repo, '.worktrees/t'))
    gitIn(repo, 'worktree', 'lock', '--reason', 'ai-worktree: task t', join(repo, '.worktrees/t'))
    const r = sw('git checkout -b feat/other')
    assert.ok(denied(r))
    assert.match(reason(r), /tasks are running in other worktrees: t \(feat\/t\).*ai-worktree new/s)
    assert.ok(denied(sw('git switch main', join(repo, '.worktrees/t'))), 'not inside the task worktree either')
    assert.doesNotMatch(reason(sw('git checkout -- a.txt')) ?? '', /flow-router/, 'restoring a file is not a switch')
    assert.ok(!denied(sw('git status')))
  })
})

test('an unwritable state dir under procfs cannot hang the hook (recursive mkdir loops there)', { skip: !existsSync('/proc/self') }, () => {
  const fx = fixture()
  const start = Date.now()
  // A denied write records its denial count, which creates the session directory.
  const r = hook(fx, pre('Write', { file_path: join(fx.ws, 'README.md') }), { DOCS_GATE_STATE_DIR: '/proc/docs-gate-spec/nope' })
  assert.equal(r.code, 0)
  assert.ok(denied(r), 'the deny still stands')
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start}ms`)
})

test('FLOW_ROUTER_DISABLED=1 turns off the notes and the switch block, and leaves docs-gate on', () => {
  const fx = fixture()
  const off = { FLOW_ROUTER_DISABLED: '1' }
  assert.equal(hook(fx, { hook_event_name: 'UserPromptSubmit', prompt: 'start acme/shop#1' }, off).json, undefined)
  assert.ok(denied(hook(fx, pre('Write', { file_path: join(fx.ws, 'README.md') }), off)), 'docs-gate still denies')
})
