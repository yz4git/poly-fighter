import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS gameplay profile owns deterministic combat tuning", async () => {
  const source = await readFile(new URL("../src/game/tps-gameplay-profile.ts", import.meta.url), "utf8");

  assert.match(source, /FIXED_STEP = 1 \/ 60/);
  assert.match(source, /ROUND_TICKS = 99 \* 60/);
  assert.match(source, /TPS_STRIKE_RANGE = 2\.12/);
  assert.match(source, /TPS_STEP_TICKS = 9/);
  assert.match(source, /TPS_STEP_COOLDOWN_TICKS = 18/);
  assert.match(source, /TPS_COMBO_GRACE_TICKS = 34/);
  assert.match(source, /TPS_FLANK_WINDOW_TICKS = 30/);
  assert.match(source, /TPS_FINISHER_BEAT_TICKS = 72/);
});
