#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRESETS="${POLY_FIGHTER_KIMODO_PRESETS:-$ROOT/tools/kimodo/poly-fighter-presets.json}"
OUT="${1:-$ROOT/artifacts/kimodo-poly-fighter}"
MODEL="${KIMODO_MODEL:-Kimodo-SOMA-RP-v1.1}"

command -v kimodo_gen >/dev/null || { echo "kimodo_gen is required. Install NVIDIA Kimodo first." >&2; exit 2; }
command -v kimodo_convert >/dev/null || { echo "kimodo_convert is required. Install NVIDIA Kimodo first." >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 2; }

mkdir -p "$OUT"

python3 - "$PRESETS" "$OUT/queue.tsv" <<'PY'
import json, sys
from pathlib import Path
src = json.loads(Path(sys.argv[1]).read_text())
rows = []
for move_id, spec in src["moves"].items():
    for seed in spec["seeds"]:
        rows.append("\t".join([
            move_id,
            spec["action"],
            str(spec["duration"]),
            spec["strikeSide"],
            spec["supportSide"],
            str(seed),
            spec["prompt"].replace("\t", " ").replace("\n", " "),
        ]))
Path(sys.argv[2]).write_text("\n".join(rows) + "\n")
PY

while IFS=$'\t' read -r move action duration strike support seed prompt; do
  dir="$OUT/$move"
  mkdir -p "$dir"
  stem="$dir/${move}_seed_${seed}"
  echo "=== Kimodo $move seed=$seed ==="
  kimodo_gen "$prompt" \
    --model "$MODEL" \
    --duration "$duration" \
    --num_samples 1 \
    --seed "$seed" \
    --output "$stem"

  npz="$stem.npz"
  test -s "$npz"
  kimodo_convert "$npz" "$stem.bvh"
  test -s "$stem.bvh"
done < "$OUT/queue.tsv"

python3 "$ROOT/tools/kimodo/select-poly-fighter-kick.py" \
  --presets "$PRESETS" \
  --root "$OUT" \
  --output "$OUT/selection.json"

cat "$OUT/selection.json"
echo
echo "Kimodo candidates are ready under: $OUT"
echo "Pass the selected BVHs to Motion Foundry using --kimodo-front/--kimodo-low/--kimodo-rising."
