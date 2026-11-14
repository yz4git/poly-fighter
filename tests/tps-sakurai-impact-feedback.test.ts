import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { expandMoveSet } from "../src/game/move-expansion";
import {
  TPS_HYPE_PROFILE,
  tpsHypeImpactTier,
  tpsHypeImpactTierForMove,
  tpsHypeHitStopForTier,
  tpsHypeKnockbackScaleForTier,
} from "../src/game/tps-hype";
import { cinematicImpactStyle } from "../src/game/tps-cinematic-impact-spectacle";

test("authored move families preserve readable impact on weaker/renamed variations", () => {
  assert.equal(tpsHypeImpactTier("power-SNAP", 1.02), 1, "raw variant id has no family semantics");
  assert.equal(tpsHypeImpactTierForMove({ id: "power-SNAP", motionBase: "power", power: 1.02 }), 3);
  assert.equal(tpsHypeImpactTierForMove({ id: "risingKick-PIVOT", motionBase: "risingKick", power: 1.12 }), 3);
  assert.equal(tpsHypeImpactTierForMove({ id: "jab-SNAP", motionBase: "jab", power: 0.90 }), 1);
  assert.equal(tpsHypeImpactTierForMove({ id: "bodyBlow-PIVOT", motionBase: "bodyBlow", power: 1.00 }), 2);
  assert.equal(tpsHypeImpactTierForMove({ id: "unknown", power: 1.00, cinematicRole: "skyBreaker" }), 3);
  assert.equal(tpsHypeImpactTierForMove({ id: "unknown", power: 1.00 }), 1);
  assert.equal(tpsHypeImpactTierForMove({ id: "unknown", power: 1.35 }), 2);
});

test("blocking communicates impact weight without inheriting full clean-hit pause", () => {
  const blockedStops = [1, 2, 3].map((tier) => tpsHypeHitStopForTier(tier as 1 | 2 | 3, true));
  const hitStops = [1, 2, 3].map((tier) => tpsHypeHitStopForTier(tier as 1 | 2 | 3, false));
  assert.deepEqual(blockedStops, [1, 2, 3]);
  assert.deepEqual(hitStops, [
    TPS_HYPE_PROFILE.lightSharedHitStopTicks,
    TPS_HYPE_PROFILE.mediumSharedHitStopTicks,
    TPS_HYPE_PROFILE.heavySharedHitStopTicks,
  ]);
  assert.ok(blockedStops.every((stop, index) => stop < hitStops[index]));
});

test("guard spark scales modestly by threat and never obscures both fighters", () => {
  const guards = ([1, 2, 3] as const).map((tier) =>
    cinematicImpactStyle(tier, true, true, true, 6, true));
  assert.deepEqual(guards.map((s) => s.shards), [1, 1, 1]);
  assert.deepEqual(guards.map((s) => s.groundWaves), [0, 0, 0]);
  assert.ok(guards[0].scale < guards[1].scale && guards[1].scale < guards[2].scale);
  assert.ok(guards[0].opacity < guards[1].opacity && guards[1].opacity < guards[2].opacity);
  assert.ok(guards[2].opacity < 0.20);
  assert.ok(guards[2].duration <= 0.14);
  const unblocked = cinematicImpactStyle(3, false, false, false, 1, false);
  assert.ok(unblocked.scale > guards[2].scale);
  assert.ok(unblocked.opacity > guards[2].opacity);
});

test("family-aware hit feedback does not change physics for fast derived attacks", () => {
  const moves = expandMoveSet(FIGHTER_DEFINITIONS.red.moves);
  // BACKFIST SNAP has light numerical power despite inheriting the heavy
  // spinning-family animation; POWER SNAP itself is still tier 3 numerically.
  const backfistSnap = moves.backfistSnap;
  assert.ok(backfistSnap, "actual BACKFIST SNAP exists");
  const visualTier = tpsHypeImpactTierForMove(backfistSnap);
  const originalPhysicsTier = tpsHypeImpactTier(backfistSnap.id, backfistSnap.power);
  assert.equal(visualTier, 3, "backfist silhouette remains heavy");
  assert.notEqual(originalPhysicsTier, visualTier, "fast variant retains lighter physical impact");
  assert.ok(tpsHypeKnockbackScaleForTier(originalPhysicsTier) <
    tpsHypeKnockbackScaleForTier(visualTier), "accidentally sharing tiers changes real knockback");
  const core = readFileSync(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(core, /const physicsTier = tpsHypeImpactTier\(move\.id, move\.power\);/,
    "combat simulation must keep the original impact classifier");
  assert.match(core, /tpsHypeKnockbackScaleForTier\(physicsTier\)/,
    "knockback uses only the old physical tier, not the new visual tier");
  assert.match(core, /physicsTier === 3 && defender\.state/,
    "heavy vertical knockdown threshold also retains its former physics tier");
});
