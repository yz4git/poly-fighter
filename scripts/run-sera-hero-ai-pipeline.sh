#!/usr/bin/env bash
set -euo pipefail

SOURCE_GLTF="${SERA_HERO_SOURCE_GLTF:-.external/quaternius/first/assets/3d/characters/player/Superhero_Female_FullBody.gltf}"
OUTPUT_DIR="${SERA_HERO_OUTPUT_DIR:-artifacts/sera-hero-ai}"
SPEC="${SERA_HERO_SPEC:-tools/blender/hero/sera_hero_spec.json}"
FEEDBACK="${SERA_HERO_FEEDBACK:-tools/blender/hero/sera_hero_feedback.json}"
ITERATIONS="${SERA_HERO_ITERATIONS:-8}"

if ! command -v blender >/dev/null 2>&1; then
  echo "Blender is required for the SERA Hero Asset AI Pipeline" >&2
  exit 2
fi
if [[ ! -s "$SOURCE_GLTF" ]]; then
  echo "Missing SERA hero source GLTF: $SOURCE_GLTF" >&2
  exit 3
fi
if [[ ! -s "$SPEC" ]]; then
  echo "Missing SERA hero spec: $SPEC" >&2
  exit 4
fi
if [[ ! -s "$FEEDBACK" ]]; then
  echo "Missing SERA hero feedback file: $FEEDBACK" >&2
  exit 5
fi

mkdir -p "$OUTPUT_DIR"
export PYTHONPATH="tools/blender:tools/blender/hero:/usr/lib/python3/dist-packages${PYTHONPATH:+:$PYTHONPATH}"

blender --background \
  --python-use-system-env \
  --python-exit-code 1 \
  --python tools/blender/hero/sera_hero_pipeline.py \
  -- \
  --output-dir "$OUTPUT_DIR" \
  --source-gltf "$SOURCE_GLTF" \
  --spec "$SPEC" \
  --feedback "$FEEDBACK" \
  --iterations "$ITERATIONS"

test -s "$OUTPUT_DIR/sera-hero.blend"
test -s "$OUTPUT_DIR/sera-hero.glb"
test -s "$OUTPUT_DIR/sera-blender-runtime.glb"
test -s "$OUTPUT_DIR/sera-hero-report.json"
for view in front three-quarter side back; do
  test -s "$OUTPUT_DIR/sera-blender-${view}.png"
done
test -s "$OUTPUT_DIR/sera-hero-fight.png"

python3 - "$OUTPUT_DIR/sera-hero-report.json" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path, encoding='utf-8') as fp:
    report = json.load(fp)
print(
    'SERA_HERO_REPORT',
    'baseline=', round(report['baselineScore'], 5),
    'final=', round(report['finalScore'], 5),
    'gate=', report['passedScoreGate'],
    'feedbackRevision=', report['feedbackRevision'],
)
if report['finalScore'] + 1e-9 < report['baselineScore']:
    raise SystemExit('SERA Hero optimizer regressed the measured score')
PY
