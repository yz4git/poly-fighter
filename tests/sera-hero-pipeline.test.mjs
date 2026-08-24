import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specPath = new URL('../tools/blender/hero/sera_hero_spec.json', import.meta.url);
const feedbackPath = new URL('../tools/blender/hero/sera_hero_feedback.json', import.meta.url);
const statePath = new URL('../tools/blender/hero/sera_hero_search_state.json', import.meta.url);
const cachePath = new URL('../tools/blender/hero/sera_hero_search_cache.json', import.meta.url);
const pipelinePath = new URL('../tools/blender/hero/sera_hero_pipeline_v3.py', import.meta.url);
const metricsPath = new URL('../tools/blender/hero/sera_hero_metrics.py', import.meta.url);
const parameterSearchPath = new URL('../tools/blender/hero/sera_parameter_search.py', import.meta.url);
const objectivePath = new URL('../tools/blender/hero/sera_reference_objective.py', import.meta.url);
const preparePath = new URL('../scripts/prepare-sera-reference-objective.py', import.meta.url);
const runnerPath = new URL('../scripts/run-sera-hero-ai-pipeline.sh', import.meta.url);

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const feedback = JSON.parse(readFileSync(feedbackPath, 'utf8'));
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const pipeline = readFileSync(pipelinePath, 'utf8');
const metrics = readFileSync(metricsPath, 'utf8');
const parameterSearch = readFileSync(parameterSearchPath, 'utf8');
const objective = readFileSync(objectivePath, 'utf8');
const prepare = readFileSync(preparePath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

test('SERA Hero spec defines a persistent 96D reference-driven search', () => {
  assert.equal(spec.character, 'SERA');
  assert.match(spec.version, /^SERA_HERO_SPEC_V3_/);
  assert.equal(spec.parameterSearch.enabled, true);
  assert.equal(spec.parameterSearch.parameterCount, 96);
  assert.ok(spec.parameterSearch.candidateBudget >= 4 && spec.parameterSearch.candidateBudget <= 16);
  assert.ok(spec.parameterSearch.maxGenerations >= 2);
  assert.ok(spec.parameterSearch.initialStep > spec.parameterSearch.minStep);
  assert.ok(spec.parameterSearch.maxViewSilhouetteRegression > 0);
  assert.deepEqual(spec.parameterSearch.groups, {skeleton:20, face:20, hair:20, arms:12, legs:12, costume:12});
  const w = spec.referenceObjective.weights;
  for (const key of ['silhouette','bodyLandmarks','faceLandmarks','faceSilhouette','hairSilhouette']) {
    assert.equal(typeof w[key], 'number'); assert.ok(w[key] > 0);
  }
  assert.ok(Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1) < 1e-9);
});

test('persistent search state and cache are schema-safe', () => {
  assert.equal(state.version, 'SERA_HERO_PARAMETER_SEARCH_STATE_V1');
  assert.equal(state.schemaVersion, 'SERA_HERO_PARAMETER_SPACE_V1_96D');
  assert.ok(Number.isInteger(state.generation) && state.generation >= 0);
  assert.equal(typeof state.parameters, 'object');
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

test('96D search covers skeleton, face, hair, arms, legs and costume', () => {
  assert.match(parameterSearch, /SERA_HERO_PARAMETER_SPACE_V1_96D/);
  assert.match(parameterSearch, /expected 96/);
  for (const group of ['skeleton','face','hair','arms','legs','costume']) assert.ok(parameterSearch.includes(`'${group}'`));
  for (const primitive of ['body_scale','body_shift','body_mirror_shift','object_scale','object_pair_spread','object_pair_rotate']) assert.ok(parameterSearch.includes(primitive));
  assert.match(parameterSearch, /run_parameter_search/);
  assert.match(parameterSearch, /_proposals/);
  assert.match(parameterSearch, /_priority/);
  assert.match(parameterSearch, /_view_safe/);
  assert.match(parameterSearch, /cacheHit/);
  assert.match(parameterSearch, /continueSearch/);
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

test('V3 pipeline uses persistent candidates and keeps T-pose metrics diagnostic-only', () => {
  assert.match(pipeline, /run_parameter_search/);
  assert.match(pipeline, /write_search_outputs/);
  assert.match(pipeline, /neutral_pose\.apply/);
  assert.match(pipeline, /SERA_HERO_ASSET_AI_PIPELINE_V3_96D_PARAMETER_SEARCH/);
  assert.match(pipeline, /REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1/);
  assert.match(pipeline, /legacyBodyDiagnostic/);
  assert.match(pipeline, /never accept or reject a Hero candidate/);
  assert.match(metrics, /world-space meters/);
});

test('runner persists search artifacts and enforces 96 dimensions', () => {
  for (const artifact of ['sera-hero.blend','sera-hero.glb','sera-blender-runtime.glb','sera-hero-report.json','sera-hero-search-state.json','sera-hero-search-cache.json','sera-hero-search-report.json','sera-hero-fight.png','objective-final-${view}.png']) assert.ok(runner.includes(artifact));
  assert.match(runner, /sera_hero_pipeline_v3\.py/);
  assert.match(runner, /--search-state/);
  assert.match(runner, /--search-cache/);
  assert.match(runner, /--candidate-budget/);
  assert.match(runner, /parameter search must expose exactly 96 dimensions/);
});
