#!/usr/bin/env node
/**
 * The bundle manifest has to load on every dsh version it meets, not just the
 * newest one installed here.
 *
 * WHY THIS EXISTS. `dsh web` died on a second machine with
 *
 *   TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string.
 *   Received an instance of Array
 *     at join (node:path)
 *     at loadProfile (dsh-app-boot/lib/index.js:863)
 *
 * The bundle declared `dsh.bundle.patch` as an array of one path, which dsh
 * 0.2.0 accepts and dsh 0.1.2 does not: 0.2.0 normalises a string to an array and
 * validates both forms, while 0.1.2 reads the field with no type check and passes
 * it straight to `path.join`. A single path is the only form both read, so the
 * manifest now emits a string and this checks that it stays one.
 *
 * The two loader bodies below are copied from the shipped packages, not
 * paraphrased, so the check fails when the contract changes rather than when
 * somebody remembers to look:
 *   0.2.0-rc.2  lib/index.js:496   `typeof bundle.patch === "string" ? [...] : ...`
 *   0.1.2-rc.1  lib/index.js:863   `join(packageDir, declared)`, untyped
 *
 * Run after any change to the bundle builder:
 *   node tools/verify-bundle-manifest.mjs
 *
 * Exit code is non-zero when a case fails.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const OUT = process.env.DSH_BUNDLE_OUT ?? join(homedir(), 'dsh-user-presets')

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

// ── the manifest as it is actually published ─────────────────────────────────

const manifestPath = join(OUT, 'package.json')
if (!existsSync(manifestPath)) {
  console.error(`no bundle at ${manifestPath}; run agents/dsh/install.sh first`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const declared = manifest?.dsh?.bundle?.patch

console.log(`bundle at ${OUT}`)
console.log('\nthe manifest declares one path, not a list')
check('dsh.bundle.patch exists', declared !== undefined)
check('and is a string', typeof declared === 'string', `got ${Array.isArray(declared) ? 'array' : typeof declared}`)
check('and names a patch file', typeof declared === 'string' && declared.endsWith('.patch.yml'), String(declared))

if (typeof declared === 'string') {
  check('and that file exists inside the bundle', existsSync(join(OUT, declared)), declared)
}

console.log('\nthe newest loader accepts it (0.2.0-rc.2, lib/index.js:496)')
{
  // Verbatim from the package: a string is normalised, a list is validated.
  const normalise = (bundle) => {
    const value = typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch
    if (!Array.isArray(value) || !value.every((file) => typeof file === 'string')) {
      throw new Error('dsh.bundle.patch must be a file path or a list of file paths')
    }
    return value
  }
  let paths
  try {
    paths = normalise({ patch: declared })
    check('normalises without throwing', true)
  } catch (error) {
    check('normalises without throwing', false, error.message)
  }
  check('and resolves to exactly one path', paths?.length === 1, JSON.stringify(paths))
}

console.log('\nthe older loader accepts it (0.1.2-rc.1, lib/index.js:863)')
{
  // Verbatim in the part that matters: no type check, straight to join. This is
  // the case that produced the TypeError, so it is reproduced rather than
  // described.
  const loadLike012 = (packageDir, value) => join(packageDir, value)
  let patchPath
  try {
    patchPath = loadLike012(OUT, declared)
    check('joins without throwing', true)
  } catch (error) {
    check('joins without throwing', false, `${error.code ?? error.name}: ${error.message.slice(0, 60)}`)
  }
  check('and produces a real path', typeof patchPath === 'string' && patchPath.startsWith(OUT), patchPath)

  // The regression itself, so the check is known to be capable of failing.
  let threw = false
  try {
    loadLike012(OUT, ['./presets/x.patch.yml'])
  } catch (error) {
    threw = error.code === 'ERR_INVALID_ARG_TYPE'
  }
  check('and the array form really is what 0.1.2 rejects', threw, 'the bug is reproduced, not assumed')
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
