/**
 * Locate dsh's installed `standard` preset recipe and return it in the bare-list
 * shape this repository's recipe tools model.
 *
 * WHY THIS MODULE EXISTS. Two tools independently probed for the stock recipe and
 * both assumed the pre-0.2.0 layout: a directory preset at
 * `<dshHome>/profiles/**\/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml`.
 * dsh 0.2.0 does not ship that. Presets became loader patch files inside the dsh
 * installation itself, at
 * `<dsh install>/@deepseek-ai/dsh-web-app/presets/<id>.patch.yml`, with the plugin
 * list at `insert[0].config.plugins`. On a 0.2.0 machine the old probe returned
 * nothing every time, so `build-preset-recipe.mjs` exited 1 and `install.sh`
 * installed its fallback recipe on every run while reporting success. The merge
 * path had stopped executing and nothing said so.
 *
 * One resolver serves both tools so the extraction cannot drift between them.
 *
 * THE SHAPE. The returned text is the plugin entry list de-indented to column 0,
 * which is what the recipe files in `agents/dsh/presets/renks/` hold and what
 * `indentPlugins()` in `agents/dsh/build-preset-bundle.mjs` re-indents on the way
 * back out. Those two are inverses and must stay that way: same ten spaces, same
 * treatment of blank lines.
 */
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

/** Indentation of a plugin row inside the shipped patch file. */
const ITEM_INDENT = 10

/** The legacy directory-preset path, still probed first so an older dsh works. */
const LEGACY_SUFFIX = join('@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')

/** Where the 0.2.0 layout keeps the shipped `standard` declaration. */
const SHIPPED_MODULE = '@deepseek-ai/dsh-web-app'
const SHIPPED_SUFFIX = join('presets', 'standard.patch.yml')

const require_ = createRequire(import.meta.url)

/**
 * The argument of the launcher shim's `# cmd-shim-target=` line.
 *
 * pnpm writes that line; npm instead links the launcher at the entry. Both shapes
 * are read here, the same way the version-floor guard in `agents/dsh/install.sh`
 * reads them, so the two agree about which dsh is running.
 *
 * @param launcher - the absolute path of the `dsh` launcher.
 * @returns the CLI entry path, or undefined.
 */
function entryFromShim(launcher) {
  if (!existsSync(launcher)) return undefined
  const text = readFileSync(launcher, 'utf8')
  const named = /^#\s*cmd-shim-target=(.+)$/m.exec(text)
  if (named !== null) return named[1].trim()
  // An npm-style launcher is a symlink to the entry, sometimes relative.
  try {
    const linked = readlinkSync(launcher)
    return linked.startsWith('/') ? linked : resolve(dirname(launcher), linked)
  } catch {
    return undefined
  }
}

/**
 * Where the running `dsh` keeps its packages, derived from the launcher.
 *
 * @param whichDsh - the launcher path, usually from `command -v dsh`.
 * @returns the directory to resolve the shipped preset module from, or undefined.
 */
export function dshInstallDir(whichDsh) {
  if (whichDsh === undefined || whichDsh.length === 0) return undefined
  const entry = entryFromShim(whichDsh)
  if (entry === undefined || !existsSync(entry)) return undefined
  return dirname(entry)
}

/**
 * The legacy recipe, when an older dsh has one installed.
 *
 * @param dshHome - the dsh home directory.
 * @returns the absolute path, or undefined.
 */
export function findLegacyRecipe(dshHome) {
  const candidates = []
  const profilesDir = join(dshHome, 'profiles')
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(profilesDir, entry.name, 'node_modules', LEGACY_SUFFIX))
    }
  }
  candidates.push(join(profilesDir, 'node_modules', LEGACY_SUFFIX))
  return candidates.find(candidate => existsSync(candidate))
}

/**
 * Pull the plugin entry list out of a shipped preset patch file.
 *
 * The file wraps the list in `- insert:` / `config:` / `plugins:`, so the list is
 * every line after `plugins:` that is indented deeper than it, with one level
 * removed. It is the exact inverse of `indentPlugins()`, including blank-line
 * handling, and a mismatch between the two would produce a recipe that mounts
 * differently than it reads.
 *
 * @param text - the patch file's contents.
 * @returns the bare-list text, or undefined when the file has no plugin list.
 */
export function extractPluginList(text) {
  const lines = text.split('\n')
  const marker = lines.findIndex(line => line.trimEnd() === ' '.repeat(ITEM_INDENT - 2) + 'plugins:')
  if (marker < 0) return undefined
  const body = lines.slice(marker + 1)
  const after = body.findIndex(line => line.trim().length > 0 && !line.startsWith(' '.repeat(ITEM_INDENT)))
  const rows = after < 0 ? body : body.slice(0, after)
  const dedented = rows
    .filter(line => line.trim().length > 0)
    .map(line => (line.length >= ITEM_INDENT ? line.slice(ITEM_INDENT) : line))
  if (dedented.length === 0) return undefined
  return `${dedented.join('\n')}\n`
}

