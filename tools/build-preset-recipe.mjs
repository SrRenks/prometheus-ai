/**
 * Rebuild the `renks` preset recipe set for the dsh version actually installed.
 *
 * The repo deliberately does not commit dsh's third-party `standard` recipe as
 * the live source: `stock-baseline.agent.cordis.yml` is the 3-way merge base and
 * only works while it matches the installed stock preset. Upstream rewrote the
 * persona block (`text:` -> `prefix:`/`suffix:`) and the workflow rows between
 * 0.1.2-rc.1 and 0.2.0-rc.2, which left the old base stale: every install fell
 * through to the fallback recipe, so a change to the patch could not reach the
 * machine at all.
 *
 * This script removes that class of failure. It:
 *   1. finds the installed `standard` preset (the live source of truth),
 *   2. rebuilds the target recipe by applying the patch's own blocks plus the
 *      docs-gate row to that stock recipe,
 *   3. regenerates `stock-baseline.agent.cordis.yml`, `agent.cordis.patch` and
 *      `fallback.agent.cordis.yml` so all three agree,
 *   4. verifies the patch round-trips and that a simulated 3-way merge (the
 *      exact operation `install.sh` performs) produces no conflict.
 *
 * Usage: node tools/build-preset-recipe.mjs [--check] [--print-stock <file>]
 *   --check              verify only; write nothing and exit non-zero on drift
 *   --print-stock <file> write the resolved stock recipe and stop, for install.sh
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { resolveStock } from './stock-recipe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PRESET_DIR = join(REPO, 'agents/dsh/presets/renks')
const CHECK_ONLY = process.argv.includes('--check')

/** The row this preset adds on top of the stock recipe, behind the hint. */
const DOCS_GATE_ROW = `
# THE ENFORCEMENT for the section above. \`tools/pre-execute\` denies every
# mutating tool call in a workspace whose behavioural docs have not been read,
# so the contract is a precondition instead of a suggestion. Measured baseline
# (2026-10, 96 recorded sessions): 33% had read an instruction file, 8% had read
# any core behavioural doc, and 17 of the 30 sessions that received the hint still
# never opened one. This plugin needs no realm: it registers listeners and resolves
# the host \`fs\` service, and it owns no service of its own.
# \`agents/dsh/presets/renks/docs-gate.spec.mjs\` is its test suite.
- id: docs-gate
  name: ./docs-gate.mjs
`

/**
 * The stock instruction row. The preset REPLACES it: a full AGENTS.md digest is
 * not injected, because the gate enforces the reads instead of advertising
 * them. The `persona` row above is left exactly as upstream ships it, since
 * rewriting a block this preset has no opinion about is how a "personal delta"
 * turns into an unmergeable fork.
 */
const STOCK_INSTRUCTIONS_OLD = `- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536
`

const GATE_ROW_REPLACEMENT = DOCS_GATE_ROW

const HINT_BLOCK = `# Instruction delivery — evidence-based (2026-09 config review): the full
# AGENTS.md/CLAUDE.md digest is NOT injected. Large always-on injections
# perturb trajectories (liangshen issue #6: skill-catalog injection broke
# first-request anchoring 0/9 vs ~81% without) and dilute attention (context
# rot; Anthropic "smallest set of high-signal tokens"; ETH Zurich
# arXiv:2602.11988, +20-23% inference cost). A hint that named the files was
# tried instead and removed on 2026-10-02: it never reached a live session, and
# the gate below enforces the same contract by denial. NOTE: .ai/project.md and
# .ai/session.md are NOT discovered by any plugin — the shared AGENTS.md orders
# the agent to read them at session start.
`

/**
 * The stock skill pair, replaced by the on-demand search/load pair.
 *
 * ANCHORED ON THE ROWS, NOT ON A COMMENT. The 0.2.0 shipped preset is machine
 * generated and carries no comments at all, so the block this edit used to match
 * (the prose above `skill-filesystem`) does not exist there and the edit matched
 * zero times. Rows are what upstream actually ships and what a version bump is
 * least likely to reword.
 */
const STOCK_SKILL_OLD = `- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
`

const SKILL_NEW = `# \`skill-filesystem\` contributes local-root discovery for agents on this preset.
# The full skill-catalog injection (\`dsh-tool-skill\`'s ~9KB \`<available_skills>\`
# reminder) is REMOVED (evidence-based, see the identity section). Instead
# \`skill-search\` exposes two small on-demand tools — \`skill_search\` (list
# matching name/description summaries) and \`skill_load\` (inject one skill's
# full instructions) — the tool-search pattern. Scale policy: search/load
# remains the right default as the catalog grows; do not re-add catalog
# injection beyond ~3-5 skills.
#
# The skill REGISTRY lives in the host composition and is layered per scope:
# these rows register into THIS preset's layer of it, so they need no realm.
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
- id: skill-search
  name: ./skill-search.mjs
`

