/**
 * instruction-hint behaviour.
 *
 * WHY THIS FILE EXISTS LATE. The gate had 34 tests and the hint had none, and
 * the hint is the plugin that broke silently for three rounds: with the wrong fs
 * seam its probes returned nothing, `sections` came back empty, and it emitted
 * no hint while reporting no error. Nothing noticed because nothing tested it.
 *
 * These cases drive the plugin through its real entry point with the SERVICE
 * fs contract (resolve returns an opaque target, stat is a method of the
 * service), and they cover the two things that were invisible:
 *
 *   1. the hint needs TWO requests — the first records no tool call, so the
 *      promotion gate is still closed;
 *   2. an emission that cannot complete must not silence the session forever.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from './instruction-hint.mjs'

const CWD = '/work/project'
const DSH_HOME = '/home/tester/.dsh'

// The plugin resolves the user-global instruction file through `$DSH_HOME`, so
// the fixture has to pin it: otherwise the case depends on whichever home the
// machine running the suite happens to have, and passes or fails by accident.
process.env.DSH_HOME = DSH_HOME

/**
 * A stand-in for the filesystem service, modelling BOTH calls.
 *
 * @param files - absolute paths that exist.
 * @param options.failResolve - make `resolve` throw instead of reporting absence.
 * @returns the service surface the plugin consumes.
 */
function fakeFs(files, { failResolve = false } = {}) {
  const set = new Set(files)
  const isDir = (path) => [...set].some(file => file.startsWith(`${path}/`))
  return {
    async resolve(path) {
      if (failResolve) throw new Error('fs unavailable')
      return { targetKey: path, displayPath: path }
    },
    async stat(target) {
      const path = typeof target === 'string' ? target : target?.targetKey
      if (set.has(path)) return { type: 'file' }
      if (isDir(path)) return { type: 'directory' }
      return undefined
    },
  }
}

/**
 * Mount the plugin and expose a driver that runs one `agent/pre-step`.
 *
 * @param options.fs - the fs service to inject, or undefined to omit it.
 * @param options.warnings - collects logger warnings.
 * @returns `{ session, run }` where `run` performs one request.
 */
