#!/usr/bin/env node
/**
 * Report every profile whose `dsh-unrestricted` pin cannot run against this dsh.
 *
 * WHY THIS EXISTS. The README states a version floor and, until this script, no
 * code applied it. `install.sh` wires profiles and syncs bundles and never looked
 * at their dependencies, so a profile pinned below the floor installed without
 * complaint and failed later at activation with `ctx.settings.register is not a
 * function`, which reads as a plugin incompatible with dsh rather than a stale
 * pin. A documented rule with no check is a rule the next machine discovers by
 * crashing.
 *
 * The floor itself lives in `tools/preset-helpers.mjs` next to the parser, so this
 * script and the library cannot disagree about what "below the floor" means.
 *
 * Run it directly, or let `install.sh` call it after step 7:
 *   node tools/check-profile-deps.mjs [--dsh-home <dir>]
 *
 * Exit code is non-zero when a profile is below the floor or its pin is
 * unreadable. A profile that does not name the plugin is skipped, which is what
 * keeps this from commenting on profiles that belong to another setup.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { FLOOR, PACKAGE, checkProfilePin, profileUsesPlugin } from './preset-helpers.mjs'

const args = process.argv.slice(2)
const homeAt = args.indexOf('--dsh-home')
const DSH_HOME = homeAt >= 0 ? args[homeAt + 1] : process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')

const profilesDir = join(DSH_HOME, 'profiles')
if (!existsSync(profilesDir)) {
  console.log(`no profiles under ${profilesDir}; nothing to check`)
  process.exit(0)
}

const rows = []
for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(profilesDir, entry.name, 'package.json')
  if (!existsSync(manifestPath)) continue
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    rows.push({ profile: entry.name, status: 'unreadable', detail: `package.json does not parse: ${error.message}` })
    continue
  }
  if (!profileUsesPlugin(manifest)) continue
  const { status, spec, version, source } = checkProfilePin(manifest, join(profilesDir, entry.name))
  rows.push({ profile: entry.name, status, spec, version, source })
}

const bad = rows.filter(row => row.status === 'below' || row.status === 'unreadable')

console.log(`${PACKAGE} floor check (needs >= ${FLOOR} against this dsh)`)
if (rows.length === 0) {
  console.log(`  no profile declares ${PACKAGE}; nothing to check`)
  process.exit(0)
}
for (const row of rows) {
  const label = row.version === undefined ? row.spec ?? 'no version in the spec' : `${row.version} from ${row.source}`
  console.log(`  ${row.status === 'ok' ? 'pass' : 'FAIL'}  ${row.profile}: ${label}  (${row.status})`)
}

if (bad.length > 0) {
  console.log('')
  console.log(`  Below ${FLOOR} the plugin calls \`ctx.settings.register\`, which this dsh's`)
  console.log('  settings service does not expose. It installs and then fails to activate.')
  console.log('  Fix a profile with:')
  console.log(`    dsh plugin --profile <name> add "${PACKAGE}@github:SrRenks/dsh-unrestricted-renks#v0.2.2-renks.1"`)
  process.exit(1)
}
process.exit(0)
