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

# The stock `standard` recipe ships in the PROFILE's node_modules, not in the
# shared profiles root, and which profile exists is machine-specific. Probing
# every profile keeps this working when the active one changes (web <-> tui <-> a
# rescue profile) instead of failing on a path that looked right once.
# `profiles/*/node_modules` covers a profile with its own copy; the shared
# `profiles/node_modules` covers a hoisted install, which is where the package
# actually lives on at least one machine this has run on. Probing only the first
# reported a false "no stock preset" and left STOCK empty.
STOCK=""
for candidate in \
  "${DSH_H}"/profiles/*/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml \
  "${DSH_H}"/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml; do
  if [ -f "${candidate}" ]; then STOCK="${candidate}"; break; fi
done

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
PRESET_ROW=""
for candidate in "${DSH_H}"/profiles/*/node_modules/@deepseek-ai/dsh-agent-preset/package.json \
                 "${DSH_H}"/profiles/node_modules/@deepseek-ai/dsh-agent-preset/package.json; do
  if [ -f "${candidate}" ]; then PRESET_ROW="${candidate}"; break; fi
done

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

if [ -z "${STOCK}" ] || [ ! -f "${STOCK}" ]; then
  echo "  [warn] no installed stock preset under ${DSH_H}/profiles/node_modules or"
  echo "         ${DSH_H}/profiles/*/node_modules. Installing the last-known-good"
  echo "         recipe; re-run after dsh is installed to rebuild against the"
  echo "         version actually present."
  STOCK=""
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
echo "  [ok] preset 'renks' installed at ${DSH_H}/.agent-presets/renks"

# ── 3) User-global rules + skills (symlinks: `git pull` updates propagate) ───
ln -sfn "${REPO}/AGENTS.md" "${DSH_H}/AGENTS.md"
ln -sfn "${REPO}/skills" "${DSH_H}/skills"
echo "  [ok] symlinks: ${DSH_H}/AGENTS.md -> repo AGENTS.md ; ${DSH_H}/skills -> repo skills"

# ── 4) Make renks the default preset for new sessions ────────────────────────
# Append only, and back up first. This script has always appended, but the file
# it appends to does not survive verbatim on its own: it was 82 bytes on
# 2026-09-15 and contained one section, and on 2026-10-03 it contained only the
# section this step adds. Whatever rewrote it kept nothing else, so the risk this
# guards is not a bad append here - it is the NEXT rewrite discarding the preset
# choice and this step then re-appending to a file that lost its other settings.
SETTINGS="${DSH_H}/settings.yaml"
if grep -q '^agent-presets:' "${SETTINGS}" 2>/dev/null; then
  echo "  [skip] settings.yaml already has an agent-presets section"
else
  if [ -f "${SETTINGS}" ] && [ -s "${SETTINGS}" ]; then
    cp "${SETTINGS}" "${SETTINGS}.bak-$(date +%Y%m%d%H%M%S)"
  fi
  printf '\nagent-presets:\n  default: renks\n' >> "${SETTINGS}"
  echo "  [ok] settings.yaml: agent-presets.default = renks (previous content backed up if any)"
fi

# ── 5) Bundle the preset into the 0.2.0 format ──────────────────────────────
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

# ── 6) Declare the bundle in each profile that already refers to it ─────────
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

# ── 7) Sync the bundle into every profile ───────────────────────────────────
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
echo ""
echo "Re-run after every dsh update: it rebuilds the recipe against the installed"
echo "version, re-bundles, and syncs every profile."
