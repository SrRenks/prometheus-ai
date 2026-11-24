---
name: quality-audit
description: 'Audit code quality and risk in an existing repository: the project''s tools first, then findings grounded in the code''s intent and in concrete evidence (a reproducing test or command, or a traced call or data path), filtered for actionability, ranked by severity, with unproven findings kept apart. Changes no project file. Use when the user asks for a quality, risk, or security audit of a repository or an area of one.'
---
Find what is wrong, prove it, and report it. Fix nothing unless asked. LLM reviewers are often wrong (on SWR-Bench the best single-pass reviewer reached about 15% precision), so a finding counts only with evidence someone else can check. The only files written are the audit report and throwaway reproduction files in a scratch directory outside the repository, deleted when the audit ends; prefer a command over a new file.

1. Scope and intent. Agree the area with the user: the whole repository, a module, or the files a change touches. Collect what the code is meant to do: the issue or PR text, the module's purpose from `.ai/context/` or the README, and the user's words. Reviewers given that intent text measured far better than those given the code alone. Read `.ai/project.md` for the build, test and lint commands, and `.ai/overlay.md` for local rules.
2. Tools first. Run what the project already has: its linters, type checker and tests. Run the complexity limits of `core/docs/complexity.md` with the tool its `core/docs/languages/*.md` names. Run a dependency audit (`npm audit`, `pip-audit`, `govulncheck`, `cargo audit`) and `semgrep` when installed. Do not install a tool without approval. Record each command and its result.
3. Locate before judging. Narrow in steps: `ai-skeleton` on the scoped files to see the definitions, then read the risky ones in full together with their direct callers and callees. For a tool warning, trace the path from where the data enters to the flagged line before judging it.
4. Candidate findings. Look for what tools cannot see: wrong logic against the intent, unhandled failure paths, data loss, security holes, races, broken contracts with callers. Skip style and taste.
5. Prove each one. Give each candidate one of these:
   - A reproduction: a command, or a throwaway test in the scratch directory, that fails, with its output.
   - A trace: the concrete path, as `path:line` steps from the input to the wrong outcome, with the condition that triggers it.
   A finding with neither is UNVERIFIED. It is listed separately, never ranked with the proven ones. Grounding claims in concrete paths and data flow removed most false positives when triaging static-analysis alarms; in a production review system, an LLM judge of factual correctness had minimal impact. So a model's agreement is not proof: this is a judgement from those studies, not a measured result for audits.
6. Filter for action. Keep a proven finding only if a maintainer would change code because of it: a real input reaches it, and the consequence matters to the intent. Count what you dropped and why. Verification also discards some real bugs, so the dropped list stays in the report.
7. Report. Write `.ai/audits/<YYYY-MM-DD>-quality.md` with:
   - scope, intent and commit
   - tool results
   - proven findings, most severe first; each has a severity (critical, high, medium, low), `path:line`, the defect in one sentence, its reproduction or trace, and the consequence
   - then the UNVERIFIED findings and the dropped count

   Run `ai-lint`. Give the user the top proven findings and the file path.

Deliverable: the audit file and a short ranked summary. Stop condition: the report is delivered; propose fixes only when the user asks for them.
