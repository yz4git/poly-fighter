import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MOTIONBRICKS_GOAL_BRIDGE_VERSION, predictPoseTowardGoal } from "../src/game/motionbricks-goal-bridge";
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
  assert.equal(MOTIONBRICKS_GOAL_BRIDGE_VERSION, "GOAL_CONDITIONED_CONTEXT4_V1");
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
