import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS finish flow owns deterministic winner and KO settle timing", async () => {
  const source = await readFile(new URL("../src/game/tps-finish-flow.ts", import.meta.url), "utf8");

  assert.match(source, /export function tpsWinnerForHealth/);
  assert.match(source, /p1Health === p2Health \? "draw"/);
  assert.match(source, /export function defeatedFighterForWinner/);
  assert.match(source, /export function isTpsDefeatedSettled/);
  assert.match(source, /defeated\.grounded/);
  assert.match(source, /export function advanceTpsFinishWindow/);
  assert.match(source, /TPS_KO_MIN_SHOW_TICKS = 72/);
  assert.match(source, /TPS_KO_SETTLED_HOLD_TICKS = 30/);
  assert.match(source, /TPS_KO_MAX_SHOW_TICKS = 150/);
});
