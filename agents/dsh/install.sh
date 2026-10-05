#!/usr/bin/env bash
# agents/dsh/install.sh - install the personal dsh layer on this machine.
#
# One command after `git clone`:
#     bash ~/.config/agent-config/agents/dsh/install.sh
#
# Idempotent: safe to re-run after every `git pull` or dsh update. It rebuilds
# the `renks` preset from the dsh version ACTUALLY INSTALLED here (stock
# `standard` preset + your personal patch, 3-way merged). If upstream changed a
# block you patched, the merge fails and the last-known-good generated preset is
# installed instead.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../agent-config/agents/dsh
REPO="$(cd "${SRC}/../.." && pwd)"                    # repo root (clone location)
DSH_H="${DSH_HOME:-${HOME}/.dsh}"
PRESET_DIR="${SRC}/presets/renks"
BUILDER="${REPO}/tools/build-preset-recipe.mjs"

# The stock recipe is resolved by `tools/build-preset-recipe.mjs`, NOT here.
# This script used to probe for it with its own hard-coded paths, and that probe
# assumed the pre-0.2.0 layout: a directory preset under `profiles/**/node_modules/
# @deepseek-ai/dsh-agent-presets/`. dsh 0.2.0 ships its presets as loader patch
# files inside its own installation, so the probe found nothing on every run,
# STOCK stayed empty, and this installer silently fell through to the fallback
# recipe every time. The merge path never executed and nothing said so.
#
# Keeping one resolver matters beyond tidiness: two lookups that disagree make the
# baseline match a recipe the running dsh does not use. The file is produced in
# step 1, which is the first place with a scratch directory to write it to.
STOCK=""

# Directory that can `require('yaml')`, for the recipe sanity gate.
YAML_DIR=""
for candidate in "${DSH_H}"/profiles/*/node_modules "${DSH_H}/profiles/node_modules"; do
  if [ -d "${candidate}/yaml" ]; then YAML_DIR="${candidate}"; break; fi
done

echo "=== dsh personal layer install ==="
echo "  repo     : ${REPO}"
echo "  dsh home : ${DSH_H}"

# ── 0) Refuse a dsh too old to mount a preset, BEFORE building anything ──────
# A preset is a `@deepseek-ai/dsh-agent-preset` row, and that package does not
# exist before 0.1.7-alpha.1. On an older dsh this installer used to succeed,
# sync the bundle, and leave `dsh web` failing at startup with
#
#   failed to import loader entry preset-renks (@deepseek-ai/dsh-agent-preset):
#   Cannot find package '@deepseek-ai/dsh-agent-preset'
#
# which names the symptom and not the cause. Checking here turns a dead launcher
# into one actionable line. Probed from the installed tree, so no network.
#
# The profile trees are asked first, because an older dsh hoisted its
# dependencies into them. They are not sufficient on their own: a profile holds
# only what it declares, and this setup declares two local bundles, so on a
# healthy 0.2.0-rc.2 machine with no @deepseek-ai/* in the profiles both probes
# find nothing. Measured 2026-10-05, which is how this guard came to refuse an
# install on a working dsh. A preset row is resolved by dsh from its OWN install
# tree, and that tree is also the honest answer to the question the guard asks:
# an old dsh does not ship that package anywhere, a current one always does.
PRESET_ROW=""
for candidate in "${DSH_H}"/profiles/*/node_modules/@deepseek-ai/dsh-agent-preset/package.json \
                 "${DSH_H}"/profiles/node_modules/@deepseek-ai/dsh-agent-preset/package.json; do
  if [ -f "${candidate}" ]; then PRESET_ROW="${candidate}"; break; fi
done

