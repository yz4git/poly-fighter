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

test('V6.5 keeps robust static pole calibration as the preferred baseline', () => {
  assert.match(kicks, /AUTO_CONTINUOUS_BEND_HEMISPHERE_V6_6/);
  assert.match(kicks, /calibrate_ik_pole_angle/);
  assert.match(kicks, /robust_min \* 10\.0 \+ mean/);
  assert.match(kicks, /strikePoleCalibrationMinDot/);
  assert.match(kicks, /supportPoleCalibrationMinDot/);
});

test('V6.6 dynamically calibrates a continuous pole-angle path only when static preservation fails', () => {
  assert.match(kicks, /calibrate_dynamic_ik_pole_angle/);
  assert.match(kicks, /support_pole_calibration_min <= 0\.05/);
  assert.match(kicks, /keyframe_insert\(data_path="pole_angle", frame=frame\)/);
  assert.match(kicks, /point\.interpolation = "LINEAR"/);
  assert.match(kicks, /supportPoleAngleKeysDegrees/);
  assert.match(kicks, /DYNAMIC_TARGET_MIN_DOT = 0\.10/);
  assert.match(kicks, /_wrapped_angle_delta/);
  assert.match(kicks, /dynamic programming/);
  assert.match(kicks, /supportPoleAngleMaxStepDegrees/);
});

test('support-foot pivot uses shortest quaternion angle instead of 360-degree wrap', () => {
  assert.match(kicks, /_shortest_quaternion_angle_degrees/);
  assert.match(kicks, /if angle > math\.pi:/);
  assert.match(kicks, /angle = math\.tau - angle/);
});

test('V6.5 dynamic calibration evaluates dense reference leg positions', () => {
  assert.match(kicks, /dense_frames = tuple\(range\(spec\.start_frame, spec\.end_frame \+ 1\)\)/);
  assert.match(kicks, /dense_positions = rig\.v1\.evaluated_positions/);
  assert.match(kicks, /support_ik, dense_positions, spec\.start_frame, spec\.end_frame/);
  assert.match(kicks, /frames = list\(range\(start_frame, end_frame \+ 1\)\)/);
});
