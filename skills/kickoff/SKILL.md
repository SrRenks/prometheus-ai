---
name: kickoff
description: 'Start a task from an issue or ticket: list what the issue leaves unspecified and ask about it, create the task''s own worktree and branch, then plan in fixed phases that start by reproducing the bug or the missing behaviour with a failing test, and stop for approval. Use when the user hands over an issue, ticket, or chamado to start, or asks to begin a new task in an existing repository.'
---
Turn a ticket into a specified task in its own worktree, with a plan that starts from a reproduction. Write no code before the plan is approved.

1. Read the issue. With `owner/repo#n` and a working `gh`, run `gh issue view`; otherwise use the text the user pasted. Read `.ai/overlay.md` for the ticket and branch rules; without a ticket number where the overlay needs one, ask, and never invent one.
2. Check state. Run `ai-worktree list` and `git status`. Never switch the branch of a checkout your task did not create: another task may be running there.
3. Find what the issue touches, narrowing in steps: candidate files from the issue's words, `ai-survey` markers and search; then `ai-skeleton <files>` to pick the definitions; then read only those line ranges and their direct callers and callees. Re-check any `.ai/context/` fact about those files whose cited file changed since its `Verified at` commit. A reproduction that only reads, such as running the existing tests or a command, may run now; record its output.
4. Check for missing information, explicitly. Write down, for this issue: the expected behaviour, the actual behaviour, the inputs or data that trigger it, the edge cases, what is out of scope, and how the user will judge it done. Mark each item as stated in the issue, answered by the code, or missing. Ask about every missing item, batched, and stop for answers. Models rarely ask unless they check like this, and in the measured study asking recovered most of what an underspecified issue cost.
5. Specify. Draft, for the user to confirm: the goal in one sentence, acceptance criteria that a test or command can check, non-goals, the files likely to change, and risks.
6. Worktree. Show the exact command, built from the overlay's branch rules (default `ai-worktree new <slug> --type <type>`), and run it once approved. Work only inside the worktree from here on.
7. Plan and stop. Write into the worktree's `.ai/session.md` the confirmed spec and a plan in fixed phases:
   - reproduce: the failing test (or command) that shows the bug or the missing behaviour, written and run first, before any fix. A reproduction test is the signal with the largest measured gain in resolving issues. When it cannot be reproduced, the plan says why and asks.
   - change: the smallest change that makes it pass.
   - validate: the reproduction passes, then the project's tests and linters.
   Present the plan with the plan skill and stop for approval. After approval, follow the phases in order and re-read the plan in `session.md` between them.

Deliverable: the worktree path, its branch, and the spec and plan in its `.ai/session.md`. Stop condition: the plan is presented and waits for approval.
