---
name: audit
description: 'First audit of an existing project and the repositories it talks to: computed survey, question-driven exploration, evidence-backed facts filed into .ai/context/, open questions for the user. Re-run it to refresh facts the code has moved past. Use when starting on an existing repository that has no audited .ai/context/ yet, when the user asks for an audit or a project map, or when recorded facts look stale.'
---
Build the project knowledge the code cannot show at a glance, with evidence for every fact. Change no source file.

1. State first. Run `ai-survey` (add `--siblings <parent dir>` when related repositories live next to this one; it reads only their manifests and last commit date) and read its git section: if this checkout is on a branch your task did not create or shows changes that are not yours, work read-only and say so. If `.ai/project.md` is missing, ask to run `ai-init` (docs-gate requires it). Read `.ai/overlay.md`, `.ai/project.md` and `.ai/context/` if present.
2. Scope by questions, not coverage. Write down the questions the user's work needs answered (what the system does, its main flows, its data, the services it calls and who calls it, how it is built, tested and deployed), say which areas you will read, and let the user widen or narrow that. Do not read the whole repository: exploration beyond what the questions need raised cost by about a fifth without raising success (arXiv:2602.11988).
3. Explore in a funnel, per question: files, then definitions, then lines. Pick candidate files from the survey's markers and churn list and from keyword search. Run `ai-skeleton <files>` to see their classes and functions with line numbers, and read only the line ranges that answer the question, plus one hop of their callers and callees (wider dependency context measured worse). Signatures-first localization was more accurate than reading whole files, at about a seventh of the cost. Hand broad searches to read-only subagents, one question each, and keep their conclusions, not their file dumps. Trace one main flow end to end.
4. Record facts as they are found, into the matching `.ai/context/` topic file (domain, architecture, database, dependencies, conventions):
   - Each fact carries its evidence as a backticked `path:line`, and a confidence: CONFIRMED (the user's words, or two independent artefacts that agree) or OBSERVED (one artefact). Inference is not a fact; it goes to the open questions.
   - Two artefacts that disagree are a CONFLICT: quote both, decide nothing.
   - Write the commit you read at the top of each file you change (`Verified at: <short sha>`).
   - Only what the code does not show plainly: business rules, why things are the way they are, cross-repository contracts. Layout and conventions an agent finds on its own cost context in every later session.
5. Related repositories. A relation (an API, a queue, a shared table, a package) is closed only with evidence on both sides; with one side it is a hypothesis listed as an open question. Read a sibling only after the user approves that sibling, and never write into it. Record relations in `.ai/context/dependencies.md`, citing the other side as `<repo>/<path>:line` (the sibling directory's name first), which `ai-lint` checks next to this project.
6. Check the pack. Run `ai-lint` and fix what it reports: broken citations, tables, bold, placeholders.
7. Report and stop. Summarize what is now known, list the conflicts, and ask the open questions batched by topic. Wait for answers; record each answer in the topic file it settles.

Refresh: on a later run, list the files cited in `.ai/context/` that changed since their `Verified at` commit (`git diff --name-only <sha>..HEAD`), re-check only those facts, and update the commit line.

Deliverable: updated `.ai/context/` topic files and a list of open questions. Stop condition: the report is delivered and the questions are asked.
