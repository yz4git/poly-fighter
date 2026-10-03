import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS player policy owns directional movement and reactive step math", async () => {
  const source = await readFile(new URL("../src/game/tps-player-policy.ts", import.meta.url), "utf8");

  assert.match(source, /TPS_CLOSE_ORBIT_SPEED_SCALE = 0\.65/);
  assert.match(source, /export function tpsInputAxes/);
  assert.match(source, /export function planTpsStep/);
  assert.match(source, /directionalStepBonus/);
  assert.match(source, /export function tpsCloseLocomotionSpeedScale/);
  assert.match(source, /const reactiveSideStep = Boolean/);
  assert.match(source, /incomingDistance <= incomingThreatReach/);
  assert.match(source, /export function tpsLegacyThrowPressed/);
});
