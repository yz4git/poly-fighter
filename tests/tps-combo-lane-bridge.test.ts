import assert from "node:assert/strict";
import test from "node:test";
import {
  tpsConfirmedComboLaneCarry,
  tpsShouldBridgeConfirmedCombo,
} from "../src/game/tps-combo-lane-bridge";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { tpsComboMoveForRoute } from "../src/game/motion-profile";

test("real clean-hit close-range combo branches are straight and backfist for the red fighter", () => {
  assert.equal(tpsComboMoveForRoute("CLOSE_A", 1, FIGHTER_DEFINITIONS.red), "straight");
  assert.equal(tpsComboMoveForRoute("CLOSE_B", 1, FIGHTER_DEFINITIONS.red), "backfist");
});

test("confirmed combo mesh bridge carries frame zero exactly then releases before ACTIVE contact", () => {
  for (const startup of [3, 5, 7, 9, 14]) {
    const samples = Array.from({ length: startup + 3 }, (_, tick) =>
      tpsConfirmedComboLaneCarry(tick, startup));
    assert.equal(samples[0], 1);
    assert.equal(samples[startup], 0, "the authored fist's ACTIVE pose must remain authoritative");
    assert.ok(samples.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 1
      && (i === 0 || v <= samples[i - 1])), "the model cannot bounce from a secondary lane impulse");
    assert.equal(samples.at(-1), 0);
  }
  for (const invalid of [NaN, Number.POSITIVE_INFINITY, -Infinity]) {
    assert.equal(tpsConfirmedComboLaneCarry(invalid, 8), 0);
  }
  assert.equal(tpsConfirmedComboLaneCarry(0, 0), 0);
});

test("only confirmed same-fighter ATTACK combo links inherit the outgoing punch mesh pose", () => {
  const genuine = {
    lastState: "ATTACK",
    currentState: "ATTACK",
    lastMove: "jab",
    newMove: "straight",
    previousFamily: "jab",
    linkState: "LINKED",
    linkFromMove: "jab",
  };
  assert.equal(tpsShouldBridgeConfirmedCombo(genuine), true);
  assert.equal(tpsShouldBridgeConfirmedCombo({ ...genuine, newMove: "backfist" }), true,
    "a buffered BACK branch keeps the outgoing lead-jab screen position");
  assert.equal(tpsShouldBridgeConfirmedCombo({
    ...genuine, lastMove: "backfist", previousFamily: "backfist",
    newMove: "power", linkFromMove: "backfist",
  }), true, "the BACK backfist follow-up must not teleport into the third hit");
  assert.equal(tpsShouldBridgeConfirmedCombo({
    ...genuine, lastMove: "backfistPivot", previousFamily: "backfist",
    newMove: "power", linkFromMove: "backfistPivot",
  }), true, "all authored backfist variants remain eligible for the same bounded carry");
  assert.equal(tpsShouldBridgeConfirmedCombo({
    ...genuine, lastMove: "jabSnap", linkFromMove: "jabSnap",
  }), true, "authored jab variants keep their own actual IDs");
  for (const caseInput of [
    { linkState: "MISSED" },
    { linkState: "BUFFERED" },
    { linkFromMove: "other" },
    { lastMove: null },
    { newMove: null },
    { lastState: "IDLE" },
    { currentState: "GUARD" },
    { currentState: "HIT" },
    { newMove: "jab" },
    { previousFamily: "kick" },
    { previousFamily: "dashKick" },
    { previousFamily: "throw" },
  ]) {
    assert.equal(tpsShouldBridgeConfirmedCombo({ ...genuine, ...caseInput }), false,
      JSON.stringify(caseInput) + " must not create a cosmetic combo transition");
  }
});
