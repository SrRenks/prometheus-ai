# ADR-0002: move to dsh 0.2.1-rc.5 with dsh-tui 0.18.0 and the rebased fork

**Status**: Proposed
**Date**: 2026-11-05
**Supersedes**: ADR-0001 (the decision to stay on 0.2.0-rc.2)

## Context

ADR-0001 blocked the upgrade on three parts that could not move together. One of them was the fork. That premise was wrong at the time of writing: the fork is a snapshot of upstream `yexi-by/dsh-unrestricted` v0.2.1, and upstream had already solved the 0.2.1 problem in v0.2.2 and removed the fragility in v0.2.6.

What upstream changed, read from its releases and source:

| version | date | effect on this machine |
|---|---|---|
| v0.2.2 | 2026-10-09 | `connection` injects `webStartup` and keeps `trustedHosts: ctx.webStartup.trustedHosts`; plan-mode text re-anchored |
| v0.2.3 | 2026-10-15 | adds `engines.dsh: >=0.2.0-rc.2 <0.2.2-0`, later widened |
| v0.2.6 | 2026-10-31 | drops verbatim prompt anchors for fusion by section name; verified on 0.2.2-alpha.2 and 0.2.1-rc.5 |
| v0.2.8 | 2026-11-05 | `engines.dsh: >=0.2.0-rc.2 <0.2.3-0`; syncs the 0.2.2-rc.1 prompt snapshot |

The fusion in v0.2.6 and later reads `deployment:persona-prefix`, `plan:policy`, `tools:ptc-only` and `tool:structured_output` by name. All four section names exist in dsh 0.2.1-rc.5: the persona constants are exported by `@deepseek-ai/dsh-system-prompt@0.2.1-rc.5`, `plan:policy` by `dsh-plan-mode`, `tools:ptc-only` by `dsh-tools`, `harness:identity` by `dsh-system-prompt`.

The rest of the 0.2.1-rc.5 surface this setup touches checks out:

- `@deepseek-ai/dsh-client-ui-primitives@0.2.1-rc.5` exists, which the v0.2.6 client rewrite imports and the bundle keeps external.
- `@deepseek-ai/dsh-host-webserver` is a dependency of `dsh-web-app@0.2.1-rc.5`, so the fork's `webServer` injection resolves.
- `tools/pre-execute` is present, so the docs gate keeps its hook. `tools/ptc-dispatch-log`, which the gate does not use, is still there too.
- The stock `standard` preset still matches all four edit anchors in `tools/build-preset-recipe.mjs`, so the `renks` recipe regenerates instead of falling back.
- The web profile patch targets `ui-settings-general` and the TUI profile patch targets `dsh-tui-agent-preset-registry`; both rows exist in the target releases.

dsh-tui 0.18.0 declares support through 0.2.1-rc.5 and no further, so 0.2.1-rc.5 is the highest mutually supported dsh release.

## Decision

Adopt dsh 0.2.1-rc.5 with dsh-tui 0.18.0 and a fork rebased onto upstream v0.2.8, tagged `v0.2.8-renks.1`.

The rebase is prepared at `~/dsh-unrestricted-renks-v028`, on branch `renks/0.2.8`, one commit on top of the `v0.2.8` tag. It carries the local delta only: `renks` in `PRESETS` and `PRESET_RULES`, a card row with its Chinese and English strings, the fork identity in `package.json`, standard-fixture replay cases under the `renks` preset id, and a drift guard rewritten for the by-name fusion. The suite passes with 37 tests, including the live-preset guard, and `npm run build` regenerates `lib/client.js`.

The order is fixed by dependencies, not by preference:

1. Re-run `bash agents/dsh/install.sh` while 0.2.0-rc.2 is still installed. This rebuilds `~/dsh-user-presets`, which is missing today and would fail `pnpm install` in every profile.
2. `pnpm add -g @deepseek-ai/dsh@0.2.1-rc.5`.
3. Repoint both profiles at the rebased fork and run `pnpm install` in each. The fork cannot be swapped in before step 2: its `connection` override injects `webStartup`, a service 0.2.0-rc.2 does not provide.
4. `pnpm add -g @deepseek-harness-tui/dsh-tui@0.18.0` and raise the TUI profile's pinned version to match.
5. Re-run `agents/dsh/install.sh` so the recipe is regenerated from the 0.2.1-rc.5 stock preset, then commit the regenerated `stock-baseline.agent.cordis.yml`, `agent.cordis.patch` and `fallback.agent.cordis.yml`.
6. Fix `~/.dsh-tui/model.json` and `model-recents.json` to `deepseek-flash`.

## Options considered

- Option A, stay on 0.2.0-rc.2. Superseded. It costs nothing and gains nothing, but it keeps the fork on a snapshot that upstream abandoned for good reasons.
- Option B, dsh 0.2.1-rc.5 with dsh-tui 0.18.0. Proposed. Every declared range, section name and package resolves, and it is the newest pairing the TUI supports.
- Option C, dsh 0.2.2-rc.1. Rejected for now. dsh-tui has no release that declares it, and the TUI patch still disables `tool-ralph`, a package 0.2.1 and 0.2.2 no longer ship.

## Consequences

The preset regenerates against a stock recipe that differs from today's in ways worth expecting: `time-context`, `tool-schedule` and `tool-plugin-market` rows appear, `tool-fs` gains `applyPatch: false`, `tool-subagent` renames `modelSelectionSettings` to `modelSelection` and drops `backgroundMode`, and the `tool-ralph`, `tool-subagent-codex`, `tool-subagent-claude-code` rows disappear. The `renks` delta itself is unaffected.

The fork stops being a private divergence from v0.2.1 and becomes a small delta on a maintained base, which is what makes the next dsh release cheap.

The gate keeps working through `tools/pre-execute`. What changes under it is only the preset text it guards, and the drift guard fails loudly if the live preset stops declaring the persona or plan-mode rows.

## References

- Upstream releases: https://github.com/yexi-by/dsh-unrestricted/releases
- `ADR-0001-dsh-runtime-upgrade-gate.md` for the model-id findings, which still hold.
- `tools/build-preset-recipe.mjs`, `agents/dsh/install.sh`.
