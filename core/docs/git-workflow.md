# Git workflow (shared conventions)

Generic, production-grade Git conventions for every project.
Project-specific deviations go in the project's `.ai/docs/git-workflow.md` (local-only) and override this file.

## Branch model
- `main` - always green, protected. No direct pushes; every change lands via a pull request.
- Short-lived branches off `main`, named `<type>/<slug>`: `feat/...`, `fix/...`, `chore/...`, `docs/...`, `test/...`, `refactor/...`, `ci/...`.
- Delete branches after merge. Never reuse a merged branch.

## Commits - conventional and atomic
- Format: `<type>(<scope>): <subject>` - types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.
- Subject: imperative mood, lowercase, ≤ 72 chars, no trailing period.
- Body explains the *why* (and references decisions/issue IDs when relevant).
- Atomic: one logical change per commit; each commit compiles, passes tests, and is independently reviewable.
- Never `git add -A` / `git add .` - stage explicit files only.
- Do not put agent, model, or tool attribution in a commit message: no `Co-Authored-By` naming one, no `Generated-by`, `Assisted-by`, or `AI-assisted` trailer, and no sentence crediting one as the author or as the reason for the change. Describe the change and its evidence, and leave the identity to the commit metadata. The reason is a rule about the change's content, not about disclosure: an agent naming itself adds a line that will be wrong the moment the reader checks who wrote it, and it invites the reader to weigh the author instead of the diff.

## Pull requests & merge
- Open the PR early.
- PR title = the squash-commit subject, in conventional format:
  `<type>(<scope>): <subject>` - imperative, lowercase, ≤ 72 chars, no
  trailing period.
- PR description - three sections:
  - What - what changed and why (commit-body content, decisions, issue IDs).
  - How - how it was verified (tests, lint, manual checks).
  - Notes - anything the reviewer needs: breaking changes, migration steps, follow-ups.
  - Create with `gh pr create` (via lazygit or the shell); it fills the title and body interactively.
- CI must pass before merge: build + lint + tests.
- Squash-merge to `main` - keeps main linear and `git bisect`-friendly.
- Delete the branch after merge.

## Issue format
- Use this format for PR descriptions that close a tracked ticket. The issue body doubles as the squash-commit body.
- Optional first line, only when a tracked ticket is supplied: `Issue: <owner>/<repo>#<number>`.
- Summary line: imperative mood, lowercase. Names the change and the ticket or advisory it closes.
- Then the sections, in order:
  - `Context`: root cause, dependency chain, and the advisory or issue ranges affected.
  - `What changes`: exact file and override added, plus before/after versions.
  - `Impact`: what else changed or did not change; list anything else touched.
  - `Validation`: commands run and the expected output.
  - `Notes`: only when there is something to note; omitted when empty.
- Keep each section terse; lead with facts. For PRs without a tracked ticket, use the generic three-section description above instead.

## CI
- Every push to `main` and every PR targeting `main` runs the pipeline (build, lint, test) as the merge gate.

## Tooling - lazygit + GitHub CLI
- Standardize the git workflow on lazygit + gh when available:
  - Prefer `lazygit` for interactive git: staging, committing, branches, merges, history review.
  - Prefer `gh` for everything remote: pull requests (`gh pr create`, `gh pr view`, `gh pr checks`), releases (`gh release create`), issues.
  - Drive `gh` from inside lazygit via custom commands (`customCommands` in lazygit config), so branch → commit → PR → merge is one flow. Without custom commands, run `gh` in the same repo from the shell.
  - Stage explicit files only - never "stage all" (`git add -A` / `git add .`), including in lazygit.
- Availability gate: use each tool only if installed AND working (`gh auth status` for gh). If missing or unauthenticated, fall back to plain `git` + the GitHub web UI. Never block work on tool availability.

## Releases
- Tag `main` with semantic versions: `v0.1.0`, `v0.2.0`, ...
- Changelog derived from conventional commit subjects (tooling when the first release is cut).

## History hygiene
- Never rewrite history after it has been pushed/shared.
- Sole exception: secrets, credentials, or personal data committed by mistake. Purge them from every commit (`git filter-branch --index-filter` / `git filter-repo`), clean refs and reflog, force-push, then rotate whatever was exposed.
- No scratch notes, tool artifacts, or generated files in commits.

## Git identity & auth
- Identity (user.name, user.email) is commit metadata, not authentication. Git resolves it local → global → system; a repo's `.git/config` always wins.
- Do not hard-code a global identity in `~/.gitconfig`. Identity is directory-scoped via conditional includes: `~/.gitconfig` includes `~/.config/git/identity` for `~/Projects/` and `~/.config/`.
- Personal identity is never tracked in a repo. Set or change it in `~/.config/git/identity` (mode 600); the includes pick it up with no reinstall.
- Auth is SSH and machine-level, never git config. GitHub auth uses the default key `~/.ssh/id_ed25519`; `~/.ssh/config` has no `github.com` entry.

Sources: `core/docs/sources.md`, section "Git, commits, and releases".
