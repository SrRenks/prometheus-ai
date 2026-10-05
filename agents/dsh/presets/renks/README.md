# renks preset - patch-based source of truth

This directory holds the personal `renks` preset WITHOUT committing a copy of
dsh's third-party `standard` recipe. `../install.sh` rebuilds the recipe at
install time from whatever dsh version is installed on the machine.

| File | Role |
|---|---|
| `agent.cordis.patch` | Your personal delta on top of the stock recipe (2 changes: docs-gate, skill-search). GENERATED - do not hand-edit. |
| `stock-baseline.agent.cordis.yml` | The 3-way merge base, kept byte-identical to the installed stock `standard` recipe. GENERATED. |
| `fallback.agent.cordis.yml` | Last-known-good generated recipe. Installed only when even a regenerated patch cannot merge. GENERATED. |
| `docs-gate.mjs` | Denies mutating tool calls until the session has successfully read the mandatory doc set's current content. See below. |
| `docs-gate-policy.mjs` | The fs seam, the doc resolution and the denials. |
| `docs-gate-target.mjs` | Path and `bash` parsing: what counts as a target, and where the workspace boundary is. |
| `docs-gate-tiers.mjs` | The doc registry, the tiers, and which tier a mutation needs. |
| `docs-gate.spec.mjs`, `docs-gate-tiers.spec.mjs` | Test suites: gate behaviour, and the tier/language rules. NOT installed. |
| `docs-gate.testkit.mjs` | Fake fs seam, fake agent and waterfall driver shared by the spec. NOT installed. |
| `skill-search.mjs` | Replaces the ~9KB skill-catalog injection with `skill_search` / `skill_load`. |
| `preset.yml` | Name/description shown in `/preset`. |

The `.mjs` plugins import only each other, never dsh internals, so an
upstream release does not break them.

## Requirements

`@deepseek-ai/dsh-agent-preset` arrived in dsh **0.1.7-alpha.1**, and this preset
is one of its rows. On an older dsh the profile fails to start with `Cannot find
package '@deepseek-ai/dsh-agent-preset'`, so `../install.sh` checks for the package
and stops with the upgrade command instead of syncing a bundle that cannot load.

There is no older-version fallback. dsh 0.1.2 dropped directory presets before it
shipped the row that replaced them, so no configuration makes this work there.

## Regenerating the three generated files

```bash
node tools/build-preset-recipe.mjs          # rewrite baseline + patch + fallback
node tools/build-preset-recipe.mjs --check  # verify only; non-zero on drift
```

The tool reads the stock recipe from the dsh version actually installed, applies
the edit blocks declared at the top of the script, and verifies that the patch
round-trips and that the simulated 3-way merge is conflict-free. When upstream
rewrites a block the script patches, the tool reports which edit stopped matching
instead of writing a patch that silently degrades the install.

## docs-gate

`docs-gate.mjs` observes `tools/pre-execute` and denies a mutating call until the
session has successfully read what that call's TIER requires, plus the project's
`.ai/project.md` when it exists.

"Successfully read" is exact, and `docs-gate-credit.mjs` owns the rules. A credit
records a CONTENT fingerprint, so:

- a read that produced no content credits nothing, and the denial will not claim
  the agent read rules it never saw;
- reading one line of a 500-line file is a full credit, because the fingerprint
  covers the file;
- a document edited after the read LOSES its credit, because the agent then holds
  text that is no longer on disk.

### Optional: reusing a credit across a restart

The credit is per process, keyed by root session, so a resumed session re-reads.
`docs-gate-store.mjs` offers a switch for that, and it is OFF by default:

```yaml
- id: docs-gate
  name: ./docs-gate.mjs
  config:
    creditStore: ~/.dsh/gate-credit.json   # omit to keep it off
```

WHY IT IS NOT THE DEFAULT. A credit means "this session has seen this content".
Reusing a record from an earlier session produces a session that mutates WITHOUT
the rules in its context while the gate reports them satisfied, which is the
failure this plugin exists to prevent: 0 percent file-reading compliance measured
in arXiv:2605.01771, and 99 percent first-mutation-before-reading in this repo's
own sessions. Du's survey (arXiv:2603.07670) argues the other way and is worth
weighing rather than dismissing: summarisation drift loses important detail across
compaction, and a store of raw records is its recommended supplement. Both
readings are true, so this is a switch with the trade stated rather than a choice
made for the reader.

