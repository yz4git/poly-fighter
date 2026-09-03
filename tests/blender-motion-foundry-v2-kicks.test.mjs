import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User-authored checkpoint: run the real WebGL audit against the latest generated kick pack.
const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-kicks.py", import.meta.url), "utf8");
const integrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2-kicks.mjs", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../src/game/model-viewer-motion.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/blender-motion-foundry-v2-kicks.yml", import.meta.url), "utf8");
const metrics = JSON.parse(await readFile(new URL("../public/models/quaternius/blender-kicks-core.metrics.json", import.meta.url), "utf8"));

test("grounded kick Foundry authors three move-specific leg IK actions on the shared v2 body rig", () => {
  assert.match(generator, /class KickSpec/);
  assert.match(generator, /source_action_hint: str = "Idle_Loop_Armature"/);
  assert.match(generator, /action_name="BF_FrontKick_R"/);
  assert.match(generator, /action_name="BF_LowKick_L"/);
  assert.match(generator, /action_name="BF_RisingKick_R"/);
  assert.match(generator, /Shoulder span did not provide a usable anatomical left axis/);
  assert.match(generator, /StrikeLegIK/);
  assert.match(generator, /StrikeFootOrientation/);
  assert.match(generator, /GuardHandIK/);
  assert.match(generator, /SupportFootPositionLockIK/);
  assert.match(generator, /SupportFootOrientationLock/);
  assert.match(generator, /strikeFootForwardReach/);
  assert.match(generator, /rig\.add_master_controls/);
  assert.match(generator, /blender-kicks-core\.glb/);
});

test("generated kick pack uses standing Idle, reaches forward and holds a high guard on planted support feet", () => {
  assert.equal(metrics.version, "BLENDER_MOTION_FOUNDRY_V2_KICKS");
  assert.equal(metrics.sharedRig, "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG");
  assert.deepEqual(new Set(metrics.actions), new Set(["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R"]));
  const byAction = new Map(metrics.moves.map((move) => [move.action, move]));
  const front = byAction.get("BF_FrontKick_R");
  const low = byAction.get("BF_LowKick_L");
  const rising = byAction.get("BF_RisingKick_R");
  assert.ok(front && low && rising);
  for (const move of [front, low, rising]) {
    assert.equal(move.sourceAction, "Idle_Loop_Armature");
    assert.ok(move.strikeFootForwardReach > 0.15, `${move.action}: ${move.strikeFootForwardReach}`);
    assert.ok(move.guardHandMaxChestDistance < 0.34, `${move.action}: ${move.guardHandMaxChestDistance}`);
    assert.ok(move.supportFootLockMaxDrift < 0.01, `${move.action}: ${move.supportFootLockMaxDrift}`);
    assert.ok(move.supportFootLockMaxAngularDriftDegrees < 1.0, `${move.action}: ${move.supportFootLockMaxAngularDriftDegrees}`);
    assert.ok(move.durationSeconds < 0.9, `${move.action}: ${move.durationSeconds}`);
  }
  assert.ok(front.strikeFootTravel > 0.45, front.strikeFootTravel);
  assert.ok(front.strikeFootForwardReach > 0.38, front.strikeFootForwardReach);
  assert.ok(low.strikeFootTravel > 0.32, low.strikeFootTravel);
  assert.ok(low.strikeFootForwardReach > 0.24, low.strikeFootForwardReach);
  assert.ok(rising.strikeFootTravel > 0.58, rising.strikeFootTravel);
  assert.ok(rising.strikeFootForwardReach > 0.24, rising.strikeFootForwardReach);
  assert.ok(low.torsoTwistDegrees > front.torsoTwistDegrees, `${low.torsoTwistDegrees} !> ${front.torsoTwistDegrees}`);
  assert.ok(rising.strikeFootTravel > front.strikeFootTravel, `${rising.strikeFootTravel} !> ${front.strikeFootTravel}`);
});

test("runtime prefers authored grounded kicks with independent PF fallbacks while Dash Kick stays procedural", () => {
  assert.match(runtime, /QUATERNIUS_BLENDER_KICKS_URL/);
  assert.match(runtime, /blenderKicks: MotionClipSource \| null/);
  assert.match(runtime, /blenderKickClips/);
  assert.match(runtime, /kick: "BF_FrontKick_R"/);
  assert.match(runtime, /lowKick: "BF_LowKick_L"/);
  assert.match(runtime, /risingKick: "BF_RisingKick_R"/);
  assert.match(runtime, /dashKick: "PF_DashKick_R"/);
  assert.match(runtime, /\["BF_FrontKick_R", "PF_FrontKick_R"\]/);
  assert.match(runtime, /\["BF_LowKick_L", "PF_LowKick_L"\]/);
  assert.match(runtime, /\["BF_RisingKick_R", "PF_RisingKick_R"\]/);
  assert.match(runtime, /quaterniusBlenderKickClipCount/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V2_KICKS/);
  assert.match(integrator, /kick: \\"BF_FrontKick_R\\"|kick: "BF_FrontKick_R"/);
  assert.match(integrator, /lowKick: \\"BF_LowKick_L\\"|lowKick: "BF_LowKick_L"/);
  assert.match(integrator, /risingKick: \\"BF_RisingKick_R\\"|risingKick: "BF_RisingKick_R"/);
});

test("Model Viewer audit captures PF versus BF kick impact poses at 55 percent", () => {
  assert.match(viewer, /QUATERNIUS_BLENDER_KICKS_URL/);
  for (const [procedural, blender, slug] of [
    ["PF_FrontKick_R", "BF_FrontKick_R", "front-kick"],
    ["PF_LowKick_L", "BF_LowKick_L", "low-kick"],
    ["PF_RisingKick_R", "BF_RisingKick_R", "rising-kick"],
  ]) {
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${procedural}", 0\\.55\\)`));
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${blender}", 0\\.55\\)`));
    assert.match(audit, new RegExp(`model-view-motion-procedural-${slug}\\.png`));
    assert.match(audit, new RegExp(`model-view-motion-blender-${slug}\\.png`));
  }
});

test("kick CI hashes the shared rig and validates actual exported GLB actions", () => {
  assert.match(workflow, /motion_foundry_v2_rig\.py/);
  assert.match(workflow, /build-fight-motion-foundry-v2-kicks\.py/);
  assert.match(workflow, /BF_FrontKick_R/);
  assert.match(workflow, /BF_LowKick_L/);
  assert.match(workflow, /BF_RisingKick_R/);
  assert.match(workflow, /supportFootLockMaxDrift/);
  assert.match(workflow, /supportFootLockMaxAngularDriftDegrees/);
  assert.match(workflow, /animations/);
  assert.match(workflow, /apply-blender-motion-foundry-v2-kicks\.mjs/);
});
