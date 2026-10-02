# renks preset - patch-based source of truth

This directory holds the personal `renks` preset WITHOUT committing a copy of
dsh's third-party `standard` recipe. `../install.sh` rebuilds the recipe at
install time from whatever dsh version is installed on the machine.

| File | Role |
|---|---|
| `agent.cordis.patch` | Your personal delta on top of the stock recipe (3 changes: instruction-hint, docs-gate, skill-search). GENERATED - do not hand-edit. |
| `stock-baseline.agent.cordis.yml` | The 3-way merge base, kept byte-identical to the installed stock `standard` recipe. GENERATED. |
| `fallback.agent.cordis.yml` | Last-known-good generated recipe. Installed only when even a regenerated patch cannot merge. GENERATED. |
| `instruction-hint.mjs` | Replaces the full `AGENTS.md` digest with one hint, and names the mandatory doc set by path. |
| `docs-gate.mjs` | Denies mutating tool calls until the session has read the mandatory doc set. See below. |
| `docs-gate-policy.mjs` | The fs seam, the doc resolution and the denials. |
| `docs-gate-target.mjs` | Path and `bash` parsing: what counts as a target, and where the workspace boundary is. |
| `docs-gate-tiers.mjs` | The doc registry, the tiers, and which tier a mutation needs. |
| `docs-gate.spec.mjs` | Test suite for the gate. NOT installed into the preset directory. |
| `docs-gate.testkit.mjs` | Fake fs seam, fake agent and waterfall driver shared by the spec. NOT installed. |
| `skill-search.mjs` | Replaces the ~9KB skill-catalog injection with `skill_search` / `skill_load`. |
| `compaction-epoch.mjs` | Shared compaction-boundary helper for the hint and the gate. |
| `preset.yml` | Name/description shown in `/preset`. |

The `.mjs` plugins import only each other, never dsh internals, so an
upstream release does not break them.

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
session has read what that call's TIER requires, plus the project's
`.ai/project.md` when it exists:

- `core` — every change, prose included: `core/principles.md`,
  `core/docs/git-workflow.md`, `core/docs/development-workflow.md`.
- `code` — source changes only: `core/docs/complexity.md`,
  `core/docs/maintainability.md`.

The tier is chosen by positive identification. A target is spared the code tier
only when its extension says prose (`.md`, `.rst`, `.adoc`) or configuration
(`.json`, `.yaml`, `.toml`, …); an unknown extension, no extension, or a `bash`
command that cannot be attributed to a file all fall through to `code`. `.txt` is
deliberately not prose, because it is the usual destination of command output.
Over-gating shows up in the denial and can be corrected; under-gating is silent.

`instruction-hint.mjs` derives its list from the same registry, so the hint
advertises the tiered set the gate actually enforces.

It was added because hints were being skipped. An audit of the 96 recorded
sessions in `~/.dsh/sessions` (`node tools/audit-instruction-reads.mjs`) found
33% had read an instruction file, 8% had read any core behavioural doc, and 17 of
the 30 sessions that received the hint still never opened one. The hint fired;
nothing enforced it.

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

Test it with `node --test agents/dsh/presets/renks/docs-gate.spec.mjs`. One case
pins the enforced set to the set `instruction-hint.mjs` advertises, so the two
cannot drift apart.

Workflow after a dsh update: `git pull && bash dsh/install.sh`.
- Clean merge → new stock behavior + your three changes.
- Stale baseline → `install.sh` regenerates the recipe and merges again.
- Still conflicting → last-known-good installed, with the command to regenerate.
