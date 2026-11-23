# Claude Code specific
- Use plan mode for multi-file or uncertain tasks. Skip the plan when the change fits a one-sentence diff.
- Model tiering (task-based, not brand-based): strongest model for planning, architecture, and hard debugging; a smaller/faster model for routine edits, mechanical refactors, and simple queries; mid-tier for interactive work. Re-evaluate when models change. Price is not quality - measure task success and total cost (see `core/docs/evals.md`).
- Prefer prompt-caching-friendly structure: stable system prompt, append-only conversation, avoid rewriting earlier context.
- Use sub-agents for parallel work when tasks are independent (exploration and review), not for parallel coding by default.
- Run `/review` before declaring done (includes the fresh-context review step).