/**
 * The note added above the nested `plan-mode` row.
 *
 * This one is an INSERT, not a replacement. `plan-mode` is not a top-level row:
 * it sits inside the `planning` group's `config`, indented four spaces, and the
 * comment that used to precede it upstream is gone. Inserting the note keeps the
 * explanation attached to the row and leaves the group's own text untouched.
 */
const PLAN_NOTE = `# NOTE: this \`section\` is duplicated byte-identical in the liangshen preset —
# keep BOTH copies in sync on any edit (shared-include support is not
# available in preset compositions).
#
# Plan state is per-agent by nature, so an entry-local realm is not a
# workaround here — it is the correct lifetime.
`

const PLAN_ANCHOR = `    - id: plan-mode
`

const WEB_NOTE = `# fetch stays ENABLED in this default preset; liangshen (experimental minimal
# preset) deliberately disables it. If the policies must match, change BOTH
# copies of both presets.
- id: tool-web
`

const WEB_ANCHOR = `- id: tool-web
`

/**
 * Patches this preset applies to the stock recipe, in application order.
 *
 * Two kinds. `old`/`new` replaces a block the stock still ships. `before` inserts
 * text ahead of an anchor and keeps it, which is what a note added to a row that
 * has no comment of its own needs; re-indenting to the anchor's own depth happens
 * in `applyEdits`, so a nested row does not get a top-level comment above it.
 */
const EDITS = [
  { id: 'instructions -> docs-gate', old: STOCK_INSTRUCTIONS_OLD, new: `${HINT_BLOCK}${GATE_ROW_REPLACEMENT}` },
  { id: 'skill catalog -> search/load', old: STOCK_SKILL_OLD, new: SKILL_NEW },
  { id: 'plan-mode note', before: PLAN_ANCHOR, text: PLAN_NOTE },
  { id: 'web-fetch note', old: WEB_ANCHOR, new: WEB_NOTE },
]

/** Print a result and exit. */
function finish(result) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok === true ? 0 : 1)
}

/** Count non-overlapping literal occurrences. */
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1
}

/**
 * Re-indent a block so its own lines sit at the anchor's depth.
 *
 * A note written at column 0 is correct for a top-level row and wrong for a row
 * nested inside a group, where a column-0 comment between indented siblings reads
 * as though it belonged to something else. Blank lines stay blank.
 *
 * @param text - the note.
 * @param indent - the leading whitespace to apply.
 * @returns the note, indented.
 */
function reindent(text, indent) {
  if (indent.length === 0) return text
  return text
    .split('\n')
    .map(line => (line.trim().length === 0 ? line : `${indent}${line}`))
    .join('\n')
}

/**
 * Apply every declared edit to the stock recipe.
 *
 * @param stock - the installed stock recipe.
 * @param stockPath - where it came from, for diagnostics.
 * @returns `{ target }`, or `{ error }` when an edit no longer matches.
 */
function applyEdits(stock, stockPath) {
  let target = stock
  for (const edit of EDITS) {
    // An insert keeps the anchor and puts the note in front of it, re-indented to
    // the anchor's own depth. A replacement swaps the block outright.
    const needle = edit.before ?? edit.old
    const count = occurrences(target, needle)
    if (count !== 1) {
      return {
        error: `edit "${edit.id}" matched ${count} times in ${stockPath}; upstream changed that block`,
        hint: 'update the edit block in this script, then re-run',
      }
    }
    if (edit.before !== undefined) {
      const lead = /^[ \t]*/.exec(edit.before)[0]
      target = target.replace(edit.before, `${reindent(edit.text, lead)}${edit.before}`)
    } else {
      target = target.replace(edit.old, edit.new)
    }
  }
  const gateRows = occurrences(target, '- id: docs-gate')
  const stockRows = occurrences(target, '- id: agent-instructions')
  if (gateRows !== 1 || stockRows !== 0) {
    return { error: `post-edit sanity failed: docs-gate rows=${gateRows}, stock instruction rows=${stockRows}` }
  }
  return { target }
}

/**
 * Compare what is on disk with what this script would write.
 *
 * @param stock - the installed stock recipe.
 * @param target - the recipe this script would generate.
 * @param stockPath - where the stock recipe came from.
 * @returns the finish() payload.
 */
function checkDrift(stock, target, stockPath) {
  const baselinePath = join(PRESET_DIR, 'stock-baseline.agent.cordis.yml')
  const fallbackPath = join(PRESET_DIR, 'fallback.agent.cordis.yml')
  const baselineMatches = existsSync(baselinePath) && readFileSync(baselinePath, 'utf8') === stock
  const fallbackMatches = existsSync(fallbackPath) && readFileSync(fallbackPath, 'utf8') === target
  return {
    ok: baselineMatches && fallbackMatches,
    stockPath,
    baselineMatches,
    fallbackMatches,
    error: baselineMatches && fallbackMatches ? undefined : 'baseline and/or fallback are stale',
  }
}

