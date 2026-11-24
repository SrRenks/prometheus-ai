---
name: kickoff
description: 'Start a task from an issue or ticket: read the issue, check what the project already knows, interview the user until the task is specified with testable acceptance criteria, create the task''s own worktree and branch, then plan and stop for approval. Use when the user hands over an issue, ticket, or chamado to start, or asks to begin a new task in an existing repository.'
---
Turn a ticket into a specified task in its own worktree. Write no code in this skill.

1. Read the issue. With `owner/repo#n` and a working `gh`, run `gh issue view`; otherwise use the text the user pasted. Read `.ai/overlay.md` for the ticket and branch rules; without a ticket number where the overlay needs one, ask, and never invent one.
2. Check state. Run `ai-worktree list` and `git status`. Never switch the branch of a checkout your task did not create: another task may be running there.
3. Read what the issue touches: `.ai/project.md`, the `.ai/context/` facts about those files (re-check any cited file changed since its `Verified at` commit), then the code itself.
4. Interview. Ask the questions you need to write the spec, batched, and stop for answers. Ask about behaviour, edge cases and what is out of scope; do not ask what the code answers.
5. Specify. Draft, for the user to confirm: the goal in one sentence, acceptance criteria that a test or command can check, non-goals, the files likely to change, risks, and the test plan.
6. Worktree. Show the exact command, built from the overlay's branch rules (default `ai-worktree new <slug> --type <type>`), and run it once approved. Write the confirmed spec into that worktree's `.ai/session.md`, and work only inside the worktree from here on.
7. Plan. Use the plan skill inside the worktree, and stop for approval before any code.

Deliverable: the worktree path, its branch, and the spec in its `.ai/session.md`. Stop condition: the plan is presented and waits for approval.
