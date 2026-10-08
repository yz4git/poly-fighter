import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { planCombatMotionHandoff, isCombatAttackClip } from "../src/game/combat-motion-handoff";
import {
  applyInertialTransition,
  beginInertialTransition,
  recordInertialPose,
  type InertialPoseSample,
  type InertialTransitionSample,
} from "../src/game/kimodo-motion-inertialization";
import { buildUniMateReplacementProfile } from "../src/game/unimate-motion-replacement";

test("every combat handoff has an intentional priority, duration and velocity budget", () => {
  const cases = [
    ["BF_Jab_L", "BF_Cross_R", "ATTACK", "ATTACK_COMBO"],
    ["BF_Cross_R", "BF_Cross_R", "ATTACK", "ATTACK_COMBO"],
    ["CM_Ready", "BF_Cross_R", "ATTACK", "ATTACK_ENTRY"],
    ["BF_Power_R", "CM_Guard", "GUARD", "ATTACK_TO_GUARD"],
    ["BF_FrontKick_R", "CM_Ready", "IDLE", "ATTACK_TO_READY"],
    ["BF_FrontKick_R", "BF_HitLight_L", "HIT", "REACTION_INTERRUPT"],
    ["BF_Cross_R", "CM_Block", "BLOCK_STUN", "BLOCK_INTERRUPT"],
    ["BF_HitMid_R", "CM_Guard", "GUARD", "REACTION_RECOVERY"],
    ["CM_Block", "CM_Ready", "IDLE", "BLOCK_RECOVERY"],
    ["CM_Ready", "CM_Guard", "GUARD", "GUARD_RECOVERY"],
    ["CM_Move_F", "CM_Move_BLEND", "WALK", "LOCOMOTION"],
    ["CM_Ready", "CM_Land", "IDLE", "LANDING"],
    ["CM_Ready", "CM_Ready", "IDLE", "GENERAL"],
    ["BF_Jab_L", "BF_EdgeStagger", "HIT", "REACTION_INTERRUPT"],
    ["BF_DashKick_R", "CM_Launch", "HIT", "REACTION_INTERRUPT"],
  ] as const;
  for (const [from, to, state, mode] of cases) {
    const plan = planCombatMotionHandoff(from, to, state);
    assert.equal(plan.mode, mode, `${from} -> ${to}`);
    assert.ok(plan.duration > 0 && plan.duration <= .12, `${mode}: bounded duration`);
    assert.ok(plan.velocityCarry >= 0 && plan.velocityCarry <= 1);
  }
  const combo = planCombatMotionHandoff("BF_Jab_L", "BF_Cross_R", "ATTACK");
  const hit = planCombatMotionHandoff("BF_Jab_L", "BF_HitHeavy", "HIT");
  const blocked = planCombatMotionHandoff("BF_Jab_L", "CM_Block", "BLOCK_STUN");
  assert.ok(combo.velocityCarry > blocked.velocityCarry && blocked.velocityCarry > hit.velocityCarry);
  assert.ok(combo.duration > hit.duration);
  assert.equal(isCombatAttackClip("BF_Jab_L"), true);
  assert.equal(isCombatAttackClip("BF_Backfist_L"), true);
  assert.equal(isCombatAttackClip("BF_RisingKick_R"), true);
  assert.equal(isCombatAttackClip("BF_HitHeavy"), false);
});

