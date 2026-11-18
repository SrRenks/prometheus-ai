# Universal agent principles

## Karpathy principles (llm-rigor)

1. Think before coding - State implementation plan before any code. For multi-file or uncertain work: numbered plan with success criteria, approved first. Skip the written plan when the change fits a one-sentence diff.
2. Surgical changes - Touch only requested lines. No drive-by refactoring.
3. Minimum viable code - Solve the current problem completely - includes error handling, logging, edge cases. Minimum scope, not minimum quality.
4. Pushback scales with certainty - Probe harder when user sounds confident. Question when evidence is weak.
5. Verifiable execution - Define explicit success criteria. Not "make it work."
6. No sycophancy - Never flatter. Disagree when evidence contradicts. State confidence level when uncertain.
7. Explicit verification gates - Compiler, tests, linter, LSP diagnostics before declaring done.

## Operational rules

8. One task at a time. Finish, confirm, next.
9. Time-box: 3 tries or 5 minutes for simple fixes. For complex bugs, investigate root cause - don't patch symptoms.
10. Never commit without human approval.

## Workflow
1. Explore - read relevant docs and code
2. Plan - numbered implementation plan with success criteria
3. Implement - complete changes: error handling, logging, edge cases
4. Verify - tests, linters, diagnostics
5. Review - self-review the diff. Working code is a first draft: after tests go green, do one ruthless edit. Remove dead code, debug artifacts, speculative abstractions. Then fresh-context review: a subagent without session history checks the diff adversarially. Explain what changed.
6. Commit - only after approval

## Complexity budgets
- Single source of the budgets and rationale: `~/.config/prometheus-ai/core/docs/complexity.md`. Enforce in CI; do not increase total repository complexity without justification. Document exceptions in the commit message.
- Evidence: GitClear's "AI Copilot Code Quality" studies (2024-2025) measure rising churn, copy/pasted lines, and duplicated code blocks in AI-assisted repositories, with refactoring ("moved" lines) declining - see https://gitclear-public.s3.us-west-2.amazonaws.com/AI-Copilot-Code-Quality-2025.pdf (retrieved 2026-09-06). Complex code is agent drag - expensive for both humans and agents to navigate.

## Dependencies
- Standard library first.
- No new dependencies without approval.

## Anti-patterns - never do these

- Process theater - generating placeholder files, fake metrics, or busy-work to "prove" progress.
- Excessive abstraction - LLMs overcomplicate code and APIs. A 100-line solution is better than a 1,000-line abstraction.
- Drive-by refactoring - refactoring unrelated modules when asked for a simple fix.
- Ignoring STOP signals - continuing to generate after the user says stop.
- Speculative features - building for imagined futures. Solve the current problem.
- Interfaces solely for mocking - only introduce interfaces at stable boundaries with multiple implementations.

## Security
- See `~/.config/prometheus-ai/core/docs/security.md`.
- Never log passwords, tokens, secrets, or private data.

Sources: `core/docs/sources.md`, sections "Agent behavior, context, and instructions" and "Complexity, design, and maintainability".
