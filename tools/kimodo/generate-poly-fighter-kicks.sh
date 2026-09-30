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

# Pass A: text-only exploration. Four deterministic seeds per move establish
# natural candidate poses before gameplay constraints are introduced.
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
  echo "=== Kimodo kick exploration $move seed=$seed ==="
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

python3 "$ROOT/tools/kimodo/select-poly-fighter-kick.py" \
  --presets "$PRESETS" \
  --root "$OUT" \
  --output "$OUT/selection.initial.json"

# Convert the best exploratory candidate into sparse official Kimodo constraints:
# guard/contact/guard full-body keys + strike foot + support-foot contact window
# + bounded Root2D path at the gameplay-authored contact phase.
python3 "$ROOT/tools/kimodo/build-poly-fighter-constraints.py" \
  --presets "$PRESETS" \
  --selection "$OUT/selection.initial.json" \
  --root "$OUT" \
  --kind kick

# Pass B: regenerate around those combat constraints with separate text and
# constraint CFG weights. This lets Kimodo improve transitions while preserving
# deterministic POLY FIGHTER contact timing and planted-foot intent.
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
  echo "=== Kimodo constrained kick $move seed=$seed ==="
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

# Final ranking compares exploratory and constrained-refinement candidates.
python3 "$ROOT/tools/kimodo/select-poly-fighter-kick.py" \
  --presets "$PRESETS" \
  --root "$OUT" \
  --output "$OUT/selection.json"

cat "$OUT/selection.json"
echo
echo "Kimodo constrained kick candidates are ready under: $OUT"
echo "Pass the selected BVHs to Motion Foundry using --kimodo-front/--kimodo-low/--kimodo-rising."
