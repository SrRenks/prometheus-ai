# prometheus-ai authoring spec (v2026-09-07)

Purpose: how to create or extend files in this repo when the human explicitly orders it. The config is READ-ONLY otherwise (AGENTS.md, Scope section). Load this spec, then follow it exactly.

## Where each thing goes
- core/docs/<topic>.md - reference doc, read on demand, listed in AGENTS.md section 3
- core/docs/languages/<lang>.md - language guidelines (tooling, linter config, practices)
- agents/claude-code/rules/<lang>.md - scoped rules with dual frontmatter, short imperative bullets
- skills/<name>/SKILL.md - a procedure the agent runs on demand
- core/templates/<file> - skeletons copied into projects by ai-init and ai-context
- agents/dsh/presets/renks/ - dsh preset (patch flow; see its README.md)
- setup.sh - machine bridges (symlinks); README.md - human overview; core/docs/repository-map.md - structure doc

## File formats (follow exactly)

Rules, agents/claude-code/rules/<lang>.md:
---
description: One sentence, what these rules cover.
globs: "**/*.go"
paths:
  - "**/*.go"
---
- Imperative bullets only, 5 to 20 lines, no prose paragraphs.
description and globs serve Cursor; paths serves Claude Code. Keep both keys when adding or editing a rule.

Skills, skills/<name>/SKILL.md:
---
name: kebab-case, equal to the directory name
description: What the skill does plus when to use it, trigger phrasing included. Both Claude Code and dsh pick a skill from this field, so the triggers live here and nowhere else.
---
- Body: numbered imperative steps; state the deliverables; end with a stop condition (wait for approval or report).
- Never duplicate a procedure that already exists; extend the existing skill instead.
- Keep bodies lean. A loaded skill occupies context, so every line must pay rent.
- Frontmatter is YAML and must parse. A colon followed by a space inside an unquoted value ends the scalar and breaks the file, so single-quote the `description` when it contains one. A block that fails to parse makes the skill disappear from `skill_search` with no error anywhere.

Reference docs, core/docs/*.md:
- Agent-facing format: headers and bullets only; no bold, no tables, no em dashes, no decorative markdown (AGENTS.md section 0 rule 8).
- One topic per file. Order: purpose, rules, procedure.

Language docs, core/docs/languages/<lang>.md:
- Sections: Tooling, Recommended linter configuration, Practices. Mirror go.md.
- Agent-facing format (the agent reads them while coding).

Templates:
- Start from the closest existing template. Keep placeholders minimal and named.

## Wiring checklist (run after creating any file)
1. New reference doc: add one line to AGENTS.md section 3.
2. New tool bridge or top-level dir: update setup.sh symlinks plus the README layout and matrix.
3. Structure changes: update core/docs/repository-map.md.
4. New skill: nothing else needed (auto-discovered by dsh and Claude Code through the skills/ symlinks).
5. New rule: nothing else needed (auto-loaded by Claude Code and Cursor).
6. Preset changes: follow the agents/dsh/presets/renks/README.md patch flow; run the retained eval set (core/docs/evals.md) before changing defaults.
7. Commit: conventional message, plain wording, explicit files only, never git add -A. Wait for human approval before committing (AGENTS.md section 1 rule 8).
8. New behavioral rule or numeric threshold: add its entry to core/docs/sources.md in the same commit, naming the source, the URL or DOI, the retrieval date, and the claim it justifies. With no citable source, label the claim repo design or community practice. A file that ends without a Sources line gets one.

## Validation before finishing
- Scripts: bash -n <file>.
- Preset YAML: node -e "require('yaml').parse(...)" run from ~/.dsh/profiles; the !!js tag warnings are expected.
- Patch integrity: apply agent.cordis.patch to stock-baseline.agent.cordis.yml and diff against fallback.agent.cordis.yml; must be byte-exact.
- Skill frontmatter: name and description present; name equals the directory; the block parses as YAML.
- Rule frontmatter: description, globs, paths present; the block parses as YAML.
- Frontmatter sweep: python3 -c "import yaml,pathlib; [yaml.safe_load(p.read_text()[3:p.read_text().find('\n---',3)]) for p in pathlib.Path('.').rglob('*.md') if p.read_text().startswith('---')]" returns without raising.
- Symlinks: find . -type l ! -exec test -e {} \; -print must return nothing.
- Hooks: the tool names a hook compares must match its matcher in agents/claude-code/settings.json. A mismatch in case makes the hook exit without doing anything, which stays invisible until someone traces it. Feed the hook a payload carrying the real tool name and confirm it reaches its work.
- Injection budget: python3 -c "import tiktoken,pathlib; e=tiktoken.get_encoding('o200k_base'); print(sum(len(e.encode(pathlib.Path(p).read_text())) for p in ('AGENTS.md','agents/claude-code/CLAUDE.md')))" stays at or below 2500. tiktoken is not a repo dependency; any BPE encoder reads the same files within a few tokens.
- Human-facing prose: scan against core/docs/ai-writing.md and fix the tells.
- Provenance: every numeric threshold in the changed files has an entry in core/docs/sources.md; check with grep -rnE '[<>≤≥] ?[0-9]+' core/docs/*.md.

## Procedure
1. Classify the request: rule, skill, doc, template, preset, or bridge.
2. Read the closest existing file of that type and copy its structure.
3. Write the file following the format rules above.
4. Run the wiring checklist.
5. Run the validation list.
6. Report what was created, where it is wired, and what remains unverified.
