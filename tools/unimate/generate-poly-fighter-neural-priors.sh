#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRESETS="${POLY_FIGHTER_UNIMATE_PRESETS:-$ROOT/tools/unimate/poly-fighter-neural-inbetween-presets.json}"
OUT="${1:-$ROOT/artifacts/unimate-neural-priors}"
mkdir -p "$OUT"

python3 - "$PRESETS" "$OUT/queue.tsv" <<'PY'
import json, sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
rows = []
for move_id, spec in data["moves"].items():
    rows.append("\t".join([
        move_id,
        spec["action"],
        spec.get("sourceAction", spec["action"]),
        spec["source"],
        ",".join(map(str, spec["keepFrames60Hz"])),
        spec["prompt"].replace("\t", " ").replace("\n", " "),
    ]))
Path(sys.argv[2]).write_text("\n".join(rows) + "\n")
PY

while IFS=$'\t' read -r move action source_action source keep prompt; do
  source_path="$ROOT/$source"
  move_out="$OUT/$move"
  mkdir -p "$move_out"
  echo "=== UniMate neural bridge: $move / $source_action -> $action ==="
  SOURCE_GLB="$source_path" \
  ACTION_NAME="$action" \
  SOURCE_ACTION_NAME="$source_action" \
  KEEP_FRAMES_60="$keep" \
  PROMPT="$prompt" \
  OUTPUT_DIR="$move_out" \
    bash "$ROOT/tools/unimate/run-poly-fighter-neural-inbetween.sh"
done < "$OUT/queue.tsv"

python3 - "$PRESETS" "$OUT" "$OUT/manifest.json" <<'PY'
import json, sys
from pathlib import Path

presets = json.loads(Path(sys.argv[1]).read_text())
root = Path(sys.argv[2])
moves = {}
for move_id, spec in presets["moves"].items():
    result_path = root / move_id / "result.json"
    result = json.loads(result_path.read_text()) if result_path.exists() else {
        "mode": "deterministic-fallback",
        "reason": "result.json missing",
    }
    moves[move_id] = {
        "action": spec["action"],
        "sourceAction": spec.get("sourceAction", spec["action"]),
        "source": spec["source"],
        "keepFrames60Hz": spec["keepFrames60Hz"],
        **result,
    }

manifest = {
    "version": "POLY_FIGHTER_UNIMATE_NEURAL_PRIOR_MANIFEST_V2_SOURCE_TARGET",
    "presetVersion": presets.get("version"),
    "moves": moves,
    "neuralCount": sum(
        1 for move in moves.values() if move.get("mode") == "neural-inbetween"
    ),
    "fallbackCount": sum(
        1 for move in moves.values() if move.get("mode") != "neural-inbetween"
    ),
}
Path(sys.argv[3]).write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
PY
