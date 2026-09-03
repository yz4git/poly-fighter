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

test("motion readability audit samples authored strikes by contact type without legacy IK exaggeration", async () => {
  const source = await readFile(new URL("../scripts/capture-motion-readability-audit.mjs", import.meta.url), "utf8");
  assert.match(source, /const authoredContactTick = move\.startup \+ move\.active - 1/);
  assert.match(source, /const footContact = move\.visualContact === 'LEFT_FOOT' \|\| move\.visualContact === 'RIGHT_FOOT'/);
  assert.match(source, /game\.p1\.isActive\(\) && \(!footContact \|\| game\.p1\.moveTick >= authoredContactTick\)/);
  assert.match(source, /const minimumLowKickDrop = 0\.04/);
  assert.match(source, /lowY < kickY - minimumLowKickDrop/);
  assert.match(source, /risingY > kickY \+ 0\.08/);
});

test("V10 visual audit accepts compact guard assistance while preserving strong punch and kick floors", async () => {
  const source = await readFile(new URL("../scripts/capture-v10-visual-audit.mjs", import.meta.url), "utf8");
  assert.match(source, /metrics\.guardFistWorld < 0\.18 \|\| metrics\.guardFistScreen < 12/);
  assert.match(source, /GUARD: \{ meanAbs: 0\.75, changedFraction: 0\.012 \}/);
  assert.match(source, /PUNCH: \{ meanAbs: 2\.5, changedFraction: 0\.035 \}/);
  assert.match(source, /KICK: \{ meanAbs: 2\.5, changedFraction: 0\.035 \}/);
});
