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

test("Motion Readability v2 maps every authored move to explicit motion and reaction data", () => {
  assert.equal(MOTION_EXPANSION_PROFILE.version, "MOTION_READABILITY_V2");
  assert.equal(MOTION_EXPANSION_PROFILE.uniqueMoveMappings, 11);
  assert.equal(MOTION_EXPANSION_PROFILE.secondaryLibraryClips, 20);
  assert.ok(MOTION_EXPANSION_PROFILE.reactionKinds >= 9);
  assert.equal(MOTION_EXPANSION_PROFILE.guardBreakClip, "Idle_Shield_Break");
  assert.equal(MOTION_EXPANSION_PROFILE.wakeupClip, "LayToIdle");

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

  assert.equal(jab.clip, "Punch_Jab");
  assert.equal(backfist.clip, "Melee_Hook");
  assert.equal(backfist.recoveryClip, "Melee_Hook_Rec");
  assert.equal(body.clip, "Shield_OneShot");
  assert.equal(power.clip, "Sword_Regular_C");
  assert.notEqual(body.clip, backfist.clip);
  assert.notEqual(power.clip, backfist.clip);
  assert.equal(kick.recoveryClip, "NinjaJump_Land");
  assert.equal(low.recoveryClip, "Slide_Exit");
  assert.equal(rising.recoveryClip, "NinjaJump_Land");
  assert.notEqual(dash.clip, "Roll");
  assert.ok(dash.contactBlend >= 0.85);
});

test("motion runtime preloads in neutral and biases imported strikes toward the opponent instead of the old procedural contact pose", async () => {
  const source = await readFile(new URL("../src/game/motion-expansion-runtime.ts", import.meta.url), "utf8");
  const presentation = await readFile(new URL("../src/game/presentation-animation.ts", import.meta.url), "utf8");

  assert.match(source, /const runtime = ensureRuntime\(fighter\);\s*if \(!EXPANDED_STATES\.has\(fighter\.state\)\) return false;/);
  assert.match(source, /strikeTrajectory\(runtime, fighter, opponent\)/);
  assert.match(source, /motionExpansionContactMode = "OPPONENT_WEIGHTED_IK"/);
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
