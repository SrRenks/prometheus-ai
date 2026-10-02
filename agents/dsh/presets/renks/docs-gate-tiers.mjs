/**
 * docs-gate tiers: which behavioural docs a given mutation must satisfy.
 *
 * The gate used to demand the whole set for every mutation. That is friction
 * with no return: a session editing only prose learns nothing from a complexity
 * budget, and it pays the cost on its first edit, before the nature of the work
 * is knowable.
 *
 * So the set is tiered. `core` applies to any change, prose included, because
 * `principles.md` is behavior and `git-workflow.md` governs a commit a human
 * will read. `code` only pays off when source changes.
 *
 * The exemption rule is POSITIVE identification: a target is spared the code
 * tier only when its extension says prose or configuration. An unknown
 * extension, no extension, or a `bash` command whose target cannot be
 * attributed all fall through to `code`, because over-gating is visible in the
 * denial while under-gating is silent.
 */

/**
 * The behavioural doc set, single-sourced from the shared config repo, tiered
 * and triggered.
 *
 * `repoPath` is relative to the agent-config checkout root. Language guides,
 * `coupling.md`, `testing.md` and the rest stay on-demand reading; gating them
 * would tax every session for occasional value.
 *
 * `tier` is a rung on the ladder, climbed from the cheapest: any change needs
 * `core`, a source change needs `code` too.
 *
 * `commits` marks a doc that only matters at the moment of committing. It is not
 * a rung, because a session that never commits has no use for it: the whole of
 * `git-workflow.md` is commit and pull-request procedure. Requiring it up front
 * spends context on every session for the subset that reaches a commit.
 */
export const REQUIRED_DOCS = [
  { id: 'principles', repoPath: 'core/principles.md', tier: 'core' },
  { id: 'git-workflow', repoPath: 'core/docs/git-workflow.md', tier: 'core', commits: true },
  { id: 'development-workflow', repoPath: 'core/docs/development-workflow.md', tier: 'code' },
  { id: 'complexity', repoPath: 'core/docs/complexity.md', tier: 'code' },
  { id: 'maintainability', repoPath: 'core/docs/maintainability.md', tier: 'code' },
  // Language guides carry their own dimension. `language` is not a rung either:
  // it is selected by the extension of the file being changed, so it is added
  // alongside whichever tier applies.
  { id: 'lang-python', repoPath: 'core/docs/languages/python.md', tier: 'language', language: 'python' },
  { id: 'lang-go', repoPath: 'core/docs/languages/go.md', tier: 'language', language: 'go' },
  { id: 'lang-rust', repoPath: 'core/docs/languages/rust.md', tier: 'language', language: 'rust' },
  { id: 'lang-kotlin', repoPath: 'core/docs/languages/kotlin.md', tier: 'language', language: 'kotlin' },
]

/**
 * The tier ladder, cheapest first. Requiring one requires every tier below it.
 * `language` and `commits` are deliberately NOT on this ladder: both are
 * selected by what the call does, not reached by climbing.
 */
export const TIERS = ['core', 'code']

/**
 * Extensions that mean "prose", not source.
 *
 * `.txt` is deliberately NOT here. It is the usual destination of a command's
 * output (`> out.txt`, `> build.log`), so treating it as prose would drop a
 * redirected real-world write to the cheaper tier. Only formats that exist to
 * carry authored documentation count.
 */
const PROSE_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'rst', 'adoc'])

/**
 * Extensions that mean configuration or data, not source.
 */
const CONFIG_EXTENSIONS = new Set([
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'lock', 'env',
])

/**
 * Source extension to the language guide that governs it.
 *
 * WHY THIS IS GATED. `complexity.md` states the budgets as numbers; the language
 * guide states how to actually enforce them - which linter, which rules, which
 * thresholds (`C901` max 10 for Python, `gocyclo` for Go, `clippy::too_many_lines`
 * at 60 for Rust). Requiring the budget while leaving out the tool configuration
 * asks the agent to honour a limit without telling it how the limit is checked.
 *
 * The guides are 800 to 1000 bytes each, except Kotlin at 3.8 KB, so requiring
 * exactly one of them - the one for the file being changed - is bounded and
 * small. A file whose extension is absent from this map requires no language
 * guide. That is deliberate: naming the WRONG guide is worse than naming none,
 * so an unknown language gets the core rules and nothing false.
 */
const LANGUAGE_BY_EXTENSION = {
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  kt: 'kotlin',
  kts: 'kotlin',
}