function mount({ fs = fakeFs([`${DSH_HOME}/AGENTS.md`]), warnings = [] } = {}) {
  const handlers = new Map()
  const ctx = {
    logger: { warn: (m) => warnings.push(m), info() {}, debug() {} },
    on(name, fn) { handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    get(name) { return name === 'fs' ? fs : undefined },
  }
  apply(ctx, { promoteOn: 'tool-call', includeSubagents: true })

  const session = { id: 'spec-session', header: { cwd: CWD }, events: [] }
  const agent = { session, ctx: {}, parentAgent: undefined }
  const onEvent = (handlers.get('session/event') ?? [])[0]
  const preStep = (handlers.get('agent/pre-step') ?? [])[0]

  /**
   * Record a durable event and feed the incremental observer, as the host does.
   * @param event - the session event.
   */
  const land = async (event) => {
    session.events.push(event)
    if (onEvent !== undefined) await onEvent(session, event)
  }

  /** Run one request; returns the hint messages it produced. */
  const run = async () => {
    const out = await preStep({ agent, signal: undefined }, async () => ({ messages: [] }))
    return (out.messages ?? []).filter(m => m.source?.kind === 'instruction-hint')
  }
  return { session, run, land, warnings }
}

/** Open the promotion gate the way a live session does. */
const openGate = (h) => h.land({ seq: 1, type: 'tool/call', data: { name: 'bash' } })

test('no hint on the first request, one on the second', async () => {
  // Invisible constraint worth pinning: the hint is attached to a request, and
  // the first request of a session has no tool call yet. A one-request session
  // therefore never receives it, which looks like a bug and is not one.
  const h = mount()
  assert.deepEqual(await h.run(), [], 'the first request has no promotion signal')

  await openGate(h)
  const hints = await h.run()
  assert.equal(hints.length, 1, 'the second request carries exactly one hint')
})

test('the hint names the tiered docs, the commit trigger and the languages', async () => {
  const h = mount()
  await openGate(h)
  const [hint] = await h.run()
  const text = hint.content.map(block => block.text ?? '').join('')

  assert.match(text, /AGENTS\.md/, 'it reports the instruction file it found')
  assert.match(text, /core\/principles\.md/, 'the always-on rule')
  assert.match(text, /core\/docs\/complexity\.md/, 'the source tier')
  assert.match(text, /core\/docs\/git-workflow\.md/, 'the commit trigger')
  assert.match(text, /languages/, 'the language guides')
  assert.match(text, /docs-gate/, 'and it points at the enforcement')
})

test('the hint is emitted once per session', async () => {
  const h = mount()
  await openGate(h)
  assert.equal((await h.run()).length, 1)
  assert.deepEqual(await h.run(), [], 'a later request must not repeat it')
  assert.deepEqual(await h.run(), [])
})

test('the hint needs no session/event dispatch to fire', async () => {
  // Why this case exists: the plugin was mute in EVERY live session while its
  // log was complete and it rendered correctly in isolation. The promotion
  // signal was fed only by the host's `session/event` dispatch, which the live
  // run never delivered. The durable log is now the source of truth, so the
  // hint must appear even when nothing feeds the observer.
  const handlers = new Map()
  const ctx = {
    logger: { warn() {}, info() {}, debug() {} },
    on(name, fn) { handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    get: (name) => (name === 'fs' ? fakeFs([`${DSH_HOME}/AGENTS.md`]) : undefined),
  }
  apply(ctx, { promoteOn: 'tool-call', includeSubagents: true })
  assert.equal(handlers.has('session/event'), true, 'the plugin still registers the feed')

  const session = { id: 'no-feed', header: { cwd: CWD }, events: [] }
  const agent = { session, ctx: {}, parentAgent: undefined }
  const preStep = (handlers.get('agent/pre-step') ?? [])[0]
  const run = async () => {
    const out = await preStep({ agent, signal: undefined }, async () => ({ messages: [] }))
    return (out.messages ?? []).filter(m => m.source?.kind === 'instruction-hint')
  }

  assert.deepEqual(await run(), [], 'first request: nothing to promote yet')

  // The tool call lands in the durable log ONLY. No observe() call, exactly as
  // the live host behaved.
  session.events.push({ seq: 1, type: 'tool/call', data: { name: 'read' } })

  assert.equal((await run()).length, 1, 'the durable log alone must open the gate')
})

test('a compaction boundary still suppresses the hint after promotion', async () => {
  // The self-sufficient rescan must not lose the compaction rule: a signal
  // recorded before the boundary does not count after it.
  const h = mount()
  await h.land({ seq: 1, type: 'tool/call', data: { name: 'read' } })
  await h.land({ seq: 2, type: 'compaction/end', data: {} })
  assert.deepEqual(await h.run(), [], 'the promotion signal predates the boundary')

  await h.land({ seq: 3, type: 'tool/call', data: { name: 'read' } })
  assert.equal((await h.run()).length, 1, 'a signal after the boundary promotes again')
})

test('a transient probe failure does not consume the session\'s one hint', async () => {
  // The bug this test exists for: the session was claimed BEFORE the hint was
  // built, so an emission that could not complete silenced that session
  // permanently, with no log and no retry. The seam starts broken and is then
  // repaired, which is what a transient filesystem failure looks like.
  let broken = true
  const flaky = {
    async resolve(path) {
      if (broken) throw new Error('fs unavailable')
      return { targetKey: path, displayPath: path }
    },
    async stat(target) {
      const path = typeof target === 'string' ? target : target?.targetKey
      return path === `${DSH_HOME}/AGENTS.md` ? { type: 'file' } : undefined
    },
  }
  const h = mount({ fs: flaky })
  await openGate(h)

  assert.deepEqual(await h.run(), [], 'a broken seam yields no hint and does not crash')

  broken = false
  const recovered = await h.run()
  assert.equal(recovered.length, 1, 'the repaired seam still gets its hint')
})

test('a session with nothing to report is claimed once and not retried', async () => {
  // The other side of the claim: a DEFINITIVE "there are no instruction files"
  // must be recorded, or every request re-walks the filesystem forever.
  const h = mount({ fs: fakeFs([]) })
  await openGate(h)
  assert.deepEqual(await h.run(), [], 'nothing to report')
  assert.deepEqual(await h.run(), [], 'and nothing to report again')
})

test('the hint survives a filesystem that reports absence by returning undefined', async () => {
  // The real service returns undefined for an absent target; it does not throw.
  // A seam that only coped with throws would find no files and emit nothing.
  const h = mount({ fs: fakeFs([`${CWD}/AGENTS.md`]) })
  await openGate(h)
  const hints = await h.run()
  assert.equal(hints.length, 1, 'a project-root AGENTS.md is reported')
  const text = hints[0].content.map(b => b.text ?? '').join('')
  assert.match(text, /Workspace instruction files exist/, 'reported as a project file')
})
