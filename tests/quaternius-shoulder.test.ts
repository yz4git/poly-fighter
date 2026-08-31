import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/game/visual-quaternius-runtime.ts", "utf8");

test("imported arm swing is shared through the clavicle", () => {
  assert.match(source, /function solveImportedArm\(/);
  assert.ok(source.includes("clavicle_"));
  assert.ok(source.includes("MAX_IMPORTED_CLAVICLE_SWING"));
  assert.ok(source.includes("solveImportedArm(runtime, chain.suffix"));
});

test("neutral and guard elbow poles stay outside the torso", () => {
  assert.ok(source.includes("chain.poleSide * 0.60"));
  assert.ok(source.includes("chain.poleSide * 0.66"));
});


test("neutral ready pose keeps an elbow bend", () => {
  assert.ok(source.includes("MAX_IMPORTED_NEUTRAL_REACH = 0.76"));
  assert.ok(source.includes("clampImportedArmTarget(root, mid, end, rawTarget, MAX_IMPORTED_NEUTRAL_REACH)"));
  assert.ok(source.includes("solveImportedArm(runtime, chain.suffix, root, mid, end, target, pole, 0.28)"));
});
