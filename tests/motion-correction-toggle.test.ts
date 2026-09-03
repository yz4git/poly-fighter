import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { motionCorrectionsEnabled, setMotionCorrectionsEnabled } from "../src/game/motion-correction-state";

test("motion corrections default OFF and can be toggled", () => {
  assert.equal(motionCorrectionsEnabled(), false);
  setMotionCorrectionsEnabled(true);
  assert.equal(motionCorrectionsEnabled(), true);
  setMotionCorrectionsEnabled(false);
  assert.equal(motionCorrectionsEnabled(), false);
});

test("settings expose persistent motion correction switch with OFF default", async () => {
  const settings = await readFile(new URL("../src/game/settings.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(settings, /motionCorrections: false/);
  assert.match(settings, /setMotionCorrectionsEnabled\(this\.value\.motionCorrections\)/);
  assert.match(page, /MOTION CORRECTION/);
  assert.match(page, /motionCorrections: !settings\.motionCorrections/);
});

test("raw mode bypasses post-playback arm and body corrections", async () => {
  const presentation = await readFile(new URL("../src/game/presentation-animation.ts", import.meta.url), "utf8");
  const quaternius = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  assert.match(presentation, /if \(correctionsEnabled\) \{[\s\S]*updateMotionExpansionSkin/);
  assert.match(presentation, /else \{[\s\S]*updateQuaterniusModelSkin/);
  assert.match(quaternius, /if \(correctionsEnabled\) \{[\s\S]*neutralPoseCorrection[\s\S]*guardPoseCorrection[\s\S]*attackContactCorrection/);
  assert.match(quaternius, /RAW_CLIP_PLAYBACK/);
});
