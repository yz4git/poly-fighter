import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS, MOVE_ORDER } from "../src/game/definitions";
import {
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

test("every move has a distinct usable clip and reaction mapping", () => {

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
