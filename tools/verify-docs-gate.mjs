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
  // The gate fingerprints CONTENT to decide whether a credit still holds, so the
  // seam must serve it. Without this the verifier passed only because none of its
  // scenarios reached a content check, which is the wrong reason to pass.
  readText: async (targetOrPath) => {
    const { readFile } = await import('node:fs/promises')
    const path = typeof targetOrPath === 'string' ? targetOrPath : targetOrPath?.targetKey
    return await readFile(path, 'utf8')
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

// ── a whole session, from a cold deny to an allow ───────────────────────────
// Everything above probes one decision. This drives the REAL plugin through a
// session's shape: a fresh agent is denied, reading the named docs lifts it, and
// a doc rewritten mid-session loses its credit. It needs no model, because the
// gate is mechanical - every decision depends on the tool call and the ledger,
// never on what an assistant would have said.

/** Mount the real gate and return a driver for one fresh session. */
const mountSession = (sessionId) => {
  const listeners = new Map()
  apply({
    logger: { warn: () => {} },
    on: (name, handler) => {
      listeners.set(name, [...(listeners.get(name) ?? []), handler])
      return () => {}
    },
    get: (name) => (name === 'fs' ? realSeam : undefined),
  }, { repoRoots: [CONFIG_ROOT], extraDocs: [] })

  const agent = { session: { id: sessionId, header: { cwd: NO_MARKER_WORKSPACE } }, parentAgent: undefined }
  /** Run one tool call through the plugin's waterfall. */
  const call = async (exec) => {
    let index = -1
    const next = async () => {
      index += 1
      const handlers = listeners.get('tools/pre-execute') ?? []
      return index >= handlers.length ? { kind: 'allow' } : handlers[index]({ ...exec, agent }, next)
    }
    return next()
  }
  return { call, agent }
}

/** The doc paths a denial names, in the order it names them. */
const demanded = (decision) => (decision.reason ?? '')
  .split('\n')
  .filter(line => /^\s+- /.test(line))
  .map(line => line.trim().slice(2).replace('~/.config/agent-config/', ''))

console.log('\na cold session is denied, and the read it names lifts the gate')
{
  const session = mountSession(`verify-e2e-${Date.now()}`)

  const first = await session.call({ name: 'write', arguments: { file_path: `${NO_MARKER_WORKSPACE}/probe.md` } })
  check('a fresh session is denied on its first mutation', first.kind === 'deny', first.kind)
  const names = demanded(first)
  check('the denial names exactly the core tier for a prose write', names.length === 1 && names[0].endsWith('core/principles.md'), names.join(', '))

  // Read what it asked for, one file at a time, and watch the gate lift.
  for (const [index, relative] of names.entries()) {
    const absolute = `${CONFIG_ROOT}/${relative}`
    const read = await session.call({ name: 'read', arguments: { file_path: absolute } })
    check(`read ${index + 1} of ${names.length} is allowed`, read.kind === 'allow', read.kind)
  }
  const after = await session.call({ name: 'write', arguments: { file_path: `${NO_MARKER_WORKSPACE}/probe.md` } })
  check('and the same mutation is allowed once they are read', after.kind === 'allow', after.kind)
}

console.log('\na source change demands the code tier, a commit demands the commit tier')
{
  const prose = demanded(await mountSession(`verify-prose-${Date.now()}`)
    .call({ name: 'write', arguments: { file_path: `${NO_MARKER_WORKSPACE}/notes.md` } }))
  check('prose asks for one doc', prose.length === 1, prose.join(', '))

  const source = demanded(await mountSession(`verify-source-${Date.now()}`)
    .call({ name: 'edit', arguments: { file_path: `${NO_MARKER_WORKSPACE}/a.ts` } }))
  check('source asks for the code tier', source.length >= 4, source.join(', '))
  check('and no language guide, because TypeScript has none', !source.some(d => d.includes('languages/')), source.join(', '))

  const python = demanded(await mountSession(`verify-py-${Date.now()}`)
    .call({ name: 'edit', arguments: { file_path: `${NO_MARKER_WORKSPACE}/a.py` } }))
  check('Python adds its guide', python.some(d => d.endsWith('languages/python.md')), python.join(', '))

  const commit = demanded(await mountSession(`verify-commit-${Date.now()}`)
    .call({ name: 'bash', arguments: { command: 'git commit -m x' } }))
  check('a commit asks for the commit-time docs', commit.some(d => d.endsWith('git-workflow.md')) && commit.some(d => d.endsWith('ai-writing.md')), commit.join(', '))
  check('and an ordinary edit does not', !prose.some(d => d.endsWith('git-workflow.md')), prose.join(', '))
}

console.log('\na credit follows content, not the mention of a path')
{
  const session = mountSession(`verify-credit-${Date.now()}`)
  const doc = `${CONFIG_ROOT}/core/principles.md`
  const target = { name: 'write', arguments: { file_path: `${NO_MARKER_WORKSPACE}/probe.md` } }

  await session.call({ name: 'read', arguments: { file_path: doc } })
  const held = await session.call(target)
  check('reading the named doc lifts its part of the denial', !demanded(held).includes('core/principles.md'), demanded(held).join(', '))

  const fresh = mountSession(`verify-failed-${Date.now()}`)
  await fresh.call({ name: 'read', arguments: { file_path: `${CONFIG_ROOT}/core/principles.md.backup-does-not-exist` } })
  const afterFailed = await fresh.call(target)
  check('a read of a path that does not exist credits nothing', demanded(afterFailed).includes('core/principles.md'), demanded(afterFailed).join(', '))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
