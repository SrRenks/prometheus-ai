/**
 * What belongs in an installed preset directory, and which dsh-unrestricted
 * versions can run against this dsh.
 *
 * TWO RULES THE README STATES AND NOTHING APPLIED.
 *
 * 1. `dsh-unrestricted` below 0.1.9 calls `ctx.settings.register`, which the
 *    current `dsh-settings` does not expose: its service offers `configure`, `get`
 *    and `update`. A profile pinned below that installs cleanly and then fails at
 *    activation, which reads as "incompatible with dsh" rather than "stale pin".
 *    The README claimed the floor applied to every profile while no code checked
 *    it, so the next machine learned it from a crash instead of from `install.sh`.
 *
 * 2. The installed preset directory was written with `cp -f` and never pruned, so
 *    a module the recipe no longer names stayed there forever, and the bundle
 *    builder then carried it into every profile. That is how two modules of a
 *    plugin deleted on 2026-10-02 kept travelling. The builder prunes by the
 *    import closure now; this applies the same rule one step earlier, where the
 *    copies are made.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** The oldest `dsh-unrestricted` that runs against a dsh with the current settings service. */
export const FLOOR = '0.1.9'

/** The dependency a profile declares to mount the plugin. */
export const PACKAGE = 'dsh-unrestricted'

/**
 * Parse a version out of a dependency spec.
 *
 * Accepts an exact version, a semver range prefix, and the `#tag` of a GitHub
 * spec. A spec naming no version parses as undefined, which the caller reports
 * rather than guessing, because a pin nobody can read is the case worth seeing.
 *
 * @param spec - the dependency spec.
 * @returns the version, or undefined.
 */
export function versionFromSpec(spec) {
  if (typeof spec !== 'string') return undefined
  const at = /#([^#]*)$/.exec(spec)
  const candidate = at === null ? spec : at[1]
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(candidate)
  return match === undefined || match === null ? undefined : `${match[1]}.${match[2]}.${match[3]}`
}

/**
 * The version a `file:` spec points at, read from the package it names.
 *
 * A local dependency carries no version in its spec, and on a machine set up this
 * way that is the normal shape rather than an oddity: both profiles here declare
 * `file:~/dsh-unrestricted-renks`. Reporting that as unreadable would fail the
 * check on a correct setup, which is the worst outcome for a check whose whole
 * purpose is to be believed. The version is read from the package's own manifest,
 * and `packageDir` is derived from the spec rather than from the profile's
 * `node_modules`, so the two cannot disagree after an install that lagged.
 *
 * @param spec - the dependency spec.
 * @param profileDir - the profile directory, for a relative spec.
 * @returns the version, or undefined.
 */
export function versionFromLocalSpec(spec, profileDir) {
  const match = /^file:(.+)$/.exec(String(spec ?? ''))
  if (match === null) return undefined
  const raw = match[1]
  const dir = raw.startsWith('/') ? raw : join(profileDir, raw)
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return versionFromSpec(manifest.version)
  } catch {
    return undefined
  }
}

/**
 * Compare two dotted versions.
 *
 * @param a - the first version.
 * @param b - the second version.
 * @returns negative when a is lower, zero when equal, positive when higher.
 */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

/**
 * Check one profile's `dsh-unrestricted` pin against the floor.
 *
 * @param manifest - the profile's parsed `package.json`.
 * @param profileDir - the profile directory, needed for a `file:` spec.
 * @returns `{ status, spec, version, source }` where status is ok, below,
 *   unreadable, or absent.
 */
export function checkProfilePin(manifest, profileDir) {
  const spec = manifest?.dependencies?.[PACKAGE]
  if (spec === undefined) return { status: 'absent', spec: undefined, version: undefined }
  const pinned = versionFromSpec(spec)
  const version = pinned ?? versionFromLocalSpec(spec, profileDir)
  if (version === undefined) return { status: 'unreadable', spec, version: undefined }
  return {
    status: compareVersions(version, FLOOR) < 0 ? 'below' : 'ok',
    spec,
    version,
    source: pinned === undefined ? 'local package' : 'spec',
  }
}

/**
 * Should this profile be checked at all?
 *
 * The marker is the same one `install.sh` uses to tell this setup's profiles from
 * somebody else's: a profile naming `dsh-unrestricted` belongs to this setup, and
 * one that does not is left alone.
 *
 * @param manifest - the profile's parsed `package.json`.
 * @returns true when the profile declares the plugin.
 */
export function profileUsesPlugin(manifest) {
  return manifest?.dependencies?.[PACKAGE] !== undefined
}

/**
 * Every `.mjs` a composition reaches, following relative imports.
 *
 * @param dir - the installed preset directory.
 * @param entryNames - module names the composition references.
 * @returns `{ names }`, or `{ error }` naming the unresolved reference.
 */
export async function reachableModules(dir, entryNames) {
  const seen = new Set()
  const queue = [...entryNames]
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    const path = join(dir, name)
    if (!existsSync(path)) return { error: `${name} is referenced but not present in ${dir}` }
    seen.add(name)
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(/from\s+'\.\/([\w.-]+\.mjs)'/g)) queue.push(match[1])
  }
  return { names: [...seen].sort() }
}

/**
 * The helper modules a composition references.
 *
 * @param composition - the preset's `agent.cordis.yml`.
 * @returns the referenced module names.
 */
export function referencedHelpers(composition) {
  const names = new Set()
  for (const match of composition.matchAll(/name:\s*\.\/([\w.-]+\.mjs)/g)) names.add(match[1])
  return [...names]
}

/**
 * Remove `.mjs` files the composition cannot reach.
 *
 * Only `.mjs` is touched: the directory also holds `preset.yml`, the composed
 * `agent.cordis.yml` and whatever backup the installer left, and none of those is
 * a helper.
 *
 * @param dir - the installed preset directory.
 * @param composition - the preset's `agent.cordis.yml`.
 * @returns `{ pruned, error }`.
 */
export async function pruneHelpers(dir, composition) {
  const reachable = await reachableModules(dir, referencedHelpers(composition))
  if (reachable.error !== undefined) return { pruned: [], error: reachable.error }
  const pruned = []
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith('.mjs')) continue
    if (reachable.names.includes(entry)) continue
    await rm(join(dir, entry))
    pruned.push(entry)
  }
  return { pruned }
}
