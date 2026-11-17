import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { expandMoveSet } from "../src/game/move-expansion";
import { computeTpsCameraFraming, tpsCameraAttackFamily, TPS_CAMERA_DEFAULT_FOV, TPS_CAMERA_MAX_TRAVEL_SPEED } from "../src/game/tps-camera-profile";

const moves = expandMoveSet(FIGHTER_DEFINITIONS.red.moves);

function framing(moveId: string | null) {
  return computeTpsCameraFraming({
    fightDistance: 1.28,
    aspect: 2.18,
    playerPerfectEvadeTicks: 0,
    playerFlankWindowTicks: 0,
    playerFlankAttackTicks: 0,
    flankWindowTicks: 1,
    playerEvadeSign: 0,
    maxHitStop: 0,
    attackMoveId: moveId,
    authoredContactWeight: 1,
    dramaPhase: "",
    dramaIntensity: 0,
  });
}

test("derived punch and kick families keep their TPS contact silhouette camera composition", () => {
  for (const base of ["jab", "straight", "bodyBlow", "kick", "lowKick", "risingKick"] as const) {
    const expected = framing(base);
    for (const variant of ["Snap", "Drive", "Pivot", "Crush"]) {
      const derived = moves[`${base}${variant}`];
      assert.ok(derived, `${base}/${variant}`);
      assert.equal(tpsCameraAttackFamily(derived), base);
      assert.deepEqual(framing(tpsCameraAttackFamily(derived)), expected,
        `${derived.id} should stage the original strike in a close iPhone view`);
    }
  }
  assert.equal(tpsCameraAttackFamily(null), null);
  assert.equal(tpsCameraAttackFamily(moves.jab), "jab");
});

test("close punch and front-kick camera readability stay within bounded presentation offsets", () => {
  const jab = framing(tpsCameraAttackFamily(moves.jabSnap));
  const kick = framing(tpsCameraAttackFamily(moves.kickPivot));
  const distant = framing(null);
  assert.ok(jab.closePunchDollyFactor > 0 && jab.closePunchDollyFactor <= 0.34);
  assert.ok(kick.kickContactReadabilityFactor > 0);
  assert.ok(kick.frontKickReadabilityFactor > 0);
  assert.equal(distant.closePunchDollyFactor, 0);
  assert.equal(distant.kickContactReadabilityFactor, 0);
});

test("tighter fixed lens keeps close contacts larger without changing camera travel policy", () => {
  assert.equal(TPS_CAMERA_DEFAULT_FOV, 45);
  assert.equal(TPS_CAMERA_MAX_TRAVEL_SPEED, 13.2);
  const close = framing("jab");
  const far = computeTpsCameraFraming({
    fightDistance: 3.6, aspect: 2.18,
    playerPerfectEvadeTicks: 0, playerFlankWindowTicks: 0,
    playerFlankAttackTicks: 0, flankWindowTicks: 1, playerEvadeSign: 0,
    maxHitStop: 0, attackMoveId: null, authoredContactWeight: 0,
    dramaPhase: "", dramaIntensity: 0,
  });
  assert.ok(close.backDistance < far.backDistance);
  assert.ok(close.shoulderOffset > far.shoulderOffset);
  assert.ok(close.closePunchDollyFactor > 0 && close.closePunchDollyFactor <= .34);
  assert.ok(close.targetSideShift > 0);
});
