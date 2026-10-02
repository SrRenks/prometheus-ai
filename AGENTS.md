# AGENTS.md - v2026-09-06

## Scope and ownership
- This configuration is the single source of truth for agent behavior. It is READ-ONLY for agents: never create, edit, or delete anything under `~/.config/agent-config/` unless the human explicitly orders it. When the human does order a change, follow `~/.config/agent-config/core/docs/agent-config-authoring.md` (or load the extend-config skill).
- A project's agent configuration lives in its `.ai/` directory. `.ai/agents.md` is a symlink to this file - shared, identical in every project, updated automatically when this config changes. `.ai/project.md` holds project-specific rules. The `.ai/` structure is defined in `~/.config/agent-config/core/docs/ai-directory.md`.
- Custom, project-specific instructions belong only in `.ai/project.md` and `.ai/docs/`. Never adapt shared rules to fit one project - override in the project instead.
- Injection varies by tool: some tools auto-inject this file; others (including the dsh default preset) inject only a one-time hint. If unsure whether this file was injected, read it yourself at the start of work in any workspace.

## Section 0: Non-negotiables
1. No flattery. Never say "Great question," "Good catch," or similar. Be direct.
2. Always explain what you did. After any change, state: what files, what was changed, why.
3. Disagree when evidence contradicts. State the conflict and your confidence level.
4. Never fabricate. If you don't know, say so. Don't guess and sound certain.
5. Stop when confused. Ask. Don't barrel ahead with wrong assumptions.
6. Touch only what's requested. No drive-by refactoring. No cleanups outside scope.
7. Before the first edit, write, or mutating command in a workspace, read the mandatory doc set: `core/principles.md`, `core/docs/complexity.md`, `core/docs/maintainability.md`, `core/docs/git-workflow.md`, `core/docs/development-workflow.md`, and the project's `.ai/project.md` when it exists (paths relative to `~/.config/agent-config/`). The dsh `docs-gate` plugin denies the call until these land.
8. Formatting by audience: agent-facing files (this config, `.ai/`) are AI-only - headers and bullets, no bold, no tables, no decorative markdown. Committed project docs (`README.md`, `docs/`) are written for humans - full markdown, and the skeletons under `core/templates/` mirror that human format, tables and bold included.
9. AI-writing hygiene applies only to prose written into files for humans (README, docs, code comments, commit messages): follow `~/.config/agent-config/core/docs/ai-writing.md`. Chat replies and `.ai/` files are exempt.

## Section 1: Project entry
1. On first action in a workspace, classify the project:
   - NEW - empty, scaffold-only, no build history. Propose `ai-init`, fill `.ai/project.md` and project context, then plan the build-out.
   - EXISTING - has source, build files, or commit history. Onboard like a new employee before any change: survey `docs/repository-map.md` and `.ai/context/index.md`, review git history, then ask targeted questions about anything unclear - business rules, database, conventions, hidden context. Follow the full procedure in `~/.config/agent-config/core/docs/onboarding.md`. Never re-create, restructure, or "improve" what already works.
2. At session start in an initialized project, read `.ai/project.md` and `.ai/session.md` before acting. In an EXISTING project, check git state first: current branch, uncommitted changes, recent commits; never make changes on `main` or a protected branch, and never create or switch branches, without the human's approval. Most tools do not inject `.ai/` files; this instruction is the only mechanism that loads them.
3. Read state before acting: `.ai/assumptions.md` (decision log), `.ai/scratchpad.md` (working notes), `.ai/context/index.md` (project knowledge base).
4. Capture project knowledge as it is confirmed - from the user's words or your exploration - into the matching file: `.ai/context/domain.md` (purpose, business rules, glossary), `.ai/context/architecture.md` (modules, data flow), `.ai/context/database.md` (schema, storage), `.ai/context/dependencies.md` (external services), `.ai/context/conventions.md` (local rules), `.ai/project.md` (stack, build/test, conventions), `.ai/assumptions.md` (decisions). Replace the open questions in the topic files with the confirmed facts. Never put facts in `.ai/context/index.md` - it is machine-owned.
5. Consult `.ai/context/` and `.ai/docs/` for project-specific knowledge and the repository's `docs/` for technical documentation.
6. Generate `README.md` and context topic files on demand with `ai-context` - driven by detected project context, only sections that apply. Never copy generic templates into the project.
7. When creating agent-facing `.md` files (`.ai/`), follow `~/.config/agent-config/core/docs/ai-directory.md` and start from `~/.config/agent-config/core/templates/convention-doc.md`. Project docs (`README.md`, `docs/`) follow `~/.config/agent-config/core/docs/project-docs.md` and are formatted for humans.
8. Commit only after human approval.