if [ -z "${PRESET_ROW}" ]; then
  # A pnpm launcher is a shell shim whose last line names the CLI entry; an npm
  # one is a symlink to it. Whichever is found, node then resolves the package
  # the way dsh does - from that entry's own tree.
  DSH_SHIM="$(command -v dsh 2>/dev/null || true)"
  DSH_ENTRY=""
  if [ -n "${DSH_SHIM}" ] && [ -f "${DSH_SHIM}" ]; then
    # Each probe carries `|| true`: under `set -o pipefail` an assignment whose
    # substitution fails ends the script on the spot, which would trade this
    # guard's one actionable line for no output at all.
    DSH_ENTRY="$(sed -n 's/^# cmd-shim-target=//p' "${DSH_SHIM}" | tail -1 || true)"
    if [ ! -f "${DSH_ENTRY}" ]; then
      # One level is enough: a launcher links straight at the CLI entry.
      # `readlink -f` is GNU-only, so a relative target is joined here.
      LINKED="$(readlink "${DSH_SHIM}" 2>/dev/null || true)"
      case "${LINKED}" in
        '') ;;
        /*) DSH_ENTRY="${LINKED}" ;;
        *) DSH_ENTRY="$(dirname "${DSH_SHIM}")/${LINKED}" ;;
      esac
    fi
    if [ ! -f "${DSH_ENTRY}" ]; then
      # A shim that only execs the entry inline: take the path it names. The
      # match starts at the first `/`, so in a shim that writes
      # `"$basedir/../global/..."` it comes out relative to the launcher.
      DSH_ENTRY="$(grep -oE '/[^"[:space:]]*/lib/bin\.js' "${DSH_SHIM}" 2>/dev/null | head -1 || true)"
      if [ -n "${DSH_ENTRY}" ] && [ ! -f "${DSH_ENTRY}" ]; then
        DSH_ENTRY="$(dirname "${DSH_SHIM}")/${DSH_ENTRY}"
      fi
      [ -f "${DSH_ENTRY}" ] || DSH_ENTRY=""
    fi
  fi
  # require.resolve, not import: the package only has to be reachable, and this
  # runs before the builder does, on whatever node the machine has.
  if [ -f "${DSH_ENTRY}" ] && command -v node >/dev/null 2>&1; then
    PRESET_ROW="$(cd "$(dirname "${DSH_ENTRY}")" && node -e "const t=['@deepseek-ai/dsh-agent-preset/package.json','@deepseek-ai/dsh-agent-preset']; for (const s of t) { try { process.stdout.write(require.resolve(s)); break } catch {} }" 2>/dev/null || true)"
  fi
fi

if [ -z "${PRESET_ROW}" ]; then
  echo "  [fail] dsh is too old for this preset: no @deepseek-ai/dsh-agent-preset installed."
  echo "         A preset is that plugin's row, and dsh ships it only from 0.1.7-alpha.1."
  echo "         Nothing was written. Upgrade, then re-run this script:"
  echo "           pnpm add -g @deepseek-ai/dsh@latest"
  exit 1
fi

# ── 1) Rebuild the preset recipe for THIS dsh version ────────────────────────
BASE="${PRESET_DIR}/stock-baseline.agent.cordis.yml"
PATCH="${PRESET_DIR}/agent.cordis.patch"
FALLBACK="${PRESET_DIR}/fallback.agent.cordis.yml"
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
RESULT="${WORK}/agent.cordis.yml"
STATUS="merged"

# Ask the tool where the stock recipe is and what shape it takes. It probes the
# legacy directory layout first and falls back to the shipped patch file inside
# the dsh installation, extracting the plugin list, so this script never needs to
# know which layout is installed.
STOCK="${WORK}/stock.yml"
BUILDER_TOOL="${REPO}/tools/build-preset-recipe.mjs"
if [ -f "${BUILDER_TOOL}" ] && command -v node >/dev/null 2>&1; then
  if ! node "${BUILDER_TOOL}" --print-stock "${STOCK}" >"${WORK}/print-stock.json" 2>&1; then
    echo "  [warn] the stock recipe could not be resolved:"
    sed 's/^/         /' "${WORK}/print-stock.json" | head -5
    STOCK=""
  fi
else
  echo "  [warn] no ${BUILDER_TOOL}, so the stock recipe cannot be resolved."
  STOCK=""
fi
if [ -n "${STOCK}" ] && [ ! -s "${STOCK}" ]; then STOCK=""; fi
if [ -z "${STOCK}" ]; then
  echo "  [warn] installing the last-known-good recipe instead. The merge path is"
  echo "         skipped, so re-run once dsh is installed and resolvable."
fi

