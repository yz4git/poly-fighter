import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { planAdaptiveMotionHandoff, MOTIONBRICKS_ADAPTIVE_HANDOFF_VERSION } from "../src/game/motionbricks-adaptive-handoff";
import { planCombatMotionHandoff } from "../src/game/combat-motion-handoff";

const bones = () => {
  const incoming = new Map<string, THREE.Object3D>();
  const outgoing = new Map<string, { position: THREE.Vector3; rotation: THREE.Quaternion }>();
  for (const name of ["pelvis", "spine_02", "spine_03", "upperarm_l", "upperarm_r", "thigh_l", "thigh_r"]) {
    const bone = new THREE.Bone();
    bone.name = name;
    incoming.set(name, bone);
    outgoing.set(name, { position: bone.position.clone(), rotation: bone.quaternion.clone() });
  }
  return { incoming, outgoing };
};

test("MotionBricks-inspired planner adjusts *visual* durations to actual skeletal pose gaps", () => {
  assert.equal(MOTIONBRICKS_ADAPTIVE_HANDOFF_VERSION, "POSE_GAP_DURATION_V1");
  const { incoming, outgoing } = bones();
  const handoff = planCombatMotionHandoff("BF_Jab_L", "BF_Cross_R", "ATTACK");
  const aligned = planAdaptiveMotionHandoff(handoff.mode, handoff.duration, outgoing, incoming);
  assert.equal(aligned.evaluatedBones, 7);
  assert.equal(aligned.severity, 0);
  assert.ok(aligned.duration < handoff.duration);
  for (const bone of incoming.values()) bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);
  const large = planAdaptiveMotionHandoff(handoff.mode, handoff.duration, outgoing, incoming);
  assert.ok(large.duration > handoff.duration, "large limb pose changes get a longer but capped visual bridge");
  assert.ok(large.duration <= .108);
  assert.ok(large.severity > .9);
  assert.ok(aligned.duration >= .05);
});

test("reaction and block interruptions stay immediate even after a large outgoing kick", () => {
  const { incoming, outgoing } = bones();
  incoming.get("spine_03")!.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  incoming.get("pelvis")!.position.set(1, 0, 0);
  for (const mode of ["REACTION_INTERRUPT", "BLOCK_INTERRUPT", "LANDING"] as const) {
    const planned = planAdaptiveMotionHandoff(mode, .034, outgoing, incoming);
    assert.equal(planned.duration, .034);
    assert.equal(planned.evaluatedBones, 0);
  }
});

test("fall back to authored duration for missing or invalid skeletons", () => {
  const { incoming, outgoing } = bones();
  const absent = planAdaptiveMotionHandoff("ATTACK_ENTRY", .052, new Map(), incoming);
  assert.equal(absent.duration, .052);
  const unknown = planAdaptiveMotionHandoff("ATTACK_ENTRY", .052,
    new Map([["unknown", { position: new THREE.Vector3(), rotation: new THREE.Quaternion() }]]), incoming);
  assert.equal(unknown.duration, .052);
  const invalid = planAdaptiveMotionHandoff("ATTACK_ENTRY", Number.NaN, outgoing, incoming);
  assert.equal(invalid.duration, 0);
  incoming.get("pelvis")!.quaternion.set(Number.NaN, 0, 0, 1);
  const safe = planAdaptiveMotionHandoff("ATTACK_ENTRY", .052, outgoing, incoming);
  assert.ok(Number.isFinite(safe.duration));
});

test("attack entry keeps startup readable while stance-to-guard bridges are bounded", () => {
  const { incoming, outgoing } = bones();
  for (const bone of incoming.values()) bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.0);
  const attack = planAdaptiveMotionHandoff("ATTACK_ENTRY", .052, outgoing, incoming);
  const guard = planAdaptiveMotionHandoff("ATTACK_TO_GUARD", .09, outgoing, incoming);
  assert.ok(attack.duration <= .077);
  assert.ok(guard.duration <= .115);
  assert.ok(guard.duration > attack.duration);
});