## Section 2: Workflow (CRISPY)
Full procedure and step order: `~/.config/agent-config/core/docs/development-workflow.md`.
### Analysis
1. Read the project's `docs/repository-map.md` for structure; if absent, use `~/.config/agent-config/core/docs/repository-map.md`.
2. Read the mandatory doc set (Section 0, rule 7) before loading anything else.
3. Plan before code for multi-file or uncertain work: numbered plan with explicit success criteria, with the assumptions recorded in `.ai/assumptions.md`. Skip the written plan when the change fits a one-sentence diff.
   Gate: the plan is approved before implementation starts.
### Implementation
1. Surgical changes only - every diff line traces to the request. Minimum scope, not minimum quality: handle errors and edge cases. One task at a time.
2. Test-first: write failing test -> implement -> verify pass -> refactor.
3. Stay inside the complexity budgets, single-sourced at `~/.config/agent-config/core/docs/complexity.md`.
   Gate: linters clean and all tests passing before review.
### Review
1. Self-review the diff, then one ruthless edit of your own draft - remove dead code, abstractions, debug artifacts, and noise comments.
2. Fresh-context review: delegate the diff to a subagent (or second session) that does not share this conversation; fix its valid findings before declaring done.
3. Run the validation checklist - `~/.config/agent-config/core/docs/validation-checklist.md` (a project `docs/validation-checklist.md` overrides it) - and scan any human-facing prose in the change against `~/.config/agent-config/core/docs/ai-writing.md`.
   Gate: human approval before the commit. Stage explicit files only; never `git add -A`.

## Section 3: Reference docs - shared, read on demand
Read on demand; never copy them into projects. Paths below are relative to `~/.config/agent-config/`.
- `.ai/` structure: `core/docs/ai-directory.md`
- Extending this config (rules/skills/docs/templates): `core/docs/agent-config-authoring.md`
- Onboarding: `core/docs/onboarding.md`
- Project docs standard: `core/docs/project-docs.md`
- Development workflow: `core/docs/development-workflow.md`
- Validation checklist: `core/docs/validation-checklist.md`
- Evals (retained task set for config changes): `core/docs/evals.md`
- Sources and evidence: `core/docs/sources.md`
- Git/Commits: `core/docs/git-workflow.md`
- Architecture: `core/docs/architecture.md`
- Code Style: `core/docs/coding-standards.md`
- AI-writing tells (README/docs/comments/commit messages): `core/docs/ai-writing.md`
- Testing: `core/docs/testing.md`
- Security: `core/docs/security.md`
- Complexity: `core/docs/complexity.md`
- Coupling: `core/docs/coupling.md`
- Debugging: `core/docs/debugging.md`
- Maintainability: `core/docs/maintainability.md`
- Performance: `core/docs/performance.md`
- Languages: `core/docs/languages/`
- Decisions: `core/docs/decisions/`
- Dependencies: `core/docs/dependency-policy.md`

## Section 4: Memory files (`.ai/`, local-only, never committed)
- `.ai/agents.md` - symlink to this file (shared; do not edit)
- `.ai/project.md` - project-specific rules (stack, build/test/lint, conventions)
- `.ai/session.md` - current session state (update at end of each task/session)
- `.ai/assumptions.md` - decision log
- `.ai/scratchpad.md` - working notes
- `.ai/docs/` - project-specific convention docs
- `.ai/context/` - project knowledge base (domain, architecture, database, dependencies, conventions)
- `.ai/evals/` - retained eval runs, optional (see `~/.config/agent-config/core/docs/evals.md`)
- Never commit `.ai/`; it is per-project knowledge, not project content.

## Section 5: No-Go
- No new dependencies without approval - prefer the standard library (see `docs/dependency-policy.md`)
- No speculative abstractions - build only what the current task needs
- No interfaces solely for mocking - introduce them at stable boundaries with multiple implementations
- No rewriting working code during feature changes - extend existing patterns, don't replace them

## Section 6: Tool usage
- Prefer dedicated search/read tools over shell commands for file access: in-project text search, file discovery, reading files, and diff review all have dedicated tools; use the shell only when no dedicated tool exists.
- Search once, search well: one precise query beats repeated similar ones; read only the line ranges needed.
- Web search is a last resort, not a first move: consult local sources first (this config's `docs/`, `.ai/context/`, `.ai/docs/`, the repo's `docs/`, and files already read). Use it only for what local sources cannot answer: current versions/changelogs of external dependencies, upstream breaking changes, official API docs, and errors that require external knowledge. Cite the source and retrieval date for any fact taken from the web.
