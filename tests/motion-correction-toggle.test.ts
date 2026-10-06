import assert from "node:assert/strict";
import test from "node:test";
import { SettingsManager } from "../src/game/settings";
import { motionCorrectionsEnabled } from "../src/game/motion-correction-state";

test("settings default to corrections OFF and apply changes to runtime", () => {
  const settings = new SettingsManager();
  assert.equal(settings.get().motionCorrections, false);
  assert.equal(motionCorrectionsEnabled(), false);
  settings.update({ motionCorrections: true });
  assert.equal(motionCorrectionsEnabled(), true);
  settings.update({ motionCorrections: false });
  assert.equal(motionCorrectionsEnabled(), false);
});
