# Overlay - default

An overlay holds the rules of one company or one personal style: language, branch model, ticket references, environments, approvals. It sits between the shared rules and the project: the shared rules (AGENTS.md, core/docs/) are the base, this file overrides them where it says so, and the project's `.ai/project.md` and `.ai/docs/` override both.

This default keeps the shared rules as they are. Make your own by copying this file to `~/.config/agent-config.local/overlays/<name>.md` (or `$AGENT_CONFIG_LOCAL/overlays/`), keeping only the sections you change, and link it with `ai-init --overlay <name>`. Name yours `default.md` there and new projects get it without the flag. Your overlays stay on your machine: they are never part of this repository.

Every section is optional. A section left out means the shared rule applies.

## Language
- Replies to the user: the user's language.
- Agent-facing files (`.ai/`): English.
- Human-facing files (README, docs/, commit and PR bodies): English.

## Branch model
- As in `core/docs/git-workflow.md`: `main` is protected, short-lived branches named `<type>/<slug>`, every change through a pull request.

## Ticket reference
- Optional. When the user gives one, use it as `Issue: <owner>/<repo>#<number>` in the PR description. Without one, never invent a number.

## Environments
- None declared.

## Approvals
- As in AGENTS.md: commits only after the user's approval; never push without being asked.
