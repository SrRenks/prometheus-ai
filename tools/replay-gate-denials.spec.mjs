/**
 * The replay benchmark reads both transcript formats and reclassifies.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deniedCalls, replay } from './replay-gate-denials.mjs'

const DENY = 'bash is blocked once per session (fs-write): the behavioural rules have not been read yet.'

test('dsh transcripts: denied bash calls are found and replayed', () => {
  const lines = [
    { type: 'session', cwd: '/tmp' },
    { type: 'tool/call', data: { name: 'bash', callId: 'a', arguments: JSON.stringify({ command: 'git grep -ln x' }) } },
    { type: 'tool/result', data: { message: { toolCallId: 'a', content: [{ type: 'text', text: DENY }] } } },
    { type: 'tool/call', data: { name: 'bash', callId: 'b', arguments: JSON.stringify({ command: 'ls' }) } },
    { type: 'tool/result', data: { message: { toolCallId: 'b', content: [{ type: 'text', text: 'a b' }] } } },
    { type: 'tool/call', data: { name: 'bash', callId: 'c', arguments: JSON.stringify({ command: 'rm x' }) } },
    { type: 'tool/result', data: { message: { toolCallId: 'c', content: [{ type: 'text', text: DENY }] } } },
  ].map(line => JSON.stringify(line)).join('\n')
  const calls = deniedCalls(lines)
  assert.deepEqual(calls.map(call => call.command), ['git grep -ln x', 'rm x'])
  const result = replay(calls)
  assert.equal(result.total, 2)
  assert.equal(result.allowed, 1)
  assert.deepEqual(result.byKind, { 'fs-write': 1 })
})

test('Claude Code transcripts: tool_use and tool_result blocks are paired', () => {
  const lines = [
    { cwd: '/tmp', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git tag -l' } }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Bash is blocked by docs-gate (git-write): ...' }] } },
  ].map(line => JSON.stringify(line)).join('\n')
  const result = replay(deniedCalls(lines))
  assert.equal(result.total, 1)
  assert.equal(result.allowed, 1)
})

test('output that merely quotes the denial text is not a denial', () => {
  const lines = [
    { message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat docs-gate.mjs' } }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: "const x = 'is blocked by docs-gate'" }] } },
  ].map(line => JSON.stringify(line)).join('\n')
  assert.equal(deniedCalls(lines).length, 0)
})
