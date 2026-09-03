import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User-authored checkpoint: runtime integration must exist in the real source tree, not only in the patch script.
const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-airborne.py", import.meta.url), "utf8");
const integrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2-airborne.mjs", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../src/game/model-viewer-motion.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");

async function readMetricsIfPresent() {
  try {
    return JSON.parse(await readFile(new URL("../public/models/quaternius/blender-airborne-core.metrics.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

test("airborne Dash Kick uses a dedicated no-support-lock Blender rig", () => {
  assert.match(generator, /BF_DashKick_R/);
  assert.match(generator, /MOTION_FOUNDRY_V2_AIRBORNE_STRIKE_RIG/);
  assert.match(generator, /StrikeLegIK/);
  assert.match(generator, /TrailLegTuckIK/);
  assert.match(generator, /no planted support-foot constraint while airborne/);
  assert.doesNotMatch(generator, /SupportFootPositionLockIK/);
  assert.doesNotMatch(generator, /SupportFootOrientationLock/);
  assert.match(generator, /pelvisApexRise/);
  assert.match(generator, /landingVerticalResidual/);
  assert.match(generator, /airborneFeetAtImpact/);
  assert.match(generator, /strikeKneeExtensionDegrees/);
  assert.match(generator, /trailKneeAngleDegrees/);
});

test("runtime source itself exports and routes the Blender airborne pack with PF fallback", () => {
  assert.match(runtime, /export const QUATERNIUS_BLENDER_AIRBORNE_URL =/);
  assert.match(runtime, /blenderAirborne: MotionClipSource \| null/);
  assert.match(runtime, /const blenderAirborneMotion = loader\.loadAsync\(QUATERNIUS_BLENDER_AIRBORNE_URL\)/);
  assert.match(runtime, /const blenderAirborneClips = resources\.motion\.blenderAirborne/);
  assert.match(runtime, /dashKick: "BF_DashKick_R"/);
  assert.match(runtime, /\["BF_DashKick_R", "PF_DashKick_R"\]/);
  assert.match(runtime, /quaterniusBlenderAirborneClipCount/);
  assert.match(runtime, /quaterniusDashKickMotionSource/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V2_AIRBORNE/);
});

test("Model Viewer source itself loads the Blender airborne pack", () => {
  assert.match(viewer, /QUATERNIUS_BLENDER_AIRBORNE_URL/);
  assert.match(viewer, /const blenderAirborneMotion = loader\.loadAsync\(QUATERNIUS_BLENDER_AIRBORNE_URL\)/);
  assert.match(viewer, /blenderAirborne/);
  assert.match(viewer, /source: "BLENDER"/);
});

test("WebGL audit source itself captures procedural and Blender Dash Kick at the same phase", () => {
  assert.match(audit, /hasBlenderDashKick/);
  assert.match(audit, /hasProceduralDashKick/);
  assert.match(audit, /poseMotionViewer\(sessionId, "PF_DashKick_R", 0\.52\)/);
  assert.match(audit, /poseMotionViewer\(sessionId, "BF_DashKick_R", 0\.52\)/);
  assert.match(audit, /model-view-motion-procedural-dash-kick\.png/);
  assert.match(audit, /model-view-motion-blender-dash-kick\.png/);
});

test("integration script remains idempotent against the materialized source tree", () => {
  assert.match(integrator, /runtime airborne URL/);
  assert.match(integrator, /runtime airborne fallback/);
  assert.match(integrator, /viewer airborne pack/);
  assert.match(integrator, /audit airborne A-B captures/);
});

test("generated airborne metrics satisfy the authored flight contract when present", async (t) => {
  const metrics = await readMetricsIfPresent();
  if (!metrics) {
    t.skip("airborne GLB has not been generated on this checkout yet");
    return;
  }
  assert.equal(metrics.version, "BLENDER_MOTION_FOUNDRY_V2_AIRBORNE");
  assert.equal(metrics.sharedRig, "MOTION_FOUNDRY_V2_AIRBORNE_STRIKE_RIG");
  assert.deepEqual(metrics.actions, ["BF_DashKick_R"]);
  const move = metrics.moves[0];
  assert.equal(move.action, "BF_DashKick_R");
  assert.ok(move.strikeFootForwardReach > 0.55, move.strikeFootForwardReach);
  assert.ok(move.strikeKneeExtensionDegrees > 150, move.strikeKneeExtensionDegrees);
  assert.ok(move.strikeLegReachRatio > 0.96, move.strikeLegReachRatio);
  assert.ok(move.trailFootVerticalRise > 0.18, move.trailFootVerticalRise);
  assert.ok(move.trailKneeAngleDegrees < 130, move.trailKneeAngleDegrees);
  assert.ok(move.pelvisApexRise > 0.14, move.pelvisApexRise);
  assert.ok(move.airborneFeetAtImpact > 0.16, move.airborneFeetAtImpact);
  assert.ok(move.landingVerticalResidual < 0.06, move.landingVerticalResidual);
  assert.ok(move.guardHandMaxChestDistance < 0.34, move.guardHandMaxChestDistance);
  assert.ok(move.guardHandMinChestHeight > 0.08, move.guardHandMinChestHeight);
  assert.ok(move.durationSeconds < 0.85, move.durationSeconds);
});
