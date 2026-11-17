import assert from "node:assert/strict";
import test from "node:test";
import { TPS_HERO_LIGHTING_PROFILE } from "../src/game/tps-scene-setup";

test("readable PBR warm key/cool rim uses no additional mobile shader lights", () => {
  const lighting = TPS_HERO_LIGHTING_PROFILE;
  assert.equal(lighting.directLights, 2);
  assert.ok(lighting.hemiIntensity > 1.5 && lighting.hemiIntensity < 2.35);
  assert.ok(lighting.keyIntensity > 2.6 && lighting.keyIntensity < 3.8);
  assert.ok(lighting.rimIntensity > 2.2 && lighting.rimIntensity < 2.8);
  assert.notEqual(lighting.keyColor, lighting.rimColor);
  assert.notEqual(lighting.sky, lighting.ground);
});
