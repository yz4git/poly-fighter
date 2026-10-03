import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS enemy policy isolates telegraph and adaptive decision rules", async () => {
  const source = await readFile(new URL("../src/game/tps-enemy-policy.ts", import.meta.url), "utf8");

  assert.match(source, /TPS_REACTABLE_TELEGRAPH_TICKS/);
  assert.match(source, /EASY: 22/);
  assert.match(source, /NORMAL: 18/);
  assert.match(source, /HARD: 15/);
  assert.match(source, /TPS_REACTIVE_STEP_WINDOW_TICKS/);
  assert.match(source, /export function minimumTpsEnemyTelegraphTicks/);
  assert.match(source, /export function tpsEnemyReactionWindowTicks/);
  assert.match(source, /export function tpsCpuAttackMove/);
  assert.match(source, /export function adaptTpsCpuDecision/);
  assert.match(source, /adapt-hunt-intercept-feint/);
  assert.match(source, /adapt-anti-step-counter/);
  assert.match(source, /adapt-cut-retreat-lane/);
});