# Rebuild the recipe from the frozen baseline + your patch, then 3-way merge it
# against the installed stock recipe. A stale baseline (upstream rewrote a block
# you patch) is RECOVERABLE: `tools/build-preset-recipe.mjs` regenerates the
# baseline, the patch and the fallback from the installed stock recipe, so the
# install self-heals instead of silently degrading to the last-known-good copy.
rebuild_recipe() {
  STATUS="merged"
  cp "${BASE}" "${RESULT}"
  if ! (cd "${WORK}" && git apply "${PATCH}" 2>/dev/null); then
    STATUS="patch does not apply to the baseline"
    return
  fi
  git merge-file "${RESULT}" "${BASE}" "${STOCK}" >/dev/null 2>&1 || true  # nonzero = conflicts
  if grep -q '^<<<<<<<' "${RESULT}"; then
    STATUS="upstream changed a block this preset patches"
    return
  fi
  # Every plugin row this preset adds must survive the merge. docs-gate is the
  # enforcement of the instruction contract, so losing it silently would return
  # the machine to guidance with nothing behind it.
  if ! grep -q 'id: skill-search' "${RESULT}" \
     || ! grep -q 'id: docs-gate' "${RESULT}"; then
    STATUS="merged recipe lost a plugin row"
    return
  fi
  # YAML sanity when dsh's yaml parser is available (non-fatal gate). The parser
  # is hoisted into the PROFILE's node_modules, so probe each profile rather than
  # assuming the shared profiles root carries it.
  if [ -n "${YAML_DIR}" ]; then
    if ! (cd "${YAML_DIR}" && node -e "require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8'))" "${RESULT}" >/dev/null 2>&1); then
      STATUS="merged recipe failed YAML parse"
      return
    fi
  fi
  STATUS="merged"
}

# The attempt itself is a function so a failed regeneration can retry it without
# repeating the recovery logic. An empty STOCK must reach the fallback: that is
# the one case where the last-known-good copy is the only usable recipe.
attempt_recipe() {
  if [ -z "${STOCK}" ]; then
    STATUS="no installed stock preset to merge against"
    return
  fi
  rebuild_recipe
  if [ "${STATUS}" = "merged" ]; then
    echo "  [ok] recipe rebuilt for the installed dsh version (clean 3-way merge)"
    return
  fi
  if [ ! -f "${BUILDER}" ] || ! command -v node >/dev/null 2>&1; then
    return
  fi
  echo "  [info] ${STATUS} - regenerating the patch for this dsh version..."
  if node "${BUILDER}" >/dev/null 2>&1; then
    rebuild_recipe
    if [ "${STATUS}" = "merged" ]; then
      echo "  [ok] patch regenerated against the installed stock recipe"
    fi
  else
    echo "  [warn] regenerating the patch failed; the installed stock recipe"
    echo "         no longer matches the edit blocks in ${BUILDER##*/}."
  fi
}

attempt_recipe

# A recipe that never got built must not be reported as built. Everything past
# this point copies ${RESULT}, so leave it absent only if the fallback is also
# missing, and fail loudly rather than at the next `cp` under `set -e`.
if [ ! -f "${RESULT}" ]; then
  if [ -f "${FALLBACK}" ]; then
    cp "${FALLBACK}" "${RESULT}"
    echo "  [warn] installing the last-known-good preset instead."
    echo "         Nothing regresses; the preset keeps working as it did."
    echo "         To rebuild against the version actually installed, re-run this"
    echo "         script once dsh is present, or regenerate the patch directly:"
    echo "           node ${BUILDER}"
  else
    echo "  [fail] ${STATUS}, and no fallback recipe at ${FALLBACK}"
    exit 1
  fi
fi

