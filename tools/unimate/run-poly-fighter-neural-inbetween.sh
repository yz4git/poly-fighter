#!/usr/bin/env bash
set -euo pipefail

# Optional neural authoring bridge:
#   POLY FIGHTER animated Foundry GLB
#     -> official UniMate custom-asset preprocess
#     -> exact replacement-style neural in-betweening
#     -> official UniMate re-animation
#     -> UAL BVH
#     -> existing Motion Foundry prior path
#
# This script NEVER becomes an iPhone/runtime dependency. If the official
# UniMate environment/checkpoint/GPU is unavailable it records a deterministic
# fallback result and exits successfully; the shipping Foundry builders already
# run tools/blender/unimate_inbetween_pass.py in that mode.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIMATE_ROOT="${UNIMATE_ROOT:-}"
UNIMATE_EXP_DIR="${UNIMATE_EXP_DIR:-}"
SOURCE_GLB="${SOURCE_GLB:-${1:-}}"
ACTION_NAME="${ACTION_NAME:-${2:-}}"
SOURCE_ACTION_NAME="${SOURCE_ACTION_NAME:-$ACTION_NAME}"
KEEP_FRAMES_60="${KEEP_FRAMES_60:-${3:-}}"
PROMPT="${PROMPT:-A trained fighter performs one clean combat technique and returns to a stable guard.}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT/artifacts/unimate-neural-inbetween}"
UNIMATE_DEVICE="${UNIMATE_DEVICE:-cuda}"
UNIMATE_CFG_SCALE="${UNIMATE_CFG_SCALE:-3.0}"
UNIMATE_SEED="${UNIMATE_SEED:-27182}"
BLENDER_BIN="${BLENDER_BIN:-blender}"

mkdir -p "$OUTPUT_DIR"
RESULT="$OUTPUT_DIR/result.json"

write_fallback() {
  local reason="$1"
  python3 - "$RESULT" "$reason" "$ACTION_NAME" "$SOURCE_ACTION_NAME" <<'PY'
import json, sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({
    "version": "POLY_FIGHTER_UNIMATE_NEURAL_BRIDGE_V2_SOURCE_TARGET",
    "mode": "deterministic-fallback",
    "reason": sys.argv[2],
    "action": sys.argv[3],
    "sourceAction": sys.argv[4],
    "fallback": "tools/blender/unimate_inbetween_pass.py",
}, indent=2) + "\n")
PY
  echo "UniMate neural authoring unavailable: $reason"
  echo "Using shipping-safe deterministic replacement in-between pass."
  cat "$RESULT"
  exit 0
}

[[ -n "$SOURCE_GLB" && -f "$SOURCE_GLB" ]] || write_fallback "SOURCE_GLB is missing"
[[ -n "$ACTION_NAME" ]] || write_fallback "ACTION_NAME is missing"
[[ -n "$KEEP_FRAMES_60" ]] || write_fallback "KEEP_FRAMES_60 is missing"
[[ -n "$UNIMATE_ROOT" && -d "$UNIMATE_ROOT/unimate" ]] || write_fallback "UNIMATE_ROOT is not an official UniMate checkout"
[[ -n "$UNIMATE_EXP_DIR" && -f "$UNIMATE_EXP_DIR/config.json" ]] || write_fallback "UNIMATE_EXP_DIR/config.json is missing"

SOURCE_GLB="$(cd "$(dirname "$SOURCE_GLB")" && pwd)/$(basename "$SOURCE_GLB")"
UNIMATE_ROOT="$(cd "$UNIMATE_ROOT" && pwd)"
UNIMATE_EXP_DIR="$(cd "$UNIMATE_EXP_DIR" && pwd)"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
RESULT="$OUTPUT_DIR/result.json"
command -v python3 >/dev/null || write_fallback "python3 is unavailable"
command -v "$BLENDER_BIN" >/dev/null || write_fallback "Blender is unavailable"
if [[ "$UNIMATE_DEVICE" == cuda* ]] && ! command -v nvidia-smi >/dev/null; then
  write_fallback "CUDA authoring requested but no NVIDIA GPU runtime is available"
