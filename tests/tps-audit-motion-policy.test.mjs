import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS visual audit accepts raw and authored-preserve combo playback without Motion Expansion metadata", async () => {
  const source = await readFile(new URL("../scripts/capture-tps-visual-audit.mjs", import.meta.url), "utf8");
  assert.match(source, /correctionPolicy: data\.motionCorrectionPolicy/);
  assert.match(source, /RAW_CLIP_PLAYBACK/);
  assert.match(source, /AUTHORED_ATTACK_PRESERVE/);
  assert.match(source, /comboLinkProbe\.motionMove === null/);
  assert.match(source, /comboLinkProbe\.motionMove === 'backfist'/);
});