# ── 2) Install the renks preset where dsh discovers it ───────────────────────
mkdir -p "${DSH_H}/.agent-presets/renks"
cp -f "${PRESET_DIR}/preset.yml" "${DSH_H}/.agent-presets/renks/preset.yml"
cp -f "${RESULT}" "${DSH_H}/.agent-presets/renks/agent.cordis.yml"
for f in "${PRESET_DIR}"/*.mjs; do
  # Skip test suites and their harness: they are run from the repo, and a preset
  # directory only needs the modules its recipe actually names.
  case "$f" in *.spec.mjs|*.testkit.mjs) continue ;; esac
  [ -e "$f" ] && cp -f "$f" "${DSH_H}/.agent-presets/renks/"
done

# `cp -f` never removes, so a module this preset stopped naming stayed in the
# directory forever and the bundle builder then carried it into every profile.
# That is how two modules of a plugin deleted on 2026-10-02 kept travelling. The
# builder prunes by the import closure now; this applies the same rule here, where
# the copies are made, so the two cannot disagree about what belongs.
INSTALLED_PRESET="${DSH_H}/.agent-presets/renks"
if command -v node >/dev/null 2>&1; then
  PRUNED="$(node -e "
    const { pruneHelpers } = await import('${REPO}/tools/preset-helpers.mjs')
    const { readFileSync } = await import('node:fs')
    const dir = process.argv[1]
    const composition = readFileSync(dir + '/agent.cordis.yml', 'utf8')
    const { pruned, error } = await pruneHelpers(dir, composition)
    if (error !== undefined) { process.stderr.write(error + '\n'); process.exit(0) }
    process.stdout.write(pruned.join(' '))
  " --input-type=module "${INSTALLED_PRESET}" 2>/dev/null || true)"
  [ -n "${PRUNED}" ] && echo "  [ok] pruned unreferenced helpers: ${PRUNED}"
fi

echo "  [ok] preset 'renks' installed at ${INSTALLED_PRESET}"

# ── 3) User-global rules + skills (symlinks: `git pull` updates propagate) ───
ln -sfn "${REPO}/AGENTS.md" "${DSH_H}/AGENTS.md"
ln -sfn "${REPO}/skills" "${DSH_H}/skills"
echo "  [ok] symlinks: ${DSH_H}/AGENTS.md -> repo AGENTS.md ; ${DSH_H}/skills -> repo skills"

# ── 4) Bundle the preset into the 0.2.0 format ──────────────────────────────
# DSH 0.1.7 removed directory presets: nothing reads `.agent-presets/` any more.
# A preset is now a row carried by a plugin bundle's patch file, installed into
# the profile's node_modules. The builder converts what step 2 just wrote, so
# this order is not interchangeable.
# Where the profile expects it. `DSH_BUNDLE_OUT` overrides for a machine that
# keeps its bundles elsewhere; the profile's package.json must name the same path.
BUNDLE_OUT="${DSH_BUNDLE_OUT:-${HOME}/dsh-user-presets}"
BUNDLE_LOG="${TMPDIR:-/tmp}/dsh-bundle.log"
if [ -f "${SRC}/build-preset-bundle.mjs" ]; then
  if node "${SRC}/build-preset-bundle.mjs" --out "${BUNDLE_OUT}" --dsh-home "${DSH_H}" >"${BUNDLE_LOG}" 2>&1; then
    echo "  [ok] bundle built at ${BUNDLE_OUT}: $(ls "${BUNDLE_OUT}/presets"/*.patch.yml 2>/dev/null | wc -l) patch(es)"
    # The builder's running commentary stays in the log, but anything it PRUNED
    # or SKIPPED is a change to what a session will mount, and a silent change of
    # that kind is the defect this whole area keeps producing. Surface those.
    # Everything else is noise on the happy path, so it is not reprinted.
    grep -E -A1 '^(pruned|skip )' "${BUNDLE_LOG}" | sed 's/^/    /' || true
  else
    echo "  [fail] bundle build failed:"
    sed 's/^/         /' "${BUNDLE_LOG}"
  fi
else
  echo "  [skip] no bundle builder at ${SRC}/build-preset-bundle.mjs"
fi

# ── 5) Declare the bundle in each profile that already refers to it ─────────
# A profile mounts a bundle only when its package.json names it in BOTH the
# dsh.profile.bundles array and dependencies, and a profile missing either half
# loads nothing while reporting no error. The tool COMPLETES such a profile and
# refuses to introduce the bundle to one that never mentioned it, so a profile
# belonging to another setup is left alone. Its own dry run is the report.
WIRED=0
if [ -f "${BUNDLE_OUT}/package.json" ] && command -v node >/dev/null 2>&1; then
  WIRING="$(node "${REPO}/tools/wire-profile-bundles.mjs" --dsh-home "${DSH_H}" --bundle "${BUNDLE_OUT}" 2>&1)"
  printf '%s\n' "${WIRING}" | sed 's/^/  /'
  printf '%s\n' "${WIRING}" | grep -q '\[ok\]' && WIRED=1
else
  echo "  [skip] no bundle at ${BUNDLE_OUT} to declare"
fi

# ── 6) Sync the bundle into every profile ───────────────────────────────────
# Rewriting the bundle is NOT enough, and the reason is a pnpm detail that is
# invisible until a profile fails to pick up a change. The profiles use
# `nodeLinker: hoisted`, so a `file:` dependency may land as a HARDLINK or as an
# independent COPY depending on how the last install ran. A hardlink follows the
# bundle for free; a copy needs `pnpm install` to be refreshed. Measured on
# 2026-10-02: the `web` profile was hardlinked and followed a change with no
# install, while `dsh-tui` held a separate copy and did not.
#
# So this runs install in every profile that has the bundle. It is a no-op for
# the hardlinked ones and the only thing that works for the others.
# Run for any profile that already declares the bundle, whether or not this run
# declared it. Gating this on the wiring step was wrong: the bundle is also
# PRUNED (a preset dropped from the roster loses its patch file), and a profile
# only drops the removed preset by re-running install. Skipping it left a stale
# preset mounted with everything reporting success.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "  [warn] pnpm not found: run pnpm install in each profile to pick up the bundle"
elif [ "${WIRED}" = "0" ] && ! grep -rq 'dsh-user-presets' "${DSH_H}"/profiles/*/package.json 2>/dev/null; then
  echo "  [skip] no profile declares the bundle, so nothing to install"
