/**
 * ai-lint, run against throwaway `.ai/` directories.
 *
 * `.ai/` is agent-facing: no tables, no bold, no unfilled template
 * placeholders, and every `path:line` citation must still point at a real
 * line. `agents.md` links to the shared AGENTS.md, which is linted where it
 * lives, so it is never followed here.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { lintText } from './ai-lint.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-lint-spec-'))
  mkdirSync(join(dir, '.ai/context'), { recursive: true })
  writeFileSync(join(dir, 'src.js'), 'one\ntwo\nthree\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const lint = (...args) => spawnSync('bash', [join(ROOT, 'ai-lint'), ...args], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, AGENT_CONFIG_DIR: ROOT },
})
const put = (rel, text) => writeFileSync(join(dir, '.ai', rel), text)
const rules = (text) => lintText(text, { root: dir }).map((f) => f.rule)

test('a clean .ai/ exits 0 and prints nothing', () => {
  put('project.md', '# Project\n\n- Entry point: `src.js:2`\n- Range: `src.js:1-3`\n')
  const r = lint()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout, '')
})

test('each error prints file:line: rule: text and fails the run', () => {
  put('project.md', '# P\n\n| a | b |\n|---|---|\n- **bold** here\n- repo: <repo-name>\n')
  put('context/domain.md', '- see `src.js:9`\n- see `missing/file.go:1`\n')
  const r = lint()
  assert.equal(r.status, 1)
  const lines = r.stdout.trim().split('\n')
  assert.ok(lines.includes('.ai/project.md:4: table: |---|---|'), r.stdout)
  assert.ok(lines.includes('.ai/project.md:5: bold: **bold**'), r.stdout)
  assert.ok(lines.includes('.ai/project.md:6: placeholder: <repo-name>'), r.stdout)
  assert.ok(lines.includes('.ai/context/domain.md:1: citation: src.js:9 (src.js has 3 lines)'), r.stdout)
  assert.ok(lines.includes('.ai/context/domain.md:2: citation: missing/file.go:1 (no such file)'), r.stdout)
})

test('a dangling symlink is a broken-link error', () => {
  symlinkSync(join(dir, 'nowhere.md'), join(dir, '.ai/docs.md'))
  const r = lint()
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^\.ai\/docs\.md:1: broken-link: -> .*nowhere\.md$/m)
})

test('symlinked files are followed, but agents.md is not', () => {
  writeFileSync(join(dir, 'shared.md'), '- **x**\n')
  symlinkSync(join(dir, 'shared.md'), join(dir, '.ai/agents.md'))
  assert.equal(lint().status, 0, 'agents.md is the shared AGENTS.md')
  symlinkSync(join(dir, 'shared.md'), join(dir, '.ai/linked.md'))
  const r = lint()
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^\.ai\/linked\.md:1: bold: \*\*x\*\*$/m)
})

test('a long file is a warning that keeps the exit code at 0', () => {
  put('scratchpad.md', '- line\n'.repeat(151))
  const r = lint()
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^\.ai\/scratchpad\.md:151: long-file: warning: 151 lines, over 150$/m)
})

test('a directory argument is linted relative to its parent as the project root', () => {
  mkdirSync(join(dir, 'other/.ai'), { recursive: true })
  writeFileSync(join(dir, 'other/.ai/project.md'), '- `src.js:1`\n')
  const r = lint('other/.ai')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^other\/\.ai\/project\.md:1: citation: src\.js:1 \(no such file\)$/m)
})

test('a missing directory is a usage error', () => {
  const r = lint('nope')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /not a directory/)
})

test('code spans and fences are exempt from bold, table and placeholder', () => {
  assert.deepEqual(rules('- `**not bold**` and `<repo-name>`\n```\n|---|\n**x** <repo-name> TBD\n```\n'), [])
  assert.deepEqual(rules('~~~md\n**x**\n~~~\n'), [])
})

test('globs in prose are not bold', () => {
  assert.deepEqual(rules('- never read credentials/**, secrets/** or **/*.pem, "**/x"\n'), [])
  assert.deepEqual(rules('- **Stack**: node, and (**x**)\n'), ['bold', 'bold'])
})

