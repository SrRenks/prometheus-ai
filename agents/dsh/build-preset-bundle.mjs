#!/usr/bin/env node
/**
 * Build the DSH 0.2.0 agent-preset bundle from the legacy directory presets.
 *
 * DSH 0.1.7 removed directory presets: nothing reads `$DSH_HOME/.agent-presets/`
 * any more. A preset is now an ordinary `@deepseek-ai/dsh-agent-preset` row
 * carried by a plugin bundle's patch file, with the old `agent.cordis.yml`
 * entry list pasted verbatim under `config.plugins`.
 *
 * This script converts:
 *
 *   $DSH_HOME/.agent-presets/<id>/preset.yml        -> id/name/description/order
 *   $DSH_HOME/.agent-presets/<id>/agent.cordis.yml  -> config.plugins (re-indented)
 *   $DSH_HOME/.agent-presets/<id>/*.mjs             -> helpers/<id>/*.mjs
 *
 * Helper modules were referenced as `name: ./instruction-hint.mjs` relative to
 * the preset directory. That anchor does not exist in the new format, so each
 * reference is rewritten to a subpath of this bundle package, which is
 * installed into the profile's node_modules alongside the preset row.
 *
 * Usage: node build-preset-bundle.mjs [--out <dir>] [--dsh-home <dir>]
 *
 * `--out` defaults to `$DSH_BUNDLE_OUT` or `~/dsh-user-presets`, which is the
 * path a profile's `file:` dependency names. `install.sh` passes it explicitly.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Presets to migrate, in declaration order.
 *
 * `renks` is the preset this repository installs and the only one it owns.
 *
 * A second name was in this roster and it was a mistake with a real consequence:
 * on a machine where that preset exists, the bundle packaged it and declared it
 * in `dsh.bundle.patch`, so the profile mounted somebody else's preset in every
 * new session. Nothing failed and nothing warned, which is the same shape as the
 * other defects in this area.
 *
 * So the roster is now an ALLOW-LIST of what this repository owns, and the loop
 * additionally refuses any candidate a different tool has marked as its own by
 * leaving a `.dsh-tui-managed.json` beside it. A preset belonging to the TUI is
 * the TUI's to mount. Add names here only for presets this repository installs.
 */
const PRESETS = ['renks']

/** Marker another tool leaves to claim a preset directory. */
const FOREIGN_MARKER = '.dsh-tui-managed.json'

/** Package name of the generated bundle; also the subpath prefix for helpers. */
const BUNDLE = 'dsh-user-presets'

/** Indent of the `plugins:` key inside a declaration row. */
const PLUGINS_INDENT = 8

/** Indent of the plugin-list items under `plugins:`. */
const ITEM_INDENT = PLUGINS_INDENT + 2

/**
 * Read the CLI arguments.
 * @returns the output directory and the DSH home to read presets from.
 */
function parseArgs() {
  const argv = process.argv.slice(2)
  // Default to where the profiles expect it, not beside this file. A bare run
  // used to write the bundle INSIDE the repository, which is both the wrong
  // location and an untracked directory in a tree that should stay clean.
  let out = process.env.DSH_BUNDLE_OUT ?? join(process.env.HOME ?? '', 'dsh-user-presets')
  let dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--out') out = resolve(argv[++index])
    else if (argv[index] === '--dsh-home') dshHome = resolve(argv[++index])
  }
  return { out, dshHome }
}

/**
 * Parse the flat `key: value` front matter of a legacy `preset.yml`.
 * @param text - the file contents.
 * @returns the parsed scalar fields.
 */
function parsePresetYml(text) {
  const fields = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if (
      (value.startsWith("'") && value.endsWith("'"))
      || (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1).replaceAll("''", "'")
    }
    fields[match[1]] = value
  }
  return fields
}

/**
 * Quote a scalar for YAML, preferring double quotes when it carries an
 * apostrophe so the emitted file stays readable.
 * @param value - the raw string.
 * @returns a YAML-safe single-line scalar.
 */