/**
 * Produce the patch text from the stock recipe to the target.
 *
 * `git diff --no-index` exits 1 when the files differ, which is the normal case,
 * so its status is not an error signal and only empty output is.
 *
 * @param work - scratch directory.
 * @param stock - the stock recipe.
 * @param target - the generated recipe.
 * @returns `{ patch }`, or `{ error }` when there is nothing to diff.
 */
function buildPatch(work, stock, target) {
  writeFileSync(join(work, 'base.yml'), stock)
  writeFileSync(join(work, 'target.yml'), target)
  let diff = ''
  try {
    diff = execFileSync('git', ['diff', '--no-index', '--no-color', 'base.yml', 'target.yml'], { cwd: work, encoding: 'utf8' })
  } catch (error) {
    diff = error.stdout ?? ''
  }
  if (diff.length === 0) return { error: 'git diff produced no output; baseline and target are identical' }
  const lines = diff.split('\n')
  const headerAt = lines.findIndex(line => line.startsWith('--- '))
  if (headerAt < 0) return { error: 'git diff produced no file header' }
  return { patch: `--- a/agent.cordis.yml\n+++ b/agent.cordis.yml\n${lines.slice(headerAt + 2).join('\n')}` }
}

/**
 * Verify the patch rebuilds the target from the baseline alone, and that
 * install.sh's 3-way merge of the result against the stock recipe is clean.
 *
 * @param work - scratch directory.
 * @param stock - the stock recipe.
 * @param target - the generated recipe.
 * @param patch - the candidate patch.
 * @returns `{ mergeStatus }`, or `{ error }`.
 */
function verifyPatch(work, stock, target, patch) {
  const rtFile = join(work, 'rt.yml')
  writeFileSync(join(work, 'candidate.patch'), patch
    .replace('--- a/agent.cordis.yml', '--- a/rt.yml')
    .replace('+++ b/agent.cordis.yml', '+++ b/rt.yml'))
  writeFileSync(rtFile, stock)
  try {
    execFileSync('git', ['apply', 'candidate.patch'], { cwd: work, encoding: 'utf8' })
  } catch (error) {
    return { error: `generated patch does not apply: ${error.stderr ?? error.message}` }
  }
  if (readFileSync(rtFile, 'utf8') !== target) return { error: 'round trip produced a different recipe' }

  // git merge-file takes (current, base, other) and leaves conflict markers.
  const mergeFile = join(work, 'merged.yml')
  writeFileSync(mergeFile, readFileSync(rtFile, 'utf8'))
  let mergeStatus = 0
  try {
    execFileSync('git', ['merge-file', mergeFile, join(work, 'base.yml'), join(work, 'target.yml')], { cwd: work, encoding: 'utf8' })
  } catch (error) {
    mergeStatus = error.status ?? 1
  }
  if (readFileSync(mergeFile, 'utf8').includes('<<<<<<<')) {
    return { error: 'simulated 3-way merge conflicts', mergeStatus }
  }
  return { mergeStatus }
}

function main() {
  const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
  const resolved = resolveStock({ dshHome })
  if (resolved.error !== undefined) return finish(resolved)

  const stock = resolved.text
  const stockPath = resolved.path

  // `--print-stock <file>` writes the resolved stock and stops. `install.sh`
  // consumes it instead of probing for the recipe itself, so the lookup and the
  // extraction live in one place rather than in two that can disagree.
  const printAt = process.argv.indexOf('--print-stock')
  if (printAt >= 0) {
    const destination = process.argv[printAt + 1]
    if (destination === undefined || destination.startsWith('--')) {
      return finish({ error: '--print-stock needs an output path' })
    }
    writeFileSync(destination, stock)
    return finish({ ok: true, layout: resolved.layout, stockPath, bytes: stock.length, wrote: destination })
  }

  const edited = applyEdits(stock, stockPath)
  if (edited.error !== undefined) return finish(edited)
  const target = edited.target

  if (CHECK_ONLY) return finish(checkDrift(stock, target, stockPath))

  // Scratch space lives OUTSIDE the repo tree: the working files are inputs to
  // `git diff`, not artifacts anyone should commit or install.
  const work = join(tmpdir(), `build-preset-recipe-${process.pid}`)
  execFileSync('mkdir', ['-p', work])
  process.on('exit', () => {
    try { rmSync(work, { recursive: true, force: true }) } catch { /* scratch only */ }
  })

  const built = buildPatch(work, stock, target)
  if (built.error !== undefined) return finish(built)

  const verified = verifyPatch(work, stock, target, built.patch)
  if (verified.error !== undefined) return finish(verified)

  writeFileSync(join(PRESET_DIR, 'stock-baseline.agent.cordis.yml'), stock)
  writeFileSync(join(PRESET_DIR, 'fallback.agent.cordis.yml'), target)
  writeFileSync(join(PRESET_DIR, 'agent.cordis.patch'), built.patch)
  return finish({
    ok: true,
    stockPath,
    hunks: built.patch.split('\n').filter(line => line.startsWith('@@')).length,
    patchBytes: built.patch.length,
    mergeStatus: verified.mergeStatus,
  })
}

main()
