# prometheus-ai repository map

Layout of `~/.config/prometheus-ai/` - the single source of truth for AI/agent configuration.
This config is READ-ONLY for agents. Projects do not copy it: `ai-init` creates the project's `.ai/` directory, whose `agents.md` imports this config.

## Root level
- `AGENTS.md` - universal agent rules (v2026-09-06). Symlinked as each project's `.ai/agents.md`; also linked to `~/.codex/AGENTS.md`, `~/.agents/AGENTS.md`, and `~/.dsh/AGENTS.md`.
- `README.md` - human overview: what the config is, how it reaches each tool, how to install and extend it.
- `LICENSE` - MIT.
- `setup.sh` - one-time global install: every tool bridge (symlinks), the `~/.local/bin` commands, and the git identity include.
- `ai-init` - creates the project's `.ai/` directory (agents.md symlink, project.md, memory files, docs/) and ignores it in `.git/info/exclude`; `--team` writes a committed `./AGENTS.md` from `core/templates/team-agents.md`, `--link-agents` links one for Cursor. → `~/.local/bin/ai-init`.
- `ai-context` - generates `.ai/context/` topic files and the project README on demand. → `~/.local/bin/ai-context`.
- `ai-survey` - prints a read-only, agent-facing markdown report of computed project facts (git state, worktrees, file counts, markers, churn, `--siblings` repos without remote URLs) for onboarding; code in `tools/ai-survey.mjs`. → `~/.local/bin/ai-survey`.
- `ai-lint` - lints `.ai/**/*.md` for tables, bold, unfilled placeholders, stale `path:line` citations and dangling symlinks (long files warn); exits 1 on any error; code in `tools/ai-lint.mjs`. → `~/.local/bin/ai-lint`.
- `ai` - one entry point: `ai status` prints where the project stands and the next command (code in `tools/ai-status.mjs`); `ai init`, `ai task`, `ai survey|lint|skeleton|context` route to the ai-* commands. → `~/.local/bin/ai`.
- `agents/dsh/presets/renks/flow-router.mjs` (+ `flow-router-dsh.mjs`) - the next-step notes at session start and on a prompt naming a GitHub issue or an audit, and the branch-switch block while ai-worktree tasks run; shared by the dsh preset and the Claude Code hook.
- `ai-skeleton` - prints the classes and functions of source files with their line numbers and no bodies (Python, JS/TS, Go, Java, Kotlin, PHP, xBase .prg, SQL, Ruby, Rust, C#), by pattern; code in `tools/ai-skeleton.mjs`. → `~/.local/bin/ai-skeleton`.
- `ai-worktree` - one locked git worktree and branch per task under `<main>/.worktrees/`, sharing the main checkout's `.ai/` knowledge and keeping its own session notes (`new`, `list`, `remove`). → `~/.local/bin/ai-worktree`.
- `core/overlays/default.md` - the shipped overlay: company or personal rules between the shared config and the project, linked as `.ai/overlay.md` by `ai-init --overlay`; user overlays live in `~/.config/prometheus-ai.local/overlays/`.
- `core/` - tool-free content: `core/docs/` (reference library), `core/principles.md`, `core/templates/`.
- `agents/` - per-tool adapters: `claude-code/` (CLAUDE.md, CLAUDE.token.md, claude-code.md, CLAUDE.local.md, settings.json, hooks, rules, commands, claudeignore), `gemini/`, `dsh/`.
- `tools/` - repo-maintenance scripts. `build-preset-recipe.mjs` regenerates the dsh preset's baseline, patch and fallback from the installed stock recipe, and `--check` reports drift.
- `skills/` - shared procedures, symlinked to `~/.claude/skills` and `~/.dsh/skills`.

## Tool integrations - `agents/`
- `agents/dsh/presets/renks/` - the DEFAULT dsh preset (mirrors the live roster `~/.dsh/.agent-presets/renks/`). Evidence-based instruction delivery: no full AGENTS.md digest and no skill-catalog injection; `docs-gate.mjs` (with `docs-gate-policy.mjs`, `docs-gate-target.mjs`, the shell reader `docs-gate-shell.mjs`, its rules `docs-gate-bash.mjs`, the interpreter scan `docs-gate-code.mjs`, the init check `docs-gate-init.mjs`, `docs-gate-tiers.mjs`, the credit rules in `docs-gate-credit.mjs`, the filesystem seam in `docs-gate-seam.mjs` and the harness `docs-gate.testkit.mjs`) DENIES mutating tool calls until the docs its selectors require have been read: `principles.md` for any change, the code-tier rules for source, the one language guide matching the changed file, and `git-workflow.md` only at the commit act (an audit of recorded sessions found about a tenth had read any core behavioural doc, so guidance became a precondition), and `skill-search.mjs` exposes `skill_search`/`skill_load`. Scale policy: search/load stays the default as the catalog grows; do not re-add catalog injection beyond ~3-5 skills.
- `agents/claude-code/` - CLAUDE.md (subscription mode: imports AGENTS.md), CLAUDE.token.md (token mode: points at it), claude-code.md (the Claude Code rules both import), settings.json, hooks, rules, commands (commands symlink to `skills/`). `setup.sh --mode` picks which CLAUDE file is linked.
- `agents/gemini/` - GEMINI.md wrapper.
- `skills/` - shared procedures (plan, onboard, context, review, ci, ship, extend-config), symlinked to both `~/.dsh/skills` and `~/.claude/skills`.
- The experimental `liangshen` preset (minimal-bootstrap anchoring) lives in `~/.dsh/.agent-presets/liangshen/` and is not tracked here.

## Reference library - `core/docs/`
Shared across all projects; read on demand (AGENTS.md §3). Never copied into a project - a project's `docs/` holds project docs only.
- `architecture.md`, `coding-standards.md`, `testing.md`, `security.md`, `complexity.md`, `coupling.md`, `debugging.md`, `maintainability.md`, `performance.md`, `development-workflow.md`, `validation-checklist.md`, `dependency-policy.md`, `git-workflow.md`, `onboarding.md`
- `evals.md` - retained eval set (anchor checks + task set) to run before changing the default preset or shared rules
- `ai-directory.md` - the `.ai/` structure standard (files, names, creation rules)
- `project-docs.md` - the committed docs/ + README standard (templates, naming, workflow)
- `repository-map.md` - this file
- `prometheus-ai-authoring.md` - the spec for extending this repo (rules, skills, docs, templates, bridges)
- `sources.md` - provenance of every rule, design choice, and threshold, grouped by domain: cited sources with retrieval dates, internal measurements, repo design decisions, and the commit that introduced each file type
- `decisions/` - ADR template
- `languages/` - go, kotlin, python, rust

## Agent support
- `core/principles.md` - universal agent principles (Karpathy/llm-rigor + operational rules); complexity budgets single-sourced in `core/docs/complexity.md`
- `skills/` - shared procedures (dsh + Claude Code): plan, onboard, context, review, ci, ship, extend-config
- `agents/claude-code/rules/` - scoped rules (dual frontmatter for Claude Code + Cursor): go, python, rust, security, testing
- `agents/claude-code/commands/` - slash commands (symlinks into skills/): `ci`, `review`, `ship`
- `agents/claude-code/hooks/` - lifecycle hooks: `docs-gate.mjs` with `docs-gate-ledger.mjs` (the dsh gate as a hook, importing the preset's modules), `session-init` (opt-in), `lint-check`, `block-danger`

## Project templates - `core/templates/`
Seeded into `.ai/` by `ai-init` (per-project, ignored locally):
- `team-agents.md` - the short, committed `./AGENTS.md` that `ai-init --team` writes at the project root: commands and conventions the code does not show
- `project.md` - project rules starter (stack, build/test/lint, conventions)
- `convention-doc.md` - template for agent-created convention docs (`.ai/docs/`): purpose, imperative rules, pointers
- `session.md` - current session state
- `assumptions.md` - decision/assumption log
- `scratchpad.md` - working notes
- `README.md` - root enterprise README (superficial overview; deep docs go in `docs/`)
- `project-docs/` - starters for the committed docs/: `repository-map.md`, `architecture.md`

## Notes
- This repository configures AI coding agents; it contains no application code.
- Projects keep agent configuration in their own `.ai/` directory - repos stay project-only, `.ai/` stays local and never committed.