else
  for profile in "${DSH_H}"/profiles/*/; do
    [ -f "${profile}package.json" ] || continue
    grep -q 'dsh-user-presets' "${profile}package.json" 2>/dev/null || continue
    name="$(basename "${profile}")"
    if (cd "${profile}" && pnpm install --silent >/dev/null 2>&1); then
      echo "  [ok] synced bundle into profile '${name}'"
    else
      echo "  [warn] '${name}': pnpm install failed; run it by hand to pick up the bundle"
    fi
  done
fi

# ── 7) Make renks the default preset for new sessions ────────────────────────
# This used to append `agent-presets: default: renks` to `$DSH_HOME/settings.yaml`.
# That is a 0.1.x mechanism. dsh 0.2.0 imports the sections of that file into the
# entry with the matching id and renames it to `settings.yaml.imported`, and no
# entry is called `agent-presets` - the registry row is `agent-preset-registry`,
# shipped with `default: standard`. So the section was dropped with a log warning
# that nothing surfaced, and new sessions kept opening as the stock preset while
# every step above reported success.
#
# The choice now goes where the running composition reads it: the profile's own
# patch layer, which is applied after every bundle layer. Only a profile whose
# composition HAS that entry can take it - the TUI profile runs its own preset
# roster - and rather than guess from a package name this asks dsh for the
# composed tree, which is the same tree a session mounts.
for profile in "${DSH_H}"/profiles/*/; do
  [ -f "${profile}package.json" ] || continue
  grep -q 'dsh-user-presets' "${profile}package.json" 2>/dev/null || continue
  name="$(basename "${profile}")"
  PROFILE_PATCH="${profile}cordis.patch.yml"
  if [ ! -f "${PROFILE_PATCH}" ]; then
    echo "  [warn] '${name}': no cordis.patch.yml, so the default preset is unset"
    continue
  fi
  if grep -q '^- id: agent-preset-registry' "${PROFILE_PATCH}"; then
    echo "  [skip] '${name}': default preset already set in cordis.patch.yml"
    continue
  fi
  if ! command -v dsh >/dev/null 2>&1; then
    echo "  [warn] '${name}': dsh not on PATH, cannot read its composed entries"
    continue
  fi
  # To a file, not into a pipe: `grep -q` stops at the first match, and under
  # `set -o pipefail` the SIGPIPE that leaves behind would read as "no entry".
  # The dump itself rewrites the profile's cordis.yml, which dsh normalises at
  # every boot anyway.
  COMPOSED="${WORK}/composed-${name}.yml"
  if ! dsh --profile "${name}" --dump-config >"${COMPOSED}" 2>/dev/null; then
    echo "  [warn] '${name}': dsh could not compose this profile; default preset unset"
    continue
  fi
  if ! grep -q '^- id: agent-preset-registry' "${COMPOSED}"; then
    echo "  [skip] '${name}': its composition has no agent-preset-registry entry"
    continue
  fi
  # A default naming a preset that is not mounted turns every new session into a
  # "no such preset" error at session creation, which is worse than leaving the
  # stock default in place. The roster row comes from the bundle this run builds.
  if ! grep -q '^- id: preset-renks' "${COMPOSED}"; then
    echo "  [warn] '${name}': the renks preset is not mounted, leaving the default alone"
    continue
  fi
  cp "${PROFILE_PATCH}" "${PROFILE_PATCH}.bak-$(date +%Y%m%d%H%M%S)-$$"
  # An untouched patch layer is an empty list written as `[]`, and a block cannot
  # be appended to that: the marker has to go first. `|| true` because a file
  # holding nothing but the marker selects no lines, and grep calls that a
  # failure - which `set -e` would turn into a silent stop mid-install.
  if [ "$(grep -vE '^[[:space:]]*(#|$)' "${PROFILE_PATCH}" | tr -d '[:space:]')" = "[]" ]; then
    { grep -vE '^[[:space:]]*\[[[:space:]]*\][[:space:]]*$' "${PROFILE_PATCH}" || true; } > "${PROFILE_PATCH}.new"
    mv "${PROFILE_PATCH}.new" "${PROFILE_PATCH}"
  fi
  printf '\n# Renks is the default preset. A `settings.yaml` section is not read by\n# dsh 0.2.0; the registry row owns this choice.\n- id: agent-preset-registry\n  name: "@deepseek-ai/dsh-agent-preset-registry"\n  config:\n    default: renks\n' >> "${PROFILE_PATCH}"
  # Writing is not mounting: a patch whose target id or name drifts is dropped by
  # the loader with a warning and still exits 0, so the line a human reads has to
  # come from the composed tree rather than from the append above.
  AFTER="${COMPOSED%.yml}-after.yml"
  if dsh --profile "${name}" --dump-config >"${AFTER}" 2>/dev/null \
     && grep -A3 '^- id: agent-preset-registry' "${AFTER}" | grep -q 'default: renks'; then
    echo "  [ok] '${name}': agent-preset-registry.default = renks (previous patch backed up)"
  else
    echo "  [warn] '${name}': wrote the override but the composed tree does not show it"
  fi