fi

BASE_STATS="$UNIMATE_EXP_DIR/dataset_stats.npy"
[[ -f "$BASE_STATS" ]] || write_fallback "training dataset_stats.npy is missing"
python3 - "$BASE_STATS" <<'PY' || write_fallback "checkpoint stats do not contain the objaverse normalization used for custom rigs"
import numpy as np, sys
stats = np.load(sys.argv[1], allow_pickle=True).item()
if "objaverse" not in stats:
    raise SystemExit(1)
PY

if [[ -n "${UNIMATE_MODEL_PATH:-}" ]]; then
  CHECKPOINT="$UNIMATE_MODEL_PATH"
else
  CHECKPOINT="$(find "$UNIMATE_EXP_DIR/checkpoints" -maxdepth 1 -type f -name 'checkpoint_step_*.pt' 2>/dev/null | sort -V | tail -n 1 || true)"
fi
[[ -n "$CHECKPOINT" && -f "$CHECKPOINT" ]] || write_fallback "UniMate checkpoint is missing"

WORK="$OUTPUT_DIR/work"
PREP="$WORK/preprocessed"
EXP="$WORK/experiment"
GEN="$WORK/generated"
ANIMATED="$WORK/animated"
mkdir -p "$WORK" "$PREP" "$EXP" "$GEN" "$ANIMATED"

# UniMate's multi-topology loader uses the text before the first '-' as the
# object_type. Use one deliberately boring, hyphen-free name so action names
# cannot corrupt object-type resolution.
SANITIZED_SOURCE="$WORK/polyfighter.glb"
cp "$SOURCE_GLB" "$SANITIZED_SOURCE"

(
  cd "$UNIMATE_ROOT"
  CHAR_PATH="$SANITIZED_SOURCE" \
  OUTPUT_DIR="$PREP" \
  FACE_R="thigh_r" \
  FACE_L="thigh_l" \
  FORMATS="glb" \
  bash data_process/scripts/run_preprocess_char.sh
)

CANONICAL="$PREP/polyfighter_canonical.glb"
COND="$PREP/cond.npy"
[[ -s "$CANONICAL" && -s "$COND" ]] || write_fallback "UniMate custom-asset preprocessing did not produce canonical GLB/cond.npy"

# Pick the exact exported action without assuming Blender's punctuation rules.
SELECTED_MOTION="$(
python3 - "$PREP/motions" "$SOURCE_ACTION_NAME" <<'PY'
import re, sys
from pathlib import Path
motion_dir, wanted = Path(sys.argv[1]), sys.argv[2]
norm = lambda s: re.sub(r"[^a-z0-9]+", "", s.lower())
matches = []
for path in sorted(motion_dir.glob("*.npz")):
    stem = path.stem
    action = stem.split("-", 1)[1] if "-" in stem else stem
    if norm(action) == norm(wanted):
        matches.append(path)
if not matches:
    choices = [p.name for p in sorted(motion_dir.glob("*.npz"))]
    raise SystemExit("No exact action match for %r. Available: %s" % (wanted, choices))
print(matches[0])
PY
)" || write_fallback "Requested action was not found after UniMate preprocessing"

CLIP_STEM="$(basename "$SELECTED_MOTION" .npz)"
OBJECT_TYPE="${CLIP_STEM%%-*}"
CLIP_ID="${CLIP_STEM#*-}"

# Keep model architecture/checkpoint settings identical to training; redirect
# only the objaverse-style feature source to the one preprocessed fighter.
python3 - "$UNIMATE_EXP_DIR/config.json" "$EXP/config.json" "$PREP" "$UNIMATE_DEVICE" "$COND" "$WORK/unimate-compatibility.json" <<'PY' || write_fallback "UAL skeleton exceeds the checkpoint's safe topology capacity"
import json, sys
from pathlib import Path
import numpy as np

