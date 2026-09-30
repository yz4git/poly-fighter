import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UniMate-inspired Blender inbetween pass keeps combat anchors immutable", async () => {
  const source = await readFile(new URL("../tools/blender/unimate_inbetween_pass.py", import.meta.url), "utf8");

  assert.match(source, /UNIMATE_INSPIRED_REPLACEMENT_INBETWEEN_V1/);
  assert.match(source, /anchor_frames/);
  assert.match(source, /if frame in anchor_set:\n\s+continue/);
  assert.match(source, /support_preserved/);
  assert.match(source, /"pelvis"/);
  assert.match(source, /thigh_\{support_suffix\}/);
  assert.match(source, /calf_\{support_suffix\}/);
  assert.match(source, /foot_\{support_suffix\}/);
  assert.match(source, /maximum_anchor_rotation_error/);
  assert.match(source, /maximum_anchor_location_error/);
});

test("inbetween pass regularises quaternion motion instead of component-filtering rotations", async () => {
  const source = await readFile(new URL("../tools/blender/unimate_inbetween_pass.py", import.meta.url), "utf8");

  assert.match(source, /dot = abs\(/);
  assert.match(source, /1\.0 - dot <= 2\.0e-7/);
  assert.match(source, /2\.0 \* math\.acos/);
  assert.match(source, /previous_q\.slerp\(following_q, 0\.5\)/);
  assert.match(source, /source_q\.slerp\(rotation_target, weight\)/);
  assert.match(source, /_canonicalize_quaternion_signs/);
  assert.match(source, /dot < 0\.0/);
  assert.match(source, /rotation_accel_rms_before/);
  assert.match(source, /rotation_accel_rms_after/);
  assert.match(source, /max_rotation_step_before/);
  assert.match(source, /max_rotation_step_after/);
  assert.match(source, /after_accel <= before_accel/);
  assert.match(source, /after_max_step <= before_max_step/);
  assert.match(source, /unimateInbetweenAccepted/);
});

test("contact-adjacent gaps are smoothed much less than anticipation and recovery gaps", async () => {
  const source = await readFile(new URL("../tools/blender/unimate_inbetween_pass.py", import.meta.url), "utf8");

  assert.match(source, /if left >= precontact_frame and right <= overtravel_frame:\n\s+return 0\.10/);
  assert.match(source, /if left <= impact_frame <= right:\n\s+return 0\.08/);
  assert.match(source, /return 0\.28/);
});

test("shared strikes, power and kicks all run the UniMate inbetween cleanup after baking", async () => {
  const shared = await readFile(new URL("../tools/blender/motion_foundry_v2_rig.py", import.meta.url), "utf8");
  const power = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v1.py", import.meta.url), "utf8");
  const kicks = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-kicks-base.py", import.meta.url), "utf8");

  for (const source of [shared, power, kicks]) {
    const bake = source.indexOf("bake_visual_action");
    const apply = source.indexOf("apply_replacement_inbetween", bake);
    assert.ok(bake >= 0);
    assert.ok(apply > bake);
    assert.match(source, /unimate_metrics\.as_dict\(\)/);
    assert.match(source, /immutable combat anchors/);
  }
});
