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
STOCK=""
for candidate in "${DSH_H}"/profiles/*/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml; do
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

# ── 1) Rebuild the preset recipe for THIS dsh version ────────────────────────
BASE="${PRESET_DIR}/stock-baseline.agent.cordis.yml"
PATCH="${PRESET_DIR}/agent.cordis.patch"
FALLBACK="${PRESET_DIR}/fallback.agent.cordis.yml"
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
RESULT="${WORK}/agent.cordis.yml"
STATUS="merged"

if [ -z "${STOCK}" ] || [ ! -f "${STOCK}" ]; then
  echo "  [warn] no installed stock preset under ${DSH_H}/profiles/*/node_modules"
  echo "         Installing the last-known-good recipe; re-run after dsh is installed"
  echo "         to rebuild against the version actually present."
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

if [ -n "${STOCK}" ]; then
  rebuild_recipe
  if [ "${STATUS}" != "merged" ] && [ -f "${BUILDER}" ] && command -v node >/dev/null 2>&1; then
    echo "  [info] ${STATUS} - regenerating the patch for this dsh version..."
    if node "${BUILDER}" >/dev/null 2>&1; then
      rebuild_recipe
      [ "${STATUS}" = "merged" ] && echo "  [ok] patch regenerated against the installed stock recipe"
    else
      echo "  [warn] regenerating the patch failed; the installed stock recipe"
      echo "         no longer matches the edit blocks in ${BUILDER##*/}."
    fi
  fi
fi

if [ "${STATUS}" = "merged" ]; then
  echo "  [ok] recipe rebuilt for the installed dsh version (clean 3-way merge)"
else
  cp "${FALLBACK}" "${RESULT}"
  echo "  [warn] ${STATUS} - installing last-known-good preset instead."
  echo "         Everything keeps working as before. To refresh the patch later:"
  echo "         node ${BUILDER}   # regenerates baseline + patch + fallback"
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
if grep -q '^agent-presets:' "${DSH_H}/settings.yaml" 2>/dev/null; then
  echo "  [skip] settings.yaml already has an agent-presets section"
else
  printf '\nagent-presets:\n  default: renks\n' >> "${DSH_H}/settings.yaml"
  echo "  [ok] settings.yaml: agent-presets.default = renks"
fi

# ── 5) Bundle the preset into the 0.2.0 format ──────────────────────────────
# DSH 0.1.7 removed directory presets: nothing reads `.agent-presets/` any more.
# A preset is now a row carried by a plugin bundle's patch file, installed into
# the profile's node_modules. The builder converts what step 2 just wrote, so
# this order is not interchangeable.
# Where the profile expects it. `DSH_BUNDLE_OUT` overrides for a machine that
# keeps its bundles elsewhere; the profile's package.json must name the same path.
BUNDLE_OUT="${DSH_BUNDLE_OUT:-${HOME}/dsh-user-presets}"
if [ -f "${SRC}/build-preset-bundle.mjs" ]; then
  if node "${SRC}/build-preset-bundle.mjs" --out "${BUNDLE_OUT}" --dsh-home "${DSH_H}" >/tmp/dsh-bundle.log 2>&1; then
    echo "  [ok] bundle built at ${BUNDLE_OUT}: $(ls "${BUNDLE_OUT}/presets"/*.patch.yml 2>/dev/null | wc -l) patch(es)"
  else
    echo "  [fail] bundle build failed:"
    sed 's/^/         /' /tmp/dsh-bundle.log
  fi
else
  echo "  [skip] no bundle builder at ${SRC}/build-preset-bundle.mjs"
fi

echo ""
echo "Done. Two steps remain, both printed because the installer cannot do them:"
echo ""
echo "  1. The bundle must be a dependency of each dsh profile, so add to the"
echo "     profile's package.json:"
echo "         \"dsh-user-presets\": \"file:${BUNDLE_OUT}\""
echo "     and list \"dsh-user-presets\" in its dsh.profile.bundles array."
echo "     Then run \`pnpm install\` in that profile directory."
echo ""
echo "  2. Open a NEW dsh session. The default preset is 'renks'."
echo "     Use /preset to switch back to stock 'standard' at any time."
echo ""
echo "Re-run this script after every dsh update: it rebuilds the recipe against"
echo "the installed version, and re-bundles. Step 1 is a one-time edit per profile."
