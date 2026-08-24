import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specPath = new URL('../tools/blender/hero/sera_hero_spec.json', import.meta.url);
const feedbackPath = new URL('../tools/blender/hero/sera_hero_feedback.json', import.meta.url);
const pipelinePath = new URL('../tools/blender/hero/sera_hero_pipeline.py', import.meta.url);
const metricsPath = new URL('../tools/blender/hero/sera_hero_metrics.py', import.meta.url);
const objectivePath = new URL('../tools/blender/hero/sera_reference_objective.py', import.meta.url);
const preparePath = new URL('../scripts/prepare-sera-reference-objective.py', import.meta.url);
const runnerPath = new URL('../scripts/run-sera-hero-ai-pipeline.sh', import.meta.url);

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const feedback = JSON.parse(readFileSync(feedbackPath, 'utf8'));
const pipeline = readFileSync(pipelinePath, 'utf8');
const metrics = readFileSync(metricsPath, 'utf8');
const objective = readFileSync(objectivePath, 'utf8');
const prepare = readFileSync(preparePath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

test('SERA Hero spec keeps body dimensions as proposal guidance and defines the real reference objective', () => {
  assert.equal(spec.character, 'SERA');
  assert.match(spec.version, /^SERA_HERO_SPEC_/);
  for (const key of ['shoulderWidth','waistWidth','hipWidth','headWidth','headDepth','headHeightRatio','torsoDepth']) {
    assert.equal(typeof spec.targets[key], 'number', `${key} must be numeric`);
    assert.ok(spec.targets[key] > 0, `${key} must be positive`);
  }
  assert.ok(spec.optimizer.iterations >= 2);
  assert.ok(spec.optimizer.maxScaleStep > 0 && spec.optimizer.maxScaleStep < 0.2);
  assert.ok(spec.referenceObjective.scoreThreshold > 0 && spec.referenceObjective.scoreThreshold <= 1);
  const objectiveWeights = spec.referenceObjective.weights;
  for (const key of ['silhouette','bodyLandmarks','faceLandmarks','faceSilhouette','hairSilhouette']) {
    assert.equal(typeof objectiveWeights[key], 'number');
    assert.ok(objectiveWeights[key] > 0);
  }
  const weightTotal = Object.values(objectiveWeights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(weightTotal - 1) < 1e-9);
});

test('SERA Hero feedback remains schema-safe across critique revisions', () => {
  assert.match(feedback.version, /^SERA_HERO_FEEDBACK_/);
  assert.ok(Number.isInteger(feedback.revision));
  assert.ok(feedback.revision >= 0);
  assert.equal(typeof feedback.targetMultipliers, 'object');
  assert.equal(typeof feedback.styleMultipliers, 'object');
  assert.equal(typeof feedback.objectAdjustments, 'object');
  for (const [key, value] of Object.entries(feedback.targetMultipliers)) {
    assert.ok(Object.hasOwn(spec.targets, key), `unknown target feedback key: ${key}`);
    assert.equal(typeof value, 'number');
    assert.ok(Number.isFinite(value) && value > 0, `${key} multiplier must be positive`);
  }
  for (const [key, value] of Object.entries(feedback.styleMultipliers)) {
    assert.ok(Object.hasOwn(spec.style, key), `unknown style feedback key: ${key}`);
    for (const multiplier of (Array.isArray(value) ? value : [value])) {
      assert.equal(typeof multiplier, 'number');
      assert.ok(Number.isFinite(multiplier) && multiplier > 0, `${key} multiplier must be positive`);
    }
  }
  for (const [name, adjustment] of Object.entries(feedback.objectAdjustments)) {
    assert.match(name, /^SERA_/);
    for (const key of ['scaleMultiplier', 'locationDelta', 'rotationDeltaRadians']) {
      if (!(key in adjustment)) continue;
      assert.ok(Array.isArray(adjustment[key]));
      assert.equal(adjustment[key].length, 3);
      assert.ok(adjustment[key].every(Number.isFinite));
    }
  }
});

test('reference JPEG preparation extracts canonical four-view silhouette, skin, hair and landmarks', () => {
  assert.match(prepare, /female-turnaround\.jpeg/);
  assert.match(prepare, /segment_panel/);
  assert.match(prepare, /body_landmarks/);
  assert.match(prepare, /face_landmarks/);
  assert.match(prepare, /reference-objective\.json/);
  assert.match(prepare, /reference-\{view\}-silhouette/);
  assert.match(prepare, /reference-\{view\}-hair/);
});

test('Blender objective scores semantic renders against reference imagery', () => {
  assert.match(objective, /render_and_score/);
  assert.match(objective, /silhouetteIoU/);
  assert.match(objective, /hairIoU/);
  assert.match(objective, /faceIoU/);
  assert.match(objective, /bodyLandmarkRmsPx/);
  assert.match(objective, /faceLandmarkRmsPx/);
  assert.match(objective, /world_to_camera_view/);
  assert.match(objective, /film_transparent = True/);
  assert.match(objective, /SERA_ObjectiveHair/);
});

test('SERA Hero pipeline accepts candidates by reference score, not T-pose dimensions', () => {
  assert.match(pipeline, /run_reference_body_optimizer/);
  assert.match(pipeline, /render_and_score/);
  assert.match(pipeline, /neutral_pose\.apply/);
  assert.match(pipeline, /candidate\['score'\] > current\['score'\]/);
  assert.match(pipeline, /REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1/);
  assert.match(pipeline, /legacyBodyDiagnostic/);
  assert.match(pipeline, /never the quality gate/);
  assert.doesNotMatch(pipeline, /history = run_optimizer/);
  assert.match(metrics, /optimize_iteration/);
  assert.match(metrics, /world-space meters/);
});

test('runner prepares and enforces the reference-image objective and generated artifacts', () => {
  for (const artifact of ['sera-hero.blend','sera-hero.glb','sera-blender-runtime.glb','sera-hero-report.json','sera-hero-fight.png','objective-final-${view}.png']) {
    assert.ok(runner.includes(artifact), `runner must reference ${artifact}`);
  }
  assert.match(runner, /prepare-sera-reference-objective\.py/);
  assert.match(runner, /--reference-objective-dir/);
  assert.match(runner, /REFERENCE_IMAGE_SILHOUETTE_LANDMARK_FACE_HAIR_V1/);
  assert.match(runner, /reference-image optimizer regressed/);
});
