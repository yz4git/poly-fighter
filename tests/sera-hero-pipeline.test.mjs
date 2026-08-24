import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const specPath = new URL('../tools/blender/hero/sera_hero_spec.json', import.meta.url);
const feedbackPath = new URL('../tools/blender/hero/sera_hero_feedback.json', import.meta.url);
const pipelinePath = new URL('../tools/blender/hero/sera_hero_pipeline.py', import.meta.url);
const metricsPath = new URL('../tools/blender/hero/sera_hero_metrics.py', import.meta.url);
const runnerPath = new URL('../scripts/run-sera-hero-ai-pipeline.sh', import.meta.url);

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const feedback = JSON.parse(readFileSync(feedbackPath, 'utf8'));
const pipeline = readFileSync(pipelinePath, 'utf8');
const metrics = readFileSync(metricsPath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

test('SERA Hero spec exposes the major silhouette targets', () => {
  assert.equal(spec.character, 'SERA');
  assert.match(spec.version, /^SERA_HERO_SPEC_/);
  for (const key of [
    'shoulderWidth',
    'waistWidth',
    'hipWidth',
    'headWidth',
    'headDepth',
    'headHeightRatio',
    'torsoDepth',
  ]) {
    assert.equal(typeof spec.targets[key], 'number', `${key} must be numeric`);
    assert.ok(spec.targets[key] > 0, `${key} must be positive`);
  }
  assert.ok(spec.optimizer.iterations >= 2);
  assert.ok(spec.optimizer.maxScaleStep > 0 && spec.optimizer.maxScaleStep < 0.2);
});

test('SERA Hero feedback is a safe no-op baseline for AI visual critique', () => {
  assert.match(feedback.version, /^SERA_HERO_FEEDBACK_/);
  assert.equal(feedback.revision, 0);
  assert.deepEqual(feedback.targetMultipliers, {});
  assert.deepEqual(feedback.styleMultipliers, {});
  assert.deepEqual(feedback.objectAdjustments, {});
});

test('SERA Hero pipeline is a closed-loop measured Blender pass with AI feedback handoff', () => {
  assert.match(pipeline, /measure_body/);
  assert.match(pipeline, /run_optimizer/);
  assert.match(pipeline, /apply_feedback_to_spec/);
  assert.match(pipeline, /apply_object_feedback/);
  assert.match(pipeline, /feedbackRevision/);
  assert.match(pipeline, /baselineScore/);
  assert.match(pipeline, /finalScore/);
  assert.match(pipeline, /render_fight_camera/);
  assert.match(pipeline, /export_runtime_mesh/);
  assert.match(pipeline, /sera-hero-report\.json/);
  assert.match(metrics, /optimize_iteration/);
  assert.match(metrics, /world-space meters/);
  assert.match(metrics, /relativeError/);
});

test('runner requires generated Blender, GLB, audit renders, feedback and report', () => {
  for (const artifact of [
    'sera-hero.blend',
    'sera-hero.glb',
    'sera-blender-runtime.glb',
    'sera-hero-report.json',
    'sera-hero-fight.png',
    'sera_hero_feedback.json',
  ]) {
    assert.ok(runner.includes(artifact), `runner must reference ${artifact}`);
  }
  assert.match(runner, /optimizer regressed the measured score/);
});