/**
 * Find `@deepseek-ai/dsh-web-app` from the dsh entry, under either packager.
 *
 * A plain `require.resolve` from a path next to the entry is NOT enough, and the
 * reason is worth writing down because it cost a wrong first attempt: pnpm keeps
 * the real package in `node_modules/.pnpm/<name>@<version>_<hash>/node_modules/`
 * and the entry's own tree reaches it through nested links that only resolve from
 * inside that tree. The same call run from this repository fails with
 * MODULE_NOT_FOUND while a shell `node -e` in the entry's directory succeeds.
 *
 * So both layouts are probed by walking up from the entry and looking for the
 * package directory itself: the flat one npm produces, then pnpm's versioned
 * store entries. Newest version first, because a store can hold several.
 *
 * @param installDir - the directory holding the dsh entry.
 * @returns the absolute patch file path, or undefined.
 */
function findShippedPreset(installDir) {
  const relative = join('@deepseek-ai', 'dsh-web-app', SHIPPED_SUFFIX)
  const found = []
  let dir = installDir
  for (let depth = 0; depth < 6; depth += 1) {
    const flat = join(dir, 'node_modules', relative)
    if (existsSync(flat)) found.push(flat)
    const store = join(dir, 'node_modules', '.pnpm')
    if (existsSync(store)) {
      for (const name of readdirSync(store)) {
        if (!name.startsWith('@deepseek-ai+dsh-web-app@')) continue
        found.push(join(store, name, 'node_modules', relative))
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const present = found.filter(candidate => existsSync(candidate))
  if (present.length === 0) return undefined
  // Highest version wins: the `.pnpm/<name>@<version>_<hash>` directory sorts by
  // the version inside its name, and a numeric-aware compare keeps 0.10 above 0.9.
  return present.sort((a, b) => versionOf(b) - versionOf(a))[0]
}

/** The version embedded in a pnpm store path, as a comparable number. */
function versionOf(path) {
  const match = /dsh-web-app@(\d+)\.(\d+)\.(\d+)/.exec(path)
  if (match === null) return -1
  return Number(match[1]) * 1e6 + Number(match[2]) * 1e3 + Number(match[3])
}

/**
 * Locate the shipped 0.2.0 declaration from the running dsh.
 *
 * @param whichDsh - the launcher path, or undefined to resolve `dsh` on PATH.
 * @returns `{ text, path, layout }`, or `{ error, hint }`.
 */
function resolveShipped(whichDsh) {
  const installDir = dshInstallDir(whichDsh ?? whichOnPath('dsh'))
  if (installDir === undefined) {
    return { error: 'the dsh launcher could not be resolved, so its install tree is unknown' }
  }
  const shipped = findShippedPreset(installDir)
  if (shipped === undefined) {
    return {
      error: `${SHIPPED_MODULE} was not found from ${installDir}`,
      hint: 'that package carries the shipped presets; check the dsh installation is complete',
    }
  }
  const text = extractPluginList(readFileSync(shipped, 'utf8'))
  if (text === undefined) {
    return { error: `${shipped} has no config.plugins list`, hint: 'the shipped preset format changed again' }
  }
  return { text, path: shipped, layout: 'shipped-patch' }
}

/**
 * Resolve the stock recipe for the dsh that is actually installed.
 *
 * THE INSTALLED DSH DECIDES THE LAYOUT, and the order is shipped-first for that
 * reason. Probing legacy paths first looks like the careful choice and is the
 * wrong one: a machine can carry BOTH. This one does, because an older dsh owns
 * `$DSH_HOME/profiles/tui/` and left
 * `@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml` in it, byte
 * identical to this repository's stale 262-line baseline. Reading that file means
 * merging against a composition the running dsh does not use, which is the exact
 * drift this module was written to end. Whichever process consumes the result is
 * talking to the dsh on PATH, so that dsh's own shipped preset is the authority.
 * The legacy probe stays as the fallback that keeps an older dsh working.
 *
 * @param options.dshHome - the dsh home directory.
 * @param options.whichDsh - the launcher path; defaults to resolving `dsh` on PATH.
 * @returns `{ text, path, layout }`, or `{ error, hint }`.
 */
export function resolveStock({ dshHome, whichDsh } = {}) {
  const home = dshHome ?? process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
  const shipped = resolveShipped(whichDsh)
  if (shipped.error === undefined) return shipped

  const legacy = findLegacyRecipe(home)
  if (legacy !== undefined) {
    // The legacy file already IS the entry list, so it needs no extraction.
    return { text: readFileSync(legacy, 'utf8'), path: legacy, layout: 'legacy-directory' }
  }

  return {
    ...shipped,
    hint: `${shipped.hint ?? ''} No legacy directory preset was found under ${join(home, 'profiles')} either.`.trim(),
  }
}

/** The first `name` on PATH, without shelling out. */
function whichOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir.length === 0) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
