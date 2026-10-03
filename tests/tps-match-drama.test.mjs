import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS match drama owns phase and intensity policy", async () => {
  const source = await readFile(new URL("../src/game/tps-match-drama.ts", import.meta.url), "utf8");

  assert.match(source, /export type TpsMatchDramaPhase/);
  assert.match(source, /export function computeTpsMatchDrama/);
  assert.match(source, /timerTicks > 93 \* 60/);
  assert.match(source, /healthGap >= 24/);
  assert.match(source, /healthGap >= 34/);
  assert.match(source, /"FINAL STAND"/);
  assert.match(source, /"MOMENTUM SHIFT"/);
  assert.match(source, /0\.96/);
  assert.match(source, /0\.14/);
});
