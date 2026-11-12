import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { retargetMotionClips } from "../src/game/motion-retarget";

function makeRig(parentYaw = 0, jointName = "arm"): {
  root: THREE.Group;
  parent: THREE.Bone;
  joint: THREE.Bone;
} {
  const root = new THREE.Group();
  const parent = new THREE.Bone();
  parent.name = "shoulder";
  parent.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), parentYaw);
  const joint = new THREE.Bone();
  joint.name = jointName;
  parent.add(joint);
  root.add(parent);
  root.updateMatrixWorld(true);
  return { root, parent, joint };
}

function armClip(source: THREE.Bone): THREE.AnimationClip {
  const angle = Math.PI * 0.5;
  const start = source.quaternion.clone();
  const end = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
  return new THREE.AnimationClip("ArmStrike", 1, [
    new THREE.QuaternionKeyframeTrack(`${source.name}.quaternion`, [0, 1], [
      ...start.toArray(), ...end.toArray(),
    ]),
  ]);
}

function lastQuaternion(clip: THREE.AnimationClip): THREE.Quaternion {
  const track = clip.tracks[0];
  return new THREE.Quaternion().fromArray(track.values, track.values.length - 4);
}

test("WORLD retarget carries parent-rest rotation into the target basis", () => {
  const source = makeRig(Math.PI / 2);
  const target = makeRig(0);
  const clip = armClip(source.joint);
  const sourceBefore = source.joint.quaternion.clone();
  const targetBefore = target.joint.quaternion.clone();

  const world = retargetMotionClips(source.root, target.root, [clip], { rotationMode: "WORLD" }).get("ArmStrike")!;
  const legacy = retargetMotionClips(source.root, target.root, [clip]).get("ArmStrike")!;
  const worldExpected = source.parent.quaternion.clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
    .multiply(source.parent.quaternion.clone().invert());
  const localExpected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  assert.ok(lastQuaternion(world).angleTo(worldExpected) < 1e-5, "world-space arm axis should match source world axis");
  assert.ok(lastQuaternion(legacy).angleTo(localExpected) < 1e-5, "LOCAL remains backward compatible");
  assert.ok(lastQuaternion(world).angleTo(lastQuaternion(legacy)) > 1, "the two rest bases should be distinguishable");
  assert.ok(source.joint.quaternion.angleTo(sourceBefore) < 1e-6, "source rig must not be mutated");
  assert.ok(target.joint.quaternion.angleTo(targetBefore) < 1e-6, "target rig must not be mutated");
});

test("mapped VRM hips translate only the target pelvis, scaled to avatar size", () => {
  const source = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = "hips";
  hips.position.set(0, 1, 0);
  const hand = new THREE.Bone();
  hand.name = "leftHand";
  hips.add(hand);
  source.add(hips);
  const target = new THREE.Group();
  const pelvis = new THREE.Bone();
  pelvis.name = "pelvis";
  pelvis.position.set(0, 2, 0);
  const targetHand = new THREE.Bone();
  targetHand.name = "leftHand";
  pelvis.add(targetHand);
  target.add(pelvis);
  const clip = new THREE.AnimationClip("Walk", 1, [
    new THREE.VectorKeyframeTrack("hips.position", [0, 1], [0, 1, 0, 0.5, 1.25, 0]),
    new THREE.VectorKeyframeTrack("leftHand.position", [0, 1], [0, 0, 0, 0, 4, 0]),
  ]);
  const result = retargetMotionClips(source, target, [clip], {
    boneNameMap: { hips: "pelvis" },
    translationScale: 2,
  }).get("Walk")!;
  assert.deepEqual(result.tracks.map((track) => track.name), ["pelvis.position"]);
  assert.deepEqual([...result.tracks[0].values], [0, 2, 0, 1, 2.5, 0]);
  assert.equal(pelvis.position.y, 2, "bind pose remains unchanged");
});

test("WORLD mode preserves neutral pose when parent rest rotations match", () => {
  const source = makeRig(Math.PI / 4);
  const target = makeRig(Math.PI / 4);
  const clip = armClip(source.joint);
  const world = retargetMotionClips(source.root, target.root, [clip], { rotationMode: "WORLD" }).get("ArmStrike")!;
  const local = retargetMotionClips(source.root, target.root, [clip]).get("ArmStrike")!;
  assert.ok(lastQuaternion(world).angleTo(lastQuaternion(local)) < 1e-5);
});
