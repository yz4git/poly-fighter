#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRESETS="${POLY_FIGHTER_KIMODO_STRIKE_PRESETS:-$ROOT/tools/kimodo/poly-fighter-strike-presets.json}"
OUT="${1:-$ROOT/artifacts/kimodo-poly-fighter-strikes}"
MODEL="${KIMODO_MODEL:-Kimodo-SOMA-RP-v1.1}"

command -v kimodo_gen >/dev/null || { echo "kimodo_gen is required. Install NVIDIA Kimodo first." >&2; exit 2; }
command -v kimodo_convert >/dev/null || { echo "kimodo_convert is required. Install NVIDIA Kimodo first." >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 2; }

mkdir -p "$OUT"

# Pass A: text-only exploration.
python3 - "$PRESETS" "$OUT/queue.initial.tsv" <<'PY'
import json, sys
from pathlib import Path
src = json.loads(Path(sys.argv[1]).read_text())
rows = []
for move_id, spec in src["moves"].items():
    for seed in spec["seeds"]:
        rows.append("\t".join([
            move_id,
            str(spec["duration"]),
            str(seed),
            spec["prompt"].replace("\t", " ").replace("\n", " "),
        ]))
Path(sys.argv[2]).write_text("\n".join(rows) + "\n")
PY

while IFS=$'\t' read -r move duration seed prompt; do
  dir="$OUT/$move"
  mkdir -p "$dir"
  stem="$dir/${move}_seed_${seed}"
  echo "=== Kimodo strike exploration $move seed=$seed ==="
  kimodo_gen "$prompt" \
    --model "$MODEL" \
    --duration "$duration" \
    --num_samples 1 \
    --seed "$seed" \
    --output "$stem"
  test -s "$stem.npz"
  kimodo_convert "$stem.npz" "$stem.bvh"
  test -s "$stem.bvh"
done < "$OUT/queue.initial.tsv"

python3 "$ROOT/tools/kimodo/select-poly-fighter-strike.py" \
  --presets "$PRESETS" \
  --root "$OUT" \
  --output "$OUT/selection.initial.json"

python3 "$ROOT/tools/kimodo/build-poly-fighter-constraints.py" \
  --presets "$PRESETS" \
  --selection "$OUT/selection.initial.json" \
  --root "$OUT" \
  --kind strike

# Pass B: constrained regeneration. Sparse full-body keys explicitly place the
# readable contact silhouette at the gameplay contact phase; the support foot
# and Root2D tracks suppress fighting-game-inappropriate drift.
python3 - "$PRESETS" "$OUT/queue.refine.tsv" <<'PY'
import json, sys
from pathlib import Path
src = json.loads(Path(sys.argv[1]).read_text())
ref = src["refinement"]
rows = []
for move_id, spec in src["moves"].items():
    for seed in spec["refineSeeds"]:
        rows.append("\t".join([
            move_id,
            str(spec["duration"]),
            str(seed),
            str(ref["textWeight"]),
            str(ref["constraintWeight"]),
            str(ref["diffusionSteps"]),
            spec["prompt"].replace("\t", " ").replace("\n", " "),
        ]))
Path(sys.argv[2]).write_text("\n".join(rows) + "\n")
PY

while IFS=$'\t' read -r move duration seed text_weight constraint_weight steps prompt; do
  dir="$OUT/$move"
  constraints="$dir/${move}_constraints.json"
  test -s "$constraints"
  stem="$dir/${move}_refine_${seed}"
  echo "=== Kimodo constrained strike $move seed=$seed ==="
  kimodo_gen "$prompt" \
    --model "$MODEL" \
    --duration "$duration" \
    --constraints "$constraints" \
    --cfg_type separated \
    --cfg_weight "$text_weight" "$constraint_weight" \
    --diffusion_steps "$steps" \
    --num_samples 1 \
    --seed "$seed" \
    --output "$stem"
  test -s "$stem.npz"
  kimodo_convert "$stem.npz" "$stem.bvh"
  test -s "$stem.bvh"
done < "$OUT/queue.refine.tsv"

python3 "$ROOT/tools/kimodo/select-poly-fighter-strike.py" \
  --presets "$PRESETS" \
  --root "$OUT" \
  --output "$OUT/selection.json"

cat "$OUT/selection.json"
