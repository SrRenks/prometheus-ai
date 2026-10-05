/**
 * The two rules the README stated and no code applied.
 *
 * Both are pure enough to test directly, and both guard a failure that is silent
 * at install time: a stale `dsh-unrestricted` pin installs and then fails to
 * activate, and an unreferenced helper sits in the preset directory until the
 * bundle builder carries it into every profile.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FLOOR,
  checkProfilePin,
  compareVersions,
  pruneHelpers,
  reachableModules,
  referencedHelpers,
  versionFromLocalSpec,
  versionFromSpec,
} from './preset-helpers.mjs'

const scratchDirs = []
process.on('exit', () => {
  for (const dir of scratchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
})

/** A temp directory removed when the run ends. */
const scratch = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(dir)
  return dir
}

test('a version is read out of every spec shape a profile uses', () => {
  assert.equal(versionFromSpec('0.1.4'), '0.1.4')
  assert.equal(versionFromSpec('v0.2.2-renks.1'), '0.2.2')
  assert.equal(versionFromSpec('github:SrRenks/dsh-unrestricted-renks#v0.1.4-renks.1'), '0.1.4')
  assert.equal(versionFromSpec('github:SrRenks/dsh-unrestricted-renks#v0.2.2-renks.1'), '0.2.2')
  assert.equal(versionFromSpec('^0.1.9'), '0.1.9')
  // A spec with no version is not guessed at: the caller reports it.
  assert.equal(versionFromSpec('file:/home/x/dsh-unrestricted-renks'), undefined)
  assert.equal(versionFromSpec('github:owner/repo'), undefined)
  assert.equal(versionFromSpec(undefined), undefined)
})

test('versions compare numerically, not as text', () => {
  // Text comparison would put 0.10 below 0.9, which is the bug this exists to
  // avoid: the floor is 0.1.9 and the current release is 0.2.2.
  assert.ok(compareVersions('0.9.0', '0.10.0') < 0)
  assert.ok(compareVersions('0.1.8', FLOOR) < 0)
  assert.equal(compareVersions(FLOOR, FLOOR), 0)
  assert.ok(compareVersions('0.2.2', FLOOR) > 0)
})

test('a pin below the floor is reported, and one at the floor is not', () => {
  const below = checkProfilePin({ dependencies: { 'dsh-unrestricted': 'github:o/r#v0.1.4-renks.1' } })
  assert.equal(below.status, 'below')
  assert.equal(below.version, '0.1.4')

  const at = checkProfilePin({ dependencies: { 'dsh-unrestricted': 'github:o/r#v0.1.9' } })
  assert.equal(at.status, 'ok')

  const above = checkProfilePin({ dependencies: { 'dsh-unrestricted': 'github:o/r#v0.2.2-renks.1' } })
  assert.equal(above.status, 'ok')
})

test('a profile without the plugin is absent, not a failure', () => {
  // The profiles that belong to another setup must not be reported on, and
  // `absent` is what keeps the checker quiet about them.
  assert.equal(checkProfilePin({ dependencies: {} }).status, 'absent')
  assert.equal(checkProfilePin({}).status, 'absent')
})

test('a file: pin reads the version from the package it names', () => {
  // The shape both profiles on this machine use. Without this the check would
  // fail a correct setup, which is worse than not having the check.
  const dir = scratch('floor-local-')
  const pkg = join(dir, 'dsh-unrestricted-renks')
  mkdirSync(pkg)
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-unrestricted', version: '0.2.2-renks.1' }))

  assert.equal(versionFromLocalSpec(`file:${pkg}`, dir), '0.2.2')
  const result = checkProfilePin({ dependencies: { 'dsh-unrestricted': `file:${pkg}` } }, dir)
  assert.equal(result.status, 'ok')
  assert.equal(result.source, 'local package')

  // And the same shape pointing at an old checkout is caught.
  const old = join(dir, 'old')
  mkdirSync(old)
  writeFileSync(join(old, 'package.json'), JSON.stringify({ version: '0.1.4' }))
  const stale = checkProfilePin({ dependencies: { 'dsh-unrestricted': `file:${old}` } }, dir)
  assert.equal(stale.status, 'below')
  assert.equal(stale.version, '0.1.4')
})

test('a file: pin that points at nothing is unreadable, not assumed good', () => {
  const dir = scratch('floor-missing-')
  const result = checkProfilePin({ dependencies: { 'dsh-unrestricted': 'file:/nonexistent/pkg' } }, dir)
  assert.equal(result.status, 'unreadable')
})

test('the reachable set follows relative imports and nothing else', async () => {
  const dir = scratch('closure-')
  writeFileSync(join(dir, 'entry.mjs'), "import { a } from './mid.mjs'\nimport { b } from './leaf.mjs'\n")
  writeFileSync(join(dir, 'mid.mjs'), "import { c } from './leaf.mjs'\nexport const m = 1\n")
  writeFileSync(join(dir, 'leaf.mjs'), 'export const c = 1\n')
  writeFileSync(join(dir, 'orphan.mjs'), 'export const o = 1\n')

  const reached = await reachableModules(dir, ['entry.mjs'])
  assert.deepEqual(reached.names, ['entry.mjs', 'leaf.mjs', 'mid.mjs'])
  assert.equal(reached.names.includes('orphan.mjs'), false, 'a module nobody imports is not reachable')
})

test('a reference that does not resolve fails by name instead of silently', async () => {
  const dir = scratch('closure-broken-')
  writeFileSync(join(dir, 'entry.mjs'), "import { a } from './absent.mjs'\n")
  const reached = await reachableModules(dir, ['entry.mjs'])
  assert.match(reached.error, /absent\.mjs is referenced but not present/)
})

test('the composition references are read from the row names', () => {
  const composition = [
    '- id: docs-gate',
    '  name: ./docs-gate.mjs',
    '- id: skill-search',
    '  name: ./skill-search.mjs',
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
  ].join('\n')
  assert.deepEqual(referencedHelpers(composition).sort(), ['docs-gate.mjs', 'skill-search.mjs'])
})

test('pruning removes unreferenced helpers and keeps the rest', async () => {
  const dir = scratch('prune-')
  writeFileSync(join(dir, 'entry.mjs'), "import { a } from './dep.mjs'\n")
  writeFileSync(join(dir, 'dep.mjs'), 'export const a = 1\n')
  writeFileSync(join(dir, 'stale.mjs'), 'export const s = 1\n')
  // Not a helper, and must survive: the installer's own outputs live here too.
  writeFileSync(join(dir, 'agent.cordis.yml'), 'name: ./entry.mjs\n')
  writeFileSync(join(dir, 'preset.yml'), 'name: x\n')

  const { pruned } = await pruneHelpers(dir, 'name: ./entry.mjs\n')
  assert.deepEqual(pruned, ['stale.mjs'])
  const left = (await import('node:fs')).readdirSync(dir).sort()
  assert.deepEqual(left, ['agent.cordis.yml', 'dep.mjs', 'entry.mjs', 'preset.yml'])
})
