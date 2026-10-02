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
 * The behavioural doc set, single-sourced from the shared config repo, tiered.
 *
 * `repoPath` is relative to the agent-config checkout root. Language guides,
 * `coupling.md`, `testing.md` and the rest stay on-demand reading; gating them
 * would tax every session for occasional value.
 *
 * `development-workflow.md` sits in the CORE tier even though it mandates
 * test-first, because most of it is planning, review and commit procedure, which
 * applies to a docs change exactly as much as to a source change. Only the two
 * docs that are purely about code shape are withheld from prose work.
 */
export const REQUIRED_DOCS = [
  { id: 'principles', repoPath: 'core/principles.md', tier: 'core' },
  { id: 'git-workflow', repoPath: 'core/docs/git-workflow.md', tier: 'core' },
  { id: 'development-workflow', repoPath: 'core/docs/development-workflow.md', tier: 'core' },
  { id: 'complexity', repoPath: 'core/docs/complexity.md', tier: 'code' },
  { id: 'maintainability', repoPath: 'core/docs/maintainability.md', tier: 'code' },
]

/** Tier names, cheapest first. Requiring one requires every tier below it. */
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

/** Extensions that mean configuration or data, not source. */
const CONFIG_EXTENSIONS = new Set([
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'lock', 'env',
])

/** Mutation kinds that are code-workflow acts regardless of the target path. */
const CODE_WORKFLOW_KINDS = new Set(['git-write', 'pkg-write', 'build-write'])

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
  if (CODE_WORKFLOW_KINDS.has(kind)) return 'code'
  return isNonCodeTarget(target) ? 'core' : 'code'
}

/**
 * The docs a given tier requires: that tier and every tier below it.
 *
 * @param tier - a tier name from {@link TIERS}.
 * @param available - the docs that EXIST in this workspace.
 * @returns the subset of `available` that must be read.
 */
export function docsForTier(tier, available) {
  const ceiling = TIERS.indexOf(tier)
  if (ceiling < 0) return available
  return available.filter(doc => {
    // A doc with no tier is project-local: required whenever the gate is on.
    if (doc.tier === undefined) return true
    const own = TIERS.indexOf(doc.tier)
    return own >= 0 && own <= ceiling
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
