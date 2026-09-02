import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/model-viewer-panel.tsx', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/game/model-viewer.ts', import.meta.url), 'utf8');
const motionViewer = readFileSync(new URL('../src/game/model-viewer-motion.ts', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/game/visual-entry.ts', import.meta.url), 'utf8');
const referencePose = readFileSync(new URL('../src/game/visual-v11-pose.ts', import.meta.url), 'utf8');

test('title screen exposes a dedicated Model View screen', () => {
  assert.match(page, /"MODEL_VIEW"/);
  assert.match(page, />MODEL VIEW<\/button>/);
  assert.match(page, /setScreen\("MODEL_VIEW"\)/);
  assert.match(page, /<ModelViewerPanel quality=\{settings\.quality\} onBack=\{backToTitle\}/);
});

test('Model View defaults to SERA and can switch production fighters', () => {
  assert.match(panel, /useState<\(typeof fighterIds\)\[number\]>\("blue"\)/);
  assert.match(panel, /const fighterIds = \["blue", "red"\]/);
  assert.match(panel, /definition: fighter/);
  assert.match(viewer, /createFighterVisual\(options\.definition/);
  assert.match(entry, /createFemaleBlenderRuntimeVisual/);
});

test('Model View is touch-first and disposes WebGL resources', () => {
  for (const token of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) assert.ok(viewer.includes(token));
  assert.match(viewer, /pinchDistance/);
  assert.match(viewer, /this\.yaw/);
  assert.match(viewer, /this\.pitch/);
  assert.match(viewer, /this\.distance/);
  assert.match(viewer, /disposeFighterVisual\(this\.visual\)/);
  assert.match(viewer, /renderer\.dispose\(\)/);
  assert.match(viewer, /forceContextLoss\(\)/);
  assert.match(panel, /RESET VIEW/);
  assert.match(panel, /DRAG TO ORBIT/);
  assert.match(panel, /PINCH TO ZOOM/);
});

test('Model View exposes a touch motion viewer with transport and scrubbing', () => {
  assert.match(panel, /aria-label="Motion Viewer"/);
  assert.match(panel, /aria-label="Motion clip"/);
  assert.match(panel, /toggleMotionPlayback/);
  assert.match(panel, /restartMotion/);
  assert.match(panel, /stepMotion\(-1\)/);
  assert.match(panel, /stepMotion\(1\)/);
  assert.match(panel, /setMotionLoop/);
  assert.match(panel, /setMotionSpeed/);
  assert.match(panel, /aria-label="Motion timeline"/);
  assert.match(panel, /seekMotion/);
});

test('motion viewer retargets both procedural and base packs on an isolated mixer', () => {
  assert.match(motionViewer, /QUATERNIUS_UAL_CORE_URL/);
  assert.match(motionViewer, /QUATERNIUS_PROCEDURAL_CORE_URL/);
  assert.match(motionViewer, /new THREE\.AnimationMixer\(target\)/);
  assert.match(motionViewer, /targetNode\.quaternion/);
  assert.match(motionViewer, /sourceRestInverse/);
  assert.match(motionViewer, /propertyName === "position" && nodeName === "pelvis"/);
  assert.match(motionViewer, /source: "PROCEDURAL"/);
  assert.match(motionViewer, /source: "BASE"/);
  assert.match(motionViewer, /function restoreBindPose/);
  assert.match(motionViewer, /mesh\.skeleton\.pose\(\)/);
  assert.match(motionViewer, /restoreBindPose\(target\)/);
  assert.match(viewer, /if \(this\.motionController\) this\.motionController\.update\(dt\)/);
  assert.match(viewer, /else updateQuaterniusModelPreview/);
  assert.match(viewer, /this\.motionController\?\.destroy\(\)/);
});

test('SERA reference pose does not accumulate on unchanged Model View frames', () => {
  assert.match(referencePose, /lastAppliedPoseState/);
  assert.match(referencePose, /poseMatchesLastAppliedState/);
  assert.match(referencePose, /if \(poseMatchesLastAppliedState\(\)\) return;/);
  assert.match(referencePose, /captureAppliedPoseState\(\)/);
  assert.match(referencePose, /SKIP_UNCHANGED_BONE_STATE_V1/);
});
