import assert from "node:assert/strict";
import test from "node:test";
import { motionCorrectionsEnabled, setMotionCorrectionsEnabled } from "../src/game/motion-correction-state";

test("motion corrections default OFF and can be toggled", () => {
  assert.equal(motionCorrectionsEnabled(), false);
  setMotionCorrectionsEnabled(true);
  assert.equal(motionCorrectionsEnabled(), true);
  setMotionCorrectionsEnabled(false);
  assert.equal(motionCorrectionsEnabled(), false);
});
