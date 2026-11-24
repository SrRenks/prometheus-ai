/**
 * The stock-recipe resolver has to work through the package manager's link farm.
 *
 * WHY THIS SPEC EXISTS. On this machine `dsh` is a pnpm global install whose
 * `node_modules/@deepseek-ai/dsh` is a SYMLINK into a store tree. The shipped
 * preset module lives beside that store tree's own `node_modules`, one level
 * above the `@deepseek-ai` directory the launcher path walks through. Walking
 * up from the launcher's literal path checks `<global>/node_modules/...`, where
 * the module does not exist, so the resolver reported "dsh-web-app was not
 * found" and every install fell back to the last-known-good recipe.
 *
 * The fixture reproduces that shape: a shim, a global tree, a symlink into a
 * store tree, and the shipped module only beside the store.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { dshInstallDir, resolveStock } from './stock-recipe.mjs'

const SHIPPED_PATCH = `- insert:
    - id: preset-standard
      config:
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
`

/** A store-tree dsh install, optionally carrying the shipped preset module. */
function storeTree(root, { shipped }) {
  const store = join(root, 'store-dsh', 'links', '@deepseek-ai', 'dsh', '0.2.0-rc.2', 'hash')
  const dshDir = join(store, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(dshDir, 'lib'), { recursive: true })
  writeFileSync(join(dshDir, 'lib', 'bin.js'), '')
  if (shipped) {
    const presets = join(store, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets')
    mkdirSync(presets, { recursive: true })
    writeFileSync(join(presets, 'standard.patch.yml'), SHIPPED_PATCH)
  }
  return dshDir
}

/** The pnpm global tree plus the launcher shim that names its entry. */
function launcherFor(root, dshDir) {
  const linked = join(root, 'pnpm', 'global', 'v11', 'abc', 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(dirname(linked), { recursive: true })
  symlinkSync(dshDir, linked, 'dir')
  const launcher = join(root, 'pnpm', 'bin', 'dsh')
  mkdirSync(dirname(launcher), { recursive: true })
  writeFileSync(launcher, `#!/bin/sh\nexec node "$0"\n# cmd-shim-target=${join(linked, 'lib', 'bin.js')}\n`)
  return launcher
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'stock-recipe-'))
  return { root, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('the launcher resolves through the link farm to the store install', () => {
  const { root, done } = scratch()
  try {
    const dshDir = storeTree(root, { shipped: true })
    const launcher = launcherFor(root, dshDir)
    assert.equal(dshInstallDir(launcher), realpathSync(join(dshDir, 'lib')))

    const resolved = resolveStock({ dshHome: join(root, 'dsh-home'), whichDsh: launcher })
    assert.equal(resolved.error, undefined)
    assert.equal(resolved.layout, 'shipped-patch')
    assert.match(resolved.text, /id: persona/)
  } finally {
    done()
  }
})

test('a legacy directory preset still resolves when the install ships none', () => {
  const { root, done } = scratch()
  try {
    const dshDir = storeTree(root, { shipped: false })
    const launcher = launcherFor(root, dshDir)
    const legacy = join(
      root, 'dsh-home', 'profiles', 'tui', 'node_modules', '@deepseek-ai',
      'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml',
    )
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, '- id: persona\n')

    const resolved = resolveStock({ dshHome: join(root, 'dsh-home'), whichDsh: launcher })
    assert.equal(resolved.error, undefined)
    assert.equal(resolved.layout, 'legacy-directory')
    assert.equal(resolved.text, '- id: persona\n')
  } finally {
    done()
  }
})