test('placeholders are matched conservatively', () => {
  assert.deepEqual(rules('- Map<K,V> and List<string> and <br> and <https://x.y>\n'), [])
  assert.deepEqual(rules('- TBD\n- {describe the flow}\n- TODO: fill this\n- <service-name>\n'),
    ['placeholder', 'placeholder', 'placeholder', 'placeholder'])
  assert.deepEqual(rules('- TBDX and TODO: later\n'), [])
})

test('citations only count paths with a slash or an extension, and URLs are ignored', () => {
  assert.deepEqual(rules('- `localhost:8080` `10.0.0.1:5432` `https://x.y/a.js:3` `key:1`\n'), [])
  assert.deepEqual(rules('- `src.js:3` `src.js:2-3`\n'), [])
  assert.deepEqual(rules('- `src.js:3-4` `src.js:0` `src.js:3-2`\n'), ['citation', 'citation', 'citation'])
})

test('a horizontal rule and a pipe in prose are not tables', () => {
  assert.deepEqual(rules('---\n- a | b\n- a || b\n'), [])
  assert.deepEqual(rules('| :--- | ---: |\n'), ['table'])
})

test('evidence in a related repository resolves as <repo>/<path> next to the project', () => {
  const base = mkdtempSync(join(tmpdir(), 'ai-lint-sib-'))
  try {
    const app = join(base, 'app')
    mkdirSync(join(base, 'other/.git'), { recursive: true })
    mkdirSync(join(base, 'other/api'), { recursive: true })
    mkdirSync(app)
    writeFileSync(join(base, 'other/api/routes.yml'), 'a\nb\n')
    const at = (text) => lintText(text, { root: app }).map((f) => f.rule)
    assert.deepEqual(at('Called by `other/api/routes.yml:2`.'), [])
    assert.deepEqual(at('Called by `other/api/routes.yml:9`.'), ['citation'])
    assert.deepEqual(at('Not a repo: `nowhere/api/routes.yml:1`.'), ['citation'])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('in a worktree, linked .ai/ directories are linted and siblings resolve next to the main checkout', () => {
  const base = mkdtempSync(join(tmpdir(), 'ai-lint-wt-'))
  try {
    const main = join(base, 'app')
    const tree = join(main, '.worktrees/t')
    mkdirSync(join(main, '.git/worktrees/t'), { recursive: true })
    mkdirSync(join(main, '.ai/context'), { recursive: true })
    mkdirSync(join(base, 'other/.git'), { recursive: true })
    writeFileSync(join(base, 'other/x.js'), 'x\n')
    writeFileSync(join(main, '.ai/context/domain.md'), 'Bad: `src/none.js:1`. Sibling: `other/x.js:1`.\n')
    mkdirSync(join(tree, '.ai'), { recursive: true })
    writeFileSync(join(tree, '.git'), `gitdir: ${join(main, '.git/worktrees/t')}\n`)
    symlinkSync(join(main, '.ai/context'), join(tree, '.ai/context'))
    symlinkSync(join(tree, '.ai'), join(tree, '.ai/context-loop'))
    const r = spawnSync('bash', [join(ROOT, 'ai-lint')], { cwd: tree, encoding: 'utf8', env: { ...process.env, AGENT_CONFIG_DIR: ROOT } })
    assert.equal(r.status, 1, 'the linked context is checked, and the link cycle ends')
    assert.match(r.stdout, /context\/domain\.md:1: citation: src\/none\.js:1 \(no such file\)/)
    assert.doesNotMatch(r.stdout, /other\/x\.js/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a citation outside the project is an error, never a lookup', () => {
  assert.deepEqual(rules('See `/etc/passwd:1` and `../../x/y.txt:1` and `~/.ssh/config:1`.'), ['citation', 'citation', 'citation'])
  const text = lintText('`/etc/hostname:1`', { root: dir })[0].text
  assert.match(text, /outside the project/)
})
