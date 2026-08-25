import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specPath = new URL('../tools/blender/hero/sera_hero_spec_v5.json', import.meta.url);
const feedbackPath = new URL('../tools/blender/hero/sera_hero_feedback.json', import.meta.url);
const statePath = new URL('../tools/blender/hero/sera_hero_search_state_v5.json', import.meta.url);
const cachePath = new URL('../tools/blender/hero/sera_hero_search_cache_v5.json', import.meta.url);
const pipelinePath = new URL('../tools/blender/hero/sera_hero_pipeline_v5.py', import.meta.url);
const metricsPath = new URL('../tools/blender/hero/sera_hero_metrics.py', import.meta.url);
const parameterSearchPath = new URL('../tools/blender/hero/sera_parameter_search.py', import.meta.url);
const localSearchPath = new URL('../tools/blender/hero/sera_local_objective_search.py', import.meta.url);
const deformPath = new URL('../tools/blender/hero/sera_hero_v4_deform.py', import.meta.url);
const objectivePath = new URL('../tools/blender/hero/sera_reference_objective.py', import.meta.url);
const objectiveV9Path = new URL('../tools/blender/hero/sera_reference_objective_v9.py', import.meta.url);
const headSemanticPath = new URL('../tools/blender/hero/sera_head_semantic.py', import.meta.url);
const boneFollowPath = new URL('../tools/blender/sera_bone_follow.py', import.meta.url);
const identityPath = new URL('../tools/blender/sera_identity_parts.py', import.meta.url);
const conformalPath = new URL('../tools/blender/build-sera-conformal.py', import.meta.url);
const preparePath = new URL('../scripts/prepare-sera-reference-objective.py', import.meta.url);
const refinePath = new URL('../scripts/refine-sera-local-reference-crops.py', import.meta.url);
const runnerPath = new URL('../scripts/run-sera-hero-ai-pipeline.sh', import.meta.url);

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const feedback = JSON.parse(readFileSync(feedbackPath, 'utf8'));
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const pipeline = readFileSync(pipelinePath, 'utf8');
const metrics = readFileSync(metricsPath, 'utf8');
const parameterSearch = readFileSync(parameterSearchPath, 'utf8');
const localSearch = readFileSync(localSearchPath, 'utf8');
const deform = readFileSync(deformPath, 'utf8');
const objective = readFileSync(objectivePath, 'utf8');
const objectiveV9 = readFileSync(objectiveV9Path, 'utf8');
const headSemantic = readFileSync(headSemanticPath, 'utf8');
const boneFollow = readFileSync(boneFollowPath, 'utf8');
const identity = readFileSync(identityPath, 'utf8');
const conformal = readFileSync(conformalPath, 'utf8');
const prepare = readFileSync(preparePath, 'utf8');
const refine = readFileSync(refinePath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

test('SERA Hero V5 keeps the validated 128D space and enables independent local objectives', () => {
  assert.equal(spec.character, 'SERA');
  assert.match(spec.version, /^SERA_HERO_SPEC_V5_/);
  assert.equal(spec.parameterSearch.enabled, true);
  assert.equal(spec.parameterSearch.parameterCount, 128);
  assert.deepEqual(spec.parameterSearch.groups, {skeleton:20, face:36, hair:36, arms:12, legs:12, costume:12});
  assert.equal(spec.localReferenceObjective.enabled, true);
  assert.equal(spec.localReferenceObjective.version, 'REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2');
  assert.deepEqual(spec.localReferenceObjective.cropSize, [512, 512]);
  assert.ok(spec.localReferenceObjective.renderScale >= 2);
  assert.ok(spec.localReferenceObjective.acceptance.localMinImprovement > 0);
  assert.ok(spec.localReferenceObjective.acceptance.globalRegressionTolerance > 0);
  const globalWeights = spec.referenceObjective.weights;
  assert.ok(Math.abs(Object.values(globalWeights).reduce((a,b)=>a+b,0)-1) < 1e-9);
});

test('V5 state starts a new local-objective search from the validated V4 parameter seed', () => {
  assert.equal(state.version, 'SERA_HERO_PARAMETER_SEARCH_STATE_V1');
  assert.equal(state.schemaVersion, 'SERA_HERO_PARAMETER_SPACE_V2_128D_LOCAL_DEFORM');
  assert.equal(state.parameterCount, 128);
  assert.equal(state.generation, 0);
  assert.ok(Object.keys(state.parameters).length >= 40);
  assert.equal(cache.version, 'SERA_HERO_PARAMETER_SEARCH_CACHE_V1');
  assert.equal(typeof cache.entries, 'object');
});

test('SERA Hero feedback remains schema-safe', () => {
  assert.match(feedback.version, /^SERA_HERO_FEEDBACK_/);
  assert.ok(Number.isInteger(feedback.revision) && feedback.revision >= 0);
  assert.equal(typeof feedback.targetMultipliers, 'object');
  assert.equal(typeof feedback.styleMultipliers, 'object');
  assert.equal(typeof feedback.objectAdjustments, 'object');
});

test('stable search engine and V4 deformation space remain available', () => {
  assert.match(parameterSearch, /run_parameter_search/);
  assert.match(parameterSearch, /_proposals/);
  assert.match(parameterSearch, /_view_safe/);
  assert.match(deform, /SERA_HERO_PARAMETER_SPACE_V2_128D_LOCAL_DEFORM/);
  assert.match(deform, /V4_PARAMETER_COUNT = 128/);
  for (const local of ['face_local_forehead_width','face_local_cheekbone_width','face_local_jaw_angle_width','face_local_chin_projection','face_local_nose_tip_projection','face_local_muzzle_projection']) assert.ok(deform.includes(local));
  for (const strand of ['hair_strand_center_length','hair_strand_inner_l_length','hair_strand_outer_r_length','hair_back_center_length','hair_pony_fan_width','hair_pony_tip_length_independent']) assert.ok(deform.includes(strand));
});

test('reference preparation creates native-resolution-derived high-resolution face and hair crops', () => {
  assert.match(prepare, /LOCAL_CROP_SIZE = \(512, 512\)/);
  assert.match(prepare, /_local_boxes/);
  assert.match(prepare, /_normalized_box/);
  assert.match(prepare, /_crop_canvas/);
  assert.match(prepare, /reference-\{view\}-face-local/);
  assert.match(prepare, /reference-\{view\}-hair-local/);
  assert.match(prepare, /SERA_REFERENCE_OBJECTIVE_V3_HIGH_RES_LOCAL_CROPS/);
});

test('V9 Reference and Generated local windows share the head-local semantic detector', () => {
  assert.match(refine, /SERA_REFERENCE_OBJECTIVE_V9_HEAD_LOCAL_SEMANTIC/);
  assert.match(refine, /detect_head_semantics/);
  assert.match(refine, /head\["faceSkin"\]/);
  assert.match(refine, /head\["headHair"\]/);
  assert.match(refine, /headSemanticV1/);
  assert.match(headSemantic, /SERA_HEAD_SEMANTIC_V1_TOP_HAIR_FACE_SKIN/);
  assert.match(headSemantic, /_select_head_hair/);
  assert.match(headSemantic, /face skin can never extend into the/);
  assert.match(headSemantic, /head_top \+ head_height \* \.98/);
  assert.match(objectiveV9, /detect_head_semantics/);
  assert.match(objectiveV9, /head\["faceSkin"\]/);
  assert.match(objectiveV9, /head\["headHair"\]/);
  assert.match(objectiveV9, /head\["faceBox"\]/);
  assert.match(objectiveV9, /head\["hairBox"\]/);
  assert.match(objectiveV9, /headSemanticVersion/);
  assert.ok(!objectiveV9.includes('world_to_camera_view'), 'V9 local objective must not use 3D camera projection');
  assert.match(pipeline, /import sera_reference_objective_v9 as reference_objective/);
  assert.match(runner, /SERA_REFERENCE_OBJECTIVE_V9_HEAD_LOCAL_SEMANTIC/);
  assert.match(runner, /headSemanticV1/);
});

test('Blender objective keeps global score separate from independent local face/hair objectives', () => {
  assert.match(objective, /renderScale/);
  assert.match(objective, /localObjectives/);
  assert.match(objective, /globalObjective/);
  assert.match(objective, /REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2/);
  assert.match(objectiveV9, /local-\{tag\}-\{view\}-face/);
  assert.match(objectiveV9, /local-\{tag\}-\{view\}-hair/);
  assert.match(objectiveV9, /faceViewWeights/);
  assert.match(objectiveV9, /hairViewWeights/);
  assert.match(objectiveV9, /faceLandmarkFalloffPx/);
  assert.match(objectiveV9, /film_transparent = True/);
  assert.ok(!/global_score\s*\+\s*face_score/.test(objectiveV9), 'local scores must not be added into global score');
});

test('face and hair groups use their own local objective as the primary acceptance gate', () => {
  assert.match(localSearch, /LOCAL_ACCEPTANCE_VERSION = 'SERA_LOCAL_REFERENCE_ACCEPTANCE_V1'/);
  assert.match(localSearch, /if group == 'face'/);
  assert.match(localSearch, /face_delta >= local_min/);
  assert.match(localSearch, /elif group == 'hair'/);
  assert.match(localSearch, /hair_delta >= local_min/);
  assert.match(localSearch, /global_delta >= -global_tolerance/);
  assert.match(localSearch, /cross_tolerance/);
  assert.match(localSearch, /global-improved-local-safe/);
  assert.match(localSearch, /acceptanceReason/);
  assert.match(localSearch, /faceLocalDelta/);
  assert.match(localSearch, /hairLocalDelta/);
});

test('authored armor remains bone-followed and hair retains dedicated clumps', () => {
  assert.match(boneFollow, /parent_to_bone_keep_world/);
  assert.match(boneFollow, /parent_type = 'BONE'/);
  for (const bone of ['lowerarm_', 'calf_', 'foot_']) assert.ok(identity.includes(bone));
  for (const object of ['SERA_FringeInnerL','SERA_FringeInnerR','SERA_FringeOuterL','SERA_FringeOuterR','SERA_BackHairCenter','SERA_BackHairL','SERA_BackHairR','SERA_PonyFanL','SERA_PonyFanR']) assert.ok(identity.includes(object));
});

test('V15 runtime export compacts both hand regions without touching Hero reference geometry', () => {
  assert.match(conformal, /def compact_runtime_hand_mesh\(mesh\):/);
  assert.match(conformal, /if region in \('Hand_l', 'Hand_r'\):\n\s+compact_runtime_hand_mesh\(mesh\)/);
  assert.match(conformal, /seraRuntimeHandPose.*CLOSED_COMPACT_V1/);
  assert.match(conformal, /runtimeHandPose.*CLOSED_COMPACT_V1/);
  assert.match(conformal, /SERA_QUATERNIUS_CONFORMAL_V15_RUNTIME_FISTS/);
  assert.match(conformal, /return runtime_bytes/);
  const splitIndex = conformal.indexOf('def split_evaluated_body');
  const compactCallIndex = conformal.indexOf('compact_runtime_hand_mesh(mesh)', splitIndex);
  const authoredSaveIndex = conformal.indexOf("bpy.ops.wm.save_as_mainfile", splitIndex);
  assert.ok(compactCallIndex > splitIndex, 'fist deformation belongs to runtime split/export');
  assert.ok(compactCallIndex < authoredSaveIndex || authoredSaveIndex === -1, 'runtime fist deformation must not mutate the authored Hero scene before reference save');
});

test('V5 pipeline reports independent objectives and keeps T-pose dimensions diagnostic-only', () => {
  assert.match(pipeline, /install_v4/);
  assert.match(pipeline, /install_local_objective_search/);
  assert.match(pipeline, /SERA_HERO_ASSET_AI_PIPELINE_V5_INDEPENDENT_LOCAL_REFERENCE/);
  assert.match(pipeline, /REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2/);
  assert.match(pipeline, /baselineObjectives/);
  assert.match(pipeline, /finalObjectives/);
  assert.match(pipeline, /faceLocal/);
  assert.match(pipeline, /hairLocal/);
  assert.match(pipeline, /legacyBodyDiagnostic/);
  assert.match(pipeline, /never accept or reject a Hero candidate/);
  assert.match(metrics, /world-space meters/);
});

test('runner enforces V9 crop artifacts and V5 independent objective contract', () => {
  assert.match(runner, /sera_hero_pipeline_v5\.py/);
  assert.match(runner, /sera_hero_spec_v5\.json/);
  assert.match(runner, /sera_hero_search_state_v5\.json/);
  assert.match(runner, /sera_hero_search_cache_v5\.json/);
  assert.match(runner, /reference-\$\{view\}-hair-local/);
  assert.match(runner, /reference-\$\{view\}-face-local/);
  assert.match(runner, /local-final-\$\{view\}-hair/);
  assert.match(runner, /local-final-\$\{view\}-face/);
  assert.match(runner, /REFERENCE_CROP_INDEPENDENT_FACE_HAIR_V2/);
  assert.match(runner, /exactly 128 dimensions/);
  assert.match(runner, /head semantic version missing/);
});
