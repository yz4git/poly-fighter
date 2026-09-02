import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIGHTER_DEFINITIONS, MOVE_ORDER } from "../src/game/definitions";
import {
  MOTION_EXPANSION_PROFILE,
  chooseTpsComboContinuationRoute,
  chooseTpsComboRoute,
  motionClipForMove,
  motionSpecForMove,
  motionPlantFootForMove,
  motionDnaForFighter,
  reactionKindForMove,
  tpsComboLinkWindow,
  tpsComboMoveForRoute,
} from "../src/game/motion-profile";

test("Procedural Fight v3 maps every authored move to pose-graph motion and reaction data", () => {
  assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_QUALITY_V3");
  assert.equal(MOTION_EXPANSION_PROFILE.uniqueMoveMappings, 11);
  assert.equal(MOTION_EXPANSION_PROFILE.secondaryLibraryClips, 23);
  assert.equal(MOTION_EXPANSION_PROFILE.proceduralVersion, "PROCEDURAL_FIGHT_V3");
  assert.equal(MOTION_EXPANSION_PROFILE.proceduralLibraryClips, 23);
  assert.ok(MOTION_EXPANSION_PROFILE.reactionKinds >= 9);
  assert.equal(MOTION_EXPANSION_PROFILE.guardBreakClip, "PF_GuardBreak");
  assert.equal(MOTION_EXPANSION_PROFILE.wakeupClip, "PF_Wakeup");
  assert.equal(MOTION_EXPANSION_PROFILE.sideStepLeftClip, "PF_Sidestep_L");
  assert.equal(MOTION_EXPANSION_PROFILE.kickRecoveryClip, "PF_KickRecover");
  assert.equal(MOTION_EXPANSION_PROFILE.heavyRecoveryClip, "PF_HeavyRecover");
  assert.equal(MOTION_EXPANSION_PROFILE.rootMotionPolicy, "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK");
  assert.equal(MOTION_EXPANSION_PROFILE.timingPolicy, "MOVE_SPECIFIC_9_POSE_TIMING");

  for (const fighter of Object.values(FIGHTER_DEFINITIONS)) {
    const clips = new Set<string>();
    for (const moveId of MOVE_ORDER) {
      const move = fighter.moves[moveId];
      assert.ok(move, `${fighter.name} missing ${moveId}`);
      assert.ok(move.motionId, `${fighter.name}/${moveId} missing motionId`);
      assert.ok(move.reactionTarget, `${fighter.name}/${moveId} missing reactionTarget`);
      clips.add(motionClipForMove(move));
    }
    assert.ok(clips.size >= 8, `${fighter.name} only exposes ${clips.size} distinct move clips`);
  }
});

test("procedural v3 generator contains pose graph, support-foot authoring, COM and move-specific timing", async () => {
  const source = await readFile(new URL("../scripts/generate-procedural-fight-motions-v3.mjs", import.meta.url), "utf8");
  const metrics = JSON.parse(
    await readFile(new URL("../public/models/quaternius/procedural-fight-core.metrics.json", import.meta.url), "utf8"),
  ) as {
    version: string;
    generatedClipCount: number;
    clips: string[];
    rootMotionPolicy: string;
    timingPolicy: string;
    metrics: Array<{
      name: string;
      modifiedBones: string[];
      modifiedPaths: string[];
      missingAnimated: string[];
      maxPlanarRootShift: number;
      contactU: number;
    }>;
  };

  assert.match(source, /PROCEDURAL_FIGHT_V3/);
  assert.match(source, /POSE_GRAPH_NODES/);
  assert.match(source, /MOVE_TIMINGS/);
  assert.match(source, /authorSupportLeg/);
  assert.match(source, /MOTION_DNA/);
  assert.match(source, /ANTICIPATION/);
  assert.match(source, /PF_GuardBreak/);
  assert.match(source, /PF_Sidestep_L/);
  assert.match(source, /PF_KickRecover/);
  assert.match(source, /FULL_BODY_BALANCE_V3/);
  assert.match(source, /PF_Power_R.*, base: "Punch_Cross"/);
  assert.match(source, /PF_Throw.*, base: "Idle_Loop"/);
  assert.match(source, /PF_BodyBlow_L.*, base: "Punch_Jab"/);
  assert.match(source, /sampleCurve/);
  assert.equal(metrics.version, "PROCEDURAL_FIGHT_V3");
  assert.equal(metrics.generatedClipCount, 23);
  assert.equal(metrics.clips.length, 23);
  assert.equal(metrics.rootMotionPolicy, "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK");
  assert.equal(metrics.timingPolicy, "MOVE_SPECIFIC_9_POSE_TIMING");
  assert.equal(metrics.poseGraph.length, 9);
  assert.equal(metrics.motionDna.POWER.id, "KAIRO_POWER");
  assert.equal(metrics.motionDna.SPEED.id, "SERA_SPEED");
  for (const required of [
    "PF_Jab_L", "PF_Backfist_L", "PF_BodyBlow_R", "PF_Counter_L", "PF_LowKick_L", "PF_DownBack", "PF_GuardBreak",
    "PF_Sidestep_L", "PF_Sidestep_R", "PF_KickRecover", "PF_HeavyRecover",
  ]) assert.ok(metrics.clips.includes(required), `missing ${required}`);

  let planarClips = 0;
  for (const entry of metrics.metrics) {
    assert.ok(entry.modifiedBones.length >= 3, `${entry.name} modifies too few bones`);
    assert.deepEqual(entry.missingAnimated, [], `${entry.name} modifier path is absent from its base clip`);
    assert.ok(entry.modifiedPaths.includes("pelvis:translation"), `${entry.name} lacks center-of-mass translation`);
    assert.ok(entry.contactU >= 0 && entry.contactU <= 1, `${entry.name} invalid contactU`);
    if (entry.maxPlanarRootShift > 0.001) planarClips += 1;
  }
  assert.ok(planarClips >= 12, `only ${planarClips} v3 clips contain planar root motion`);
});

