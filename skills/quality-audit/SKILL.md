---
name: quality-audit
description: 'Audit code quality and risk in an existing repository: deterministic tools first, then model findings ranked by severity with file:line evidence and a failure scenario, each one challenged by a fresh-context refutation pass before it is reported. Read-only. Use when the user asks for a quality, risk, or security audit of a repository or an area of one.'
---
Find what is actually wrong, with proof, and report it. Fix nothing unless asked.

1. Scope. Agree the area with the user (the whole repository, a module, the files a change touches). Read `.ai/project.md` for the build, test and lint commands and `.ai/overlay.md` for local rules.
2. Tools first. Run what the project already has: its linters, type checker and tests; the complexity limits of `core/docs/complexity.md` with the tool its `core/docs/languages/*.md` names; a dependency audit (`npm audit`, `pip-audit`, `govulncheck`, `cargo audit`) and `semgrep` when installed. Do not install a tool without approval. Record each command and its result.
3. Model findings. Read the scoped code for what tools cannot see: wrong logic, unhandled failure paths, data loss, security holes, races, broken contracts with callers. Triage the tool output too: a tool warning is a finding only when you can show its consequence. Skip style and taste.
4. Write each finding as: severity (critical, high, medium, low), `path:line`, one-sentence defect, failure scenario (the input or state, and the wrong outcome), evidence.
5. Refute. Hand each finding to a subagent that does not share this conversation, with the code and the claim but not your reasoning, and ask it to prove the finding wrong. Keep CONFIRMED and PLAUSIBLE findings, drop refuted ones, and say how many were dropped. A reviewer asked to find problems always finds something; this pass is what separates the real ones.
6. Report. Write `.ai/audits/<YYYY-MM-DD>-quality.md`: scope, commit, tool results, then the findings most severe first. Run `ai-lint`. Give the user the top findings and the file path.

Deliverable: the audit file and a short ranked summary. Stop condition: the report is delivered; propose fixes only when the user asks for them.
