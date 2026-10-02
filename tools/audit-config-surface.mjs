#!/usr/bin/env node
/**
 * Count surfaces across the whole configuration, and report what backs each one.
 *
 * WHY THIS EXISTS. Every claim about this config has been hand-checked so far,
 * which is slow and does not survive the next change. This turns the recurring
 * questions into numbers: how many files exist per family, how many carry a
 * mechanical control behind them, how many have a caller but no control, and
 * whether the deployed copies match the repository.
 *
 * A FIRST VERSION OF THIS REPORTED FOUR WRONG THINGS, and the corrections are
 * the reason the checks are written the way they are:
 *   - it looked for the dsh wiring in `setup.sh`, which does not install dsh at
 *     all; `agents/dsh/install.sh` does. It reported the one harness with a real
 *     gate as unwired.
 *   - it resolved a control directory one level too deep, so every command and
 *     hook looked like an orphan.
 *   - it did not know frontmatter activation in the two forms that exist: glob
 *     activation for harness rules, and name/description discovery for skills
 *     and commands. It counted all fifteen as unreferenced prose.
 * The lesson is the one this repo keeps relearning: a check built from what the
 * code is ASSUMED to look like certifies nothing.
 *
 * WHAT IT COUNTS:
 *   - files per family, from `git ls-files`, so scratch never inflates a count
 *   - CONTROLLED: something acts without the agent's cooperation. A gate entry,
 *     a hook, a rule a harness activates by glob, a file a harness discovers by
 *     convention or by frontmatter.
 *   - PROSE ONLY: callers exist and every one is a sentence asking the agent to
 *     go read the file. `ai-writing.md` sat here until 2026-10-02, which is why
 *     the number is worth watching.
 *   - ORPHAN: no control AND no caller.
 *
 * Usage: node tools/audit-config-surface.mjs [--json] [--root <path>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : join(HERE, '..'))
const JSON_OUT = process.argv.includes('--json')
const HOME = process.env.HOME ?? ''

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })

/** Every tracked path, so nothing untracked skews a count. */
const tracked = git(['ls-files']).split('\n').filter(Boolean)

/** File contents, read once. */
const read = (path) => {
  const full = join(ROOT, path)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}
const bodies = Object.fromEntries(tracked.map(path => [path, read(path)]))

// ── the controls, each read from the artefact that defines it ────────────────

/** Docs the gate demands, straight from its registry. */
const gated = new Set(
  [...read('agents/dsh/presets/renks/docs-gate-tiers.mjs').matchAll(/repoPath: '([^']+)'/g)]
    .map(match => match[1]),
)

/**
 * Rules a harness activates by itself, from frontmatter.
 *
 * `globs` is Cursor's field and `paths` is Claude Code's; the files carry both so
 * one file serves both harnesses. `alwaysApply` would be a third form.
 */
const globActivated = new Set(
  tracked.filter(path => /^(globs|paths|alwaysApply):/m.test(bodies[path])),
)

/**
 * Files a harness discovers by convention in a linked directory.
 *
 * Read from the installer rather than assumed: the top-level directory under
 * `agents/claude-code/` that `setup.sh` symlinks into the harness home. Hooks,
 * commands and rules are all found this way, so the check is per directory, not
 * per file.
 */
const linkedDirs = new Set(
  [...read('setup.sh').matchAll(/"\$SRC\/agents\/claude-code\/([a-z]+)"/g)].map(m => m[1]),
)
const byConvention = new Set(
  tracked.filter(path => {
    const parts = path.split('/')
    return parts[0] === 'agents' && parts[1] === 'claude-code' && linkedDirs.has(parts[2])
  }),
)

/**
 * Files a harness discovers by frontmatter name and description.
 *
 * Different mechanism from globs: a rule is PUSHED when its glob matches, while a
 * skill or command is discovered and then pulled. Both remove the need for a
 * caller in prose, which is the property being counted.
 */
const discoverable = new Set(
  tracked.filter(path => {
    if (!path.endsWith('.md')) return false
    const body = bodies[path]
    if (!body.startsWith('---\n')) return false
    const head = body.slice(0, 400)
    return /^name:/m.test(head) && /^description:/m.test(head)
  }),
)

const controlled = (path) =>
  gated.has(path) || globActivated.has(path) || byConvention.has(path) || discoverable.has(path)

/** Every path that names this file's basename, excluding itself. */
const callers = (path) => {
  const base = path.split('/').pop()
  return tracked.filter(other => other !== path && bodies[other].includes(base))
}

/**
 * Public documentation that governs behaviour, grouped by family.
 *
 * Templates are counted separately rather than judged: they are starting points
 * an agent reads while creating a project file, and the repo states that
 * `ai-context` never copies them.
 */
