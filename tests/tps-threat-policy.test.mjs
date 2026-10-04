import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS enemy threat policy owns late-windup and active-attack reach", async () => {
  const source = await readFile(new URL("../src/game/tps-threat-policy.ts", import.meta.url), "utf8");

  assert.match(source, /export function computeTpsEnemyThreat/);
  assert.match(source, /pendingThreatReach/);
  assert.match(source, /lateWindup/);
  assert.match(source, /dashKick" \? 1\.8 : 0\.9/);
  assert.match(source, /activeMoveTick/);
  assert.match(source, /activeMove\.reach \+ 0\.9/);
});
