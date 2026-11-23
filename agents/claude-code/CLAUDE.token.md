# Token mode
- AGENTS.md is not imported here, so it does not ride along in every request. It is still the rule set: read `~/.config/agent-config/AGENTS.md` before the first action of a session, and again after compaction.
- `docs-gate` denies an edit, a write, or a mutating command until the tier's docs are read, and names the files.
- Switch back to the full import with `~/.config/agent-config/setup.sh --mode subscription`.

@~/.config/agent-config/agents/claude-code/claude-code.md
