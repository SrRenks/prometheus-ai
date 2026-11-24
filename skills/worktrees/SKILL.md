---
name: worktrees
description: 'Do work in a git worktree so the main checkout stays untouched and parallel tasks never share a checkout: create the worktree with ai-worktree, work and verify inside it, land the branch, then clean up. Use when work must run alongside another task or agent in the same repository, when the main checkout holds uncommitted changes, or when the user asks for an isolated workspace.'
---
Keep every checkout on one task, and do the work somewhere else.

1. Check state first - `ai-worktree list`, `git status` and `git branch --show-current`. Never touch uncommitted changes that are not yours, and never switch the branch of a checkout your task did not create: another session may be working in it.
2. Create the worktree, with the human's approval since it creates a branch - `ai-worktree new <task> --type <type>` (branch `<type>/<task>`; `--branch` and `--base` follow `.ai/overlay.md` when it sets a branch model). It lives in `<main>/.worktrees/<task>`, is locked while the task runs, shares the project's `.ai/` knowledge and keeps its own `.ai/session.md`. Without `ai-worktree`: `git worktree add <path> -b <branch>`.
3. Set it up - install dependencies inside the worktree, and give it its own ports, database names and container project name, so two tasks never collide on them. List gitignored files it needs, such as `.env`, in `.worktreeinclude` (gitignore syntax; only files git ignores are copied).
4. Work and verify inside the worktree - run tests, linters, builds and git there, from its root, one git command at a time.
5. One worktree, one task - do not reuse a worktree across unrelated tasks, and do not switch its branch mid-task. A branch checked out in one worktree cannot be checked out in another; never force it.
6. Land it - push the branch and open the PR, or merge locally when the human says so. Ask before merging or rebasing.
7. Clean up - `ai-worktree remove <task> --delete-branch` once the branch is merged; it refuses uncommitted work and also forgets a worktree deleted by hand. Remove only your own task's worktree: the lock marks a task as taken but does not tell a running one from a finished one. For an abandoned branch, ask before `git branch -D`.

Deliverable: the branch with the change, verified in isolation, plus the worktree path used.

Stop condition: report the branch, the worktree path, and the verification result. Ask before merging.
