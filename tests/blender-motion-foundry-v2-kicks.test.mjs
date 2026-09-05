import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Final user-authored checkpoint: audit the generated hip-relative kick GLB in the real WebGL viewer.
const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-kicks.py", import.meta.url), "utf8");
const mocapPrior = await readFile(new URL("../tools/blender/motion_foundry_v6_mocap.py", import.meta.url), "utf8");
const integrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2-kicks.mjs", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../src/game/model-viewer-motion.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/blender-motion-foundry-v2-kicks.yml", import.meta.url), "utf8");
const metrics = JSON.parse(await readFile(new URL("../public/models/quaternius/blender-kicks-core.metrics.json", import.meta.url), "utf8"));

test("grounded kick Foundry authors three move-specific leg IK actions on the shared v2 body rig", () => {
  assert.match(generator, /class KickSpec/);
  assert.match(generator, /reference_candidates/);
  assert.match(generator, /derive_reference_knots/);
  assert.match(generator, /motion_foundry_v6_mocap/);
  assert.match(generator, /CMU_MOCAP_WORLD_DELTA_V6/);
  assert.match(mocapPrior, /LOW_KICK_TORSO_DELTA_RETENTION/);
  assert.match(mocapPrior, /RISING_KICK_TORSO_DELTA_RETENTION/);
  assert.match(mocapPrior, /spine_01\": 0\.17/);
  assert.match(mocapPrior, /spine_02\": 0\.15/);
  assert.match(mocapPrior, /neck_01\": 0\.45/);
  assert.match(mocapPrior, /spine_02\": 0\.30/);
  assert.match(mocapPrior, /spine_03\": 0\.30/);
  assert.match(generator, /IMPACT_WINDOW_ONLY/);
  assert.match(generator, /V6_8_CONTACT_ASSIST/);
  assert.match(generator, /action_name="BF_FrontKick_R"/);
  assert.match(generator, /action_name="BF_LowKick_L"/);
  assert.match(generator, /action_name="BF_RisingKick_R"/);
  assert.match(generator, /Shoulder span did not provide a usable anatomical left axis/);
  assert.match(generator, /max Cross hand-to-pelvis reach|max hand-to-pelvis reach/);
  assert.match(generator, /StrikeLegIK/);
  assert.match(generator, /StrikeFootOrientation/);
  assert.match(generator, /GuardHandIK/);
  assert.match(generator, /SupportFootPositionLockIK/);
  assert.match(generator, /MOCAP_PELVIS_ANCHOR_V6_7/);
  assert.match(generator, /SupportFootOrientationLock/);
  assert.match(generator, /support_yaw/);
  assert.match(generator, /knee_pole_bias/);
  assert.match(generator, /supportFootPivotMaxDegrees/);
  assert.match(generator, /strikeFootForwardReach/);
  assert.match(generator, /strikeFootOutwardReach/);
  assert.match(generator, /strikeFootVerticalRise/);
  assert.match(generator, /strikeKneeExtensionDegrees/);
  assert.match(generator, /strikeLegReachRatio/);
  assert.match(generator, /hip-relative reach direction is degenerate/);
  assert.match(generator, /guardHandMinChestHeight/);
  assert.match(generator, /rig\.add_master_controls/);
  assert.match(generator, /blender-kicks-core\.glb/);
});

test("generated kick pack reaches its intended line with a high guard on planted support feet", () => {
  assert.equal(metrics.version, "BLENDER_MOTION_FOUNDRY_V6_KICKS");
  assert.equal(metrics.sharedRig, "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG");
  assert.equal(metrics.naturalnessPass, "REFERENCE_DRIVEN_V6");
  assert.equal(metrics.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");
  assert.deepEqual(new Set(metrics.actions), new Set(["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R"]));
  const byAction = new Map(metrics.moves.map((move) => [move.action, move]));
  const front = byAction.get("BF_FrontKick_R");
  const low = byAction.get("BF_LowKick_L");
  const rising = byAction.get("BF_RisingKick_R");
  assert.ok(front && low && rising);
  for (const move of [front, low, rising]) {
    assert.notEqual(move.sourceAction, "Idle_Loop_Armature");
    assert.ok(move.referencePriorActivityScore > 0.05, `${move.action}: ${move.referencePriorActivityScore}`);
    assert.equal(move.contactIKPolicy, "IMPACT_WINDOW_ONLY");
    assert.equal(move.kneePolePolicy, "ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3");
    assert.equal(move.footOrientationPolicy, "ANATOMICAL_BODY_AXES_V6_2");
    assert.equal(move.poleAnglePolicy, "AUTO_CONTINUOUS_BEND_HEMISPHERE_V6_6");
    assert.ok(Number.isFinite(move.strikePoleAngleDegrees));
    assert.ok(move.strikePoleCalibrationMinDot > 0.05, `${move.action} strike pole calibration ${move.strikePoleCalibrationMinDot}`);
    if (move.supportConstraintPolicy === "MOCAP_PELVIS_ANCHOR_V6_7") {
      assert.equal(move.action, "BF_RisingKick_R");
      assert.equal(move.supportPoleAngleDegrees, null);
      assert.deepEqual(move.supportPoleAngleKeysDegrees, []);
      assert.equal(move.supportPoleCalibrationMinDot, null);
      assert.ok(move.mocapSupportAnchorAfter < 0.001, `${move.action} prior anchor ${move.mocapSupportAnchorAfter}`);
    } else {
      assert.equal(move.supportConstraintPolicy, "IK_POSITION_LOCK_V6_6");
      assert.ok(Number.isFinite(move.supportPoleAngleDegrees));
      assert.ok(Array.isArray(move.supportPoleAngleKeysDegrees) && move.supportPoleAngleKeysDegrees.length >= 1);
      assert.ok(move.supportPoleAngleMaxStepDegrees <= 45, `${move.action} support pole step ${move.supportPoleAngleMaxStepDegrees}`);
      assert.ok(move.supportPoleCalibrationMinDot > 0.05, `${move.action} support pole calibration ${move.supportPoleCalibrationMinDot}`);
    }
    assert.ok(move.strikeKneePlaneMinDot > 0.05, `${move.action} strike knee plane ${move.strikeKneePlaneMinDot}`);
    assert.ok(move.supportKneePlaneMinDot > 0.05, `${move.action} support knee plane ${move.supportKneePlaneMinDot}`);
    assert.equal(move.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");
    assert.match(move.mocapSourceFile, /^135_(04|07|11)\.bvh$/);
    assert.ok(move.mocapSampleCount >= 20);
    assert.ok(move.strikeFootForwardReach > 0.15, `${move.action}: ${move.strikeFootForwardReach}`);
    assert.ok(move.guardHandMaxChestDistance < 0.55, `${move.action}: ${move.guardHandMaxChestDistance}`);
    assert.ok(move.strikeKneeExtensionDegrees > 135, `${move.action}: ${move.strikeKneeExtensionDegrees}`);
    assert.ok(move.strikeLegReachRatio > 0.85, `${move.action}: ${move.strikeLegReachRatio}`);
    assert.ok(move.guardHandMinChestHeight > -0.05, `${move.action}: ${move.guardHandMinChestHeight}`);
    assert.ok(move.supportFootLockMaxDrift < 0.01, `${move.action}: ${move.supportFootLockMaxDrift}`);
    assert.ok(move.supportFootPivotMaxDegrees > 5, `${move.action}: ${move.supportFootPivotMaxDegrees}`);
    assert.equal(move.naturalnessPass, "REFERENCE_DRIVEN_V6");
    assert.ok(move.durationSeconds < 0.9, `${move.action}: ${move.durationSeconds}`);
  }
  assert.ok(front.strikeFootTravel > 0.58, front.strikeFootTravel);
  assert.ok(front.strikeFootForwardReach > 0.48, front.strikeFootForwardReach);
  assert.ok(front.strikeFootVerticalRise > 0.27, front.strikeFootVerticalRise);
  assert.ok(front.strikeKneeExtensionDegrees > 150, front.strikeKneeExtensionDegrees);
  assert.ok(front.pelvisTravel > 0.055, front.pelvisTravel);
  assert.ok(front.supportFootPivotMaxDegrees > 8 && front.supportFootPivotMaxDegrees < 20, front.supportFootPivotMaxDegrees);
  assert.ok(front.strikeLegReachRatio > 0.96, front.strikeLegReachRatio);
  assert.ok(low.strikeFootTravel > 0.40, low.strikeFootTravel);
  assert.ok(low.strikeFootForwardReach > 0.30, low.strikeFootForwardReach);
  assert.ok(low.strikeFootVerticalRise > 0.22 && low.strikeFootVerticalRise < 0.58, low.strikeFootVerticalRise);
  assert.ok(low.strikeKneeExtensionDegrees > 145 && low.strikeKneeExtensionDegrees < 166, low.strikeKneeExtensionDegrees);
  assert.ok(low.strikeLegReachRatio > 0.90, low.strikeLegReachRatio);
  assert.ok(low.pelvisTravel > 0.045, low.pelvisTravel);
  assert.ok(low.supportFootPivotMaxDegrees > 24 && low.supportFootPivotMaxDegrees < 48, low.supportFootPivotMaxDegrees);
  assert.ok(rising.strikeFootTravel > 0.68, rising.strikeFootTravel);
  assert.ok(rising.strikeFootForwardReach > 0.34, rising.strikeFootForwardReach);
  assert.ok(rising.strikeFootOutwardReach > 0.16, rising.strikeFootOutwardReach);
  assert.ok(rising.strikeFootVerticalRise > 0.52, rising.strikeFootVerticalRise);
  assert.ok(rising.strikeKneeExtensionDegrees > 145, rising.strikeKneeExtensionDegrees);
  assert.ok(rising.strikeLegReachRatio > 0.93, rising.strikeLegReachRatio);
  assert.ok(rising.pelvisTravel > 0.050, rising.pelvisTravel);
  assert.ok(rising.supportFootPivotMaxDegrees > 12 && rising.supportFootPivotMaxDegrees < 30, rising.supportFootPivotMaxDegrees);
  assert.ok(low.supportFootPivotMaxDegrees > front.supportFootPivotMaxDegrees + 10, `${low.supportFootPivotMaxDegrees} !> ${front.supportFootPivotMaxDegrees} + 10`);
  assert.ok(rising.strikeFootVerticalRise > front.strikeFootVerticalRise, `${rising.strikeFootVerticalRise} !> ${front.strikeFootVerticalRise}`);
});

test("runtime prefers authored grounded kicks and the dedicated airborne Dash Kick with independent PF fallbacks", () => {
  assert.match(runtime, /QUATERNIUS_BLENDER_KICKS_URL/);
  assert.match(runtime, /QUATERNIUS_BLENDER_AIRBORNE_URL/);
  assert.match(runtime, /blenderKicks: MotionClipSource \| null/);
  assert.match(runtime, /blenderAirborne: MotionClipSource \| null/);
  assert.match(runtime, /blenderKickClips/);
  assert.match(runtime, /blenderAirborneClips/);
  assert.match(runtime, /kick: "BF_FrontKick_R"/);
  assert.match(runtime, /lowKick: "BF_LowKick_L"/);
  assert.match(runtime, /risingKick: "BF_RisingKick_R"/);
  assert.match(runtime, /dashKick: "BF_DashKick_R"/);
  assert.match(runtime, /\["BF_FrontKick_R", "PF_FrontKick_R"\]/);
  assert.match(runtime, /\["BF_LowKick_L", "PF_LowKick_L"\]/);
  assert.match(runtime, /\["BF_RisingKick_R", "PF_RisingKick_R"\]/);
  assert.match(runtime, /\["BF_DashKick_R", "PF_DashKick_R"\]/);
  assert.match(runtime, /quaterniusBlenderKickClipCount/);
  assert.match(runtime, /quaterniusBlenderAirborneClipCount/);
  assert.match(runtime, /quaterniusDashKickMotionSource/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V6_REFERENCE_KICKS/);
  assert.match(runtime, /V6_ACTIVE_CONTACT_SYNC/);
  assert.match(runtime, /BF_LowKick_L: 0\.5333333333333333/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V2_AIRBORNE/);
  assert.match(integrator, /kick: \\"BF_FrontKick_R\\"|kick: "BF_FrontKick_R"/);
  assert.match(integrator, /lowKick: \\"BF_LowKick_L\\"|lowKick: "BF_LowKick_L"/);
  assert.match(integrator, /risingKick: \\"BF_RisingKick_R\\"|risingKick: "BF_RisingKick_R"/);
});

test("Model Viewer audit captures PF versus BF grounded kicks", () => {
  assert.match(viewer, /QUATERNIUS_BLENDER_KICKS_URL/);
  for (const [procedural, blender, slug] of [
    ["PF_FrontKick_R", "BF_FrontKick_R", "front-kick"],
    ["PF_LowKick_L", "BF_LowKick_L", "low-kick"],
    ["PF_RisingKick_R", "BF_RisingKick_R", "rising-kick"],
  ]) {
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${procedural}"`));
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${blender}"`));
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
  assert.match(workflow, /supportFootPivotMaxDegrees/);
  assert.match(workflow, /animations/);
  assert.match(workflow, /apply-blender-motion-foundry-v2-kicks\.mjs/);
});


test("reference-pose v4 keeps all five kick checkpoints readable and physically staged", () => {
  assert.equal(metrics.naturalnessPass, "REFERENCE_DRIVEN_V6");
  assert.equal(metrics.referencePoseMethod, "FULL_BODY_REFERENCE_V6");
  for (const move of metrics.moves) {
    assert.equal(move.referencePoseMethod, "FULL_BODY_REFERENCE_V6");
    assert.deepEqual(move.referencePoses.map((pose) => pose.label), ["START", "CHAMBER", "IMPACT", "RECOVERY", "GUARD"]);
    const [start, chamber, impact, recovery, guard] = move.referencePoses;
    const minimumChamberRise = move.action === "BF_LowKick_L" ? 0.05 : 0.10;
    assert.ok(chamber.strikeFootRise > minimumChamberRise, `${move.action} chamber rise ${chamber.strikeFootRise}`);
    assert.ok(impact.strikeKneeExtensionDegrees > chamber.strikeKneeExtensionDegrees + 8, `${move.action} chamber->impact knee`);
    assert.ok(recovery.strikeKneeExtensionDegrees < impact.strikeKneeExtensionDegrees - 8, `${move.action} impact->recovery knee`);
    assert.equal(move.referenceTimeWarpKnots.length, 8, `${move.action} two-stage recovery knots`);
    const settleKnot = move.referenceTimeWarpKnots.at(-2);
    assert.ok(settleKnot[0] > recovery.normalizedTime && settleKnot[0] < 1.0, `${move.action} settle gameplay phase`);
    assert.ok(settleKnot[1] > move.referenceTimeWarpKnots.at(-3)[1], `${move.action} settle source phase`);
    assert.ok(Math.abs(guard.strikeFootForward) < 0.09, `${move.action} guard forward ${guard.strikeFootForward}`);
    assert.ok(Math.abs(guard.strikeFootRise) < 0.09, `${move.action} guard rise ${guard.strikeFootRise}`);
    assert.ok(guard.supportFootPivotDegrees < 4.0, `${move.action} guard pivot ${guard.supportFootPivotDegrees}`);
    assert.ok(start.supportFootPivotDegrees < 0.5, `${move.action} start pivot ${start.supportFootPivotDegrees}`);
  }
  const byAction = new Map(metrics.moves.map((move) => [move.action, move]));
  const front = byAction.get("BF_FrontKick_R");
  const low = byAction.get("BF_LowKick_L");
  const rising = byAction.get("BF_RisingKick_R");
  assert.ok(front.referencePoses[2].supportFootPivotDegrees > 8 && front.referencePoses[2].supportFootPivotDegrees < 20);
  assert.ok(low.referencePoses[2].supportFootPivotDegrees > 18 && low.referencePoses[2].supportFootPivotDegrees < 38);
  assert.ok(rising.referencePoses[2].supportFootPivotDegrees > 10 && rising.referencePoses[2].supportFootPivotDegrees < 28);
  assert.ok(rising.referencePoses[2].strikeFootRise > front.referencePoses[2].strikeFootRise + 0.16);
});
