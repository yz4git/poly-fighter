import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIGHTER_DEFINITIONS, MOVE_ORDER } from "../src/game/definitions";
import {
  MOTION_EXPANSION_PROFILE,
  chooseTpsComboRoute,
  motionClipForMove,
  motionSpecForMove,
  reactionKindForMove,
  tpsComboMoveForRoute,
} from "../src/game/motion-profile";

test("Procedural Fight v2 maps every authored move to generated motion and reaction data", () => {
  assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_READABILITY_V2");
  assert.equal(MOTION_EXPANSION_PROFILE.uniqueMoveMappings, 11);
  assert.equal(MOTION_EXPANSION_PROFILE.secondaryLibraryClips, 20);
  assert.equal(MOTION_EXPANSION_PROFILE.proceduralVersion, "PROCEDURAL_FIGHT_V2");
  assert.equal(MOTION_EXPANSION_PROFILE.proceduralLibraryClips, 20);
  assert.ok(MOTION_EXPANSION_PROFILE.reactionKinds >= 9);
  assert.equal(MOTION_EXPANSION_PROFILE.guardBreakClip, "PF_GuardBreak");
  assert.equal(MOTION_EXPANSION_PROFILE.wakeupClip, "PF_Wakeup");
  assert.equal(MOTION_EXPANSION_PROFILE.sideStepLeftClip, "PF_Sidestep_L");
  assert.equal(MOTION_EXPANSION_PROFILE.kickRecoveryClip, "PF_KickRecover");
  assert.equal(MOTION_EXPANSION_PROFILE.heavyRecoveryClip, "PF_HeavyRecover");
  assert.equal(MOTION_EXPANSION_PROFILE.rootMotionPolicy, "ADDITIVE_COM_RETURN_TO_BIND");

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

test("procedural v2 generator artifact contains 20 clips, root motion and deterministic timing metadata", async () => {
  const source = await readFile(new URL("../scripts/generate-procedural-fight-motions-v2.mjs", import.meta.url), "utf8");
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

  assert.match(source, /PROCEDURAL_FIGHT_V2/);
  assert.match(source, /ANTICIPATION/);
  assert.match(source, /PF_GuardBreak/);
  assert.match(source, /PF_Sidestep_L/);
  assert.match(source, /PF_KickRecover/);
  assert.match(source, /sampleCurve/);
  assert.equal(metrics.version, "PROCEDURAL_FIGHT_V2");
  assert.equal(metrics.generatedClipCount, 20);
  assert.equal(metrics.clips.length, 20);
  assert.equal(metrics.rootMotionPolicy, "ADDITIVE_COM_RETURN_TO_BIND");
  assert.equal(metrics.timingPolicy, "ANTICIPATION_DRIVE_IMPACT_OVERTRAVEL_SETTLE");
  for (const required of [
    "PF_Jab_L", "PF_LowKick_L", "PF_DownBack", "PF_GuardBreak",
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
  assert.ok(planarClips >= 12, `only ${planarClips} v2 clips contain planar root motion`);
});

test("v2 readability mappings use generated recovery clips instead of generic library recovery", () => {
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
  assert.equal(kick.recoveryClip, "PF_KickRecover");
  assert.equal(low.recoveryClip, "PF_KickRecover");
  assert.equal(rising.recoveryClip, "PF_KickRecover");
  assert.equal(dash.recoveryClip, "PF_KickRecover");
  assert.ok(dash.contactBlend >= 0.65 && dash.contactBlend <= 0.8);
});

test("motion runtime uses bounded procedural center-of-mass motion and generated guard/evasion states", async () => {
  const source = await readFile(new URL("../src/game/motion-expansion-runtime.ts", import.meta.url), "utf8");
  const presentation = await readFile(new URL("../src/game/presentation-animation.ts", import.meta.url), "utf8");

  assert.match(source, /const runtime = ensureRuntime\(fighter\);\s*if \(!EXPANDED_STATES\.has\(fighter\.state\)\) return false;/);
  assert.match(source, /strikeTrajectory\(runtime, fighter, opponent\)/);
  assert.match(source, /motionExpansionContactMode = "OPPONENT_WEIGHTED_IK"/);
  assert.match(source, /PROCEDURAL_URL/);
  assert.match(source, /PROCEDURAL_FIGHT_V2/);
  assert.match(source, /preserveProceduralPlanarRoot/);
  assert.match(source, /THREE\.MathUtils\.clamp\(track\.values\[offset\] - sourceNode\.position\.x, -0\.09, 0\.09\)/);
  assert.match(source, /PF_GuardBreak/);
  assert.match(source, /PF_Sidestep_L/);
  assert.match(source, /PF_Sidestep_R/);
  assert.match(source, /motionExpansionRootMotionPolicy = "BOUNDED_PROCEDURAL_COM_XZ_PLUS_Y"/);
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

test("left/right contact assignments make adjacent punches visibly alternate limbs", () => {
  for (const fighter of Object.values(FIGHTER_DEFINITIONS)) {
    assert.equal(fighter.moves.jab.visualContact, "LEFT_FIST");
    assert.equal(fighter.moves.straight.visualContact, "RIGHT_FIST");
    assert.notEqual(fighter.moves.jab.visualContact, fighter.moves.straight.visualContact);
  }
});