test("v7.1 kick mappings retain authored support feet and keep the attack clip through recovery", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const jab = motionSpecForMove(kairo.moves.jab);
  const backfist = motionSpecForMove(kairo.moves.backfist);
  const body = motionSpecForMove(kairo.moves.bodyBlow);
  const power = motionSpecForMove(kairo.moves.power);
  const kick = motionSpecForMove(kairo.moves.kick);
  const low = motionSpecForMove(kairo.moves.lowKick);
  const rising = motionSpecForMove(kairo.moves.risingKick);
  const dash = motionSpecForMove(kairo.moves.dashKick);

  assert.equal(jab.clip, "PF_Jab_L");
  assert.equal(backfist.clip, "PF_Backfist_R");
  assert.equal(backfist.recoveryClip, "PF_HeavyRecover");
  assert.equal(body.clip, "PF_BodyBlow_L");
  assert.equal(power.clip, "PF_Power_R");
  assert.equal(power.recoveryClip, "PF_HeavyRecover");
  assert.notEqual(body.clip, backfist.clip);
  assert.equal(kick.clip, "PF_FrontKick_R");
  assert.equal(low.clip, "PF_LowKick_L");
  assert.equal(rising.clip, "PF_RisingKick_R");
  assert.equal(dash.clip, "PF_DashKick_R");
  assert.equal(kick.recoveryClip, undefined);
  assert.equal(low.recoveryClip, undefined);
  assert.equal(rising.recoveryClip, undefined);
  assert.equal(dash.recoveryClip, undefined);
  assert.ok(kick.contactBlend >= 0.82 && kick.contactBlend <= 0.90);
  assert.ok(low.contactBlend >= 0.80 && low.contactBlend <= 0.88);
  assert.ok(rising.contactBlend >= 0.88 && rising.contactBlend <= 0.94);
  assert.ok(dash.contactBlend >= 0.88 && dash.contactBlend <= 0.94);
  assert.equal(jab.plantFoot, "RIGHT");
  assert.equal(power.plantFoot, "LEFT");
  assert.equal(dash.plantFoot, "AIR");
});

