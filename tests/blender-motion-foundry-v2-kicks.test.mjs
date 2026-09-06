import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-kicks.py", import.meta.url), "utf8");
const mocapPrior = await readFile(new URL("../tools/blender/motion_foundry_v6_mocap.py", import.meta.url), "utf8");
const integrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2-kicks.mjs", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../src/game/model-viewer-motion.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/blender-motion-foundry-v2-kicks.yml", import.meta.url), "utf8");
const metrics = JSON.parse(await readFile(new URL("../public/models/quaternius/blender-kicks-core.metrics.json", import.meta.url), "utf8"));

const byAction = new Map(metrics.moves.map((move) => [move.action, move]));
const front = byAction.get("BF_FrontKick_R");
const low = byAction.get("BF_LowKick_L");
const rising = byAction.get("BF_RisingKick_R");

test("V6.8 grounded kick generator keeps the measured shared-rig pipeline", () => {
  for (const token of [
    /class KickSpec/,
    /reference_candidates/,
    /derive_reference_knots/,
    /motion_foundry_v6_mocap/,
    /CMU_MOCAP_WORLD_DELTA_V6/,
    /IMPACT_WINDOW_ONLY/,
    /V6_8_CONTACT_ASSIST/,
    /action_name="BF_FrontKick_R"/,
    /action_name="BF_LowKick_L"/,
    /action_name="BF_RisingKick_R"/,
    /Shoulder span did not provide a usable anatomical left axis/,
    /max Cross hand-to-pelvis reach|max hand-to-pelvis reach/,
    /StrikeLegIK/,
    /StrikeFootOrientation/,
    /GuardHandIK/,
    /SupportFootPositionLockIK/,
    /MOCAP_PELVIS_ANCHOR_V6_7/,
    /SupportFootOrientationLock/,
    /support_yaw/,
    /knee_pole_bias/,
    /supportFootPivotMaxDegrees/,
    /strikeFootForwardReach/,
    /strikeFootVerticalRise/,
    /strikeKneeExtensionDegrees/,
    /strikeLegReachRatio/,
    /hip-relative reach direction is degenerate/,
    /guardHandMinChestHeight/,
    /rig\.add_master_controls/,
    /blender-kicks-core\.glb/,
  ]) assert.match(generator, token);

  for (const token of [
    /LOW_KICK_TORSO_DELTA_RETENTION/,
    /RISING_KICK_TORSO_DELTA_RETENTION/,
    /spine_01\": 0\.17/,
    /spine_02\": 0\.15/,
    /neck_01\": 0\.45/,
    /spine_02\": 0\.30/,
    /spine_03\": 0\.30/,
  ]) assert.match(mocapPrior, token);
});

