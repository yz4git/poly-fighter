import assert from "node:assert/strict";
import test from "node:test";
import {
  QUATERNIUS_MOTIONS,
  QUATERNIUS_MOTION_SOURCE,
} from "../src/game/generated/quaternius-motion-data";
import {
  motionClipDuration,
  quaterniusMotionDelta,
  sampleQuaterniusMotion,
} from "../src/game/quaternius-motion";

test("Quaternius motion source remains pinned to CC0 data", () => {
  assert.equal(QUATERNIUS_MOTION_SOURCE.author, "Quaternius");
  assert.equal(QUATERNIUS_MOTION_SOURCE.license, "CC0-1.0");
  assert.equal(QUATERNIUS_MOTION_SOURCE.commit, "e24c23cf2a1323488a3faa226ea7ea21f644b73e");
  for (const name of ["Idle_Loop", "Walk_Loop", "Punch_Jab", "Punch_Cross", "Hit_Chest", "Hit_Head", "Death01"]) {
    assert.ok(QUATERNIUS_MOTIONS[name], `${name} should be included`);
    assert.ok(motionClipDuration(name) > 0);
  }
});

test("Punch trajectories preserve useful authored strike travel", () => {
  const jab = quaterniusMotionDelta("Punch_Jab", 0.28, "leftHand");
  const cross = quaterniusMotionDelta("Punch_Cross", 0.333, "rightHand");
  assert.ok(Math.hypot(...jab) > 0.20, `jab travel too small: ${jab}`);
  assert.ok(Math.hypot(...cross) > 0.25, `cross travel too small: ${cross}`);
  assert.ok(jab[2] > 0.18, `jab should travel forward: ${jab}`);
  assert.ok(cross[2] > 0.22, `cross should travel forward: ${cross}`);
});

test("Hit reaction contains visible upper-body displacement", () => {
  const head = quaterniusMotionDelta("Hit_Chest", 0.65, "head");
  assert.ok(Math.hypot(...head) > 0.04, `hit reaction too small: ${head}`);
});

test("Motion sampling interpolates and loops deterministically", () => {
  const a = sampleQuaterniusMotion("Idle_Loop", 0.125, true);
  const b = sampleQuaterniusMotion("Idle_Loop", 1.125, true);
  assert.deepEqual(a.hipsDelta, b.hipsDelta);
  assert.deepEqual(a.leftHand, b.leftHand);
});
