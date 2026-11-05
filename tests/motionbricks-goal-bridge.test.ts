import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MOTIONBRICKS_GOAL_BRIDGE_VERSION, predictPoseTowardGoal } from "../src/game/motionbricks-goal-bridge";
import { sampleAuthoredTargetWindow, TARGET_LOOKAHEAD_SECONDS } from "../src/game/motionbricks-authored-target-window";
import {
  applyInertialTransition,
  beginInertialTransition,
  recordInertialPose,
  type InertialPoseSample,
  type InertialTransitionSample,
} from "../src/game/kimodo-motion-inertialization";

const identity = () => new THREE.Quaternion();

test("goal bridge uses the authored destination rather than extrapolating away from it", () => {
  const from = new THREE.Vector3();
  const goal = new THREE.Vector3(.16, 0, 0);
  const toward = predictPoseTowardGoal(
    from, identity(), new THREE.Vector3(2, 0, 0), new THREE.Vector3(),
    goal, identity(), .03,
  );
  const away = predictPoseTowardGoal(
    from, identity(), new THREE.Vector3(-2, 0, 0), new THREE.Vector3(),
    goal, identity(), .03,
  );
  assert.equal(MOTIONBRICKS_GOAL_BRIDGE_VERSION, "GOAL_CONDITIONED_CONTEXT4_TARGET2_V2");
  assert.ok(toward.position.x > 0, "positive carry should still move toward the goal");
  assert.ok(away.position.x > -.009, "away-directed carry must be strongly attenuated");
  assert.ok(away.rejectedChannels > 0);
  assert.ok(toward.position.x <= .16 * .48 + .003 + 1e-7, "cannot overshoot target path");
  assert.equal(predictPoseTowardGoal(from, identity(), new THREE.Vector3(), new THREE.Vector3(), goal, identity(), 0).position.x, 0);
});

test("angular goals reject unwanted reverse twists and preserve normalized quaternions", () => {
  const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .4);
  const positive = predictPoseTowardGoal(
    new THREE.Vector3(), identity(), new THREE.Vector3(), new THREE.Vector3(0, 8, 0),
    new THREE.Vector3(), target, .03,
  );
  const negative = predictPoseTowardGoal(
    new THREE.Vector3(), identity(), new THREE.Vector3(), new THREE.Vector3(0, -8, 0),
    new THREE.Vector3(), target, .03,
  );
  assert.ok(positive.rotation.angleTo(target) < identity().angleTo(target));
  assert.ok(negative.rotation.angleTo(identity()) < positive.rotation.angleTo(identity()) * .2);
  assert.equal(negative.rejectedChannels, 1);
  assert.ok(Math.abs(positive.rotation.length() - 1) < 1e-9);
});

test("four displayed poses form bounded context; frozen hitstop does not advance history", () => {
  const pelvis = new THREE.Bone(); pelvis.name = "pelvis";
  const bones = new Map<string, THREE.Object3D>([["pelvis", pelvis]]);
  const history = new Map<string, InertialPoseSample>();
  for (let i = 0; i < 7; i++) {
    pelvis.position.x = i * .012;
    recordInertialPose(bones, history, 1 / 60);
  }
  const sample = history.get("pelvis")!;
  assert.equal(sample.context?.length, 4);
  assert.ok(sample.linearVelocity.x > 0 && sample.linearVelocity.x <= 3);
  assert.ok(sample.context![0].position.x > 0, "context ring must drop old frames");
  const recorded = sample.context!.map(frame => frame.position.x);
  recordInertialPose(bones, history, 0);
  assert.deepEqual(history.get("pelvis")!.context!.map(frame => frame.position.x), recorded);

  const outgoing = new Map<string, InertialTransitionSample>();
  beginInertialTransition(bones, history, outgoing, .7);
  pelvis.position.x = .14; // new authored goal, further in the moving direction
  const result = applyInertialTransition(bones, outgoing, .022, .08);
  assert.equal(result.activeBones, 1);
  assert.ok(Number.isFinite(pelvis.position.x));
  assert.ok(pelvis.position.x > .07 && pelvis.position.x < .15);
});

test("contact suppression remains exact and skeleton bone masks still take precedence", () => {
  const hand = new THREE.Bone(); hand.name = "hand_r";
  hand.position.set(.2, 0, 0);
  const bones = new Map<string, THREE.Object3D>([["hand_r", hand]]);
  const history = new Map<string, InertialPoseSample>();
  recordInertialPose(bones, history, 1 / 60);
  const bridge = new Map<string, InertialTransitionSample>();
  beginInertialTransition(bones, history, bridge, 1);

  hand.position.set(0, .1, 0);
  applyInertialTransition(bones, bridge, .01, .07, 0);
  assert.deepEqual(hand.position.toArray(), [0, .1, 0], "contact frame must remain authored");
  assert.equal(bridge.size, 0, "suppressed transitions must be cleared");

  beginInertialTransition(bones, history, bridge, 1);
  hand.position.set(.4, .1, 0);
  applyInertialTransition(bones, bridge, .01, .07, 1, new Map([["hand_r", 0]]));
  assert.deepEqual(hand.position.toArray(), [.4, .1, 0], "authored strike pin must win");
});

