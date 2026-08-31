import assert from "node:assert/strict";
import test from "node:test";
import { TPS_GRAPHICS_PROFILE } from "../src/game/tps-graphics";

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
