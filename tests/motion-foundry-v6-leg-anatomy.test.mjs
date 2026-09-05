import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mocap = fs.readFileSync('tools/blender/motion_foundry_v6_mocap.py', 'utf8');
const kicks = fs.readFileSync('tools/blender/build-fight-motion-foundry-v2-kicks.py', 'utf8');

test('V6 mocap legs use segment-direction swing retarget instead of raw bone twist deltas', () => {
  assert.match(mocap, /SEGMENT_DIRECTION_SWING_V6_1/);
  assert.match(mocap, /_segment_direction_retarget_q/);
  assert.match(mocap, /leg_direction_targets/);
  assert.match(mocap, /Vector\(\(0\.0, 1\.0, 0\.0\)\)/);
});

test('kick IK poles follow measured knee planes instead of one frozen world pole', () => {
  assert.match(kicks, /ANIMATED_MEASURED_KNEE_PLANE_V6_1/);
  assert.match(kicks, /set_anatomical_knee_pole_keys/);
  assert.match(kicks, /positions\[frame\]\[thigh_name\]/);
  assert.match(kicks, /positions\[frame\]\[s_thigh\]/);
  assert.doesNotMatch(kicks, /knee_pole_position = rig\.v1\.chain_pole\(hip, knee, ankle/);
});