function yamlScalar(value) {
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Re-indent a legacy `agent.cordis.yml` entry list so it nests under
 * `config.plugins`, rewriting helper references to bundle subpaths.
 * @param source - the verbatim composition.
 * @param presetId - the preset the helpers belong to.
 * @returns the indented plugin-list block, without a trailing newline.
 */
function indentPlugins(source, presetId) {
  const lines = source.replace(/\s+$/, '').split('\n')
  const rewritten = lines.map(line => line.replace(
    /^(\s*(?:- )?name:\s*)\.\/([\w.-]+\.mjs)\s*$/,
    (_all, prefix, file) => `${prefix}${BUNDLE}/helpers/${presetId}/${file}`,
  ))
  return rewritten
    .map(line => (line.trim() === '' ? '' : ' '.repeat(ITEM_INDENT) + line))
    .join('\n')
}

/**
 * Build one preset patch file.
 * @param presetId - the directory name and preset id.
 * @param dshHome - the DSH home holding the legacy presets.
 * @returns the patch YAML text.
 */
async function buildPatch(presetId, dshHome) {
  const dir = join(dshHome, '.agent-presets', presetId)
  const meta = parsePresetYml(await readFile(join(dir, 'preset.yml'), 'utf8'))
  const composition = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')

  const head = [
    `# Agent preset ${presetId}: one \`@deepseek-ai/dsh-agent-preset\` declaration.`,
    '#',
    `# Migrated from the legacy directory preset \`$DSH_HOME/.agent-presets/${presetId}/\``,
    '# (preset.yml + agent.cordis.yml) by build-preset-bundle.mjs. The plugin',
    '# entry list below is the legacy composition verbatim, re-indented; only the',
    '# helper references changed, from `./x.mjs` to a subpath of this bundle.',
    '#',
    "# Edits saved from the Web editor override this row's `config.plugins` by id",
    '# from the profile patch.',
    '- insert:',
    `    - id: preset-${presetId}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${presetId}`,
    `        name: ${yamlScalar(meta.name ?? presetId)}`,
    `        description: ${yamlScalar(meta.description ?? '')}`,
    `        order: ${meta.order ?? 5}`,
    '        plugins:',
  ].join('\n')

  return `${head}\n${indentPlugins(composition, presetId)}\n`
}

const { out, dshHome } = parseArgs()

await mkdir(join(out, 'presets'), { recursive: true })
await mkdir(join(out, 'helpers'), { recursive: true })

const copied = []
/** Presets that produced a patch file, so the bundle only names real files. */
const built = []
const removed = []
for (const presetId of PRESETS) {
  const dir = join(dshHome, '.agent-presets', presetId)
  if (!existsSync(dir)) {
    console.error(`skip ${presetId}: no legacy preset at ${dir}`)
    continue
  }
  if (existsSync(join(dir, FOREIGN_MARKER))) {
    console.error(`skip ${presetId}: ${FOREIGN_MARKER} says another tool owns it`)
    continue
  }

  await writeFile(join(out, 'presets', `${presetId}.patch.yml`), await buildPatch(presetId, dshHome))
  built.push(presetId)

  const helperDir = join(out, 'helpers', presetId)
  await mkdir(helperDir, { recursive: true })
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith('.mjs')) continue
    await cp(join(dir, entry), join(helperDir, entry))
    copied.push(`helpers/${presetId}/${entry}`)
  }
  console.log(`built preset ${presetId}`)
}

// Prune what this run did not produce. Without this a preset removed from the
// roster keeps mounting: its patch file is indexed by name, so it stays live
// even though `dsh.bundle.patch` no longer lists it.
for (const entry of await readdir(join(out, 'presets'))) {
  const id = entry.replace(/\.patch\.yml$/, '')
  if (!entry.endsWith('.patch.yml') || built.includes(id)) continue
  await rm(join(out, 'presets', entry))
  await rm(join(out, 'helpers', id), { recursive: true, force: true })
  removed.push(id)
}
for (const id of removed) console.error(`pruned stale preset ${id} from the bundle`)
if (removed.length > 0) {
  console.error('  (a new session stops mounting it; the preset itself is untouched)')
}

await writeFile(join(out, 'package.json'), `${JSON.stringify({
  name: BUNDLE,
  version: '1.0.0',
  private: true,
  type: 'module',
  description: 'Local agent presets for DSH 0.2.0, migrated from $DSH_HOME/.agent-presets',
  exports: {
    './package.json': './package.json',
    './helpers/*': './helpers/*',
    './presets/*': './presets/*',
  },
  files: ['presets', 'helpers', 'README.md'],
  dsh: { bundle: { patch: built.map(id => `./presets/${id}.patch.yml`) } },
}, null, 2)}\n`)

if (built.length === 0) {
  console.error('no preset was built: install one with agents/dsh/install.sh first')
  process.exit(1)
}

console.log(`\nbundle at ${out}`)
console.log(`patches: ${built.map(id => `presets/${id}.patch.yml`).join(', ') || '(none)'}`)
console.log(`helpers: ${copied.length} file(s)`)
