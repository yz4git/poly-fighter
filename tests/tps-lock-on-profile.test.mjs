import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS lock-on profile owns cue colour, pulse, lift, and floor opacity", async () => {
  const source = await readFile(new URL("../src/game/tps-lock-on-profile.ts", import.meta.url), "utf8");

  assert.match(source, /export function computeTpsLockOnProfile/);
  assert.match(source, /input\.inStrikeRange \? 0\.62 : 0\.46/);
  assert.match(source, /0x6dffb8/);
  assert.match(source, /0xff506f/);
  assert.match(source, /pulseRate = input\.threat \? 14\.0/);
  assert.match(source, /baseGroundOpacity/);
  assert.match(source, /clamp01\(input\.contactReadability\) \* 0\.46/);
});