WHAT KEEPS IT HONEST. The store holds a CONTENT fingerprint per document, never
the content itself, so it cannot become a second copy of the rules that drifts
from the file. A credit comes back only when the document still hashes to what was
read, so a rewritten rule never reuses an old credit. A store that cannot be read,
or a document that cannot be re-read, seeds nothing. And every reuse is logged:
`credit store: reused N read(s)` names the documents, so a session that acted
without reading them leaves a trace.

The credit is per process, keyed by root session, so a resumed session re-reads.
Persisting it is blocked rather than merely undone: an out-of-repo session event
needs the envelope's `ignorable` marker, which the public `session.append()` does
not expose, and the synchronous log readers that could replay the evidence are
prohibited for new production code. `docs-gate-credit.mjs` records that reasoning
where a future reader will find it.

- `core`: every change, prose included. `core/principles.md`.
- `code`: source changes only. `core/docs/development-workflow.md`,
  `core/docs/complexity.md`, `core/docs/maintainability.md`.
- `language`, added on top when the changed file's language has a guide:
  `core/docs/languages/{python,go,rust,kotlin}.md`. The guides are 800 to 1000
  bytes each (Kotlin 3.8 KB) and they state HOW the complexity budgets are
  enforced - `C901` max 10 for Python, `gocyclo` for Go, `clippy::too_many_lines`
  at 60 for Rust. Requiring the budget without the tool configuration asks the
  agent to honour a limit it cannot check.
- `commits` is a TRIGGER, not a rung. `core/docs/git-workflow.md` and
  `core/docs/ai-writing.md` are required when the call is `git commit`,
  `git push`, `gh pr create` or `lazygit`, and at no other time. It adds those two
  and does NOT climb the ladder, because the change a commit lands was gated when
  this session made it. Measured: a commit-only session paid 5013 tokens for six
  docs, three of which say nothing about committing; it now pays 2844 for three.
  arXiv:2608.28027 measures the other side, that disclosing one tier too early
  costs up to 23 accuracy points, so loading rules a call cannot use is not free.
  The common code-then-commit session is unchanged, since the source tier was
  read at the write. Neither doc is
  used by a session that never commits: one is commit and pull-request procedure,
  the other governs prose a human will read, and the review phase places its check
  immediately before the commit. This follows the within-session compliance decay
  measured in arXiv:2605.10039 - the rules that matter are the ones in play, and a
  doc loaded for a session that never reaches its subject is context spent for
  nothing. `ai-writing.md` is the smallest doc in the set at 3.2 KB and had three
  callers with no enforcement, which is why it moved here rather than staying in
  the reference index.
- The three selectors - ladder, language, commit trigger - are UNIONED, because
  none implies another: a prose session that commits needs the two commit-time
  docs without ever needing the code tier.

The tier is chosen by positive identification. A target is spared the code tier
only when its extension says prose (`.md`, `.rst`, `.adoc`) or configuration
(`.json`, `.yaml`, `.toml`, …); an unknown extension, no extension, or a `bash`
command that cannot be attributed to a file all fall through to `code`. `.txt` is
deliberately not prose, because it is the usual destination of command output.
Over-gating shows up in the denial and can be corrected; under-gating is silent.

It was added because guidance was being skipped. An audit of the 96 recorded
sessions in `~/.dsh/sessions` (`node tools/audit-instruction-reads.mjs`) found
33% had read an instruction file and 8% had read any core behavioural doc, so
nothing enforced the reads.

A plugin that only NAMED the doc set was tried first and removed on 2026-10-02.
It never reached a live session - no hint text appeared in any recorded
transcript, and its `agent/pre-step` handler never ran - while the gate beside it
in the same composition worked throughout. Its removal is why the recipe now
carries two changes instead of three: a component that contributes nothing is
worse than absent, because it costs code, tests and a place in the patch.

Design constraints, all of them load-bearing:

- Read-only calls stay open, including read-only `bash`, so the agent can always
  explore and always satisfy the gate.
- Targets outside the workspace are not gated.
- An uninitialized workspace opens the gate instead of deadlocking the session.
- The in-or-out decision uses the workspace root ONLY when a VCS marker identified it. A fallback to
  the session cwd keeps the doc probes working but is not a boundary, because treating it as one let
  an edit to a real file above cwd pass unguarded.
- An unresolvable workspace fails closed, because "I could not check" is not
  "there is nothing to check".
- A subagent inherits its root session's evidence.
- One `Set` lookup once the set has been read.

Test it with `node --test 'agents/dsh/presets/renks/*.spec.mjs'`.

Workflow after a dsh update: `git pull && bash dsh/install.sh`.
- Clean merge → new stock behavior + your two changes.
- Stale baseline → `install.sh` regenerates the recipe and merges again.
- Still conflicting → last-known-good installed, with the command to regenerate.
