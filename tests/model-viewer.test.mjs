import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/model-viewer-panel.tsx', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/game/model-viewer.ts', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/game/visual-entry.ts', import.meta.url), 'utf8');

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