src = Path(sys.argv[1])
out = Path(sys.argv[2])
feature_dir = Path(sys.argv[3])
device_text = sys.argv[4]
cond_path = Path(sys.argv[5])
compat_path = Path(sys.argv[6])

cfg = json.loads(src.read_text())
cond_dict = np.load(cond_path, allow_pickle=True).item()
if not cond_dict:
    raise SystemExit("empty cond.npy")
entry = next(iter(cond_dict.values()))
parents = [int(value) for value in entry["parents"]]
actual_joints = len(parents)

depths = [-1] * actual_joints
for index, parent in enumerate(parents):
    if parent < 0 or parent == index:
        depths[index] = 0
for _ in range(actual_joints + 1):
    changed = False
    for index, parent in enumerate(parents):
        if depths[index] >= 0:
            continue
        if 0 <= parent < actual_joints and depths[parent] >= 0:
            depths[index] = depths[parent] + 1
            changed = True
    if not changed:
        break
if any(depth < 0 for depth in depths):
    raise SystemExit("UAL skeleton has an unresolved/cyclic parent graph")
actual_depth = max(depths, default=0)

trained_max_joints = int(cfg["dataset"].get("max_joints", 0))
trained_max_depth = int(cfg["dataset"].get("max_depth", 0))
if trained_max_depth <= 0 or actual_depth > trained_max_depth:
    raise SystemExit(
        f"UAL depth {actual_depth} exceeds checkpoint max_depth {trained_max_depth}"
    )

# UniMate's InputLayer/FinalLayer share weights across non-root joints; max_joints
# controls padding/masks and the output reshape rather than a learned per-joint
# table. Increase only that inference width so a 60-joint checkpoint does not
# discard POLY FIGHTER's slightly larger UAL rig. Preserve trained max_depth
# because depth_embedding IS a learned table.
cfg["dataset"]["max_joints"] = max(trained_max_joints, actual_joints)
cfg["objaverse"]["path"] = str(feature_dir.resolve())
cfg["objaverse"]["objects_num"] = -1
cfg["objaverse"]["filter_object"] = False
cfg["dataset"]["dataset_list"] = ["objaverse"]
for key in ("use_addition_aug", "use_removal_aug", "use_pooling_aug", "use_perturbation_aug"):
    cfg["dataset"][key] = False
cfg["sampling"]["device"] = device_text
cfg["experiment"]["output_dir"] = str(out.parent.resolve())
out.write_text(json.dumps(cfg, indent=2) + "\n")
compat_path.write_text(json.dumps({
    "version": "POLY_FIGHTER_UNIMATE_TOPOLOGY_COMPAT_V1",
    "actualJoints": actual_joints,
    "actualDepth": actual_depth,
    "checkpointMaxJoints": trained_max_joints,
    "inferenceMaxJoints": cfg["dataset"]["max_joints"],
    "checkpointMaxDepth": trained_max_depth,
    "jointPaddingExpanded": actual_joints > trained_max_joints,
}, indent=2) + "\n")
PY
cp "$BASE_STATS" "$EXP/dataset_stats.npy"

MAX_T="$(python3 - "$EXP/config.json" <<'PY'
import json, sys
print(int(json.load(open(sys.argv[1]))["dataset"]["max_motion_length"]))
PY
)"
[[ "$MAX_T" -gt 2 ]] || write_fallback "UniMate checkpoint has invalid max_motion_length"

# Foundry specs are authored on the game's 60 Hz/1-based frame clock.
# UniMate custom preprocessing yields 30 Hz features, so map those anchors to
# zero-based 30 Hz feature slots and clamp into the checkpoint's generation window.
KEEP_30="$(python3 - "$KEEP_FRAMES_60" "$MAX_T" <<'PY'
import sys
frames = []
for raw in sys.argv[1].split(","):
    raw = raw.strip()
    if not raw:
        continue
    f60 = int(raw)
    idx = round((f60 - 1) * 0.5)
    frames.append(max(0, min(int(sys.argv[2]) - 1, idx)))
