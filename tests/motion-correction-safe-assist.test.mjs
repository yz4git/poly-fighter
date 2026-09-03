import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Blender Motion Foundry attacks preserve authored silhouettes when correction is ON", async () => {
  const presentation = await readFile(new URL("../src/game/presentation-animation.ts", import.meta.url), "utf8");
  const quaternius = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  for (const move of ["jab", "straight", "bodyBlow", "backfist", "power", "kick", "lowKick", "risingKick", "dashKick"]) {
    assert.match(presentation, new RegExp(`\"${move}\"`));
    assert.match(quaternius, new RegExp(`\"${move}\"`));
  }
  assert.match(presentation, /AUTHORED_ATTACK_PRESERVE/);
  assert.match(quaternius, /AUTHORED_CONTACT_PRESERVE/);
  assert.match(quaternius, /BLENDER_AUTHORED_CONTACT_SAFE_MOVES\.has\(move\.id\)/);
});

test("ready-pose assists stay compact instead of reaching into the opponent", async () => {
  const source = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  assert.match(source, /IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 0\.82/);
  assert.match(source, /IMPORTED_GUARD_FORWARD_CLEARANCE = 1\.16/);
  assert.match(source, /IMPORTED_NEUTRAL_HAND_LIFT = -0\.055/);
  assert.match(source, /pose\.target, pose\.pole, 0\.08/);
  assert.match(source, /pose\.target, pose\.pole, 0\.12/);
});
