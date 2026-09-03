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

test("imported neutral and guard hands stay compact with elbows on a lateral shoulder-height plane", () => {
  assert.match(source, /function\s+importedReadyArmPose\s*\(/);
  assert.ok(source.includes("IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 0.58"));
  assert.ok(source.includes("IMPORTED_GUARD_FORWARD_CLEARANCE = 0.88"));
  assert.ok(source.includes("IMPORTED_NEUTRAL_HAND_LIFT = -0.085"));
  assert.ok(source.includes("IMPORTED_GUARD_HAND_LIFT = -0.015"));
  assert.ok(source.includes("targetLocal.z += layout.chestDepth"));
  assert.ok(source.includes("poleLocal.x += side * layout.shoulderWidth * (guard ? 0.86 : 0.82)"));
  assert.ok(source.includes("poleLocal.y += guard ? 0.010 : 0.0"));
  assert.equal(source.includes("poleLocal.y += guard ? 0.015 : -0.075"), false);
  assert.ok(source.includes("pose.target, pose.pole, 0.05"));
  assert.ok(source.includes("pose.target, pose.pole, 0.08"));
});

test("neutral and guard corrections no longer reuse legacy fist targets", () => {
  const neutralStart = source.indexOf("function neutralPoseCorrection");
  const desiredStart = source.indexOf("const PROCEDURAL_ATTACK_CLIPS", neutralStart);
  const readyBlock = source.slice(neutralStart, desiredStart);
  assert.equal(readyBlock.includes("getVisualContactPoint"), false);
  assert.ok(readyBlock.includes("importedReadyArmPose(fighter, suffix, root, false)"));
  assert.ok(readyBlock.includes("importedReadyArmPose(fighter, suffix, root, true)"));
});

// This file also intentionally triggers the real-WebGL audit whenever arm/body
// clearance constraints change, so static checks cannot hide a visual regression.