test("side-sensitive punches select the clip that matches each fighter's authored contact hand", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;
  assert.equal(motionSpecForMove(kairo.moves.backfist).clip, "PF_Backfist_R");
  assert.equal(motionSpecForMove(sera.moves.backfist).clip, "PF_Backfist_L");
  assert.equal(motionSpecForMove(kairo.moves.bodyBlow).clip, "PF_BodyBlow_L");
  assert.equal(motionSpecForMove(sera.moves.bodyBlow).clip, "PF_BodyBlow_R");
  assert.equal(motionSpecForMove(kairo.moves.counter).clip, "PF_Counter_L");
  assert.equal(motionSpecForMove(sera.moves.counter).clip, "PF_Counter_L");
  assert.equal(motionPlantFootForMove(kairo.moves.backfist), "LEFT");
  assert.equal(motionPlantFootForMove(sera.moves.backfist), "RIGHT");
  assert.equal(motionPlantFootForMove(kairo.moves.bodyBlow), "RIGHT");
  assert.equal(motionPlantFootForMove(sera.moves.bodyBlow), "LEFT");
  assert.equal(motionPlantFootForMove(kairo.moves.counter), "RIGHT");
  assert.equal(motionPlantFootForMove(sera.moves.counter), "RIGHT");
  assert.equal(motionDnaForFighter(kairo).id, "KAIRO_POWER");
  assert.equal(motionDnaForFighter(sera).id, "SERA_SPEED");
});

test("motion runtime uses bounded procedural center-of-mass motion and generated guard/evasion states", async () => {
  const source = await readFile(new URL("../src/game/motion-expansion-runtime.ts", import.meta.url), "utf8");
  const presentation = await readFile(new URL("../src/game/presentation-animation.ts", import.meta.url), "utf8");

  assert.match(source, /const runtime = ensureRuntime\(fighter\);/);
  assert.match(source, /TAIL_NEUTRAL_STATES/);
  assert.match(source, /motionExpansionTailKind/);
  assert.match(source, /COMBO_LINK_BLEND_SECONDS = 0\.075/);
  assert.match(source, /comboLinkState === "LINKED"/);
  assert.match(source, /comboLinkSerial !== runtime\.lastComboLinkSerial/);
  assert.match(source, /currentPhase = "SETTLE"/);
  assert.match(source, /FULL_BODY_BALANCE_VERSION = "FULL_BODY_SOLVER_V3"/);
  assert.match(source, /motionExpansionBalanceVersion = FULL_BODY_BALANCE_VERSION/);
  assert.match(source, /strikeTrajectory\(runtime, fighter, opponent\)/);
  assert.match(source, /motionExpansionContactMode = "V3_FULL_BODY_TARGET_IK"/);
  assert.match(source, /captureFootLocks/);
  assert.match(source, /solveFootLock/);
  assert.match(source, /solveCenterOfMass/);
  assert.match(source, /fullBodyStrikeSolve/);
  assert.match(source, /impactPairAccent/);
  assert.match(source, /IMPACT_PAIR_REACTION_STATES/);
  assert.match(source, /"KNOCKDOWN", "THROW", "KO", "RING_OUT"/);
  assert.match(source, /applyMotionDna/);
  assert.match(source, /V3_VISUAL_READABILITY_VERSION = "PROCEDURAL_FIGHT_V3_READABILITY_3"/);
  assert.match(source, /V3_KICK_CONTACT_SOLVER = "KICK_CONTACT_SOLVER_V2_PLANT_COMPENSATED"/);
  assert.match(source, /motionExpansionStrikeContactError/);
  assert.match(source, /motionExpansionStrikeContactBlend/);
  assert.match(source, /phaseAlignedAttackPoseU/);
  assert.match(source, /syncKickActionToAuthoredPose/);
  assert.match(source, /PHASE_ALIGNED_KICK_V2/);
  assert.match(source, /motionExpansionAuthoredPoseU/);
  assert.match(source, /motionExpansionDnaSilhouetteStrength/);
  assert.match(source, /motionExpansionImpactPairStrength/);
  assert.match(source, /motionExpansionVisualReadabilityVersion/);
  assert.match(source, /V3_CONTACT_LANE_POLICY = "OUTER_EDGE_TARGET_V2"/);
  assert.match(source, /motionExpansionContactLanePolicy/);
  assert.match(source, /motionExpansionFootLockError/);
  assert.match(source, /PROCEDURAL_URL/);
  assert.match(source, /PROCEDURAL_FIGHT_V3/);
  assert.match(source, /preserveProceduralPlanarRoot/);
  assert.match(source, /THREE\.MathUtils\.clamp\(track\.values\[offset\] - sourceNode\.position\.x, -0\.09, 0\.09\)/);
  assert.match(source, /PF_GuardBreak/);
  assert.match(source, /PF_Sidestep_L/);
  assert.match(source, /PF_Sidestep_R/);
  assert.match(source, /motionExpansionRootMotionPolicy = "V3_COM_FOOT_LOCK_FULL_BODY_IK"/);
  assert.match(source, /child\.name\.startsWith\("quaternius-ubc-"\) && child\.name\.endsWith\("-runtime"\)/);
  assert.match(source, /motionExpansionTargetsVisibleQuaternius = true/);
  assert.match(source, /motionExpansionTargetHost = host\.name/);
  assert.match(source, /styleTarget\(opponent, spec\.style, side\)/);
  assert.doesNotMatch(source, /getVisualContactPoint/);
  assert.match(presentation, /updateMotionExpansionSkin\(fighter, opponent, timeSeconds\)/);
});

