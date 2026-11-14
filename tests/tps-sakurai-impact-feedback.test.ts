import assert from "node:assert/strict";
import test from "node:test";
import {
  TPS_HYPE_PROFILE,
  tpsHypeImpactTier,
  tpsHypeImpactTierForMove,
  tpsHypeHitStopForTier,
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
