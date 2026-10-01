#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANDIDATE_ROOT="${1:-$ROOT/artifacts/unimate-neural-foundry}"
SHIPPING_ROOT="${2:-$ROOT/public/models/quaternius}"
OUT="${3:-$ROOT/artifacts/unimate-neural-quality}"
BLENDER_BIN="${BLENDER_BIN:-blender}"

command -v "$BLENDER_BIN" >/dev/null || { echo "Blender is required for neural motion promotion." >&2; exit 2; }
mkdir -p "$OUT"

compare_group() {
  local group="$1" baseline="$2" candidate="$3"; shift 3
  [[ -s "$candidate" ]] || { echo "$group: candidate GLB absent; shipping pack remains."; return 0; }
  for action in "$@"; do
    "$BLENDER_BIN" --background --python "$ROOT/tools/unimate/compare-motion-quality.py" -- \
      --baseline "$baseline" \
      --candidate "$candidate" \
      --action "$action" \
      --output "$OUT/$action.json"
  done
}

compare_group shared \
  "$SHIPPING_ROOT/blender-strikes-core.glb" \
  "$CANDIDATE_ROOT/shared/blender-strikes-core.glb" \
  BF_Jab_L BF_BodyBlow_L BF_Backfist_R

# Counter is additive in the shared pack. It is deliberately not required for
# comparison because today's shipping shared pack has no BF_Counter_R baseline.
compare_group cross \
  "$SHIPPING_ROOT/blender-cross-core.glb" \
  "$CANDIDATE_ROOT/cross/blender-cross-core.glb" \
  BF_Cross_R

compare_group power \
  "$SHIPPING_ROOT/blender-fight-core.glb" \
  "$CANDIDATE_ROOT/power/blender-fight-core.glb" \
  BF_Power_R

compare_group kicks \
  "$SHIPPING_ROOT/blender-kicks-core.glb" \
  "$CANDIDATE_ROOT/kicks/blender-kicks-core.glb" \
  BF_FrontKick_R BF_LowKick_L BF_RisingKick_R

python3 "$ROOT/tools/unimate/evaluate-neural-foundry.py" \
  --candidate-root "$CANDIDATE_ROOT" \
  --shipping-root "$SHIPPING_ROOT" \
  --quality-dir "$OUT" \
  --output "$OUT/promotion.json"

echo "Neural promotion report: $OUT/promotion.json"
