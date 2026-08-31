import assert from "node:assert/strict";
import test from "node:test";
import { TPS_GRAPHICS_PROFILE, TPS_IMPACT_FEEL_PROFILE, tpsImpactTier } from "../src/game/tps-graphics";

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
  assert.ok(TPS_IMPACT_FEEL_PROFILE.maxImpactWaves <= TPS_GRAPHICS_PROFILE.impactWavePool);
  assert.ok(TPS_IMPACT_FEEL_PROFILE.heavyExposurePunch <= 0.16);
  assert.equal(tpsImpactTier("jab", 1), 1);
  assert.equal(tpsImpactTier("straight", 1.2), 2);
  assert.equal(tpsImpactTier("power", 1.7), 3);
  assert.equal(tpsImpactTier("risingKick", 1.35), 3);
  assert.equal(tpsImpactTier("dashKick", 1.4), 3);
});
