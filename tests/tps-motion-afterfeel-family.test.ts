import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { expandMoveSet } from "../src/game/move-expansion";
import { tpsMotionAfterfeelKind } from "../src/game/motion-reaction";

const original = FIGHTER_DEFINITIONS.red.moves;
const expanded = expandMoveSet(original);

test("variant hit and attack recovery preserve the same heavy/sweep/kick motion identity", () => {
  for (const [base, expected] of [
    ["power", "HEAVY"],
    ["backfist", "SWEEP"],
    ["counter", "SWEEP"],
    ["lowKick", "KICK"],
    ["risingKick", "KICK"],
    ["jab", "PUNCH"],
    ["straight", "PUNCH"],
  ] as const) {
    assert.equal(tpsMotionAfterfeelKind(original[base]), expected, base);
    for (const variant of ["Snap", "Drive", "Pivot", "Crush"]) {
      const move = expanded[`${base}${variant}`];
      assert.ok(move, `missing ${base}${variant}`);
      assert.equal(move.motionBase, base);
      assert.equal(tpsMotionAfterfeelKind(move), expected,
        `${base}${variant} must retain the original silhouette and authored afterfeel`);
    }
  }
});

test("cinematic techniques keep their silhouette identity and do not fall back to a jab tail", () => {
  assert.equal(tpsMotionAfterfeelKind({ id: "skyBreaker", cinematicRole: "skyBreaker" }), "HEAVY");
  assert.equal(tpsMotionAfterfeelKind({ id: "airPivot", cinematicRole: "airPivot" }), "SWEEP");
  assert.equal(tpsMotionAfterfeelKind({ id: "cycloneSweep", cinematicRole: "cycloneSweep" }), "SWEEP");
  assert.equal(tpsMotionAfterfeelKind({ id: "meteorSlam", cinematicRole: "meteorSlam" }), "HEAVY");
  assert.equal(tpsMotionAfterfeelKind({ id: "futureTechnique", motionBase: "power" }), "HEAVY");
  assert.equal(tpsMotionAfterfeelKind(undefined), "PUNCH");
});
