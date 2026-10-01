#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${1:-$ROOT/artifacts/unimate-neural-priors/manifest.json}"
SOURCE="${2:-${FOUNDRY_SOURCE_GLB:-$ROOT/.tmp-quaternius/ual1-full.glb}}"
OUT="${3:-$ROOT/artifacts/unimate-neural-foundry}"
BLENDER_BIN="${BLENDER_BIN:-blender}"

test -s "$MANIFEST" || { echo "Missing UniMate prior manifest: $MANIFEST" >&2; exit 2; }
test -s "$SOURCE" || { echo "Missing full UAL Foundry source: $SOURCE" >&2; exit 2; }
command -v "$BLENDER_BIN" >/dev/null || { echo "Blender is required." >&2; exit 2; }
command -v xvfb-run >/dev/null || { echo "xvfb-run is required." >&2; exit 2; }
mkdir -p "$OUT"

eval "$(
python3 - "$MANIFEST" <<'PY'
import json, shlex, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
for key in ("jab", "bodyBlow", "backfist", "counter", "cross", "power", "frontKick", "lowKick", "risingKick"):
    move = data["moves"].get(key, {})
    value = move.get("bvh", "") if move.get("mode") == "neural-inbetween" else ""
    print(f'{key.upper()}={shlex.quote(value)}')
PY
)"

export PYTHONPATH="$ROOT/tools/blender:/usr/lib/python3/dist-packages${PYTHONPATH:+:$PYTHONPATH}"

run_blender() {
  xvfb-run -a "$BLENDER_BIN" --background \
    --python-use-system-env \
    --python-exit-code 1 "$@"
}

# Shared pack: only replace it when all currently shipping core strike priors
# exist. Counter remains optional because runtime already has its procedural
# fallback when BF_Counter_R is absent.
if [[ -n "$JAB" && -n "$BODYBLOW" && -n "$BACKFIST" ]]; then
  args=(
    --source "$SOURCE"
    --motion-prior-jab "$JAB"
    --motion-prior-body-blow "$BODYBLOW"
    --motion-prior-backfist "$BACKFIST"
    --output-dir "$OUT/shared"
  )
  [[ -n "$COUNTER" ]] && args+=(--motion-prior-counter "$COUNTER")
  run_blender --python "$ROOT/tools/blender/build-fight-motion-foundry-v2-strikes.py" -- "${args[@]}"
else
  echo "Shared strikes: neural set incomplete; leave shipping pack unchanged."
fi

if [[ -n "$CROSS" ]]; then
  run_blender --python "$ROOT/tools/blender/build-fight-motion-foundry-v2-cross.py" -- \
    --source "$SOURCE" --motion-prior "$CROSS" --output-dir "$OUT/cross"
else
  echo "Cross: no neural prior; leave shipping pack unchanged."
fi

if [[ -n "$POWER" ]]; then
  run_blender --python "$ROOT/tools/blender/build-fight-motion-foundry-v1.py" -- \
    --source "$SOURCE" --motion-prior "$POWER" --output-dir "$OUT/power"
else
  echo "Power: no neural prior; leave shipping pack unchanged."
fi

# Kicks are reviewed as one tightly coupled grounding pack. Never replace only
# one or two kicks because that would make missing techniques fall back from the
# current measured-CMU shipping motion to a different authored reference path.
if [[ -n "$FRONTKICK" && -n "$LOWKICK" && -n "$RISINGKICK" ]]; then
  run_blender --python "$ROOT/tools/blender/build-fight-motion-foundry-v2-kicks.py" -- \
    --source "$SOURCE" \
    --motion-prior-front "$FRONTKICK" \
    --motion-prior-low "$LOWKICK" \
    --motion-prior-rising "$RISINGKICK" \
    --output-dir "$OUT/kicks"
else
  echo "Kicks: neural set incomplete; leave measured V6 shipping pack unchanged."
fi

python3 - "$MANIFEST" "$OUT" <<'PY'
import json, sys
from pathlib import Path
manifest = json.loads(Path(sys.argv[1]).read_text())
root = Path(sys.argv[2])
outputs = {
    "shared": root / "shared/blender-strikes-core.metrics.json",
    "cross": root / "cross/blender-cross-core.metrics.json",
    "power": root / "power/blender-fight-core.metrics.json",
    "kicks": root / "kicks/blender-kicks-core.metrics.json",
}
summary = {
    "version": "POLY_FIGHTER_UNIMATE_NEURAL_FOUNDRY_V1",
    "neuralCount": manifest.get("neuralCount", 0),
    "groups": {},
}
for name, path in outputs.items():
    if path.exists():
        summary["groups"][name] = {
            "mode": "rebuilt-neural",
            "metrics": json.loads(path.read_text()),
        }
    else:
        summary["groups"][name] = {"mode": "shipping-pack-unchanged"}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
PY
