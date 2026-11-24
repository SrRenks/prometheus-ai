/**
 * flow-router: say the next step at the right moment, and block the one act
 * that breaks parallel work.
 *
 * WHY. Agents rarely start the right flow by themselves: in Vercel's eval a
 * skill was never invoked in 56% of runs, and an explicit instruction raised the
 * trigger rate to "95%+"; agents opened a repository's policy file in 3.5% of
 * runs (arXiv:2607.26819). A short factual note at session start, and one when
 * a prompt names a GitHub issue or PR, puts the step in front of the model.
 * Prohibitions are another matter: the same study measured "do not" rules at 0
 * to 10% compliance even with reminders, so switching branches while task
 * worktrees are in use is denied, not discouraged. Questions stay with
 * kickoff's soft check: pushing models to ask raised needless questions on
 * complete tasks to 36-93% for some models (Ambig-SWE, arXiv:2502.13069).
 *
 * Shared by the dsh preset and the Claude Code hook. Facts come from git with
 * optional locks off, so nothing is written; any failure means no note.
 */
import { execFile, execFileSync } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { parseShell } from './docs-gate-shell.mjs'

/** The lock reason ai-worktree writes, which marks a task as taken. */
const TASK_LOCK = 'ai-worktree: task '

// GitHub's autolink grammar: owner/repo#n, where an owner is letters, digits and
// single inner hyphens (up to 39), and a repository adds '.' and '_'. Paths such
// as node_modules/x#3 or v1.2/3.4#5 do not fit it.
const GITHUB_REF = /(?<![\w/.-])([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[\w.-]+)#(\d+)\b/
const GITHUB_URL = /\bhttps?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)/
// Words, not parts of a path or a file name. "onboarding" is left out: over 530
// real prompts it named a business flow, not an audit.
const AUDIT_WORDS = /(?<![\w/.-])(audit|audits|auditing|auditoria|auditorias|auditar)(?![\w/.-]*\w)/i

