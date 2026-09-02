import assert from "node:assert/strict";
import test from "node:test";
import { TPS_GRAPHICS_PROFILE, TPS_IMPACT_FEEL_PROFILE, tpsImpactTier } from "../src/game/tps-graphics";
import {
  TPS_HYPE_PROFILE,
  tpsHypeHitStopForTier,
  tpsHypeImpactTier,
  tpsHypeKnockbackScaleForTier,
} from "../src/game/tps-hype";

test("TPS graphics profile keeps the quality pass lightweight and pooled", () => {
  assert.equal(TPS_GRAPHICS_PROFILE.contactShadows, true);
  assert.equal(TPS_GRAPHICS_PROFILE.localRimLights, 2);
  assert.equal(TPS_GRAPHICS_PROFILE.impactWavePool, 8);
  assert.equal(TPS_GRAPHICS_PROFILE.attackTrailPool, 6);
  assert.equal(TPS_GRAPHICS_PROFILE.quickstepGhostPool, 4);
  assert.equal(TPS_GRAPHICS_PROFILE.skylineMonoliths, 8);
  assert.equal(TPS_GRAPHICS_PROFILE.floorAccentArcs, 12);
  assert.equal(TPS_GRAPHICS_PROFILE.toneMapping, "ACESFilmic");
  assert.ok(TPS_GRAPHICS_PROFILE.lowAtmospherePoints < TPS_GRAPHICS_PROFILE.highAtmospherePoints);
  assert.ok(TPS_GRAPHICS_PROFILE.highAtmospherePoints <= 128);
});

test("TPS impact feel escalates from quick hits to finishers without unbounded effects", () => {
  assert.equal(TPS_IMPACT_FEEL_PROFILE.sharedAttackerHitStop, true);
  assert.equal(TPS_IMPACT_FEEL_PROFILE.lightHitStopTicks, 2);
  assert.equal(TPS_IMPACT_FEEL_PROFILE.mediumHitStopTicks, 4);
  assert.equal(TPS_IMPACT_FEEL_PROFILE.heavyHitStopTicks, 6);
  assert.equal(TPS_IMPACT_FEEL_PROFILE.maxImpactWaves, 2);
  assert.ok(TPS_IMPACT_FEEL_PROFILE.maxImpactWaves <= TPS_GRAPHICS_PROFILE.impactWavePool);
  assert.ok(TPS_IMPACT_FEEL_PROFILE.heavyExposurePunch <= 0.16);
  assert.equal(tpsImpactTier("jab", 1), 1);
  assert.equal(tpsImpactTier("straight", 1.2), 2);
  assert.equal(tpsImpactTier("power", 1.7), 3);
  assert.equal(tpsImpactTier("risingKick", 1.35), 3);
  assert.equal(tpsImpactTier("dashKick", 1.4), 3);
});

test("TPS exhilaration pass adds fast confirms, cinematic finishers and bounded pooled bursts", () => {
  assert.equal(TPS_HYPE_PROFILE.hitConfirmCancelLagTicks, 3);
  assert.equal(TPS_HYPE_PROFILE.lightSharedHitStopTicks, 3);
  assert.equal(TPS_HYPE_PROFILE.mediumSharedHitStopTicks, 5);
  assert.equal(TPS_HYPE_PROFILE.heavySharedHitStopTicks, 9);
  assert.equal(tpsHypeHitStopForTier(1, false), 3);
  assert.equal(tpsHypeHitStopForTier(2, false), 5);
  assert.equal(tpsHypeHitStopForTier(3, false), 9);
  assert.equal(tpsHypeHitStopForTier(3, true), 1);
  assert.equal(tpsHypeImpactTier("jab", 0.7), 1);
  assert.equal(tpsHypeImpactTier("straight", 1.1), 2);
  assert.equal(tpsHypeImpactTier("power", 2.2), 3);
  assert.ok(tpsHypeKnockbackScaleForTier(3) > tpsHypeKnockbackScaleForTier(2));
  assert.ok(tpsHypeKnockbackScaleForTier(2) > tpsHypeKnockbackScaleForTier(1));
  assert.ok(TPS_HYPE_PROFILE.heavyKnockbackScale <= 1.5);
  assert.ok(TPS_HYPE_PROFILE.maxShockRings <= 12);
  assert.ok(TPS_HYPE_PROFILE.maxBurstSpokes <= 4);
  assert.equal(TPS_HYPE_PROFILE.lightImpactRingCount, 1);
  assert.equal(TPS_HYPE_PROFILE.mediumImpactRingCount, 1);
  assert.equal(TPS_HYPE_PROFILE.heavyImpactRingCount, 2);
  assert.ok(TPS_HYPE_PROFILE.impactRingExpansion <= 1.4);
  assert.ok(TPS_HYPE_PROFILE.heavyBurstScale <= 0.4);
  assert.ok(TPS_HYPE_PROFILE.impactDepthBias >= 0.05);
  assert.ok(TPS_HYPE_PROFILE.heavyImpactFovPunch >= -8.5);
  assert.ok(TPS_HYPE_PROFILE.perfectStepFovRush <= 5);
});