function buildSkeleton(): Map<string, THREE.Object3D> {
  const names = ["pelvis", "spine_02", "spine_03", "Head", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r"];
  const bones = new Map(names.map(n => [n, new THREE.Bone()]));
  for (const [name, bone] of bones) bone.name = name;
  const link = (parent: string, child: string) => bones.get(parent)!.add(bones.get(child)!);
  link("pelvis", "spine_02");
  link("spine_02", "spine_03");
  link("spine_03", "Head");
  for (const suffix of ["l", "r"]) {
    link("spine_03", `clavicle_${suffix}`);
    link(`clavicle_${suffix}`, `upperarm_${suffix}`);
    link(`upperarm_${suffix}`, `lowerarm_${suffix}`);
    link(`lowerarm_${suffix}`, `hand_${suffix}`);
  }
  return bones;
}

test("incoming hit and block pin reaction joints instead of carrying outgoing attacks", () => {
  const bones = buildSkeleton();
  const hit = buildUniMateReplacementProfile({
    bones, state: "HIT", currentClip: "BF_HitMid_L", contactWeight: 0,
    handoffMode: "REACTION_INTERRUPT",
  });
  assert.equal(hit.mode, "HIT_REACTION_GRAPH");
  assert.ok((hit.scales.get("Head") ?? 1) < .15);
  assert.ok((hit.scales.get("spine_03") ?? 1) < .15);
  assert.ok((hit.scales.get("pelvis") ?? 1) < .6);

  const block = buildUniMateReplacementProfile({
    bones, state: "BLOCK_STUN", currentClip: "CM_Block", contactWeight: 0,
    handoffMode: "BLOCK_INTERRUPT",
  });
  assert.equal(block.mode, "BLOCK_REACTION_GRAPH");
  assert.ok((block.scales.get("hand_l") ?? 1) < .15);
  assert.ok((block.scales.get("hand_r") ?? 1) < .15);

  const regular = buildUniMateReplacementProfile({
    bones, state: "GUARD", currentClip: "CM_Guard", contactWeight: 0,
  });
  const recovered = buildUniMateReplacementProfile({
    bones, state: "GUARD", currentClip: "CM_Guard", contactWeight: 0,
    handoffMode: "ATTACK_TO_GUARD",
  });
  assert.equal(recovered.mode, "GUARD_UPPER_BODY");
  assert.ok((recovered.scales.get("hand_l") ?? 1) < (regular.scales.get("hand_l") ?? 1));
  assert.ok((recovered.scales.get("hand_r") ?? 1) < (regular.scales.get("hand_r") ?? 1));
});

test("inertial handoff carries bounded measured velocities without altering incoming contact", () => {
  const bones = buildSkeleton();
  const history = new Map<string, InertialPoseSample>();
  const inertial = new Map<string, InertialTransitionSample>();
  recordInertialPose(bones, history, 1 / 60);
  const head = bones.get("Head")!;
  head.position.set(.025, 0, 0);
  head.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .08);
  recordInertialPose(bones, history, 1 / 60);
  const speed = history.get("Head")!.linearVelocity.length();
  assert.ok(speed > 0);
  beginInertialTransition(bones, history, inertial, .22);
  assert.ok(Math.abs(inertial.get("Head")!.linearVelocity.length() - speed * .22) < 1e-8);

  // An incoming reaction should be mostly authoritative from its first frame.
  head.position.set(0, 0, 0);
  head.quaternion.identity();
  const profile = buildUniMateReplacementProfile({
    bones, state: "HIT", currentClip: "BF_HitLight_R",
    contactWeight: 0, handoffMode: "REACTION_INTERRUPT",
  });
  const telemetry = applyInertialTransition(bones, inertial, .012, .034, 1, profile.scales);
  assert.ok(telemetry.activeBones > 0);
  assert.ok(telemetry.replacementPinnedBones > 0);
  assert.ok(head.position.x < .015, "hit head cannot inherit most of the outgoing jab");
  // Hitstop freezes age externally; repeating the same interpolation must
  // be deterministic and never accumulate a second animation offset.
  const first = head.position.clone();
  head.position.set(0, 0, 0);
  head.quaternion.identity();
  applyInertialTransition(bones, inertial, .012, .034, 1, profile.scales);
  assert.ok(head.position.distanceTo(first) < 1e-9);
});

test("a zero-timescale walk action is not considered running by three.js", () => {
  const root = new THREE.Object3D();
  root.name = "root";
  const clip = new THREE.AnimationClip("Walk", 1, [
    new THREE.NumberKeyframeTrack("root.position[x]", [0, 1], [0, 1]),
  ]);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  action.setEffectiveTimeScale(0);
  assert.equal(action.isRunning(), false,
    "walk blending must track playing directions, not isRunning() at timescale zero");
  action.stop();
  mixer.uncacheRoot(root);
});
