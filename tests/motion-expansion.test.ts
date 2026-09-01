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

test("Procedural Fight v1 maps every authored move to generated motion and reaction data", () => {
  assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_READABILITY_V2");
  assert.equal(MOTION_EXPANSION_PROFILE.uniqueMoveMappings, 11);
  assert.equal(MOTION_EXPANSION_PROFILE.secondaryLibraryClips, 20);
  assert.equal(MOTION_EXPANSION_PROFILE.proceduralVersion, "PROCEDURAL_FIGHT_V1");
  assert.equal(MOTION_EXPANSION_PROFILE.proceduralLibraryClips, 15);
  assert.ok(MOTION_EXPANSION_PROFILE.reactionKinds >= 9);
  assert.equal(MOTION_EXPANSION_PROFILE.guardBreakClip, "Idle_Shield_Break");
  assert.equal(MOTION_EXPANSION_PROFILE.wakeupClip, "PF_Wakeup");

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

test("procedural generator artifact contains all 15 clips and actually modifies animated UAL bones", async () => {
  const source = await readFile(new URL("../scripts/generate-procedural-fight-motions.mjs", import.meta.url), "utf8");
  const metrics = JSON.parse(
    await readFile(new URL("../public/models/quaternius/procedural-fight-core.metrics.json", import.meta.url), "utf8"),
  ) as {
    version: string;
    generatedClipCount: number;
    clips: string[];
    metrics: Array<{ name: string; modifiedBones: string[]; missingAnimated: string[] }>;
  };

  assert.match(source, /PROCEDURAL_FIGHT_V1/);
  assert.match(source, /PF_RisingKick_R/);
  assert.match(source, /sampleCurve/);
  assert.equal(metrics.version, "PROCEDURAL_FIGHT_V1");
  assert.equal(metrics.generatedClipCount, 15);
  assert.equal(metrics.clips.length, 15);
  assert.ok(metrics.clips.includes("PF_Jab_L"));
  assert.ok(metrics.clips.includes("PF_LowKick_L"));
  assert.ok(metrics.clips.includes("PF_DownBack"));
  for (const entry of metrics.metrics) {
    assert.ok(entry.modifiedBones.length >= 3, `${entry.name} modifies too few bones`);
    assert.deepEqual(entry.missingAnimated, [], `${entry.name} modifier bone is absent from its base clip`);
  }
});

test("readability mappings separate body momentum and strike phases instead of reusing generic hook/roll poses", () => {
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
  assert.equal(backfist.recoveryClip, "Melee_Hook_Rec");
  assert.equal(body.clip, "PF_BodyBlow_L");
  assert.equal(power.clip, "PF_Power_R");
  assert.notEqual(body.clip, backfist.clip);
  assert.notEqual(power.clip, backfist.clip);
  assert.equal(kick.clip, "PF_FrontKick_R");
  assert.equal(low.clip, "PF_LowKick_L");
  assert.equal(rising.clip, "PF_RisingKick_R");
  assert.equal(dash.clip, "PF_DashKick_R");
  assert.equal(kick.recoveryClip, "NinjaJump_Land");
  assert.equal(low.recoveryClip, "Slide_Exit");
  assert.equal(rising.recoveryClip, "NinjaJump_Land");
  assert.notEqual(dash.clip, "Roll");
  assert.ok(dash.contactBlend >= 0.65 && dash.contactBlend <= 0.8);
});

test("motion runtime preloads generated pack and only biases generated strikes toward the opponent", async () => {
  const source = await readFile(new URL("../src/game/motion-expansion-runtime.ts", import.meta.url), "utf8");
  const presentation = await readFile(new URL("../src/game/presentation-animation.ts", import.meta.url), "utf8");

  assert.match(source, /const runtime = ensureRuntime\(fighter\);\s*if \(!EXPANDED_STATES\.has\(fighter\.state\)\) return false;/);
  assert.match(source, /strikeTrajectory\(runtime, fighter, opponent\)/);
  assert.match(source, /motionExpansionContactMode = "OPPONENT_WEIGHTED_IK"/);
  assert.match(source, /PROCEDURAL_URL/);
  assert.match(source, /motionExpansionHasProcedural/);
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