test("stationary goals cannot invent a stride and pathological velocities are bounded", () => {
  const source = new THREE.Vector3(0, 0, 0);
  const output = predictPoseTowardGoal(
    source, identity(), new THREE.Vector3(1e5, 0, 0), new THREE.Vector3(0, 1e5, 0),
    source, identity(), .1,
  );
  assert.ok(output.position.length() <= .00300001);
  assert.ok(identity().angleTo(output.rotation) <= THREE.MathUtils.degToRad(1.5) + 1e-7);
  assert.ok(source.equals(new THREE.Vector3()), "source remains untouched");
});

test("two authored target poses preserve forward anticipation without inventing new motion", () => {
  const from = new THREE.Vector3();
  const futurePosition = new THREE.Vector3(.15, 0, 0);
  const goal = { position: futurePosition };
  const normal = predictPoseTowardGoal(from, identity(), new THREE.Vector3(2, 0, 0),
    new THREE.Vector3(), from, identity(), .03);
  const guided = predictPoseTowardGoal(from, identity(), new THREE.Vector3(2, 0, 0),
    new THREE.Vector3(), from, identity(), .03, goal);
  assert.ok(guided.position.x > normal.position.x + .01, "future authored direction may preserve forward momentum");
  assert.equal(guided.lookaheadChannels, 1);
  assert.equal(predictPoseTowardGoal(from, identity(), new THREE.Vector3(),
    new THREE.Vector3(), from, identity(), .03, goal).position.x, 0,
    "lookahead must never generate an attack or locomotion without actual motion");
  assert.equal(futurePosition.x, .15, "sampling must not mutate clip-owned data");

  const opposite = predictPoseTowardGoal(from, identity(), new THREE.Vector3(2, 0, 0),
    new THREE.Vector3(), new THREE.Vector3(.12, 0, 0), identity(), .03,
    { position: new THREE.Vector3(-.15, 0, 0) });
  assert.equal(opposite.lookaheadChannels, 0, "a contradictory future pose must not reverse recovery");
  assert.ok(opposite.position.x > 0);
});

test("authored target sampler reads future keyframes but never changes the live mixer", () => {
  const pelvis = new THREE.Bone(); pelvis.name = "pelvis";
  const bones = new Map<string, THREE.Object3D>([["pelvis", pelvis]]);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .5);
  const clip = new THREE.AnimationClip("strike", .2, [
    new THREE.VectorKeyframeTrack("pelvis.position", [0, .2], [0, 0, 0, .2, 0, 0]),
    new THREE.QuaternionKeyframeTrack("pelvis.quaternion", [0, .2], [0, 0, 0, 1, ...q.toArray()]),
    new THREE.VectorKeyframeTrack("missing.position", [0, .2], [0, 0, 0, 9, 0, 0]),
  ]);
  const window = sampleAuthoredTargetWindow(clip, bones, 0);
  const next = window.get("pelvis")!;
  assert.equal(window.size, 1, "only bones in the runtime rig are sampled");
  assert.ok(Math.abs(next.position!.x - TARGET_LOOKAHEAD_SECONDS) < .00001);
  assert.ok(next.rotation!.angleTo(identity()) > .05);
  assert.deepEqual(pelvis.position.toArray(), [0, 0, 0], "sampler cannot advance live rig");
  assert.ok(pelvis.quaternion.equals(identity()));
  assert.equal(sampleAuthoredTargetWindow(clip, bones, .2).size, 0);
});

test("future authored angular direction is bounded, with contact masks still exact", () => {
  const future = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .5);
  const prediction = predictPoseTowardGoal(new THREE.Vector3(), identity(), new THREE.Vector3(),
    new THREE.Vector3(0, 8, 0), new THREE.Vector3(), identity(), .03, { rotation: future });
  assert.equal(prediction.lookaheadChannels, 1);
  assert.ok(prediction.rotation.angleTo(identity()) > THREE.MathUtils.degToRad(1.5));
  assert.ok(prediction.rotation.angleTo(identity()) < THREE.MathUtils.degToRad(24) + .0001);
  const hand = new THREE.Bone(); hand.name = "hand_r";
  const bones = new Map<string, THREE.Object3D>([["hand_r", hand]]);
  const history = new Map<string, InertialPoseSample>();
  recordInertialPose(bones, history, 1 / 60);
  hand.position.x = .05;
  recordInertialPose(bones, history, 1 / 60);
  const outgoing = new Map<string, InertialTransitionSample>();
  beginInertialTransition(bones, history, outgoing);
  hand.position.set(.1, 0, 0);
  const telemetry = applyInertialTransition(bones, outgoing, .012, .07, 1,
    new Map([["hand_r", 0]]), new Map([["hand_r", { position: new THREE.Vector3(.18, 0, 0) }]]));
  assert.equal(hand.position.x, .1, "authoritative contact end effector remains exact");
  assert.equal(telemetry.goalWindowChannels, 1);
  assert.equal(telemetry.replacementPinnedBones, 1);
});
