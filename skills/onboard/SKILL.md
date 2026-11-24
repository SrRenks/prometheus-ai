---
name: onboard
description: 'Understand a repository like a new engineer: classify NEW vs EXISTING, survey docs and history, summarize, ask questions, and change nothing. Use when starting work in an unfamiliar repository or when the user asks to be onboarded.'
---
You have just joined this project as a new engineer. Your task is to understand it, not change it. Do NOT edit, create, or delete any files during onboarding.

1. Classify the project: NEW (empty/scaffold, no build history) or EXISTING (source, build files, or commits).
2. For EXISTING: check git state first (current branch, git status, recent commits); stop and ask before working on main or a protected branch. Then read .ai/project.md and .ai/context/index.md if present, and survey the parts the task touches: their entry points, manifests, tests and recent history. Do not map the whole repository unless asked; core/docs/onboarding.md says why. Summarize what you found and what the code does not tell you.
3. Ask concrete questions about anything unclear (business rules, database, conventions, hidden context) and STOP for answers before proposing any change. Never re-create, restructure, or improve what already works.
4. If .ai/project.md is missing (NEW or EXISTING), propose running ai-init; docs-gate denies changes until it has run. For NEW, propose the scaffolding plan (ai-init, .ai/project.md, ai-context context + README). Then STOP.
