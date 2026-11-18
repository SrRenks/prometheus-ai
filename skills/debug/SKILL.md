---
name: debug
description: 'Find and fix a bug systematically: reproduce it, isolate the failing path, verify assumptions, fix the root cause, and keep a regression test. Use when something is broken and the cause is not obvious, when an earlier fix did not hold, or when the user reports a bug with no known cause.'
---
Work the bug down instead of guessing at it. Rules and tactics: `~/.config/prometheus-ai/core/docs/debugging.md`.

1. Reproduce - get the smallest scenario that fails every time, and capture the exact dependency versions, logs, and stack traces.
2. Isolate - narrow to the smallest failing unit, commenting out or stubbing half at a time. Write a failing test that pins the behavior before touching the fix.
3. Verify assumptions - check configuration, dependency versions, and the data. Reproduce against a known-good dataset to rule data corruption out.
4. Fix the cause, not the symptom - the minimal change that makes the failing test pass. No drive-by refactors in the same edit.
5. Keep the regression test - the failing test stays, or gets an equivalent that would have caught this class of bug.
6. Post-mortem note - if the bug reached production or cost more than the time-box, record the root cause and what would have caught it earlier.

Deliverable: the fixed cause, the regression test, and a short report of what it was and why it happened.

Stop condition: report the root cause and the fix, or stop after three attempts on a simple issue and report what you ruled out.
