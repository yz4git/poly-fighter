import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specPath = new URL('../tools/blender/hero/sera_hero_spec_v4.json', import.meta.url);
const feedbackPath = new URL('../tools/blender/hero/sera_hero_feedback.json', import.meta.url);
const statePath = new URL('../tools/blender/hero/sera_hero_search_state_v4.json', import.meta.url);
const cachePath = new URL('../tools/blender/hero/sera_hero_search_cache_v4.json', import.meta.url);
const pipelinePath = new URL('../tools/blender/hero/sera_hero_pipeline_v4.py', import.meta.url);
const metricsPath = new URL('../tools/blender/hero/sera_hero_metrics.py', import.meta.url);
const parameterSearchPath = new URL('../tools/blender/hero/sera_parameter_search.py', import.meta.url);
const deformPath = new URL('../tools/blender/hero/sera_hero_v4_deform.py', import.meta.url);
const objectivePath = new URL('../tools/blender/hero/sera_reference_objective.py', import.meta.url);
const boneFollowPath = new URL('../tools/blender/sera_bone_follow.py', import.meta.url);
const identityPath = new URL('../tools/blender/sera_identity_parts.py', import.meta.url);
const preparePath = new URL('../scripts/prepare-sera-reference-objective.py', import.meta.url);
const runnerPath = new URL('../scripts/run-sera-hero-ai-pipeline.sh', import.meta.url);

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const feedback = JSON.parse(readFileSync(feedbackPath, 'utf8'));
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const pipeline = readFileSync(pipelinePath, 'utf8');
const metrics = readFileSync(metricsPath, 'utf8');
const parameterSearch = readFileSync(parameterSearchPath, 'utf8');
const deform = readFileSync(deformPath, 'utf8');
const objective = readFileSync(objectivePath, 'utf8');
const boneFollow = readFileSync(boneFollowPath, 'utf8');
const identity = readFileSync(identityPath, 'utf8');
const prepare = readFileSync(preparePath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

test('SERA Hero V4 spec defines a persistent 128D reference-driven search', () => {
  assert.equal(spec.character, 'SERA');
  assert.match(spec.version, /^SERA_HERO_SPEC_V4_/);
  assert.equal(spec.parameterSearch.enabled, true);
  assert.equal(spec.parameterSearch.parameterCount, 128);
  assert.ok(spec.parameterSearch.candidateBudget >= 6 && spec.parameterSearch.candidateBudget <= 16);
  assert.ok(spec.parameterSearch.maxGenerations >= 4);
  assert.ok(spec.parameterSearch.initialStep > spec.parameterSearch.minStep);
  assert.ok(spec.parameterSearch.maxViewSilhouetteRegression > 0);
  assert.deepEqual(spec.parameterSearch.groups, {skeleton:20, face:36, hair:36, arms:12, legs:12, costume:12});
  const w = spec.referenceObjective.weights;
  for (const key of ['silhouette','bodyLandmarks','faceLandmarks','faceSilhouette','hairSilhouette']) {
    assert.equal(typeof w[key], 'number'); assert.ok(w[key] > 0);
  }
  assert.ok(Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1) < 1e-9);
});

