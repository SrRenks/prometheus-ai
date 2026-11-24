/**
 * ai status and the ai dispatcher: the state of a project and the next command,
 * for a person at the terminal.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { statusReport } from './ai-status.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = { git: true, root: '/r', main: '/r', linked: false, task: undefined, busy: [], initialized: true, overlay: true, audited: true, history: true }

test('the next step follows the state', () => {
  assert.match(statusReport({ git: false }).join('\n'), /not a git repository/)
  assert.match(statusReport({ ...BASE, initialized: false }, ['acme']).join('\n'), /next   : ai init --overlay acme/)
  assert.match(statusReport({ ...BASE, initialized: false }, ['default', 'acme']).join('\n'), /ai init --overlay default   \(your overlays: default, acme\)/)
  assert.match(statusReport({ ...BASE, audited: false }).join('\n'), /\/audit/)
  assert.match(statusReport({ ...BASE, overlay: false }).join('\n'), /no overlay/)
  const busy = statusReport({ ...BASE, busy: [{ task: 'a', branch: 'feat/a', path: '/r/.worktrees/a' }] }).join('\n')
  assert.match(busy, /task   : a on feat\/a at \/r\/\.worktrees\/a/)
  assert.match(busy, /branch switching in this checkout is blocked/)
  assert.match(statusReport({ ...BASE, linked: true, task: 'a', root: '/r/.worktrees/a' }).join('\n'), /a \(this worktree\)/)
})

test('ai routes to the ai-* commands and reports a real repository', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ai-status-')))
  try {
    const env = { ...process.env, PROMETHEUS_AI_CONFIG_DIR: ROOT, PROMETHEUS_AI_LOCAL: join(dir, 'no-local'), GIT_CONFIG_GLOBAL: '/dev/null' }
    const ai = (...args) => spawnSync('bash', [join(ROOT, 'ai'), ...args], { cwd: dir, encoding: 'utf8', env })
    spawnSync('git', ['init', '-q'], { cwd: dir, env })
    assert.match(ai().stdout, /next   : ai init$/m, 'status is the default')
    mkdirSync(join(dir, '.ai'))
    writeFileSync(join(dir, '.ai/project.md'), '# p\n')
    assert.match(ai('status').stdout, /set up : yes/)
    assert.match(ai('help').stdout, /ai task new\|list\|remove/)
    assert.equal(ai('nope').status, 2)
    assert.equal(ai('task', 'list').status, 0, 'ai task routes to ai-worktree')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
