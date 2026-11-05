# ADR-0001: dsh runtime upgrade gate

**Status**: Superseded
**Date**: 2026-11-05
**Superseded by**: ADR-0002

## Context

`deepseek-v4.1-flash-1017` names no model that any published dsh serves. V4.1 Flash is already installed under `deepseek-flash`. Separately, the three parts cannot move to a newer dsh together, and the fork cannot move at all.

First, the catalogue. `@deepseek-ai/dsh-llm-deepseek` lists two entries, and the same two in 0.2.0-rc.2, 0.2.1-rc.5 and 0.2.2-rc.1:

| id | name as of 0.2.0-rc.2 | name as of 0.2.1+ |
|---|---|---|
| `deepseek-flash` | `DeepSeek-V41-Flash` | `DeepSeek-V4.1-Flash` |
| `deepseek-v4-pro` | `DeepSeek-V4-Pro` | `DeepSeek-V4-Pro` |

V4.1 Flash is therefore already served by the installed 0.2.0-rc.2 and already selected here (`agent-default-model.model: deepseek-flash` in both profile patches). The only defect is the display string, which reads `DeepSeek-V41-Flash` without the dot until 0.2.1. No `-1017` snapshot appears in any dsh package, in `@earendil-works/pi-ai` provider data (whose only dated ids are `deepseek-v4-flash-0731` and `deepseek-v4-pro-0813`, both v4), or in the packages published to npm.

Second, the three parts do not share a compatible ceiling.

| part | installed | newest published | highest dsh it declares |
|---|---|---|---|
| `@deepseek-ai/dsh` | 0.2.0-rc.2 | 0.2.2-rc.1 (2026-11-04) | n/a |
| `@deepseek-harness-tui/dsh-tui` | 0.12.0 | 0.18.0 (2026-11-01) | 0.2.1-rc.5 (0.12.0 tops at 0.2.0-rc.2) |
| `dsh-unrestricted-renks` | 0.2.2-renks.1 | same | 0.2.0-rc.2 |

dsh-tui 0.18.0 was published three days before dsh 0.2.2-rc.1 and its peer ranges stop at 0.2.1-rc.5, so no published TUI supports 0.2.2. The fork states its base as dsh 0.2.0-rc.2, and its assumptions break at 0.2.1 and later.

Third, the fork breaks on anything above 0.2.0-rc.2, for three separate reasons:

- `src/rules.js` anchor `planPrefix` is `You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode.` From 0.2.1-rc.5 the shipped `standard` preset says `...until the user approves your plan through exit_plan_mode or switches the session mode.`, so anchor verification fails and the mode stays unavailable for `standard`, `ptc`, `cordis` and `renks`.
- `src/rules.js` anchor `ptcOnly` is absent from `@deepseek-ai/dsh-tools@0.2.2-rc.1`, so `ptc` fusion fails as well.
- `cordis.patch.yml` re-declares the `connection` row with `inject: [webRuntime, webServer]`. The shipped row injected `[webRuntime]` in 0.2.0-rc.2 and injects `[webStartup]` with `trustedHosts: ctx.webStartup.trustedHosts` from 0.2.1-rc.5, so the override names services that no longer exist.

dsh and dsh-tui also live in separate pnpm global projects (`global/v11/499c6f07...` and `global/v11/274a43...`), so no single command moves both. "All at once" would be two registry installs plus a local fork update in any case.

## Decision

Stay on dsh 0.2.0-rc.2 with dsh-tui 0.12.0 and dsh-unrestricted-renks 0.2.2-renks.1. V4.1 Flash is already available and no upgrade buys model access.

Do not raise the dsh version until all of the following hold:

1. dsh-tui publishes a release whose peer ranges include the target dsh version.
2. The fork carries anchors for that version's prompts and an `inject` list derived from the shipped `connection` row.
3. `node tools/build-preset-recipe.mjs --check` passes against the target installation.

Two hygiene items come before any version change, because both turn an upgrade into a failed install:

- `~/dsh-user-presets` is missing while both profiles declare `file:/home/renks/dsh-user-presets`. The profiles work only from the hardlinked copy already under `node_modules`, and any `pnpm install` in a profile aborts with `Could not install from "/home/renks/dsh-user-presets" as it does not exist`. Re-running `bash agents/dsh/install.sh` rebuilds the bundle at that path.
- `~/.dsh-tui/model.json` and `model-recents.json` remember `deepseek-official` / `deepseek-v4-flash`, an id the catalogue no longer serves (`deepseek-flash`, `deepseek-v4-pro`). The TUI will fail to resolve it or fall back to the profile default.

## Options considered

- Option A, stay on 0.2.0-rc.2. Accepted. The model is already served, the three parts agree, and the docs gate keeps working unchanged.
- Option B, dsh 0.2.1-rc.5 with dsh-tui 0.18.0. Buys nothing for the model and still needs the fork updated for the `connection` row and the `planPrefix` anchor, so it trades a working stack for that work plus an unverified TUI on a version it was not tested against.
- Option C, dsh 0.2.2-rc.1. Adds the same fork work plus an unsupported dsh-tui, and removes `@deepseek-ai/dsh-tool-ralph`, which dsh-tui 0.18.0 still disables by id.

## Consequences

Nothing changes for the everyday workflow. The gate, the preset and the skills stay on the composition that is running now.

The cost is that dsh stays one release line behind, which matters only when a feature arrives that these versions do not carry. Model access is not such a feature.

When the gate opens, the upgrade touches in this order: rebuild the bundle source, refresh the fork against the target prompts and the shipped `connection` row, reinstall dsh, reinstall dsh-tui, re-run `agents/dsh/install.sh` so the preset is regenerated from the new stock recipe, then verify with `node tools/build-preset-recipe.mjs --check` and by reading the denial text of one blocked mutation.

What the new stock recipe changes, so the regeneration is expected to alter the preset: `agent-instructions` stays, `time-context`, `tool-schedule` and `tool-plugin-market` are added, `tool-fs` gains `applyPatch: false`, the `persona` row loses `suffix` (the `renks` preset declares its own), `tool-subagent` renames `modelSelectionSettings` to `modelSelection` and drops `backgroundMode`, and the `list-agents`, `codex`, `claude-code` and `ralph` rows are gone. All four edit anchors in `tools/build-preset-recipe.mjs` still match the 0.2.2 stock recipe, so the rebuild path is open.

## References

- `agents/dsh/presets/renks/README.md` and `docs-gate.mjs` for the gate contract.
- `tools/build-preset-recipe.mjs` and `tools/stock-recipe.mjs` for the stock recipe resolution.
- `dsh-unrestricted-renks` `src/rules.js` (`ANCHORS`, `PRESET_RULES`) and `cordis.patch.yml`.
