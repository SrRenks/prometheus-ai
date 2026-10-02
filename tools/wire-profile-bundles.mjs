#!/usr/bin/env node
/**
 * Declare the local preset bundle in every dsh profile, idempotently.
 *
 * WHY THIS IS ITS OWN FILE. `install.sh` writes the bundle, but a profile only
 * mounts a bundle its `package.json` names in TWO places: the `dsh.profile.bundles`
 * array and `dependencies`. Neither is derivable from the other, and a profile
 * missing either one loads nothing while reporting no error, which is the failure
 * mode this whole area keeps producing.
 *
 * The edit is deliberately narrow. It ADDS entries and never rewrites, reorders
 * or removes what is already there, because a profile's package.json also carries
 * its own base bundles and the user's `dsh-unrestricted` row, and a careless
 * "normalise" would be a change to somebody else's setup.
 *
 * For the same reason it only ever touches `dsh-user-presets`, which is the
 * bundle this repository builds. Whether `dsh-unrestricted` is present is a
 * separate repository's business and is reported, not decided, here.
 *
 * A backup of every file it changes is written first, so a bad edit is one `cp`
 * away from undone.
 *
 * Usage:
 *   node tools/wire-profile-bundles.mjs [--dsh-home <dir>] [--bundle <dir>]
 *                                       [--dry-run] [--json]
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The bundle this repository builds, and the only one this script edits. */
const BUNDLE = 'dsh-user-presets'

/**
 * Read the CLI arguments.
 *
 * @returns the DSH home, the bundle directory, and the flags.
 */
function parseArgs() {
  const argv = process.argv.slice(2)
  const home = process.env.HOME ?? ''
  let dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  let bundle = process.env.DSH_BUNDLE_OUT ?? join(home, 'dsh-user-presets')
  let dryRun = false
  let json = false
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--dsh-home') dshHome = resolve(argv[++index])
    else if (argv[index] === '--bundle') bundle = resolve(argv[++index])
    else if (argv[index] === '--dry-run') dryRun = true
    else if (argv[index] === '--json') json = true
  }
  return { dshHome, bundle, dryRun, json }
}

/**
 * What this script may do to one profile, decided before it does anything.
 *
 * The rule is deliberately narrow: COMPLETE a profile that already refers to the
 * bundle, never INTRODUCE it to one that does not. A profile with no mention of
 * `dsh-user-presets` is somebody else's configuration - this machine has a `tui`
 * profile running `dsh-cc-tui` and `dsh-auto-mode` - and adding a preset to it
 * would be a change to a setup this repository does not own.
 *
 * @param manifest - the parsed `package.json`.
 * @returns 'complete' when an entry is missing, 'already declared' when nothing
 *   is needed, or 'not ours' when the profile never referred to the bundle.
 */
function classify(manifest) {
  const profile = manifest?.dsh?.profile
  if (profile === undefined || typeof profile !== 'object') return 'not ours'
  if (!Array.isArray(profile.bundles)) return 'not ours'
  const dependencies = manifest.dependencies ?? {}
  const refers = profile.bundles.includes(BUNDLE) || BUNDLE in dependencies
  if (!refers) return 'not ours'
  const hasBundle = profile.bundles.includes(BUNDLE)
  const hasDep = typeof dependencies[BUNDLE] === 'string'
  return hasBundle && hasDep ? 'already declared' : 'complete'
}

/**
 * Return the manifest with the bundle declared in both places.
 *
 * Mutates nothing, and returns a new object so the caller can skip the write when
 * {@link classify} said there was nothing to do.
 *
 * @param manifest - the parsed `package.json`.
 * @param bundlePath - absolute path the `file:` dependency should name.
 * @returns the updated manifest.
 */
function complete(manifest, bundlePath) {
  const profile = manifest.dsh.profile
  const dependencies = manifest.dependencies ?? {}
  return {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: {
        ...profile,
        bundles: profile.bundles.includes(BUNDLE) ? profile.bundles : [...profile.bundles, BUNDLE],
      },
    },
    dependencies: {
      ...dependencies,
      // Leave a dependency that names a different directory alone: it may point
      // at a bundle this script was not told about.
      [BUNDLE]: typeof dependencies[BUNDLE] === 'string' ? dependencies[BUNDLE] : `file:${bundlePath}`,
    },
  }
}

const { dshHome, bundle, dryRun, json } = parseArgs()
const profilesRoot = join(dshHome, 'profiles')

if (!existsSync(profilesRoot)) {
  console.error(`no profiles directory at ${profilesRoot}`)
  process.exit(2)
}

const bundleReady = existsSync(join(bundle, 'package.json'))
const results = []

for (const entry of readdirSync(profilesRoot)) {
  const manifestPath = join(profilesRoot, entry, 'package.json')
  if (!existsSync(manifestPath)) continue

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    results.push({ profile: entry, state: 'unreadable', detail: String(error.message ?? error) })
    continue
  }

  const verdict = classify(manifest)
  if (verdict !== 'complete') {
    results.push({ profile: entry, state: verdict })
    continue
  }

  if (dryRun) {
    results.push({ profile: entry, state: 'would complete', detail: `file:${bundle}` })
    continue
  }
  const updated = complete(manifest, bundle)

  const backup = `${manifestPath}.bak-${Date.now()}`
  copyFileSync(manifestPath, backup)
  writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`)
  results.push({ profile: entry, state: 'completed', detail: `backup at ${backup}` })
}

if (json) {
  console.log(JSON.stringify({ dshHome, bundle, bundleReady, results }, null, 2))
  process.exit(0)
}

if (!bundleReady) {
  console.log(`  [warn] no bundle at ${bundle} yet; run agents/dsh/install.sh first`)
}
for (const result of results) {
  const detail = result.detail === undefined ? '' : ` (${result.detail})`
  const tag = result.state === 'completed' ? 'ok' : result.state === 'unreadable' ? 'warn' : 'skip'
  console.log(`  [${tag}] ${result.profile}: ${result.state}${detail}`)
}

const declared = results.filter(result => result.state === 'completed' || result.state === 'would complete').length
// A bundle declared but never installed mounts nothing, so say so rather than
// leaving the profile looking configured.
if (declared > 0 && !dryRun) {
  console.log(`  [info] run \`pnpm install\` in the profile${declared > 1 ? 's' : ''} above to mount the bundle`)
}
