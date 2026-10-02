#!/usr/bin/env bash
# setup.sh - Install agent-config for every supported tool on this machine.
# Run once per machine (idempotent). Derives paths from its own location,
# so the repo can be cloned anywhere.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SRC}/backups/$(date +%Y%m%d-%H%M%S)"

backup() {
    local target="$1"
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        mkdir -p "$BACKUP_DIR"
        cp -r "$target" "$BACKUP_DIR/"
        echo "  backed up: $target -> $BACKUP_DIR/"
    fi
}

symlink() {
    local src="$1"
    local dst="$2"
    backup "$dst"
    rm -rf "$dst"
    mkdir -p "$(dirname "$dst")"
    ln -sf "$src" "$dst"
    echo "  linked: $dst -> $src"
}

echo "=== agent-config setup (SRC: ${SRC}) ==="

# The rule docs referenced from AGENTS.md and the skills name the canonical path,
# so a clone somewhere else leaves those references pointing at nothing.
CANONICAL="$HOME/.config/agent-config"
if [ "$SRC" != "$CANONICAL" ]; then
    echo ""
    echo "  warning: config is at ${SRC}, not ${CANONICAL}."
    echo "           Paths written inside AGENTS.md and the skills assume"
    echo "           ${CANONICAL}, so agent instructions will reference files that"
    echo "           are not there. Move the clone, or export AGENT_CONFIG_DIR when"
    echo "           running ai-init / ai-context."
    echo ""
fi

# ── Claude Code ──────────────────────────────────────────────────────────────
symlink "$SRC/agents/claude-code/CLAUDE.md"       "$HOME/.claude/CLAUDE.md"
symlink "$SRC/agents/claude-code/CLAUDE.local.md" "$HOME/.claude/CLAUDE.local.md"
symlink "$SRC/agents/claude-code/settings.json"   "$HOME/.claude/settings.json"
symlink "$SRC/skills"                             "$HOME/.claude/skills"
symlink "$SRC/agents/claude-code/hooks"           "$HOME/.claude/hooks"
symlink "$SRC/agents/claude-code/rules"           "$HOME/.claude/rules"
symlink "$SRC/agents/claude-code/commands"        "$HOME/.claude/commands"
symlink "$SRC/agents/claude-code/claudeignore"    "$HOME/.claudeignore"

# ── Codex ────────────────────────────────────────────────────────────────────
symlink "$SRC/AGENTS.md" "$HOME/.codex/AGENTS.md"

# ── Gemini CLI ───────────────────────────────────────────────────────────────
symlink "$SRC/agents/gemini/GEMINI.md" "$HOME/.gemini/GEMINI.md"

# ── Cursor (reuses the shared rules: combined frontmatter serves both) ───────
symlink "$SRC/agents/claude-code/rules" "$HOME/.cursor/rules"

# ── Generic fallback (some tools read ~/.agents/AGENTS.md) ───────────────────
symlink "$SRC/AGENTS.md" "$HOME/.agents/AGENTS.md"

# ── Git identity (directory-scoped; see core/docs/git-workflow.md) ─────────────
GC="$HOME/.gitconfig"
IDENT="$HOME/.config/git/identity"
if [ ! -f "$IDENT" ]; then
    mkdir -p "$(dirname "$IDENT")"
    NAME=$(git config --global user.name 2>/dev/null || true)
    EMAIL=$(git config --global user.email 2>/dev/null || true)
    printf '[user]\n\tname = %s\n\temail = %s\n' "${NAME:-YOUR NAME}" "${EMAIL:-you@example.com}" > "$IDENT"
    chmod 600 "$IDENT"
    echo "  created: $IDENT (personal data - never tracked in a repo)"
fi
if grep -q 'config/git/identity' "$GC" 2>/dev/null; then
    echo "  skip: ~/.gitconfig already includes $IDENT"
else
    mkdir -p "$(dirname "$GC")"
    printf '\n[includeIf "gitdir:~/Projects/**"]\n\tpath = %s\n[includeIf "gitdir:~/.config/**"]\n\tpath = %s\n' "$IDENT" "$IDENT" >> "$GC"
    echo "  wired: ~/.gitconfig includes $IDENT for ~/Projects/** and ~/.config/**"
fi

# ── ai-init / ai-context commands ────────────────────────────────────────────
mkdir -p "$HOME/.local/bin"
ln -sfn "$SRC/ai-init" "$HOME/.local/bin/ai-init"
ln -sfn "$SRC/ai-context" "$HOME/.local/bin/ai-context"
echo "  linked: ~/.local/bin/ai-init -> $SRC/ai-init"
echo "  linked: ~/.local/bin/ai-context -> $SRC/ai-context"

echo ""
echo "Done. Installed:"
echo "  Claude Code : ~/.claude/ (CLAUDE.md, skills, hooks, rules, commands, settings.json)"
echo "  Codex       : ~/.codex/AGENTS.md"
echo "  Gemini CLI  : ~/.gemini/GEMINI.md"
echo "  Cursor      : ~/.cursor/rules"
echo "  Generic     : ~/.agents/AGENTS.md"
echo "  Commands    : ~/.local/bin/ai-init, ai-context"
echo "  Git identity : ~/.config/git/identity (conditional include from ~/.gitconfig)"
echo ""
echo "dsh (DeepSeek Harness) is installed separately:"
echo "  bash \"$SRC/agents/dsh/install.sh\""
echo ""

# ── What is actually present, and where the rules stop being enforced ────────
# Wiring a harness is not the same as having it, and the rules reach each one
# differently. `dsh` admits a plugin that DENIES a tool call; Claude Code admits
# hooks; Cursor, Codex and Gemini receive the rules as prose with nothing behind
# them. Reporting this at install time is the only place a reader learns it,
# because nothing fails when a harness is absent - the links just sit there.
echo "Harnesses found on PATH:"
for tool in dsh claude cursor codex gemini; do
    if command -v "$tool" >/dev/null 2>&1; then
        printf '  %-10s %s\n' "$tool" "$(command -v "$tool")"
    else
        printf '  %-10s not installed (its config is linked but unused)\n' "$tool"
    fi
done
echo ""
# Mirrors the Guardrails table in README.md; an edit here belongs there too.
echo "Where the shared rules are enforced, not just read:"
echo "  dsh          docs-gate denies a mutating tool call until the docs are read"
echo "  Claude Code  block-danger and lint-check hooks"
echo "  Cursor       none - rules activate by glob, nothing mediates"
echo "  Codex        none - prose only"
echo "  Gemini CLI   none - prose only"
echo ""
echo "Tooling the language guides expect (per core/docs/languages/):"
for tool in uv ruff mypy radon bandit golangci-lint cargo-audit clippy; do
    command -v "$tool" >/dev/null 2>&1 || printf '  missing: %s\n' "$tool"
done
echo "  (a missing linter does not break the guides; it means the budgets they"
echo "   state are not being checked by anything on this machine)"
