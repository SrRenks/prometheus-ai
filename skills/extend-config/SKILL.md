---
name: extend-config
description: 'Create or update files in the prometheus-ai repo (rules, skills, docs, templates, presets, bridges) following its authoring spec. Use when the user asks to add, extend, or reorganize the prometheus-ai repo, or to create new agent config files following the existing patterns.'
---
1. Read ~/.config/prometheus-ai/core/docs/prometheus-ai-authoring.md and follow it exactly.
2. Classify the requested change; read the closest existing file of that type and copy its structure.
3. Create or edit following the spec's format rules; run its wiring checklist and validation list.
4. Never commit without explicit human approval (AGENTS.md section 1 rule 8). Report what was created, where it is wired, and what remains unverified.
