import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { motionDnaForFighter, motionSpecForMove } from "../src/game/motion-profile";

test("Motion DNA keeps KAIRO mass and SERA agility visibly separated", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;
  const power = motionDnaForFighter(kairo);
  const speed = motionDnaForFighter(sera);

  assert.equal(power.id, "KAIRO_POWER");
  assert.equal(speed.id, "SERA_SPEED");
  assert.ok(power.hipLead >= 1.25, `KAIRO hip lead too soft: ${power.hipLead}`);
  assert.ok(power.chestFollow >= 1.15, `KAIRO chest follow too soft: ${power.chestFollow}`);
  assert.ok(power.recoil >= 1.2, `KAIRO recoil too light: ${power.recoil}`);
  assert.ok(power.lateral <= 0.75, `KAIRO should stay planted: ${power.lateral}`);

  assert.ok(speed.lateral >= 1.3, `SERA lateral DNA too restrained: ${speed.lateral}`);
  assert.ok(speed.recoil <= 0.75, `SERA recovery should be elastic: ${speed.recoil}`);
  assert.ok(speed.hipLead < power.hipLead);
  assert.ok(speed.chestFollow < power.chestFollow);
  assert.ok(speed.lateral > power.lateral * 1.7);
});

test("Backfist, body blow and counter retain distinct contact silhouettes", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const backfist = motionSpecForMove(kairo.moves.backfist);
  const bodyBlow = motionSpecForMove(kairo.moves.bodyBlow);
  const counter = motionSpecForMove(kairo.moves.counter);

  assert.equal(backfist.style, "HOOK");
  assert.equal(bodyBlow.style, "BODY_BLOW");
  assert.equal(counter.style, "COUNTER");
  assert.ok(backfist.contactBlend >= 0.36, `backfist arc target is too weak: ${backfist.contactBlend}`);
  assert.ok(bodyBlow.contactBlend >= 0.5, `body blow low-line target is too weak: ${bodyBlow.contactBlend}`);
  assert.ok(counter.contactBlend >= 0.4, `counter head-line target is too weak: ${counter.contactBlend}`);
  assert.ok(bodyBlow.contactBlend > backfist.contactBlend);
});

test("SERA keeps a real frame-speed advantage on the readability-critical punches", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;

  for (const moveId of ["backfist", "bodyBlow", "counter"] as const) {
    const kairoMove = kairo.moves[moveId];
    const seraMove = sera.moves[moveId];
    assert.ok(seraMove.startup < kairoMove.startup, `${moveId} startup lost SERA speed identity`);
    assert.ok(seraMove.recovery < kairoMove.recovery, `${moveId} recovery lost SERA speed identity`);
  }
});
