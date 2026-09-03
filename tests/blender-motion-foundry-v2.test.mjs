import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Keep this contract on a user-authored commit so V8/WebGL CI evaluates the generated shared-strike assets.
const sharedRig = await readFile(new URL("../tools/blender/motion_foundry_v2_rig.py", import.meta.url), "utf8");
const crossGenerator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-cross.py", import.meta.url), "utf8");
const strikeGenerator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-strikes.py", import.meta.url), "utf8");
const crossIntegrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2.mjs", import.meta.url), "utf8");
const strikeIntegrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2-shared-strikes.mjs", import.meta.url), "utf8");
const writerWorkflow = await readFile(new URL("../.github/workflows/blender-motion-foundry.yml", import.meta.url), "utf8");
const validationWorkflow = await readFile(new URL("../.github/workflows/blender-motion-foundry-v2.yml", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../src/game/model-viewer-motion.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");

test("Foundry v2 centralises COG torso hand IK and full support-foot lock in one shared strike rig", () => {
  assert.match(sharedRig, /class StrikeSpec/);
  assert.match(sharedRig, /def add_master_controls/);
  assert.match(sharedRig, /def add_contact_and_foot_controls/);
  assert.match(sharedRig, /COPY_TRANSFORMS/);
  assert.match(sharedRig, /COPY_ROTATION/);
  assert.match(sharedRig, /support_foot_rotation_drift_degrees/);
  assert.match(sharedRig, /bake_visual_action/);
  assert.match(sharedRig, /export_animation_mode="ACTIONS"/);
  assert.match(sharedRig, /MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG/);
});

test("Cross now uses the shared v2 rig instead of owning a private control implementation", () => {
  assert.match(crossGenerator, /import motion_foundry_v2_rig as rig/);
  assert.match(crossGenerator, /action_name="BF_Cross_R"/);
  assert.match(crossGenerator, /source_action_hint="Punch_Cross"/);
  assert.match(crossGenerator, /rig\.build_strike_action/);
  assert.doesNotMatch(crossGenerator, /def add_master_controls/);
  assert.doesNotMatch(crossGenerator, /def add_contact_and_foot_controls/);
});

test("shared strike pack authors Jab Body Blow and Backfist with move-specific timing and handed support", () => {
  assert.match(strikeGenerator, /action_name="BF_Jab_L"/);
  assert.match(strikeGenerator, /action_name="BF_BodyBlow_L"/);
  assert.match(strikeGenerator, /action_name="BF_Backfist_R"/);
  assert.match(strikeGenerator, /source_action_hint="Punch_Jab"/);
  assert.match(strikeGenerator, /source_action_hint="Punch_Cross"/);
  assert.match(strikeGenerator, /strike_side="l"[\s\S]*support_side="r"/);
  assert.match(strikeGenerator, /strike_side="r"[\s\S]*support_side="l"/);
  assert.match(strikeGenerator, /pelvis_pitch=/);
  assert.match(strikeGenerator, /blender-strikes-core\.glb/);
  assert.match(strikeGenerator, /rig\.export_action_library/);
});

test("runtime prefers authored shared strikes but keeps independent procedural fallbacks", () => {
  assert.match(runtime, /QUATERNIUS_BLENDER_STRIKES_URL/);
  assert.match(runtime, /blenderStrikes: MotionClipSource \| null/);
  assert.match(runtime, /jab: "BF_Jab_L"/);
  assert.match(runtime, /bodyBlow: "BF_BodyBlow_L"/);
  assert.match(runtime, /backfist: "BF_Backfist_R"/);
  assert.match(runtime, /\["BF_Jab_L", "PF_Jab_L"\]/);
  assert.match(runtime, /\["BF_BodyBlow_L", "PF_BodyBlow_L"\]/);
  assert.match(runtime, /\["BF_Backfist_R", "PF_Backfist_R"\]/);
  assert.match(runtime, /quaterniusBlenderStrikeClipCount/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V2_SHARED_STRIKES/);
});

test("Motion Viewer/WebGL audit preserves procedural versus Blender A-B inspection for all v2 punches", () => {
  assert.match(viewer, /QUATERNIUS_BLENDER_STRIKES_URL/);
  for (const [procedural, blender, slug] of [
    ["PF_Cross_R", "BF_Cross_R", "cross"],
    ["PF_Jab_L", "BF_Jab_L", "jab"],
    ["PF_BodyBlow_L", "BF_BodyBlow_L", "body-blow"],
    ["PF_Backfist_R", "BF_Backfist_R", "backfist"],
  ]) {
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${procedural}", 0\\.5\\)`));
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${blender}", 0\\.5\\)`));
    assert.match(audit, new RegExp(`model-view-motion-procedural-${slug}\\.png`));
    assert.match(audit, new RegExp(`model-view-motion-blender-${slug}\\.png`));
  }
});

test("writer CI hashes the shared rig, validates three action names and gates strike quality", () => {
  assert.match(writerWorkflow, /motion_foundry_v2_rig\.py/);
  assert.match(writerWorkflow, /build-fight-motion-foundry-v2-strikes\.py/);
  assert.match(writerWorkflow, /Generate shared v2 strikes in Blender/);
  assert.match(writerWorkflow, /BF_Jab_L/);
  assert.match(writerWorkflow, /BF_BodyBlow_L/);
  assert.match(writerWorkflow, /BF_Backfist_R/);
  assert.match(writerWorkflow, /supportFootLockMaxDrift/);
  assert.match(writerWorkflow, /supportFootLockMaxAngularDriftDegrees/);
  assert.match(writerWorkflow, /blender-strikes-core\.glb/);
  assert.match(writerWorkflow, /apply-blender-motion-foundry-v2-shared-strikes\.mjs/);
  assert.match(validationWorkflow, /motion_foundry_v2_rig\.py/);
});

test("shared-strike integration patch is explicit and idempotent", () => {
  assert.match(crossIntegrator, /QUATERNIUS_BLENDER_CROSS_URL/);
  assert.match(strikeIntegrator, /QUATERNIUS_BLENDER_STRIKES_URL/);
  assert.match(strikeIntegrator, /blenderStrikeClips/);
  assert.match(strikeIntegrator, /jab: \\"BF_Jab_L\\"|jab: "BF_Jab_L"/);
  assert.match(strikeIntegrator, /bodyBlow: \\"BF_BodyBlow_L\\"|bodyBlow: "BF_BodyBlow_L"/);
  assert.match(strikeIntegrator, /backfist: \\"BF_Backfist_R\\"|backfist: "BF_Backfist_R"/);
});
