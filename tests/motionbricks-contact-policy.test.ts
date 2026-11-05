import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  planMotionContactPolicy, MOTIONBRICKS_CONTACT_POLICY_VERSION,
} from "../src/game/motionbricks-contact-policy";
import { applyKimodoMotionConditioning } from "../src/game/kimodo-motion-conditioning";
import type { FighterRuntime } from "../src/game/fighter";

const make = (visualContact: string | null, moveId = "kick") => ({
  state: "ATTACK", grounded: true, moveId, visualContact, contactWeight: 0,
});

test("support-foot assignment protects the plant foot, not the striking end effector", () => {
  assert.equal(MOTIONBRICKS_CONTACT_POLICY_VERSION, "SUPPORT_FOOT_CONTACT_V1");
  const kickR = planMotionContactPolicy(make("RIGHT_FOOT"));
  const kickL = planMotionContactPolicy(make("LEFT_FOOT"));
  assert.equal(kickR.support, "l");
  assert.ok(kickR.left > .9);
  assert.equal(kickR.right, 0);
  assert.equal(kickL.support, "r");
  assert.equal(kickL.left, 0);
  assert.ok(kickL.right > .9);
  const punchR = planMotionContactPolicy(make("RIGHT_FIST", "straight"));
  assert.equal(punchR.support, "l");
  assert.ok(punchR.left > .72);
  assert.equal(punchR.right, 0);
});

test("near-contact and authored travel remain exact, including out-of-range attacks", () => {
  for (const id of ["rangeBlitz", "rangeCrescent", "rangeComet", "dashKick"]) {
    const policy = planMotionContactPolicy(make("RIGHT_FOOT", id));
    assert.equal(policy.mode, "COMMITTED_TRAVEL");
    assert.equal(policy.left + policy.right, 0);
  }
  const live = planMotionContactPolicy({ ...make("RIGHT_FOOT"), contactWeight: 1 });
  assert.equal(live.mode, "STRIKE_CONTACT");
  assert.equal(live.left + live.right, 0);
  const windup = planMotionContactPolicy({ ...make("RIGHT_FOOT"), contactWeight: .50 });
  assert.ok(windup.left > 0 && windup.left < .94, "support releases smoothly before contact");
  assert.equal(planMotionContactPolicy({ ...make("RIGHT_FOOT"), grounded: false }).left, 0);
  assert.equal(planMotionContactPolicy({ ...make("RIGHT_FOOT"), contactWeight: Number.NaN }).mode, "STRIKE_SUPPORT");
});

test("WALK IK and reaction motions never receive a competing root-contact lock", () => {
  const basic = { ...make("RIGHT_FOOT"), moveId: null, visualContact: null };
  const walk = planMotionContactPolicy({ ...basic, state: "WALK" });
  assert.equal(walk.mode, "WALK_IK");
  assert.equal(walk.left, 0);
  assert.equal(walk.right, 0);
  for (const state of ["JUMP", "SIDESTEP", "HIT", "KO", "THROW", "KNOCKDOWN", "WAKEUP"]) {
    assert.equal(planMotionContactPolicy({ ...basic, state }).mode, "NO_CONTACT");
  }
  assert.equal(planMotionContactPolicy({ ...basic, state: "GUARD" }).mode, "GROUND_STANCE");
});

function rigAndFighter() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  const pelvis = new THREE.Bone(); pelvis.name = "pelvis";
  const left = new THREE.Bone(); left.name = "foot_l"; left.position.set(-.22, -.85, 0);
  const right = new THREE.Bone(); right.name = "foot_r"; right.position.set(.22, -.85, 0);
  root.add(model); model.add(pelvis); pelvis.add(left); pelvis.add(right);
  root.updateMatrixWorld(true);
  const fighter = {
    visual: { root }, grounded: true, state: "ATTACK",
    currentMove: { id: "kick", visualContact: "RIGHT_FOOT" },
  } as unknown as FighterRuntime;
  const bones = new Map<string, THREE.Object3D>([["pelvis", pelvis], ["foot_l", left], ["foot_r", right]]);
  return { root, model, pelvis, left, right, bones, fighter };
}

test("the short support correction never drags a committed attack or an authored contact", () => {
  for (const [id, weight] of [["rangeComet", 0], ["kick", 1]] as const) {
    const r = rigAndFighter();
    r.fighter.currentMove!.id = id;
    applyKimodoMotionConditioning({ model: r.model, bones: r.bones }, r.fighter, 1 / 60, weight);
    applyKimodoMotionConditioning({ model: r.model, bones: r.bones }, r.fighter, 1 / 60, weight);
    r.pelvis.position.x = .012;
    applyKimodoMotionConditioning({ model: r.model, bones: r.bones }, r.fighter, 1 / 60, weight);
    assert.equal(r.pelvis.position.x, .012, id + " must not receive compensatory pelvis motion");
    assert.equal(r.root.userData.motionbricksFootPelvisCorrection, 0);
  }
});

test("hitstop cannot change conditioned pose or consume the support-foot anchor", () => {
  const r = rigAndFighter();
  applyKimodoMotionConditioning({ model: r.model, bones: r.bones }, r.fighter, 1 / 60);
  applyKimodoMotionConditioning({ model: r.model, bones: r.bones }, r.fighter, 1 / 60);
  const pos = r.pelvis.position.clone();
  applyKimodoMotionConditioning({ model: r.model, bones: r.bones }, r.fighter, 0);
  assert.ok(r.pelvis.position.equals(pos));
});
