#!/usr/bin/env bash
set -euo pipefail

SOURCE_GLTF="${SERA_HERO_SOURCE_GLTF:-.external/quaternius/first/assets/3d/characters/player/Superhero_Female_FullBody.gltf}"
OUTPUT_DIR="${SERA_HERO_OUTPUT_DIR:-artifacts/sera-hero-ai}"
SPEC="${SERA_HERO_SPEC:-tools/blender/hero/sera_hero_spec_v4.json}"
FEEDBACK="${SERA_HERO_FEEDBACK:-tools/blender/hero/sera_hero_feedback.json}"
SEARCH_STATE="${SERA_HERO_SEARCH_STATE:-tools/blender/hero/sera_hero_search_state_v4.json}"
SEARCH_CACHE="${SERA_HERO_SEARCH_CACHE:-tools/blender/hero/sera_hero_search_cache_v4.json}"
REFERENCE_IMAGE="${SERA_HERO_REFERENCE_IMAGE:-public/reference/female-turnaround.jpeg}"
REFERENCE_OBJECTIVE_DIR="$OUTPUT_DIR/reference-objective/input"
CANDIDATE_BUDGET="${SERA_HERO_CANDIDATE_BUDGET:-10}"

if ! command -v blender >/dev/null 2>&1; then
  echo "Blender is required for the SERA Hero Asset AI Pipeline" >&2
  exit 2
fi
for required in "$SOURCE_GLTF" "$SPEC" "$FEEDBACK" "$SEARCH_STATE" "$SEARCH_CACHE" "$REFERENCE_IMAGE"; do
  if [[ ! -s "$required" ]]; then
    echo "Missing SERA Hero input: $required" >&2
    exit 3
  fi
done

mkdir -p "$OUTPUT_DIR" "$REFERENCE_OBJECTIVE_DIR"
python3 scripts/prepare-sera-reference-objective.py \
  --source "$REFERENCE_IMAGE" \
  --out "$REFERENCE_OBJECTIVE_DIR"

test -s "$REFERENCE_OBJECTIVE_DIR/reference-objective.json"
for view in front three-quarter side back; do
  test -s "$REFERENCE_OBJECTIVE_DIR/reference-${view}-silhouette.png"
  test -s "$REFERENCE_OBJECTIVE_DIR/reference-${view}-skin.png"
  test -s "$REFERENCE_OBJECTIVE_DIR/reference-${view}-hair.png"
done

export PYTHONPATH="tools/blender:tools/blender/hero:/usr/lib/python3/dist-packages${PYTHONPATH:+:$PYTHONPATH}"

blender --background \
  --python-use-system-env \
  --python-exit-code 1 \
  --python tools/blender/hero/sera_hero_pipeline_v4.py \
  -- \
  --output-dir "$OUTPUT_DIR" \
  --source-gltf "$SOURCE_GLTF" \
  --spec "$SPEC" \
  --feedback "$FEEDBACK" \
  --search-state "$SEARCH_STATE" \
  --search-cache "$SEARCH_CACHE" \
  --reference-objective-dir "$REFERENCE_OBJECTIVE_DIR" \
  --candidate-budget "$CANDIDATE_BUDGET"

test -s "$OUTPUT_DIR/sera-hero.blend"
test -s "$OUTPUT_DIR/sera-hero.glb"
test -s "$OUTPUT_DIR/sera-blender-runtime.glb"
test -s "$OUTPUT_DIR/sera-hero-report.json"
test -s "$OUTPUT_DIR/sera-hero-search-state.json"
test -s "$OUTPUT_DIR/sera-hero-search-cache.json"
test -s "$OUTPUT_DIR/sera-hero-search-report.json"
for view in front three-quarter side back; do
  test -s "$OUTPUT_DIR/sera-blender-${view}.png"
  test -s "$OUTPUT_DIR/reference-objective/objective-final-${view}.png"
done
test -s "$OUTPUT_DIR/sera-hero-fight.png"

python3 - "$OUTPUT_DIR/sera-hero-report.json" "$OUTPUT_DIR/sera-hero-search-state.json" <<'PY'
import json
import sys
report_path, state_path = sys.argv[1:3]
with open(report_path, encoding='utf-8') as fp:
    report = json.load(fp)
with open(state_path, encoding='utf-8') as fp:
    state = json.load(fp)
print(
    'SERA_HERO_REPORT',
    'pipeline=', report['pipeline'],
    'objective=', report['objectiveType'],
    'baseline=', round(report['baselineScore'], 5),
    'final=', round(report['finalScore'], 5),
    'gate=', report['passedScoreGate'],
    'generation=', state['generation'],
    'parameters=', state['parameterCount'],
    'active=', len(state['parameters']),
    'continue=', state['continueSearch'],
    'boneFollow=', report.get('boneFollowAttachmentCount', 0),
)
print('SERA_HERO_COMPONENTS', report['referenceObjective']['components'])
print('SERA_HERO_GROUP_PRIORITY', state['groupPriority'])
if report['finalScore'] + 1e-9 < report['baselineScore']:
    raise SystemExit('SERA Hero V4 reference-image optimizer regressed the measured score')
if report['objectiveType'] != 'REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1':
    raise SystemExit('SERA Hero is not using the reference-image objective')
if report['parameterCount'] != 128 or state['parameterCount'] != 128:
    raise SystemExit('SERA Hero V4 parameter search must expose exactly 128 dimensions')
if report['parameterSpaceVersion'] != 'SERA_HERO_PARAMETER_SPACE_V2_128D_LOCAL_DEFORM':
    raise SystemExit('unexpected SERA Hero V4 parameter-space version')
if report.get('boneFollowAttachmentCount', 0) < 6:
    raise SystemExit('SERA Hero V4 must bone-follow both guards, shins and boots')
PY
