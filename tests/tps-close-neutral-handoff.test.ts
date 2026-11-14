import assert from "node:assert/strict";
import test from "node:test";
import { tpsCloseNeutralPunchCarry } from "../src/game/tps-close-neutral-lane";
import { tpsClosePunchFamily, tpsClosePunchProfile } from "../src/game/tps-close-punch-lane";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { expandMoveSet } from "../src/game/move-expansion";

test("close jab and cross retain their existing stance lane until their own punch lane takes over", () => {
  for (const moveId of ["jab", "straight", "bodyBlow"]) {
    const values = Array.from({ length: 7 }, (_, tick) =>
      tpsCloseNeutralPunchCarry(moveId, tick, 6, true));
    assert.equal(values[0], 1, moveId + ": no startup teleport");
    assert.equal(values.at(-1), 0, moveId + ": neutral lane is fully released at contact");
    assert.ok(values[1] > 0.8, moveId + ": early windup preserves stance position");
    assert.ok(values[3] > 0.35 && values[3] < 0.65, moveId + ": smooth middle handoff");
    assert.ok(values.every((x, i) => i === 0 || x <= values[i - 1]),
      moveId + ": released steadily without a second lateral bounce");
  }
});

test("combo starts and unrelated kicks do not introduce a new neutral lane", () => {
  assert.equal(tpsCloseNeutralPunchCarry("jab", 0, 5, false), 0,
    "no earlier neutral lane means no fresh offset during a combo");
  for (const moveId of ["kick", "lowKick", "risingKick", "power", "throw"]) {
    assert.equal(tpsCloseNeutralPunchCarry(moveId, 0, 8, true), 0, moveId);
  }
  assert.equal(tpsCloseNeutralPunchCarry("jab", 0, 0, true), 0,
    "moves with no startup cannot take a neutral handoff");
  assert.equal(tpsCloseNeutralPunchCarry("jab", 100, 5, true), 0,
    "past contact the neutral lane cannot reappear");
});

test("render-only stance-to-punch lanes do not add an overshoot at short distance", () => {
  const stanceLane = 0.062;
  const punchLane = 0.050;
  const inPunch = (tick: number) => {
    const u = Math.max(0, Math.min(1, (tick - 1) / 5));
    return u * u * (3 - 2 * u);
  };
  const samples = Array.from({ length: 6 }, (_, tick) =>
    stanceLane * tpsCloseNeutralPunchCarry("jab", tick, 5, true)
      + punchLane * inPunch(tick));
  assert.equal(samples[0], stanceLane, "new punch begins from the same visible neutral location");
  assert.ok(samples.every((x) => x >= 0 && x <= stanceLane + 1e-8),
    "no double-applied sideways launch while lanes overlap");
  assert.ok(Math.max(...samples.slice(1).map((x, i) => Math.abs(x - samples[i]))) < stanceLane * 0.35,
    "camera-facing model moves in small, bounded increments instead of one full-lane snap");
});

test("all generated jab/cross/body-blow variants receive the same authored attack lane", () => {
  const moves = expandMoveSet(FIGHTER_DEFINITIONS.red.moves);
  for (const base of ["jab", "straight", "bodyBlow"]) {
    assert.equal(tpsClosePunchFamily(moves[base]), base);
    const expected = tpsClosePunchProfile(base);
    for (const variant of ["Snap", "Drive", "Pivot", "Crush"]) {
      const move = moves[`${base}${variant}`];
      assert.ok(move, `${base}/${variant} exists`);
      assert.equal(tpsClosePunchFamily(move), base, move.id);
      assert.deepEqual(tpsClosePunchProfile(tpsClosePunchFamily(move)!), expected);
      assert.equal(tpsCloseNeutralPunchCarry(move.motionBase!, 0, move.startup, true), 1,
        move.id + " preserves stance-to-attack lane continuity");
    }
  }
  for (const base of ["kick", "risingKick", "power", "throw"]) {
    assert.equal(tpsClosePunchFamily(moves[base]), null, base + " remains outside punch lane");
  }
  assert.equal(tpsClosePunchFamily(null), null);
});