test('V4 state is schema-safe and persists the validated search best', () => {
  assert.equal(state.version, 'SERA_HERO_PARAMETER_SEARCH_STATE_V1');
  assert.equal(state.schemaVersion, 'SERA_HERO_PARAMETER_SPACE_V2_128D_LOCAL_DEFORM');
  assert.ok(Number.isInteger(state.generation) && state.generation >= 0);
  assert.ok(Object.keys(state.parameters).length >= 20);
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

test('stable search engine remains reference-objective guarded', () => {
  assert.match(parameterSearch, /run_parameter_search/);
  assert.match(parameterSearch, /_proposals/);
  assert.match(parameterSearch, /_priority/);
  assert.match(parameterSearch, /_view_safe/);
  assert.match(parameterSearch, /cacheHit/);
  assert.match(parameterSearch, /continueSearch/);
});

test('V4 adds 16 local face fields and 16 independent hair controls', () => {
  assert.match(deform, /SERA_HERO_PARAMETER_SPACE_V2_128D_LOCAL_DEFORM/);
  assert.match(deform, /V4_PARAMETER_COUNT = 128/);
  for (const local of [
    'face_local_forehead_width','face_local_cheekbone_width','face_local_cheek_hollow',
    'face_local_jaw_angle_width','face_local_chin_projection','face_local_nose_bridge_projection',
    'face_local_nose_tip_projection','face_local_muzzle_projection','face_local_mouth_chin_transition'
  ]) assert.ok(deform.includes(local));
  assert.match(deform, /body_face_local_scale/);
  assert.match(deform, /body_face_local_shift/);
  assert.match(deform, /_face_weight/);
  assert.match(deform, /front_gate/);
  for (const strand of [
    'hair_strand_center_length','hair_strand_inner_l_length','hair_strand_inner_r_length',
    'hair_strand_outer_l_length','hair_strand_outer_r_length','hair_side_l_length_independent',
    'hair_side_r_length_independent','hair_back_center_length','hair_back_side_length',
    'hair_back_depth','hair_pony_fan_width','hair_pony_mid_sweep','hair_pony_tip_length_independent'
  ]) assert.ok(deform.includes(strand));
});

test('authored armor follows source bones and hair has dedicated clumps', () => {
  assert.match(boneFollow, /parent_to_bone_keep_world/);
  assert.match(boneFollow, /parent_type = 'BONE'/);
  assert.match(boneFollow, /seraBoneFollow/);
  for (const bone of ['lowerarm_', 'calf_', 'foot_']) assert.ok(identity.includes(bone));
  for (const object of [
    'SERA_FringeInnerL','SERA_FringeInnerR','SERA_FringeOuterL','SERA_FringeOuterR',
    'SERA_BackHairCenter','SERA_BackHairL','SERA_BackHairR','SERA_PonyFanL','SERA_PonyFanR'
  ]) assert.ok(identity.includes(object));
});

test('reference preparation and semantic objective remain image-driven', () => {
  assert.match(prepare, /female-turnaround\.jpeg/);
  assert.match(prepare, /segment_panel/);
  assert.match(prepare, /body_landmarks/);
  assert.match(prepare, /face_landmarks/);
  assert.match(objective, /render_and_score/);
  assert.match(objective, /silhouetteIoU/);
  assert.match(objective, /hairIoU/);
  assert.match(objective, /faceIoU/);
  assert.match(objective, /bodyLandmarkRmsPx/);
  assert.match(objective, /faceLandmarkRmsPx/);
  assert.match(objective, /film_transparent = True/);
});

test('V4 pipeline keeps T-pose metrics diagnostic-only and reports bone follow', () => {
  assert.match(pipeline, /install_v4/);
  assert.match(pipeline, /run_parameter_search/);
  assert.match(pipeline, /write_search_outputs/);
  assert.match(pipeline, /neutral_pose\.apply/);
  assert.match(pipeline, /SERA_HERO_ASSET_AI_PIPELINE_V4_128D_LOCAL_FACE_STRAND_HAIR/);
  assert.match(pipeline, /REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1/);
  assert.match(pipeline, /boneFollowAttachments/);
  assert.match(pipeline, /legacyBodyDiagnostic/);
  assert.match(pipeline, /never accept or reject a Hero candidate/);
  assert.match(metrics, /world-space meters/);
});

test('runner persists V4 search artifacts and enforces 128 dimensions', () => {
  for (const artifact of ['sera-hero.blend','sera-hero.glb','sera-blender-runtime.glb','sera-hero-report.json','sera-hero-search-state.json','sera-hero-search-cache.json','sera-hero-search-report.json','sera-hero-fight.png','objective-final-${view}.png']) assert.ok(runner.includes(artifact));
  assert.match(runner, /sera_hero_pipeline_v4\.py/);
  assert.match(runner, /sera_hero_spec_v4\.json/);
  assert.match(runner, /sera_hero_search_state_v4\.json/);
  assert.match(runner, /sera_hero_search_cache_v4\.json/);
  assert.match(runner, /--candidate-budget/);
  assert.match(runner, /exactly 128 dimensions/);
  assert.match(runner, /boneFollowAttachmentCount/);
});
