# The `.ai/` directory - standard

Defines the per-project agent directory: purpose, files, naming, and creation rules.
This is the contract that `ai-init` and the SessionStart hook implement.

## Purpose
- `.ai/` holds all per-project agent knowledge. It is local-only and never committed.
- The shared config (`~/.config/agent-config/`) is READ-ONLY. Everything project-specific goes here.

## Structure
```
.ai/
├── agents.md       # SYMLINK → ~/.config/agent-config/AGENTS.md (shared, read-only)
├── project.md      # Project-specific rules: stack, build/test/lint, conventions
├── overlay.md      # SYMLINK → the company or personal overlay chosen by ai-init --overlay
├── session.md      # Current session state (updated at session end)
├── assumptions.md  # Decision log - one numbered entry per decision
├── scratchpad.md   # Working notes, commands, investigation results
├── context/        # Project knowledge base - generated on demand by ai-context
│   ├── index.md        # machine-owned entry: maturity, stack, pointers, gaps
│   ├── domain.md       # purpose, business rules, glossary (created on demand)
│   ├── architecture.md # modules, data flow (created on demand)
│   ├── database.md     # schema/storage - ONLY when a database is detected
│   ├── dependencies.md # external services/APIs - ONLY when present
│   └── conventions.md  # local conventions - ONLY when detected
├── audits/         # optional: quality-audit reports, one dated file per run
└── docs/           # optional, created on demand
```

docs/ is optional, created on demand - only when a project-specific deviation must be documented (see below).

context/ holds the project knowledge base: internal context future agents need (business rules, architecture, database, external dependencies, local conventions). It is generated on demand by `ai-context` - never by copying generic templates.

## context/ rules
1. `index.md` is machine-owned: `ai-context` refreshes it on every run. User/AI notes go in the topic files, never in the index.
2. Topic files are created once and never overwritten. Facts replace their open questions as they are confirmed with the user.
3. Generation is dynamic: a project without a database gets no `database.md`; without external services no `dependencies.md`; without local convention markers no `conventions.md`. Only files that apply are written.
4. Content is real detected facts + explicit open questions. No `<...>` placeholders, no generic filler (per the shared config principles).
5. `README.md` is generated on demand by `ai-context` too (project-docs standard) with only the sections that apply - never copied from a template.

## Rules
1. Top-level files are fixed: `agents.md` (symlink), `overlay.md` (symlink), `project.md`, `session.md`, `assumptions.md`, `scratchpad.md`. `context/`, `docs/`, `audits/`, and `evals/` (retained eval runs, see `~/.config/agent-config/core/docs/evals.md`) are optional, created on demand. Do not add other top-level files without updating this standard.
2. `docs/` files: one topic per file, lowercase kebab-case names (`git-workflow.md`, `testing.md`). Written as imperative rules - no fill-in placeholders.
3. Content style: direct, imperative orders. Never write "context {describe here}" templates - write actual rules.
4. `agents.md` is a symlink to `~/.config/agent-config/AGENTS.md` - never edit it (the shared config is READ-ONLY). Project rules live in `project.md`: imperative, placeholder-free directives, build/test/lint commands first.
5. `.ai/` is created by `ai-init`. Keep it current with this standard.
6. Never commit `.ai/` - `ai-init` ignores it in `.git/info/exclude`, which is local to the clone, so a team repository's `.gitignore` is not edited. What the whole team should share goes in a short committed `./AGENTS.md` (`ai-init --team`): commands and conventions the code does not show.

7. Precedence: the shared config, then `overlay.md`, then `project.md` and `docs/`; the later one wins where they disagree. The shipped overlay is `core/overlays/default.md`; a user's own overlays live outside this repository in `~/.config/agent-config.local/overlays/` (or `$AGENT_CONFIG_LOCAL`) and are never committed.
8. Worktrees: `ai-worktree new` gives each task a worktree under `<main>/.worktrees/`. Its `.ai/` links `agents.md`, `overlay.md`, `project.md`, `assumptions.md`, `context/`, `docs/` and `evals/` to the main checkout, so the knowledge is shared, and holds its own `session.md` and `scratchpad.md`, so the task notes are not. `ai-init` run inside a linked worktree sets up the main checkout, and `docs-gate` reads the main checkout's `project.md` from a worktree that has none.

## When to add a `.ai/docs/` file
- When a project-specific convention must be documented (git workflow, stack rules, processes).
- Short rules go in `.ai/project.md`; full documents go in `.ai/docs/`.
- Never duplicate universal docs - if a convention already exists in the shared config (`~/.config/agent-config/core/docs/`), reference it instead; `.ai/docs/` holds only genuine project-specific deviations.
- Project technical documentation (architecture, design) belongs in the repository's committed `docs/`, not here.

## Creating convention docs (`.ai/docs/`)
- Start from the template: `~/.config/agent-config/core/templates/convention-doc.md`.
- Name files in lowercase kebab-case: `git-workflow.md`, `testing.md`.
- One topic per file; keep it lean (under ~100 lines) - split the file when it grows.
- Imperative rules only; no placeholders; no generic information the model already knows.
- Prefer pointers over embedding content (index, not dump).
- New directories under `.ai/docs/` require justification - prefer flat files.

Sources: `core/docs/sources.md`, sections "Repo design decisions" and "Agent behavior, context, and instructions".
