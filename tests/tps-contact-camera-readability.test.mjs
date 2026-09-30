import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS contact camera opens the authored strike silhouette without moving gameplay actors", async () => {
  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");

  assert.match(source, /TPS_CAMERA_CONTACT_BACK_BONUS = 0\.18/);
  assert.match(source, /TPS_CAMERA_CONTACT_SHOULDER_BONUS = 0\.32/);
  assert.match(source, /TPS_CAMERA_KICK_CONTACT_SHOULDER_BONUS = 0\.20/);
  assert.match(source, /TPS_CAMERA_LOW_KICK_TARGET_DROP = 0\.16/);
  assert.match(source, /sampleCombatMotionAtEvent/);
  assert.match(source, /motionEventsAtContact/);
  assert.match(source, /this\.p1\.moveTick/);
  assert.match(source, /authoredContactReadabilityFactor/);
  assert.match(source, /kickContactReadabilityFactor/);
  assert.match(source, /lowKickReadabilityFactor/);
  assert.match(source, /tpsAuthoredContactReadabilityFactor/);
  assert.match(source, /tpsContactReadabilityMove/);
  assert.match(source, /baseGroundOpacity \* \(1 - THREE\.MathUtils\.clamp\(contactReadability, 0, 1\) \* 0\.46\)/);

  // The readability pass is intentionally camera/UI-only: no contact-driven
  // writes to p1/p2 simulation positions are introduced inside updateCamera.
  const cameraStart = source.indexOf("private updateCamera(delta: number)");
  const cameraEnd = source.indexOf("private setCombatBeat", cameraStart);
  const cameraBody = source.slice(cameraStart, cameraEnd);
  assert.doesNotMatch(cameraBody, /this\.p1\.position\.(add|copy|set)/);
  assert.doesNotMatch(cameraBody, /this\.p2\.position\.(add|copy|set)/);
});

test("kick WebGL audit verifies contact opening and low-kick lower-body framing", async () => {
  const audit = await readFile(new URL("../scripts/capture-tps-kick-sequence-audit.mjs", import.meta.url), "utf8");

  assert.match(audit, /cameraContactReadability/);
  assert.match(audit, /cameraShoulderOffset/);
  assert.match(audit, /cameraTargetHeight/);
  assert.match(audit, /targetGroundOpacity/);
  assert.match(audit, /contact\.cameraShoulderOffset > startup\.cameraShoulderOffset \+ 0\.22/);
  assert.match(audit, /results\.lowKick\.contact\.cameraTargetHeight < results\.kick\.contact\.cameraTargetHeight - 0\.08/);
});
