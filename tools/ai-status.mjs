/**
 * ai status - where this project stands in the shared flow, and the next step.
 *
 * The human side of flow-router: the same facts the agents' session note is
 * chosen from (agents/dsh/presets/renks/flow-router.mjs), printed for a person
 * at the terminal with the command to run next. Read-only.
 *
 * Usage: ai status
 */
import { readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { gatherFacts } from '../agents/dsh/presets/renks/flow-router.mjs'

/** The user's own overlays, by name. */
function localOverlays(env) {
  const dir = join(env.PROMETHEUS_AI_LOCAL ?? join(env.HOME ?? homedir(), '.config/prometheus-ai.local'), 'overlays')
  try {
    return readdirSync(dir).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)).sort()
  } catch {
    return []
  }
}

/** The set-up line and its next command. */
function setupLines(facts, overlays) {
  if (!facts.initialized) {
    const pick = overlays.length > 0 ? ` --overlay ${overlays.includes('default') ? 'default' : overlays[0]}` : ''
    return ['set up : no .ai/project.md', `next   : ai init${pick}${overlays.length > 1 ? `   (your overlays: ${overlays.join(', ')})` : ''}`]
  }
  const lines = [`set up : yes${facts.overlay ? ', with an overlay' : ', no overlay (ai init --overlay <name>)'}`]
  if (facts.history && !facts.audited) lines.push('next   : ask the agent for /audit, so .ai/context/ holds evidence-backed facts')
  return lines
}

/** The task lines: this worktree's task, or the tasks running elsewhere. */
function taskLines(facts) {
  if (facts.linked && facts.task !== undefined) {
    return [`task   : ${facts.task} (this worktree); spec and plan in .ai/session.md`, 'done?  : ai task remove <task> --delete-branch, from the main checkout, after the merge']
  }
  const lines = facts.busy.map(t => `task   : ${t.task} on ${t.branch ?? 'detached'} at ${t.path}`)
  if (facts.busy.length > 0) lines.push('note   : branch switching in this checkout is blocked while these run')
  lines.push('start  : ask the agent for /kickoff <owner/repo#N>, or ai task new <name> --type <type>')
  return lines
}

/**
 * The status report for one directory.
 * @param facts - from gatherFacts.
 * @param overlays - the names of the user's own overlays.
 * @returns the lines to print.
 */
export function statusReport(facts, overlays = []) {
  if (!facts.git) return ['repo   : not a git repository; ai init still sets up .ai/ here if you want it']
  const where = facts.linked ? `${facts.root} (worktree of ${facts.main})` : facts.root
  return [`repo   : ${where}`, ...setupLines(facts, overlays), ...taskLines(facts)]
}

async function main() {
  const lines = statusReport(await gatherFacts(process.cwd()), localOverlays(process.env))
  console.log(lines.join('\n'))
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main()
}