/**
 * The language guide a target requires, if any.
 *
 * @param target - the target path, when the call carries one.
 * @returns the guide's id, or undefined when no guide applies.
 */
export function languageForTarget(target) {
  if (typeof target !== 'string' || target.length === 0) return undefined
  const name = target.replace(/\/+$/, '').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()]
}

/** Mutation kinds that are code-workflow acts regardless of the target path. */
const CODE_WORKFLOW_KINDS = new Set(['git-write', 'gh-write', 'pkg-write', 'build-write'])

/**
 * Exempt as "prose or configuration"?
 *
 * @param target - the target path as the model wrote it, or undefined.
 * @returns true only when the extension positively identifies prose or config.
 */
export function isNonCodeTarget(target) {
  if (typeof target !== 'string' || target.length === 0) return false
  const name = target.replace(/\/+$/, '').split('/').pop() ?? ''
  // A dotfile such as `.gitignore` carries its whole name as the extension.
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  const extension = name.slice(dot + 1).toLowerCase()
  return PROSE_EXTENSIONS.has(extension) || CONFIG_EXTENSIONS.has(extension)
}

/**
 * Which tier must be satisfied before `kind` may proceed?
 *
 * @param kind - the mutation kind.
 * @param target - the target path, when the call carries one.
 * @returns a tier name from {@link TIERS}.
 */
export function requiredTier(kind, target) {
  // A commit, a push or a release belongs to source workflow whatever it names.
  if (CODE_WORKFLOW_KINDS.has(kind) || kind === 'lazygit') return 'code'
  return isNonCodeTarget(target) ? 'core' : 'code'
}

/**
 * Does this command commit, push, or open a pull request?
 *
 * The commit-time docs are gated here rather than up front because a session may
 * never reach a commit, and `git-workflow.md` is entirely commit and
 * pull-request procedure. Commits run through `bash` in this setup, so the
 * command text is the reliable place to detect the act.
 *
 * @param command - the raw `bash` command, when the call has one.
 * @returns true when the command is a commit-class act.
 */
export function isCommitCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return false
  return COMMIT_COMMAND_RE.test(command)
}

/** Commit-class git invocations: the acts `git-workflow.md` governs. */
const COMMIT_COMMAND_RE = /\bgit\s+(?:commit|push|merge|rebase|cherry-pick|tag)\b|\bgh\s+pr\s+(?:create|merge)\b|\blazygit\b/

/**
 * The docs a call must satisfy, from three independent selectors.
 *
 *   - the tier ladder: `core`, plus `code` for a source change;
 *   - the language dimension: the guide matching the changed file's extension;
 *   - the commit trigger: the commit-time docs, only when the call commits.
 *
 * They are unioned rather than nested, because none implies another: a prose
 * session that commits needs the commit docs without ever needing the code ones.
 *
 * @param tier - a tier name from {@link TIERS}.
 * @param available - the docs that EXIST in this workspace.
 * @param options.language - the language selected by the target's extension.
 * @param options.commits - whether the call is a commit-class act.
 * @returns the subset of `available` that must be read.
 */
export function docsForTier(tier, available, { language = undefined, commits = false } = {}) {
  const ceiling = TIERS.indexOf(tier)
  if (ceiling < 0) return available
  return available.filter(doc => {
    // A doc with no tier is project-local: required whenever the gate is on.
    if (doc.tier === undefined) return true
    // Selected by extension, never climbed.
    if (doc.tier === 'language') return language !== undefined && doc.language === language
    // On the ladder: required, and the commit trigger adds it unconditionally.
    const own = TIERS.indexOf(doc.tier)
    const onLadder = own >= 0 && own <= ceiling
    return onLadder && (doc.commits !== true || commits)
  })
}

/**
 * The strictest tier a set of docs can express.
 *
 * A workspace whose checkout is missing the code-tier files cannot gate on
 * them, so the ceiling falls back to the highest tier whose docs are present.
 * Unknown docs project-local, so they never lower the ceiling.
 *
 * @param available - the docs that EXIST in this workspace.
 * @returns a tier name from {@link TIERS}.
 */
export function tierCeiling(available) {
  let ceiling = 'core'
  for (const tier of TIERS) {
    const needed = REQUIRED_DOCS.filter(doc => doc.tier === tier)
    if (needed.length === 0) continue
    if (needed.every(doc => available.some(entry => entry.id === doc.id))) ceiling = tier
  }
  return ceiling
}
