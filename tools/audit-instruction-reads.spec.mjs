/**
 * The audit's Claude Code mode, run against a fabricated transcript tree in the
 * shape `~/.claude/projects/<project>/<session>.jsonl` takes.
 *
 * Run: node --test tools/audit-instruction-reads.spec.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const TOOL = join(resolve(dirname(fileURLToPath(import.meta.url))), 'audit-instruction-reads.mjs')
const CFG = '/home/u/.config/prometheus-ai'

const base = mkdtempSync(join(tmpdir(), 'audit-claude-'))
after(() => rmSync(base, { recursive: true, force: true }))

/** One assistant tool call, as Claude Code records it. */
const toolUse = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name, input }] } })
/** One tool result carrying a docs-gate denial. */
const denial = paths => JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', is_error: true, content: `Edit is blocked by docs-gate (edit): this session has not read the rules this change needs.\n\nRead each file below with the Read tool, then retry.\n${paths.map(p => `  - ${p}`).join('\n')}\n` }] },
})

const project = join(base, 'projects', '-home-u-repo')
mkdirSync(project, { recursive: true })
// Session a: denied, then read both named docs. Honoured.
writeFileSync(join(project, 'a.jsonl'), [
  toolUse('Edit', { file_path: '/home/u/repo/x.ts' }),
  denial([`${CFG}/core/principles.md`, `${CFG}/core/docs/complexity.md`]),
  toolUse('Read', { file_path: `${CFG}/core/principles.md` }),
  toolUse('Read', { file_path: `${CFG}/core/docs/complexity.md` }),
].join('\n'))
// Session b: read nothing, never denied (the pre-gate shape).
writeFileSync(join(project, 'b.jsonl'), toolUse('Bash', { command: 'ls' }))
// Session c: denied and read nothing.
writeFileSync(join(project, 'c.jsonl'), [toolUse('Write', { file_path: '/home/u/repo/y.py' }), denial([`${CFG}/core/principles.md`])].join('\n'))

const audit = () => JSON.parse(execFileSync('node', [TOOL, '--claude', '--sessions', join(base, 'projects'), '--json'], { encoding: 'utf8' })).summary

test('the Claude mode reads .jsonl transcripts without zstd', () => {
  assert.equal(audit().transcripts, 3)
})

test('core-doc reads are counted from Claude tool names', () => {
  const s = audit()
  assert.equal(s.readAnyCoreDoc, 1)
  assert.equal(s.perDoc['core/principles.md'], 1)
})

test('process fidelity recognises the Claude Code denial', () => {
  const s = audit()
  assert.equal(s.denied, 2)
  assert.equal(s.sessionsHonoured, 1)
  assert.equal(s.sessionsIgnored, 1)
})
