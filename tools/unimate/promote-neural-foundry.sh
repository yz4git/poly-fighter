#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANDIDATE_ROOT="${1:-$ROOT/artifacts/unimate-neural-foundry}"
QUALITY_REPORT="${2:-$ROOT/artifacts/unimate-neural-quality/promotion.json}"
DEST="${3:-$ROOT/public/models/quaternius}"
PROMOTE="${PROMOTE:-0}"

test -s "$QUALITY_REPORT" || { echo "Missing quality report: $QUALITY_REPORT" >&2; exit 2; }

python3 - "$QUALITY_REPORT" "$CANDIDATE_ROOT" "$DEST" "$PROMOTE" <<'PY'
import json, shutil, sys
from pathlib import Path
report = json.loads(Path(sys.argv[1]).read_text())
candidate = Path(sys.argv[2])
dest = Path(sys.argv[3])
promote = sys.argv[4] == "1"
mapping = {
    "shared": ("shared/blender-strikes-core.glb", "shared/blender-strikes-core.metrics.json", "blender-strikes-core.glb", "blender-strikes-core.metrics.json"),
    "cross": ("cross/blender-cross-core.glb", "cross/blender-cross-core.metrics.json", "blender-cross-core.glb", "blender-cross-core.metrics.json"),
    "power": ("power/blender-fight-core.glb", "power/blender-fight-core.metrics.json", "blender-fight-core.glb", "blender-fight-core.metrics.json"),
    "kicks": ("kicks/blender-kicks-core.glb", "kicks/blender-kicks-core.metrics.json", "blender-kicks-core.glb", "blender-kicks-core.metrics.json"),
}
accepted = set(report.get("acceptedGroups", []))
print("UNIMATE_PROMOTION_MODE", "APPLY" if promote else "DRY_RUN")
for group, paths in mapping.items():
    if group not in accepted:
        print("KEEP_SHIPPING", group)
        continue
    glb_src, metrics_src, glb_dst, metrics_dst = paths
    print("ACCEPTED", group, candidate / glb_src)
    if promote:
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidate / glb_src, dest / glb_dst)
        shutil.copy2(candidate / metrics_src, dest / metrics_dst)
if not promote:
    print("No repository artifacts changed. Re-run with PROMOTE=1 only after visual audit review.")
PY
