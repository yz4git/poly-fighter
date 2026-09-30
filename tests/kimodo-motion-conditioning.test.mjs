import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Kimodo-inspired conditioner keeps authored attacks while conditioning root and contacts", async () => {
  const source = await readFile(new URL("../src/game/kimodo-motion-conditioning.ts", import.meta.url), "utf8");
  assert.match(source, /KIMODO_INSPIRED_RUNTIME_V1/);
  assert.match(source, /ROOT_BODY_FOOT_CONTACT/);
  assert.match(source, /moveId === "dashKick"/);
  assert.match(source, /fighter\.state === "ATTACK" \? 0\.55/);
  assert.match(source, /kimodoAuthoredStrikePreserved = fighter\.state === "ATTACK"/);
  assert.match(source, /0\.036 \* scale/);
});

test("Quaternius runtime applies conditioning after synchronized clip sampling", async () => {
  const source = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  const syncIndex = source.indexOf("synchronizeMotion(runtime, fighter);");
  const kimodoIndex = source.indexOf("applyKimodoMotionConditioning({ model: runtime.model, bones: runtime.bones }, fighter, delta);");
  const correctionIndex = source.indexOf("const correctionsEnabled = motionCorrectionsEnabled();", syncIndex);
  assert.ok(syncIndex >= 0);
  assert.ok(kimodoIndex > syncIndex);
  assert.ok(correctionIndex > kimodoIndex);
});
