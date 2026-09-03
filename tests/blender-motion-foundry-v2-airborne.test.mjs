import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User-authored checkpoint: regenerate the airborne Dash Kick after Python 3.12 helper registration.
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

test("runtime and Model Viewer prefer BF_DashKick_R with an independent PF fallback", () => {
  const combined = `${runtime}\n${integrator}`;
  assert.match(combined, /QUATERNIUS_BLENDER_AIRBORNE_URL/);
  assert.match(combined, /blenderAirborne/);
  assert.match(combined, /dashKick: \"BF_DashKick_R\"/);
  assert.match(combined, /\[\"BF_DashKick_R\", \"PF_DashKick_R\"\]/);
  assert.match(combined, /quaterniusDashKickMotionSource/);
  assert.match(combined, /BLENDER_MOTION_FOUNDRY_V2_AIRBORNE/);
  assert.match(`${viewer}\n${integrator}`, /QUATERNIUS_BLENDER_AIRBORNE_URL/);
});

test("WebGL audit captures procedural and Blender Dash Kick at the same phase", () => {
  const combined = `${audit}\n${integrator}`;
  assert.match(combined, /PF_DashKick_R/);
  assert.match(combined, /BF_DashKick_R/);
  assert.match(combined, /model-view-motion-procedural-dash-kick\.png/);
  assert.match(combined, /model-view-motion-blender-dash-kick\.png/);
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
