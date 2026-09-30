#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELECTION="${1:-$ROOT/artifacts/kimodo-poly-fighter-strikes/selection.json}"
SOURCE="${2:-$ROOT/.tmp-quaternius/ual1-full.glb}"
OUT="${3:-$ROOT/artifacts/kimodo-motion-foundry-strikes}"

command -v blender >/dev/null || { echo "blender is required." >&2; exit 2; }
command -v xvfb-run >/dev/null || { echo "xvfb-run is required." >&2; exit 2; }
test -s "$SELECTION" || { echo "Missing selection: $SELECTION" >&2; exit 2; }
test -s "$SOURCE" || { echo "Missing UAL source: $SOURCE" >&2; exit 2; }

mkdir -p "$OUT/shared" "$OUT/cross" "$OUT/power"

eval "$(
python3 - "$SELECTION" <<'PY'
import json, shlex, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
for move in ("jab", "cross", "bodyBlow", "backfist", "power", "counter"):
    bvh = data["moves"][move]["selected"]["bvh"]
    print(f'{move.upper()}={shlex.quote(str(Path(bvh).resolve()))}')
PY
)"

export PYTHONPATH="$ROOT/tools/blender:/usr/lib/python3/dist-packages${PYTHONPATH:+:$PYTHONPATH}"

xvfb-run -a blender --background \
  --python-use-system-env \
  --python-exit-code 1 \
  --python "$ROOT/tools/blender/build-fight-motion-foundry-v2-strikes.py" \
  -- \
  --source "$SOURCE" \
  --kimodo-jab "$JAB" \
  --kimodo-body-blow "$BODYBLOW" \
  --kimodo-backfist "$BACKFIST" \
  --kimodo-counter "$COUNTER" \
  --output-dir "$OUT/shared"

xvfb-run -a blender --background \
  --python-use-system-env \
  --python-exit-code 1 \
  --python "$ROOT/tools/blender/build-fight-motion-foundry-v2-cross.py" \
  -- \
  --source "$SOURCE" \
  --kimodo-prior "$CROSS" \
  --output-dir "$OUT/cross"

xvfb-run -a blender --background \
  --python-use-system-env \
  --python-exit-code 1 \
  --python "$ROOT/tools/blender/build-fight-motion-foundry-v1.py" \
  -- \
  --source "$SOURCE" \
  --kimodo-prior "$POWER" \
  --output-dir "$OUT/power"

test -s "$OUT/shared/blender-strikes-core.glb"
test -s "$OUT/cross/blender-cross-core.glb"
test -s "$OUT/power/blender-fight-core.glb"

python3 - "$OUT" <<'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
summary = {
    "version": "POLY_FIGHTER_KIMODO_STRIKE_FOUNDRY_V1",
    "shared": json.loads((root / "shared/blender-strikes-core.metrics.json").read_text()),
    "cross": json.loads((root / "cross/blender-cross-core.metrics.json").read_text()),
    "power": json.loads((root / "power/blender-fight-core.metrics.json").read_text()),
}
(root / "kimodo-strike-foundry-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
PY

echo "Kimodo strike Foundry outputs: $OUT"