done

echo ""
echo "Done. Open a NEW dsh session: the modules are loaded at startup, so a"
echo "running session keeps the old code until it restarts."
echo "The default preset is 'renks'; /preset switches back to stock 'standard'."
echo ""
# Name the profiles this touched, and the ones it deliberately did not. A
# profile that never mentioned the bundle belongs to another setup, and saying so
# is the difference between "nothing needed" and "nothing was done".
pending=""
for profile in "${DSH_H}"/profiles/*/; do
  [ -f "${profile}package.json" ] || continue
  name="$(basename "${profile}")"
  grep -q 'dsh-user-presets' "${profile}package.json" 2>/dev/null && continue
  case "${name}" in node_modules) continue ;; esac
  pending="${pending} ${name}"
done
if [ -n "${pending}" ]; then
  echo "Not touched, because they never mentioned the bundle:${pending}"
  echo "If one of them should use the renks preset, add to its package.json:"
  echo "  \"dsh-user-presets\": \"file:${BUNDLE_OUT}\"   in dependencies, and"
  echo "  \"dsh-user-presets\"                           in dsh.profile.bundles"
fi
# ── 8) Report any profile pinned below the dsh-unrestricted floor ────────────
# The README states this floor and nothing applied it, so a profile below it
# installed without complaint and failed later at activation with an error that
# reads as a plugin incompatible with dsh. Checking here moves the discovery from
# a crash to the install that caused it.
DEPS_CHECK="${REPO}/tools/check-profile-deps.mjs"
if [ -f "${DEPS_CHECK}" ] && command -v node >/dev/null 2>&1; then
  echo ""
  if ! node "${DEPS_CHECK}" --dsh-home "${DSH_H}"; then
    echo "  [warn] a profile above is below the floor; the plugin installs and then"
    echo "         fails to activate. Nothing else in this run is affected."
  fi
fi

echo ""
echo "Re-run after every dsh update: it rebuilds the recipe against the installed"
echo "version, re-bundles, and syncs every profile."
