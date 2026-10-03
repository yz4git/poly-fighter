import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS camera profile owns scalar framing math while game core applies vectors", async () => {
  const [profile, core] = await Promise.all([
    readFile(new URL("../src/game/tps-camera-profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
  ]);

  assert.match(profile, /export function computeTpsCameraFraming/);
  assert.match(profile, /authoredContactWeight \* closeFactor/);
  assert.match(profile, /frontKickReadabilityFactor/);
  assert.match(profile, /desiredShoulderOffset: shoulderOffset \+ flankLaneShift \* 0\.36/);
  assert.match(profile, /cameraPositionRate: THREE\.MathUtils\.lerp\(10\.2, 8\.0, closeFactor\)/);

  assert.match(core, /const framing = computeTpsCameraFraming/);
  assert.match(core, /framing\.targetSideShift/);
  assert.match(core, /framing\.desiredShoulderOffset/);
  assert.match(core, /framing\.cameraPositionRate/);
  assert.doesNotMatch(core, /const backDistance = 4\.70/);
  assert.doesNotMatch(core, /const shoulderOffset = 2\.50/);
});