/** Run git read-only in `cwd`; resolves to stdout, or undefined on any failure. */
function git(cwd, args) {
  return new Promise(done => {
    execFile('git', args, { cwd, timeout: 3000, maxBuffer: 1 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (error, stdout) => done(error ? undefined : stdout))
  })
}

/**
 * Parse `git worktree list --porcelain`.
 * @param text - the porcelain output.
 * @returns `[{ path, branch, task }]`, task set when ai-worktree locked it.
 */
export function parseWorktrees(text) {
  return text.split(/\n\n+/).filter(Boolean).map(block => {
    const lines = block.split('\n')
    const field = name => lines.find(l => l === name || l.startsWith(`${name} `))
    const reason = (field('locked') ?? '').slice('locked'.length).trim()
    return {
      path: (field('worktree') ?? '').slice('worktree '.length),
      branch: (field('branch') ?? '').replace(/^branch (refs\/heads\/)?/, '') || undefined,
      task: reason.startsWith(TASK_LOCK) ? reason.slice(TASK_LOCK.length) : undefined,
    }
  }).filter(w => w.path.length > 0)
}

/** Does any `.ai/context` topic file carry a `Verified at` line, which the audit skill writes? */
async function audited(root) {
  let names
  try {
    names = await readdir(join(root, '.ai/context'))
  } catch {
    return false
  }
  for (const name of names.filter(n => n.endsWith('.md') && n !== 'index.md')) {
    const text = await readFile(join(root, '.ai/context', name), 'utf8').catch(() => '')
    if (/^Verified at:/m.test(text)) return true
  }
  return false
}

const exists = path => stat(path).then(() => true, () => false)

/**
 * The facts the notes are chosen from.
 * @param cwd - the session's working directory.
 * @returns `{ git: false }` outside git; else the checkout root, the main
 *   checkout, whether this is a linked worktree and its task, the other tasks
 *   in use, whether `.ai/` is set up (here or in the main checkout), whether it
 *   was audited, and whether the repository has history.
 */
export async function gatherFacts(cwd) {
  const top = await git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  if (top === undefined) return { git: false }
  const [root, common] = top.trim().split('\n')
  const main = common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : root
  const trees = parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain']) ?? '')
  const aiRoot = await exists(join(root, '.ai/project.md')) ? root : main
  return {
    git: true,
    root,
    main,
    linked: root !== main,
    task: trees.find(t => t.path === root)?.task,
    // A task whose directory is gone is not running; ai-worktree remove forgets it.
    busy: (await Promise.all(trees.filter(t => t.task !== undefined && t.path !== root).map(async t => (await exists(t.path) ? t : undefined)))).filter(Boolean),
    initialized: await exists(join(aiRoot, '.ai/project.md')),
    overlay: await exists(join(aiRoot, '.ai/overlay.md')),
    audited: await audited(aiRoot),
    history: ((await git(cwd, ['rev-list', '-n', '1', '--all'])) ?? '').trim().length > 0,
  }
}

const taskList = tasks => tasks.map(t => `${t.task} (${t.branch ?? 'detached'})`).join(', ')

/**
 * The session-start note for these facts, or undefined when there is nothing to say.
 * Notes state facts and the next step, and nothing more.
 */
export function sessionHint(facts) {
  if (!facts.git) return undefined
  const lines = []
  if (facts.linked && facts.task !== undefined) {
    lines.push(`flow: this is the worktree of task ${facts.task}; its spec and plan are in .ai/session.md. Work only here, and do not switch its branch.`)
  } else if (facts.busy.length > 0) {
    lines.push(`flow: tasks are running in worktrees of this repository: ${taskList(facts.busy)}. Branch switching here is blocked while they are; a new task gets its own with \`ai-worktree new <task>\`.`)
  }
  if (!facts.initialized) {
    lines.push(facts.history
      ? 'flow: this repository has history but no .ai/project.md. The first step is to ask the user to approve `ai-init` (with `--overlay <name>` if they keep one), then the audit skill builds the project knowledge.'
      : 'flow: this is a new repository with no .ai/project.md. The first step is to ask the user to approve `ai-init`, then plan the build-out.')
  } else if (!facts.audited && facts.history) {
    lines.push('flow: .ai/ is set up but .ai/context/ holds no audited facts yet; the audit skill builds them when the work needs project knowledge.')
  }
  return lines.length > 0 ? lines.join('\n') : undefined
}

/**
 * A note for one user prompt: a GitHub issue or PR points to kickoff, audit
 * words point to the audit skills.
 * @param text - the prompt text.
 * @returns `{ id, text }`; `id` lets the caller say each note once per session.
 */
export function promptHint(text) {
  if (typeof text !== 'string' || text.length === 0) return undefined
  const url = GITHUB_URL.exec(text)
  const ref = url === null ? GITHUB_REF.exec(text) : null
  if (url !== null || ref !== null) {
    const name = url !== null ? `${url[1]}#${url[3]}` : `${ref[1]}#${ref[2]}`
    return { id: `ticket:${name}`, text: `flow: the message names GitHub issue or PR ${name}. The kickoff skill starts a task from it: missing-information check, its own worktree, then a plan.` }
  }
  if (AUDIT_WORDS.test(text)) {
    return { id: 'audit', text: 'flow: for an audit, the audit skill maps the project with evidence, and quality-audit finds proven defects.' }
  }
  return undefined
}

/** Options of `git checkout` that take a value, so the next word is not an operand. */
const VALUE_OPTS = new Set(['-c', '-C', '-b', '-B', '--orphan', '--conflict', '--pathspec-from-file'])

/** Skip `git`'s global options; returns the index of the subcommand and the `-C` directory. */
function gitSubcommand(w, start) {
  let i = start
  let dir
  while (w[i]?.startsWith('-')) {
    if (w[i] === '-C') { dir = w[i + 1]; i += 2 } else i += w[i] === '-c' ? 2 : 1
  }
  return { i, dir }
}

/** Is `git checkout <rest>` a branch switch rather than a file restore? */
function checkoutSwitches(rest, isRef) {
  if (rest.includes('--') || rest.includes('-p') || rest.includes('--patch')) return false
  if (rest.some(a => ['-b', '-B', '--orphan', '--detach'].includes(a))) return true
  const operands = rest.filter((a, k) => !a.startsWith('-') && !VALUE_OPTS.has(rest[k - 1]))
  return operands.length === 1 && operands[0] !== '.' && isRef(operands[0])
}

/**
 * Would git read `name` as something to switch to? git-checkout(1): a name that
 * resolves to a commit is switched to, and so is a name that only exists as a
 * remote-tracking branch, which git then creates; anything else is a pathspec.
 * This asks git the same two questions, read-only.
 *
 * @param cwd - the checkout the command runs in.
 * @param name - the single operand of `git checkout`.
 * @returns true when git would switch.
 */
export function isGitRef(cwd, name) {
  if (name.length === 0 || name.startsWith('-')) return false
  const run = args => {
    try {
      return execFileSync('git', args, { cwd, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    } catch {
      return undefined
    }
  }
  if (run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${name}^{commit}`]) !== undefined) return true
  return (run(['for-each-ref', '--count=1', '--format=%(refname)', `refs/remotes/*/${name}`]) ?? '').trim().length > 0
}

/**
 * Does this shell text switch the branch of a checkout? `git checkout -- file`,
 * `git checkout <ref> -- path`, `git checkout -p` and a checkout of a name git
 * reads as a path restore files and do not.
 *
 * @param command - the shell text.
 * @param isRef - tells whether git reads a bare `git checkout <x>` as a ref ({@link isGitRef}).
 * @returns `{ dir }` (the `-C` directory, if any) for the first switch, or undefined.
 */
export function branchSwitch(command, isRef = () => true) {
  let commands
  try {
    commands = parseShell(command)
  } catch {
    return undefined
  }
  for (const { words } of commands) {
    const w = words.map(x => x.value)
    const lead = w[0] === 'command' || w[0] === 'env' ? 1 : 0
    if (w[lead] !== 'git') continue
    const { i, dir } = gitSubcommand(w, lead + 1)
    const rest = w.slice(i + 1)
    if (rest.includes('-h') || rest.includes('--help')) continue
    if (w[i] === 'switch' || (w[i] === 'checkout' && checkoutSwitches(rest, name => isRef(name, dir)))) return { dir }
  }
  return undefined
}

/**
 * The denial for a branch switch while ai-worktree tasks run, or undefined.
 * @param facts - from gatherFacts, for the directory the switch runs in.
 */
export function switchDenial(facts) {
  if (!facts.git || (facts.busy.length === 0 && facts.task === undefined)) return undefined
  const where = facts.task !== undefined
    ? `this is the worktree of task ${facts.task}`
    : `tasks are running in other worktrees: ${taskList(facts.busy)}`
  return [
    `Branch switching is blocked by flow-router: ${where}.`,
    'One checkout, one task: a switch here would move the files and staging under whoever works in it.',
    'For a new task, create its own worktree with `ai-worktree new <task> --type <type>` (with the user\'s approval) and work there. If the user wants this checkout switched anyway, tell them; they can run the command themselves.',
    'A task that is finished but still listed (`ai-worktree list`) is released with `ai-worktree remove <task>`.',
  ].join('\n')
}
