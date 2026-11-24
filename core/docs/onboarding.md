# Onboarding - first steps in an existing project

Shared workflow for onboarding into an already-working codebase. Applies to EXISTING projects only; empty or scaffold-only repos take the ai-init path instead. Read on demand; never copy into projects.

## Purpose
One deterministic, read-first-then-ask procedure to understand an existing codebase, then capture confirmed knowledge in `.ai/` before any change is made.

## Workflow
1. Classify before acting - confirm EXISTING (source, build files, or commit history). NEW/empty repos go through ai-init, not this flow. If `.ai/project.md` is missing, propose `ai-init` and run it once approved: `docs-gate` denies changes in a git workspace until `.ai/project.md` exists, and leaves reading open.
2. Read state - git state first: current branch, `git status` (uncommitted changes), `git log --oneline -10`; then `.ai/project.md`, `.ai/session.md`, `.ai/assumptions.md`, `.ai/context/index.md` if present; root `README.md`; `docs/repository-map.md`.
3. Survey what the task touches, read-only - start from `ai-survey`, which computes the git state, stack markers, churn and (with `--siblings`) the neighbouring repositories, then read the entry points, manifests, CI config and tests of that area, narrowing from files to definitions (`ai-skeleton`) to the line ranges that matter. Do not map the whole repository up front: a study of repository context files found that pushing agents into more exploration raised cost by about a fifth without raising task success (arXiv:2602.11988). No code edits in this phase.
4. Map as far as the task needs - module layout, data flow, external boundaries, change points and seams in that area. Draft `docs/repository-map.md` only when the human asks for one (human-formatted, committed).
5. Ask, never presume - run the question checklist below. Batch by topic; wait for answers before the next batch.
6. Capture confirmed facts - fill `.ai/project.md` and `.ai/context/` topic files; log decisions in `.ai/assumptions.md`.
7. Verify understanding - run build, tests, lint; trace one end-to-end request through the code; state back a summary and get confirmation before any change.

## Skills for the deeper passes
- `audit`: the first full audit of an existing project and its related repositories, every fact with `path:line` evidence and a confidence, conflicts and open questions kept apart; re-run to refresh stale facts.
- `quality-audit`: tools first, then findings proven by a reproduction or a traced path, unproven ones kept apart.
- `kickoff`: missing information listed and asked about, a failing reproduction in the task's own worktree, then a plan in fixed phases.

## Question checklist - ask the items the task depends on, never assume
- Branches and git - naming scheme, protected branches, where features branch from, merge strategy.
- Pull requests - required checks, reviewers, squash vs merge, title and description conventions.
- Environments - dev, QA, staging, prod: how to run each, config sources, secrets location, who has access.
- Domain - what the system does, business rules, glossary terms.
- Database and storage - engines, schema source, migrations, backup and restore.
- External services - APIs, message queues, auth providers, cron jobs.
- Build, test, lint - exact commands; confirm against CI config, not manifests alone.
- Conventions - code style, commit style, doc locations, any local rules not yet in `.ai/`.
- Deployment and releases - how code ships, versioning, rollback.
- Ambiguities - every code path whose intent is not explicit; ask instead of inferring.

## Output - files to write as facts are confirmed
- `.ai/project.md` - build/test/lint commands and conventions the code does not show. Facts an agent can derive from the repository cost context without helping; human-written context helped where generated context did not (arXiv:2602.11988).
- `.ai/context/domain.md`, `architecture.md`, `database.md`, `dependencies.md`, `conventions.md` - create only the files that apply; replace open questions with confirmed facts.
- `.ai/assumptions.md` - one numbered entry per decision.
- Never write facts into `.ai/context/index.md` - it is machine-owned.

## Rules
- Never presume business rules, workflow, or architecture; when the code does not make them explicit, ask.
- Never edit code during onboarding; it is read-only until understanding is confirmed.
- Never make changes on `main` or another protected branch; if the session starts there, stop and ask which branch to work on. Never create or switch branches without the human's approval.
- Never touch uncommitted changes that are not yours; if the tree is dirty, ask how to proceed.
- Never fabricate; record unknowns as open questions, not guesses.
- Do not dump all questions at once; batch by topic and wait for answers.
- Create only the context files that apply; no `database.md` without a database.
- Keep `.ai/docs/` lean; reference shared docs instead of duplicating them.
- Treat untested code as legacy; note characterization-test targets for later, but do not write tests during onboarding.

## Pointers
- `.ai/` structure: `ai-directory.md`
- Repo map: `repository-map.md`
- Git and PR: `git-workflow.md`
- Project docs: `project-docs.md`
- Behavior rules: `../principles.md`
