import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  MOTION_POSE_POLICY_VERSION,
  attackEntryBlendTicks,
  attackEntryPreviousPoseWeight,
  motionPoseOwner,
  shouldApplyLocomotionFootLock,
  shouldResamplePose,
} from "../src/game/motion-pose-policy";
import type { FighterState } from "../src/game/types";

const STATES: FighterState[] = [
  "IDLE", "WALK", "CROUCH", "JUMP", "SIDESTEP", "GUARD", "ATTACK",
  "HIT", "BLOCK_STUN", "KNOCKDOWN", "WAKEUP", "THROW", "KO", "RING_OUT",
];

test("pose policy assigns exactly one owner to every fighter state", () => {
  assert.equal(MOTION_POSE_POLICY_VERSION, "MOTION_POSE_OWNER_V1");
  for (const state of STATES) {
    const owner = motionPoseOwner(state);
    if (state === "ATTACK") assert.equal(owner, "AUTHORED_COMBAT_TIMELINE");
    else if (state === "WALK") assert.equal(owner, "LOCOMOTION_CLIP_WITH_FOOT_LOCK");
    else assert.equal(owner, "STATE_CLIP");
  }
});

test("attack entry blend is deterministic and gone before ACTIVE", () => {
  for (let startup = 1; startup <= 30; startup += 1) {
    const move = { startup };
    const fadeTicks = attackEntryBlendTicks(move);
    assert.ok(fadeTicks >= 1 && fadeTicks <= 3);
    let previous = 1;
    for (let tick = 0; tick <= startup; tick += 1) {
      const weight = attackEntryPreviousPoseWeight(move, tick);
      assert.ok(Number.isFinite(weight));
      assert.ok(weight >= 0 && weight <= 1);
      assert.ok(weight <= previous + 1e-12, `startup=${startup} tick=${tick}`);
      previous = weight;
    }
    assert.equal(attackEntryPreviousPoseWeight(move, startup), 0, `startup=${startup}: ACTIVE pose must be fully authored`);
  }
});

test("attack entry blend depends only on gameplay tick", () => {
  const move = { startup: 8 };
  assert.equal(attackEntryPreviousPoseWeight(move, 0), attackEntryPreviousPoseWeight(move, 0));
  assert.equal(attackEntryPreviousPoseWeight(move, 1), attackEntryPreviousPoseWeight(move, 1));
  assert.equal(attackEntryPreviousPoseWeight(move, 2), 0);
});

test("hitstop resamples a newly reached gameplay pose once, then holds it exactly", () => {
  assert.equal(shouldResamplePose(0, false), true);
  assert.equal(shouldResamplePose(0, true), true);
  assert.equal(shouldResamplePose(1, true), true);
  assert.equal(shouldResamplePose(8, true), true);
  assert.equal(shouldResamplePose(1, false), false);
  assert.equal(shouldResamplePose(8, false), false);
});

test("foot lock belongs only to unfrozen locomotion", () => {
  for (const state of STATES) {
    assert.equal(shouldApplyLocomotionFootLock(state, 0), state === "WALK");
    assert.equal(shouldApplyLocomotionFootLock(state, 1), false);
  }
});

test("production runtime delegates attack blending, hitstop hold and foot lock to pose policy", async () => {
  const source = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
  assert.match(source, /attackEntryPreviousPoseWeight\(move, fighter\.moveTick\)/);
  assert.match(source, /shouldResamplePose\(fighter\.hitStop, poseSampleChanged\)/);
  assert.match(source, /shouldApplyLocomotionFootLock\(fighter\.state, fighter\.hitStop\)/);
  assert.match(source, /combatMotionHitStopPoseFrozen/);
  assert.match(source, /combatMotionPoseOwner/);
  assert.doesNotMatch(source, /const walking = fighter\.state === "WALK"/);
});