test("generated V6.8 kick pack keeps three distinct readable contact lines", () => {
  assert.equal(metrics.version, "BLENDER_MOTION_FOUNDRY_V6_KICKS");
  assert.equal(metrics.sharedRig, "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG");
  assert.equal(metrics.naturalnessPass, "REFERENCE_DRIVEN_V6");
  assert.equal(metrics.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");
  assert.deepEqual(new Set(metrics.actions), new Set(["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R"]));
  assert.ok(front && low && rising);

  for (const move of [front, low, rising]) {
    assert.notEqual(move.sourceAction, "Idle_Loop_Armature");
    assert.ok(move.referencePriorActivityScore > 0.05, `${move.action} prior activity`);
    assert.equal(move.contactIKPolicy, "IMPACT_WINDOW_ONLY");
    assert.equal(move.kneePolePolicy, "ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3");
    assert.equal(move.footOrientationPolicy, "ANATOMICAL_BODY_AXES_V6_2");
    assert.equal(move.poleAnglePolicy, "AUTO_CONTINUOUS_BEND_HEMISPHERE_V6_6");
    assert.ok(Number.isFinite(move.strikePoleAngleDegrees));
    assert.ok(move.strikePoleCalibrationMinDot > 0.05, `${move.action} strike pole`);
    assert.ok(move.strikeKneePlaneMinDot > 0.05, `${move.action} strike knee plane`);
    assert.ok(move.supportKneePlaneMinDot > 0.05, `${move.action} support knee plane`);
    assert.equal(move.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");
    assert.match(move.mocapSourceFile, /^135_(04|07|11)\.bvh$/);
    assert.ok(move.mocapSampleCount >= 20);
    assert.ok(move.guardHandMaxChestDistance < 0.55, `${move.action} guard distance`);
    assert.ok(move.guardHandMinChestHeight > -0.05, `${move.action} guard height`);
    assert.ok(move.supportFootLockMaxDrift < 0.01, `${move.action} support drift`);
    assert.ok(move.durationSeconds < 0.9, `${move.action} duration`);
    assert.ok(Number.isFinite(move.allFrameStrikeFootVerticalRiseMax), `${move.action} all-frame rise max`);
    assert.ok(Number.isInteger(move.allFrameStrikeFootVerticalRiseMaxFrame), `${move.action} all-frame rise frame`);
    assert.ok(Number.isFinite(move.allFrameStrikeFootForwardReachMax), `${move.action} all-frame forward max`);
    assert.ok(Number.isInteger(move.allFrameStrikeFootForwardReachMaxFrame), `${move.action} all-frame forward frame`);

    if (move.supportConstraintPolicy === "MOCAP_PELVIS_ANCHOR_V6_7") {
      assert.equal(move.action, "BF_RisingKick_R");
      assert.equal(move.supportPoleAngleDegrees, null);
      assert.deepEqual(move.supportPoleAngleKeysDegrees, []);
      assert.ok(move.mocapSupportAnchorAfter < 0.001);
    } else {
      assert.equal(move.supportConstraintPolicy, "IK_POSITION_LOCK_V6_6");
      assert.ok(Number.isFinite(move.supportPoleAngleDegrees));
      assert.ok(move.supportPoleCalibrationMinDot > 0.05);
      assert.ok(move.supportPoleAngleMaxStepDegrees <= 45);
    }
  }

  // V6.8 deliberately keeps contact knees bent instead of restoring V6.7 lockout.
  assert.ok(front.strikeFootForwardReach > 0.48);
  assert.ok(front.strikeFootVerticalRise > 0.70);
  assert.ok(front.strikeKneeExtensionDegrees > 140 && front.strikeKneeExtensionDegrees < 155);
  assert.ok(front.strikeLegReachRatio > 0.94 && front.strikeLegReachRatio < 0.97);
  assert.ok(front.supportFootPivotMaxDegrees > 8 && front.supportFootPivotMaxDegrees < 20);

  assert.ok(low.strikeFootForwardReach > 0.30);
  assert.ok(low.strikeFootVerticalRise > 0.20 && low.strikeFootVerticalRise < 0.60, low.strikeFootVerticalRise);
  assert.ok(low.strikeKneeExtensionDegrees > 128 && low.strikeKneeExtensionDegrees < 145, low.strikeKneeExtensionDegrees);
  assert.ok(low.strikeLegReachRatio > 0.89 && low.strikeLegReachRatio < 0.94, low.strikeLegReachRatio);
  assert.ok(low.supportFootPivotMaxDegrees > 24 && low.supportFootPivotMaxDegrees < 48);

  assert.ok(rising.strikeFootForwardReach > 0.34);
  assert.ok(rising.strikeFootVerticalRise > 0.80);
  assert.ok(rising.strikeKneeExtensionDegrees > 120 && rising.strikeKneeExtensionDegrees < 140);
  assert.ok(rising.strikeLegReachRatio > 0.87 && rising.strikeLegReachRatio < 0.92);
  assert.ok(rising.supportFootPivotMaxDegrees > 12 && rising.supportFootPivotMaxDegrees < 30);

  // The all-frame gate is the V6.8 regression that representative poses lacked.
  // A Low Kick may never climb into the Front/Rising vertical band between checkpoints.
  assert.ok(low.allFrameStrikeFootVerticalRiseMax < 0.65, low.allFrameStrikeFootVerticalRiseMax);
  assert.ok(low.allFrameStrikeFootForwardReachMax < 0.95, low.allFrameStrikeFootForwardReachMax);
  assert.ok(low.allFrameStrikeFootVerticalRiseMax < front.allFrameStrikeFootVerticalRiseMax - 0.35);
  assert.ok(low.allFrameStrikeFootVerticalRiseMax < rising.allFrameStrikeFootVerticalRiseMax - 0.35);
  assert.ok(low.supportFootPivotMaxDegrees > front.supportFootPivotMaxDegrees + 10);
});

test("all five reference checkpoints stage contact and recovery without a late snap", () => {
  for (const move of metrics.moves) {
    assert.equal(move.referencePoseMethod, "FULL_BODY_REFERENCE_V6");
    assert.deepEqual(move.referencePoses.map((pose) => pose.label), ["START", "CHAMBER", "IMPACT", "RECOVERY", "GUARD"]);
    const [start, chamber, impact, recovery, guard] = move.referencePoses;
    const minimumChamberRise = move.action === "BF_LowKick_L" ? 0.05 : 0.10;
    assert.ok(chamber.strikeFootRise > minimumChamberRise, `${move.action} chamber rise`);
    assert.ok(impact.strikeKneeExtensionDegrees > chamber.strikeKneeExtensionDegrees + 8, `${move.action} chamber->impact knee`);

    if (move.action === "BF_FrontKick_R") {
      assert.ok(recovery.strikeKneeExtensionDegrees < impact.strikeKneeExtensionDegrees - 8, `${move.action} impact->recovery knee`);
    } else if (move.action === "BF_LowKick_L") {
      // The low leg can re-open while it drops; spatial retreat is the actual visual contract.
      assert.ok(recovery.strikeFootRise < impact.strikeFootRise - 0.40, `${move.action} impact->recovery rise`);
      assert.ok(recovery.strikeFootForward < impact.strikeFootForward - 0.20, `${move.action} impact->recovery forward`);
      assert.ok(recovery.strikeKneeExtensionDegrees < 150, `${move.action} recovery knee not locked`);
    } else {
      // Rising retracts spatially while the knee can re-open as the thigh drops.
      assert.ok(recovery.strikeFootForward < impact.strikeFootForward - 0.20, `${move.action} impact->recovery forward`);
      assert.ok(recovery.strikeFootRise < impact.strikeFootRise - 0.50, `${move.action} impact->recovery rise`);
    }

    assert.equal(move.referenceTimeWarpKnots.length, 8, `${move.action} two-stage recovery knots`);
    const settleKnot = move.referenceTimeWarpKnots.at(-2);
    assert.ok(settleKnot[0] > recovery.normalizedTime && settleKnot[0] < 1.0, `${move.action} settle gameplay phase`);
    assert.ok(settleKnot[1] > move.referenceTimeWarpKnots.at(-3)[1], `${move.action} settle source phase`);
    assert.ok(Math.abs(guard.strikeFootForward) < 0.09, `${move.action} guard forward`);
    assert.ok(Math.abs(guard.strikeFootRise) < 0.09, `${move.action} guard rise`);
    assert.ok(guard.supportFootPivotDegrees < 4.0, `${move.action} guard pivot`);
    assert.ok(start.supportFootPivotDegrees < 0.5, `${move.action} start pivot`);
  }

  assert.ok(front.referencePoses[2].supportFootPivotDegrees > 8 && front.referencePoses[2].supportFootPivotDegrees < 20);
  assert.ok(low.referencePoses[2].supportFootPivotDegrees > 18 && low.referencePoses[2].supportFootPivotDegrees < 38);
  assert.ok(rising.referencePoses[2].supportFootPivotDegrees > 10 && rising.referencePoses[2].supportFootPivotDegrees < 28);
});

test("runtime and Model View prefer authored BF kicks with procedural fallbacks", () => {
  for (const token of [
    "QUATERNIUS_BLENDER_KICKS_URL",
    "QUATERNIUS_BLENDER_AIRBORNE_URL",
    'kick: "BF_FrontKick_R"',
    'lowKick: "BF_LowKick_L"',
    'risingKick: "BF_RisingKick_R"',
    'dashKick: "BF_DashKick_R"',
    '["BF_FrontKick_R", "PF_FrontKick_R"]',
    '["BF_LowKick_L", "PF_LowKick_L"]',
    '["BF_RisingKick_R", "PF_RisingKick_R"]',
    '["BF_DashKick_R", "PF_DashKick_R"]',
    "quaterniusBlenderKickClipCount",
    "quaterniusBlenderAirborneClipCount",
    "V6_ACTIVE_CONTACT_SYNC",
  ]) assert.ok(runtime.includes(token), token);

  assert.ok(viewer.includes("QUATERNIUS_BLENDER_KICKS_URL"));
  for (const [procedural, blender, slug] of [
    ["PF_FrontKick_R", "BF_FrontKick_R", "front-kick"],
    ["PF_LowKick_L", "BF_LowKick_L", "low-kick"],
    ["PF_RisingKick_R", "BF_RisingKick_R", "rising-kick"],
  ]) {
    assert.ok(audit.includes(`poseMotionViewer(sessionId, "${procedural}"`));
    assert.ok(audit.includes(`poseMotionViewer(sessionId, "${blender}"`));
    assert.ok(audit.includes(`model-view-motion-procedural-${slug}.png`));
    assert.ok(audit.includes(`model-view-motion-blender-${slug}.png`));
  }
  assert.ok(integrator.includes('kick: "BF_FrontKick_R"') || integrator.includes('kick: \\"BF_FrontKick_R\\"'));
});

test("kick CI regenerates, validates and exports the measured action library", () => {
  for (const token of [
    "motion_foundry_v2_rig.py",
    "build-fight-motion-foundry-v2-kicks.py",
    "BF_FrontKick_R",
    "BF_LowKick_L",
    "BF_RisingKick_R",
    "supportFootLockMaxDrift",
    "supportFootPivotMaxDegrees",
    "animations",
    "apply-blender-motion-foundry-v2-kicks.mjs",
  ]) assert.ok(workflow.includes(token), token);
});
