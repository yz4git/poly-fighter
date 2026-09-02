import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-cross.py", import.meta.url), "utf8");
const integrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2.mjs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/blender-motion-foundry-v2.yml", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../src/game/model-viewer-motion.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");

test("Foundry v2 authors Cross with COG, torso, hand IK and full support-foot lock", () => {
  assert.match(generator, /ACTION_NAME = "BF_Cross_R"/);
  assert.match(generator, /VERSION = "BLENDER_MOTION_FOUNDRY_V2_CROSS"/);
  assert.match(generator, /BF2_CTRL_COG/);
  assert.match(generator, /BF2_CTRL_torso_lower/);
  assert.match(generator, /BF2_CTRL_torso_upper/);
  assert.match(generator, /BF2_RightHandContactIK/);
  assert.match(generator, /BF2_LeftFootPositionLockIK/);
  assert.match(generator, /BF2_LeftFootOrientationLock/);
  assert.match(generator, /bpy\.ops\.nla\.bake|bake_visual_action/);
  assert.match(generator, /leftFootLockMaxAngularDriftDegrees/);
  assert.match(generator, /torsoTwistDegrees/);
});

test("Foundry v2 runtime prefers authored Straight but keeps procedural fallback", () => {
  assert.match(runtime, /QUATERNIUS_BLENDER_CROSS_URL/);
  assert.match(runtime, /blenderCross: MotionClipSource \| null/);
  assert.match(runtime, /straight: "BF_Cross_R"/);
  assert.match(runtime, /proceduralClips\.get\("PF_Cross_R"\)/);
  assert.match(runtime, /alias\.name = "BF_Cross_R"/);
  assert.match(runtime, /quaterniusStraightMotionSource/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V2_CROSS/);
});

test("Motion Viewer and WebGL audit preserve PF/BF Cross A-B inspection", () => {
  assert.match(viewer, /QUATERNIUS_BLENDER_CROSS_URL/);
  assert.match(viewer, /source: "BLENDER"/);
  assert.match(audit, /PF_Cross_R/);
  assert.match(audit, /BF_Cross_R/);
  assert.match(audit, /model-view-motion-procedural-cross\.png/);
  assert.match(audit, /model-view-motion-blender-cross\.png/);
});

test("Foundry v2 CI validates positional and angular foot lock before publishing", () => {
  assert.match(workflow, /Generate BF_Cross_R in Blender/);
  assert.match(workflow, /leftFootLockMaxDrift/);
  assert.match(workflow, /leftFootLockMaxAngularDriftDegrees/);
  assert.match(workflow, /blender-cross-core\.glb/);
  assert.match(workflow, /apply-blender-motion-foundry-v2\.mjs/);
});

test("v2 integration patch is explicit and idempotent around the new source", () => {
  assert.match(integrator, /QUATERNIUS_BLENDER_CROSS_URL/);
  assert.match(integrator, /blenderCrossClips/);
  assert.match(integrator, /straight: \\"BF_Cross_R\\"|straight: "BF_Cross_R"/);
});
