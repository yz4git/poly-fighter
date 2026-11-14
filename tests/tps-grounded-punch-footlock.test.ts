import assert from "node:assert/strict";
import test from "node:test";
import { tpsGroundedPunchFootlockWeight } from "../src/game/tps-grounded-punch-footlock";

test("close punches keep grounded feet planted through the authored contact beat", () => {
  for (const family of ["jab", "straight", "bodyBlow"]) {
    for (const tick of [0, 2, 5, 6, 7]) {
      assert.equal(tpsGroundedPunchFootlockWeight(family, tick, 5, 2, 9, true), 1,
        `${family} tick ${tick}: stay planted through the last active tick`);
    }
    assert.ok(tpsGroundedPunchFootlockWeight(family, 10, 5, 2, 9, true) < 1);
    assert.equal(tpsGroundedPunchFootlockWeight(family, 16, 5, 2, 9, true), 0,
      "release by the authored recovery end");
  }
});

test("foot IK never attaches to kicks, throws, air strikes or combo transitions", () => {
  for (const family of [null, "kick", "lowKick", "risingKick", "dashKick", "power",
    "backfist", "throw", "rangeComet"]) {
    assert.equal(tpsGroundedPunchFootlockWeight(family, 0, 8, 2, 9, true), 0,
      String(family) + " does not get a special planted-punch foot solve");
  }
  assert.equal(tpsGroundedPunchFootlockWeight("jab", 0, 5, 2, 10, false), 0,
    "a jab launched from an ongoing combo must not anchor to an old neutral position");
});

test("recovery-foot release remains finite, smooth and monotonic", () => {
  for (const recovery of [2, 4, 8, 14]) {
    const start = 5 + 3;
    const weights = Array.from({ length: 15 }, (_, i) =>
      tpsGroundedPunchFootlockWeight("jab", start + i, 5, 3, recovery, true));
    assert.equal(weights[0], 1);
    assert.ok(weights.every((v) => v >= 0 && v <= 1 && Number.isFinite(v)));
    assert.ok(weights.every((v, i) => i === 0 || v <= weights[i - 1] + 1e-12),
      "there must be no second kick or rebound from foot lock release");
    assert.equal(weights.at(-1), 0);
  }
});

test("invalid gameplay-tick values cannot apply a persistent foot IK correction", () => {
  for (const tick of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(tpsGroundedPunchFootlockWeight("jab", tick, 5, 3, 10, true), 0);
  }
});
