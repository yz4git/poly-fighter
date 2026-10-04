import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS visual state owns fighter telemetry and shoulder-view finalization", async () => {
  const source = await readFile(new URL("../src/game/tps-visual-state.ts", import.meta.url), "utf8");

  assert.match(source, /export function prepareTpsFighterVisual/);
  assert.match(source, /combatTps = true/);
  assert.match(source, /tpsFighterDna = fighterDnaId/);
  assert.match(source, /combatMotionForward = forward\.toArray\(\)/);
  assert.match(source, /combatStepDirection/);
  assert.match(source, /export function finalizeTpsFighterVisual/);
  assert.match(source, /fighter\.visual\.aura\.visible = false/);
  assert.match(source, /setFromUnitVectors\(MODEL_FORWARD, forward\)/);
});
