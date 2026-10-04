import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS player policy owns context attack planning", async () => {
  const source = await readFile(new URL("../src/game/tps-player-policy.ts", import.meta.url), "utf8");

  assert.match(source, /export function planTpsContextAttack/);
  assert.match(source, /playerReversalTicks > 0/);
  assert.match(source, /playerFlankWindowTicks > 0/);
  assert.match(source, /playerInterceptTicks > 0/);
  assert.match(source, /resolveContextAttack/);
  assert.match(source, /nextComboStage: reversalStrike \? 1 : stage \+ 1/);
});
