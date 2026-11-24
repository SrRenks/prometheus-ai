# Personal preferences - committed; edit to match yours.
# NOT loaded by Claude Code from ~/.claude: it reads CLAUDE.local.md only at a
# project root (https://code.claude.com/docs/en/memory, retrieved 2026-11-23).
# To use it in a project, add `@~/.claude/CLAUDE.local.md` to that project's
# CLAUDE.local.md. Not imported globally: the standing-injection budget has no room.

## Editor
- I use Neovim. Set EDITOR=nvim for commit messages and multi-line input.
- Prefer 2-space indent in JS/TS. 4-space in Go. PEP 8 for Python.

## Git
- Branch naming and commit format: `core/docs/git-workflow.md` (`<type>/<slug>`, conventional commits).

## Testing
- Always run tests with `--verbose` flag.
- If a test is flaky, fix the flakiness - don't skip it.

## Communication
- Prefer terminal commands over GUI suggestions.
- When proposing a change, show the exact diff or command first, then explain.
