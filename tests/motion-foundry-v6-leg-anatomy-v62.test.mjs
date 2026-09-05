import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const kicks = fs.readFileSync('tools/blender/build-fight-motion-foundry-v2-kicks.py', 'utf8');

test('V6.3 target-aware knee poles preserve the measured bend hemisphere', () => {
  assert.match(kicks, /ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3/);
  assert.match(kicks, /safe_bias -= axis \* safe_bias\.dot\(axis\)/);
  assert.match(kicks, /safe_bias\.length > 0\.035/);
  assert.match(kicks, /knee_plane_min_dot/);
  assert.match(kicks, /strikeKneePlaneMinDot/);
  assert.match(kicks, /supportKneePlaneMinDot/);
});

test('V6.2 foot orientation follows fighter anatomical axes instead of world X', () => {
  assert.match(kicks, /ANATOMICAL_BODY_AXES_V6_2/);
  assert.match(kicks, /pitch_axis=left, yaw_axis=up/);
  assert.doesNotMatch(kicks, /pitch = Quaternion\(Vector\(\(1\.0, 0\.0, 0\.0\)\), math\.radians\(pitch_deg\)\)/);
});

test('V6.4 calibrates Blender IK pole angle from evaluated anatomical bend scores', () => {
  assert.match(kicks, /AUTO_ROBUST_BEND_HEMISPHERE_V6_4/);
  assert.match(kicks, /calibrate_ik_pole_angle/);
  assert.match(kicks, /robust_min \* 10\.0 \+ mean/);
  assert.match(kicks, /strikePoleCalibrationMinDot/);
  assert.match(kicks, /supportPoleCalibrationMinDot/);
});
