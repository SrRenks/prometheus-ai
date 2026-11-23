/**
 * setup.sh install modes, run against a throwaway HOME.
 *
 * `subscription` links the CLAUDE.md that imports AGENTS.md; `token` links the
 * lean one and leaves the rules to docs-gate. A re-run without `--mode` keeps
 * whichever mode the machine is in, so `git pull && ./setup.sh` never flips it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLAUDE = join(ROOT, 'agents/claude-code')

let home

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'setup-spec-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function setup(...args) {
  return spawnSync('bash', [join(ROOT, 'setup.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
}

const claudeLink = () => readlinkSync(join(home, '.claude/CLAUDE.md'))

test('a first install defaults to subscription mode', () => {
  const r = setup()
  assert.equal(r.status, 0, r.stderr)
  assert.equal(claudeLink(), join(CLAUDE, 'CLAUDE.md'))
  assert.match(r.stdout, /mode: subscription/)
})

test('--mode token links the lean CLAUDE.md', () => {
  const r = setup('--mode', 'token')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(claudeLink(), join(CLAUDE, 'CLAUDE.token.md'))
  assert.match(r.stdout, /mode: token/)
})

test('a re-run without --mode keeps the current mode', () => {
  setup('--mode', 'token')
  assert.equal(setup().status, 0)
  assert.equal(claudeLink(), join(CLAUDE, 'CLAUDE.token.md'))
  assert.equal(setup('--mode', 'subscription').status, 0)
  assert.equal(setup().status, 0)
  assert.equal(claudeLink(), join(CLAUDE, 'CLAUDE.md'))
})

test('an unknown or empty mode is refused before anything is linked', () => {
  // An empty value is `--mode "$VAR"` with VAR unset: refusing it beats
  // silently keeping whatever mode is linked.
  for (const args of [['--mode', 'cheap'], ['--mode', ''], ['--mode='], ['--mode']]) {
    const r = setup(...args)
    assert.notEqual(r.status, 0, args.join(' '))
    assert.match(r.stderr, /token|subscription/)
    assert.ok(!existsSync(join(home, '.claude')))
  }
})

test('the other harnesses get the full rules in both modes', () => {
  // Codex and Gemini have nothing that enforces a read, so a lean file there
  // would leave them with no rules at all.
  setup('--mode', 'token')
  assert.equal(readlinkSync(join(home, '.codex/AGENTS.md')), join(ROOT, 'AGENTS.md'))
  assert.equal(readlinkSync(join(home, '.gemini/GEMINI.md')), join(ROOT, 'agents/gemini/GEMINI.md'))
  assert.ok(lstatSync(join(home, '.claude/hooks')).isSymbolicLink())
})

test('both CLAUDE files share one Claude Code section, and only one imports AGENTS.md', () => {
  const shared = '@~/.config/agent-config/agents/claude-code/claude-code.md'
  const full = readFileSync(join(CLAUDE, 'CLAUDE.md'), 'utf8')
  const lean = readFileSync(join(CLAUDE, 'CLAUDE.token.md'), 'utf8')
  assert.ok(existsSync(join(CLAUDE, 'claude-code.md')))
  assert.ok(full.includes(shared) && lean.includes(shared))
  assert.match(full, /^@~\/\.config\/agent-config\/AGENTS\.md$/m)
  assert.doesNotMatch(lean, /^@.*AGENTS\.md$/m)
})
