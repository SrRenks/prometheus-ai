#!/usr/bin/env node
/**
 * Verify the docs gate against the REAL host filesystem, not a fake seam.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE SUITE. `docs-gate.spec.mjs` drives the
 * gate through a fabricated fs seam, which is what makes it fast and hermetic.
 * That is also its blind spot: three production defects on 2026-10-02 all lived
 * in the assumptions the fake seam shared with the code, so the suite passed
 * while every mutation in every workspace was denied. The bug that mattered was
 * "the real backend reports absent paths with a code we did not expect", which
 * a fake seam cannot report because the fake is written by the same hand.
 *
 * This script closes that gap by probing the actual filesystem: the real
 * `node:fs` error codes, a real directory with no VCS marker, and a real config
 * checkout. It asserts the observed behaviour, so a backend change that breaks
 * the gate's absent/failure discrimination fails here.
 *
 * Run after any change to the gate:
 *   node tools/verify-docs-gate.mjs
 *
 * Exit code is non-zero when any check fails.
 */
import { stat } from 'node:fs/promises'

import {
  REQUIRED_DOCS,
  apply,
  findWorkspaceRoot,
  isFailureError,
  resolveRequiredDocs,
} from '../agents/dsh/presets/renks/docs-gate.mjs'

/** A workspace with no `.git` anywhere above it, so the root walk fails. */
const NO_MARKER_WORKSPACE = '/tmp'
/** A path that exists in every checkout of this config. */
const CONFIG_ROOT = process.env.AGENT_CONFIG ?? `${process.env.HOME}/.config/agent-config`

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

/**
 * The real seam: resolve reports a missing path by THROWING, with whatever code
 * this host's backend chose. Wrapping it is the point, because the code is not
 * ours to choose.
 *
 * @param path - absolute path to probe.
 * @returns a target whose `stat` behaves like the host's.
 */
const realSeam = {
  // The service contract: `resolve(path)` yields an opaque target with no
  // methods, and `stat(target)` is a method of the SERVICE. Omitting `resolve`
  // here made every probe fail, which the gate correctly read as "no docs" and
  // opened. A verifier with a wrong seam verifies nothing.
  resolve: async (path) => ({ targetKey: path, displayPath: path }),
  stat: async (targetOrPath) => {
    const path = typeof targetOrPath === 'string' ? targetOrPath : targetOrPath?.targetKey
    try {
      const info = await stat(path)
      return { type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other' }
    } catch {
      return undefined
    }
  },
}

/**
 * Mount the deployed plugin over a given seam.
 *
 * @param resolveImpl - the fs seam to inject.
 * @param repoRoots - config roots to probe.
 * @returns a function running one `tools/pre-execute` waterfall.
 */
function mount(resolveImpl, repoRoots = [CONFIG_ROOT]) {
  const listeners = new Map()
  const warns = []
  apply({
    logger: { warn: (message) => warns.push(message) },
    on(name, handler) {
      listeners.set(name, [...(listeners.get(name) ?? []), handler])
      return () => {}
    },
    get: () => resolveImpl,
  }, { repoRoots })
  const run = async (exec) => {
    let index = -1
    const dispatch = async () => {
      index += 1
      const handlers = listeners.get('tools/pre-execute') ?? []
      if (index >= handlers.length) return { kind: 'allow' }
      return handlers[index](exec, dispatch)
    }
    return { decision: await dispatch(), warns }
  }
  return run
}

/** An agent-shaped object with no parent. */
const agent = (id, cwd) => ({ session: { id, header: { cwd } }, parentAgent: undefined })

console.log(`config root: ${CONFIG_ROOT}`)
console.log(`markerless workspace: ${NO_MARKER_WORKSPACE}`)

console.log('\nabsent paths are reported as absent, whatever code the backend uses')
check('an unknown absent code is NOT a failure', isFailureError({ code: 'BACKEND_SPECIFIC_ABSENT' }) === false)
check('a permission error IS a failure', isFailureError({ code: 'EACCES' }) === true)

console.log('\nthe workspace walk survives a directory with no VCS marker')
{
  const found = await findWorkspaceRoot(realSeam, NO_MARKER_WORKSPACE, undefined)
  check('it returns instead of throwing', found !== undefined, JSON.stringify(found))
  check('and it reports that no marker identified the root', found.found === false, `root=${found.root}`)
}

console.log('\nthe shared docs resolve without any workspace root')
{
  const docs = await resolveRequiredDocs({ seam: realSeam, workspaceRoot: undefined, repoRoots: [CONFIG_ROOT], signal: undefined })
  const count = (docs.configDocs ?? []).length
  // The registry is the source of truth, so adding a doc must not fail this.
  check('every registry doc is found', count === REQUIRED_DOCS.length, `${count}/${REQUIRED_DOCS.length}`)
  const tiers = new Set((docs.configDocs ?? []).map(doc => doc.tier))
  check('and each carries its tier', tiers.has('core') && tiers.has('code') && tiers.has('language'), [...tiers].join(','))
}

console.log('\na mutation with no boundary is still gated')
{
  const run = mount(realSeam)
  const { decision } = await run({
    name: 'edit',
    arguments: { file_path: `${NO_MARKER_WORKSPACE}/escape-probe.txt` },
    agent: agent('verify-no-marker', NO_MARKER_WORKSPACE),
  })
  check('an edit above cwd is denied', decision.kind === 'deny', decision.kind)
  check('with the read-the-docs denial, not a resolution failure', /blocked once per session/.test(decision.reason ?? ''))
  check('and resolution did not fail', !/could not be resolved/.test(decision.reason ?? ''))
}

console.log('\na target outside an identified boundary is left alone')
{
  const run = mount(realSeam)
  const { decision } = await run({
    name: 'edit',
    arguments: { file_path: '/tmp/another-checkout/file.ts' },
    agent: agent('verify-boundary', `${CONFIG_ROOT}/core`),
  })
  check('an edit in a different workspace is allowed', decision.kind === 'allow', decision.kind)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