test("reaction selection distinguishes head, body, low, heavy and launch impacts", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  assert.equal(reactionKindForMove(kairo.moves.jab, false, 100), "HEAD");
  assert.equal(reactionKindForMove(kairo.moves.bodyBlow, false, 100), "BODY");
  assert.equal(reactionKindForMove(kairo.moves.lowKick, false, 100), "LOW");
  assert.equal(reactionKindForMove(kairo.moves.power, true, 100), "HEAVY");
  assert.equal(reactionKindForMove(kairo.moves.risingKick, true, 100), "LAUNCH");
  assert.equal(reactionKindForMove(kairo.moves.jab, false, 0), "KO");
});

test("TPS combo graph branches without adding input buttons", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;

  assert.equal(chooseTpsComboRoute({ distance: 2.0, flank: false, perfect: false, variationSeed: 0 }), "FAR");
  assert.equal(chooseTpsComboRoute({ distance: 1.2, flank: true, perfect: false, variationSeed: 0 }), "FLANK");
  assert.equal(chooseTpsComboRoute({ distance: 1.2, flank: true, perfect: true, variationSeed: 0 }), "PERFECT");
  assert.notEqual(
    chooseTpsComboRoute({ distance: 1.2, flank: false, perfect: false, variationSeed: 0 }),
    chooseTpsComboRoute({ distance: 1.2, flank: false, perfect: false, variationSeed: 1 }),
  );

  assert.deepEqual(
    [0, 1, 2].map((stage) => tpsComboMoveForRoute("FAR", stage, kairo)),
    ["kick", "lowKick", "risingKick"],
  );
  assert.deepEqual(
    [0, 1, 2].map((stage) => tpsComboMoveForRoute("FLANK", stage, kairo)),
    ["backfist", "bodyBlow", "power"],
  );
  assert.deepEqual(
    [0, 1, 2].map((stage) => tpsComboMoveForRoute("PERFECT", stage, sera)),
    ["counter", "straight", "risingKick"],
  );
});

test("TPS authored combo links wait for recovery settle and branch inside cancelWindow", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const jab = kairo.moves.jab;
  const power = kairo.moves.power;
  const jabWindow = tpsComboLinkWindow(jab);
  const powerWindow = tpsComboLinkWindow(power);

  assert.ok(jabWindow.queueStart < jabWindow.linkStart);
  assert.ok(jabWindow.linkStart > jab.startup + jab.active);
  assert.ok(jabWindow.linkEnd < jab.startup + jab.active + jab.recovery);
  assert.ok(jabWindow.linkEnd - jabWindow.linkStart + 1 <= jab.cancelWindow);
  assert.ok(powerWindow.linkStart > power.startup + power.active);

  assert.equal(chooseTpsComboContinuationRoute({
    currentRoute: "CLOSE_A", distance: 1.2, forward: false, back: false, side: true,
  }), "CLOSE_B");
  assert.equal(chooseTpsComboContinuationRoute({
    currentRoute: "CLOSE_B", distance: 1.2, forward: true, back: false, side: false,
  }), "CLOSE_A");
  assert.equal(chooseTpsComboContinuationRoute({
    currentRoute: "CLOSE_A", distance: 2.0, forward: true, back: false, side: false,
  }), "FAR");
  assert.equal(chooseTpsComboContinuationRoute({
    currentRoute: "PERFECT", distance: 2.0, forward: false, back: true, side: false,
  }), "PERFECT");
});

test("left/right contact assignments make adjacent punches visibly alternate limbs", () => {
  for (const fighter of Object.values(FIGHTER_DEFINITIONS)) {
    assert.equal(fighter.moves.jab.visualContact, "LEFT_FIST");
    assert.equal(fighter.moves.straight.visualContact, "RIGHT_FIST");
    assert.notEqual(fighter.moves.jab.visualContact, fighter.moves.straight.visualContact);
  }
});