const families = {
  'agent instructions': tracked.filter(path => path === 'AGENTS.md'),
  'shared rules': tracked.filter(path => /^core\/docs\/[a-z-]+\.md$/.test(path)),
  'language guides': tracked.filter(path => path.startsWith('core/docs/languages/')),
  'harness rules': tracked.filter(path => path.startsWith('agents/claude-code/rules/')),
  'harness entry': tracked.filter(path => /^agents\/(claude-code|gemini|codex)\/[A-Za-z0-9.-]+\.md$/.test(path)),
  commands: tracked.filter(path => path.includes('/commands/') && path.endsWith('.md')),
  skills: tracked.filter(path => path.endsWith('SKILL.md')),
  templates: tracked.filter(path => path.startsWith('core/templates/')),
}

// ── report ───────────────────────────────────────────────────────────────────

const rows = Object.entries(families).map(([family, paths]) => {
  const withoutControl = paths.filter(path => !controlled(path))
  const orphan = withoutControl.filter(path => callers(path).length === 0)
  return {
    family,
    files: paths.length,
    controlled: paths.length - withoutControl.length,
    proseOnly: withoutControl.length - orphan.length,
    orphan: orphan.length,
    proseOnlyList: withoutControl.filter(path => callers(path).length > 0),
    orphanList: orphan,
  }
})

const totals = rows.reduce((sum, row) => ({
  files: sum.files + row.files,
  controlled: sum.controlled + row.controlled,
  proseOnly: sum.proseOnly + row.proseOnly,
  orphan: sum.orphan + row.orphan,
}), { files: 0, controlled: 0, proseOnly: 0, orphan: 0 })

/**
 * Whether a harness home is wired, checked against the filesystem rather than
 * against a string in an installer: the installer is the claim, the symlink is
 * the fact.
 */
const wired = (...paths) => paths.some(path => existsSync(join(HOME, path)))

const harnesses = [
  {
    name: 'dsh',
    wired: wired('.dsh/.agent-presets/renks'),
    control: 'docs-gate denies a mutating tool call until the docs are read',
  },
  {
    name: 'Claude Code',
    wired: wired('.claude/CLAUDE.md'),
    control: 'block-danger and lint-check hooks',
  },
  {
    name: 'Cursor',
    wired: wired('.cursor/rules'),
    control: 'none; rules activate by glob but nothing mediates',
  },
  { name: 'Codex', wired: wired('.codex/AGENTS.md'), control: 'none; prose only' },
  { name: 'Gemini CLI', wired: wired('.gemini/GEMINI.md'), control: 'none; prose only' },
]

/** Deployed copies of the gate, compared byte for byte with the repository. */
const deployments = () => {
  const expected = readFileSync(join(ROOT, 'agents/dsh/presets/renks/docs-gate.mjs'))
  return [
    '.dsh/.agent-presets/renks/docs-gate.mjs',
    'dsh-user-presets/helpers/renks/docs-gate.mjs',
    '.dsh/profiles/web/node_modules/dsh-user-presets/helpers/renks/docs-gate.mjs',
    '.dsh/profiles/dsh-tui/node_modules/dsh-user-presets/helpers/renks/docs-gate.mjs',
  ].map(rel => {
    const full = join(HOME, rel)
    if (!existsSync(full)) return { rel, state: 'absent' }
    return { rel, state: readFileSync(full).equals(expected) ? 'current' : 'STALE' }
  })
}

const report = { root: ROOT, rows, totals, harnesses, deployments: deployments() }

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const pad = (value, width) => String(value).padEnd(width)
console.log('SURFACE AUDIT — counts from git ls-files, controls read from their definitions')
console.log()
console.log(`${pad('family', 20)} ${pad('files', 6)} ${pad('controlled', 11)} ${pad('prose only', 11)} orphan`)
console.log('-'.repeat(62))
for (const row of rows) {
  console.log(`${pad(row.family, 20)} ${pad(row.files, 6)} ${pad(row.controlled, 11)} ${pad(row.proseOnly, 11)} ${row.orphan}`)
}
console.log('-'.repeat(62))
console.log(`${pad('TOTAL', 20)} ${pad(totals.files, 6)} ${pad(totals.controlled, 11)} ${pad(totals.proseOnly, 11)} ${totals.orphan}`)
console.log()
console.log(`control coverage: ${Math.round((totals.controlled / totals.files) * 100)}% of tracked docs`)
if (totals.orphan > 0) {
  console.log()
  for (const row of rows) {
    if (row.orphan > 0) console.log(`ORPHAN  ${row.family}: ${row.orphanList.join(', ')}`)
  }
}
console.log()
console.log('enforcement per harness (wiring checked against the filesystem):')
for (const harness of harnesses) {
  console.log(`  ${pad(harness.name, 14)} wired=${harness.wired ? 'yes' : 'NO '}  ${harness.control}`)
}
console.log()
console.log('deployed docs-gate.mjs, byte-compared with the repository:')
for (const entry of report.deployments) {
  console.log(`  ${pad(entry.state, 8)} ~/${entry.rel}`)
}
