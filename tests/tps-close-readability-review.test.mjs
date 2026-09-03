import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS close combat orbits around the pair instead of hiding the target behind P1", async () => {
  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");
  assert.match(source, /TPS_CAMERA_CLOSE_ANCHOR_BLEND = 0\.88/);
  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_MIDPOINT_BLEND = 0\.42/);
  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3\.50/);
  assert.match(source, /cameraPairMidpoint\.copy\(this\.p1\.position\)\.lerp\(this\.p2\.position, 0\.5\)/);
  assert.match(source, /cameraDesired\.copy\(this\.cameraAnchor\)/);
  assert.match(source, /lockLift = inStrikeRange \? 0\.62 : 0\.46/);
});

test("TPS close combat keeps impact rings off the shared torso silhouette", async () => {
  const source = await readFile(new URL("../src/game/tps-graphics.ts", import.meta.url), "utf8");
  assert.match(source, /addScaledVector\(facing, 0\.12\)/);
  assert.match(source, /addScaledVector\(cameraRight, contactSide \* 0\.12\)/);
  assert.match(source, /lastImpactVisualSideOffset/);
});
