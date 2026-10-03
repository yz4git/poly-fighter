import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS HUD snapshot builder owns cue and headline policy", async () => {
  const source = await readFile(new URL("../src/game/tps-hud-snapshot.ts", import.meta.url), "utf8");

  assert.match(source, /export function buildTpsHudSnapshot/);
  assert.match(source, /"PUNISH"/);
  assert.match(source, /"WINDUP"/);
  assert.match(source, /"RANGE"/);
  assert.match(source, /"BATTLE COMPLETE"/);
  assert.match(source, /"READ THE TARGET"/);
  assert.match(source, /"STRIKE RANGE"/);
  assert.match(source, /COMBO/);
});