frames = sorted(set(frames))
if len(frames) < 2:
    raise SystemExit("Need at least two distinct kept frames after 60->30 Hz mapping")
print(",".join(map(str, frames)))
PY
)" || write_fallback "KEEP_FRAMES_60 could not be mapped to UniMate frames"

CASES="$WORK/cases.json"
python3 - "$CASES" "$OBJECT_TYPE" "$CLIP_ID" "$PROMPT" <<'PY'
import json, sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({
    f"{sys.argv[2]}-{sys.argv[3]}": sys.argv[4]
}, indent=2) + "\n")
PY

(
  cd "$UNIMATE_ROOT"
  python3 -m unimate.inference.sample \
    --exp_dir "$EXP" \
    --model_path "$CHECKPOINT" \
    --test_cases_json "$CASES" \
    --num_repetitions 1 \
    --cfg_scale "$UNIMATE_CFG_SCALE" \
    --seed "$UNIMATE_SEED" \
    --output_dir "$GEN" \
    --only_save_motion \
    --inbetween \
    --keep_frames "$KEEP_30" \
    --gt_start_frame 0
)

GENERATED_NPY="$(
find "$GEN/inbetween/motions" -maxdepth 1 -type f -name '*.npy' ! -name '*-gt_*' | sort | head -n 1
)"
[[ -n "$GENERATED_NPY" && -s "$GENERATED_NPY" ]] || write_fallback "UniMate in-betweening produced no generated motion feature file"

(
  cd "$UNIMATE_ROOT"
  ANIM_PATH="$GENERATED_NPY" \
  CHAR_PATH="$CANONICAL" \
  COND_PATH="$COND" \
  OUTPUT_DIR="$ANIMATED" \
  ANIM_MODE="fk" \
  EXTRA_BONES_STRATEGY="keep" \
  bash data_process/scripts/run_animate_motion.sh objaverse
)

GENERATED_GLB="$(find "$ANIMATED" -maxdepth 1 -type f -name '*.glb' | sort | head -n 1)"
[[ -n "$GENERATED_GLB" && -s "$GENERATED_GLB" ]] || write_fallback "UniMate re-animation produced no GLB"

BVH="$OUTPUT_DIR/${ACTION_NAME}.unimate.bvh"
"$BLENDER_BIN" -b --python "$ROOT/tools/unimate/export-animated-ual-bvh.py" -- \
  --source "$GENERATED_GLB" \
  --output "$BVH" \
  --fps 30
[[ -s "$BVH" ]] || write_fallback "UAL BVH export failed"

python3 - "$RESULT" "$ACTION_NAME" "$BVH" "$GENERATED_NPY" "$GENERATED_GLB" "$KEEP_30" "$CHECKPOINT" "$WORK/unimate-compatibility.json" "$SOURCE_ACTION_NAME" <<'PY'
import json, sys
from pathlib import Path
compatibility = json.loads(Path(sys.argv[8]).read_text())
Path(sys.argv[1]).write_text(json.dumps({
    "version": "POLY_FIGHTER_UNIMATE_NEURAL_BRIDGE_V2_SOURCE_TARGET",
    "mode": "neural-inbetween",
    "provider": "UNIMATE_UAL_BVH_REPLACEMENT_V1",
    "action": sys.argv[2],
    "sourceAction": sys.argv[9],
    "bvh": str(Path(sys.argv[3]).resolve()),
    "generatedMotion": str(Path(sys.argv[4]).resolve()),
    "animatedGlb": str(Path(sys.argv[5]).resolve()),
    "keepFrames30Hz": [int(v) for v in sys.argv[6].split(",")],
    "checkpoint": str(Path(sys.argv[7]).resolve()),
    "topologyCompatibility": compatibility,
    "fallback": "tools/blender/unimate_inbetween_pass.py",
}, indent=2) + "\n")
PY

cat "$RESULT"
echo "UniMate UAL prior ready: $BVH"
