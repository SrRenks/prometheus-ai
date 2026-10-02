# Evals - retained task set for config changes

The shared config (AGENTS.md, skills, dsh presets) changes behavior for every
project. Before shipping a change to the default preset or the shared rules,
validate it against this retained set. The change ships only when the eval
result is stable or better - and never because of a public-benchmark number.

## Why
- Public coding benchmarks are contaminated or broken: SWE-bench Verified is
  "no longer meaningful" (OpenAI, Apr 2026,
  https://openai.com/index/separating-signal-from-noise-coding-evaluations/,
  retrieved 2026-09-06); SWE-bench Pro has ~30% broken tasks (same OpenAI
  audit, Jul 2026); agents have gamed them via leaked git history (Poolside,
  May 2026, https://poolside.ai/blog/through-the-looking-glass, retrieved
  2026-09-06). Self-hosted tasks avoid both problems.
- Token counts do not measure cost: compressing tool output increased billed
  cost 6.8% in arXiv:2607.12161
  (https://arxiv.org/abs/2607.12161, retrieved 2026-09-06). Measure
  success-rate-per-cost.
- The liangshen preset exists because measured trajectory evals (issues #6,
  #11) showed large always-on injections break first-request anchoring
  (skill catalog 0/9 vs ~81% without). Keep that measurement alive.

## The set

### A. anchor checks (cheap, run always)
- First-request shape: with a fixed list of N=10 prompts (mix of trivial and
  multi-file tasks), record whether the first reply is direct action versus
  meta-narration ("let me...", "I will..."), and whether the first tool call
  is the expected one. A preset/rule change that flips the majority anchor is
  a red flag - investigate before shipping.
- Injection budget: measure the standing injected context (instructions +
  skill catalog) per request. Target: instructions ≤ ~2.5K tokens, skill
  catalog ≤ 1% of the context window or on-demand search/load instead.
  Measured 2026-09-16 with tiktoken: 2460 tokens on the Claude Code path
  (AGENTS.md 2283 plus the 177-token agents/claude-code/CLAUDE.md layer on
  o200k_base; cl100k_base reads 2470). Recomputed 2026-10-02 at about 2452 by
  scaling AGENTS.md's character count against that same 2283-token measurement,
  because no tokenizer was installed to re-measure directly. AGENTS.md is 9579
  characters against the 9613 it measured at, so the file is SHORTER than when
  the budget was last confirmed - it gained a corrected injection line, the
  commit-time prose rules in the gated set, and lost more than it gained. Slack
  is roughly 48 tokens. Treat the figure as an estimate and re-measure with a
  real tokenizer before relying on it, and remember the rule either way: anything
  added to AGENTS.md comes out of something else first. The skill catalog is not
  injected at all under the renks preset.

### B. task set (run for substantive changes)
- Keep 5-10 representative tasks per project type you actually work in
  (e.g., fix-a-bug with tests, add-a-feature multi-file, refactor-a-module,
  write-docs, triage-a-failing-CI). Prefer real past tasks with known-good
  outcomes.
- Score: solved (tests/lint/diff review pass) and total cost (input+output
  tokens, cache hits/misses, latency). Record cost-per-solved-task.
- Gate: success rate does not drop AND cost-per-solved-task does not rise
  materially. Investigate any single-task regression even if the average
  holds.

## Process
- Store runs under `.ai/evals/` (project) or `~/.config/agent-config/evals/`
  (global; the repo's `.gitignore` ignores `evals/`). One JSONL line per run:
  date, config revision, task id, result, tokens, cost, latency.
- Run A for every AGENTS.md/preset edit; run B for preset swaps, instruction
  rewrites, tool-catalog changes, and before promoting liangshen-style
  presets to default.
- Update this file when a check keeps catching regressions (add it) or never
  fires (remove it - context rot applies to evals too).

Sources: `core/docs/sources.md`, section "Internal, measured".
