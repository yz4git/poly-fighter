import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { combatPoseSamplerTrackCount, sampleCombatClipPose } from "../src/game/combat-pose-sampler";

function fixture() {
  const pelvis = new THREE.Bone();
  pelvis.name = "pelvis";
  const hand = new THREE.Bone();
  hand.name = "hand_r";
  pelvis.add(hand);

  const endPelvis = new THREE.Vector3(0.2, 0.4, -0.1);
  const endHand = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.75);
  const clip = new THREE.AnimationClip("SyntheticCombat", 1, [
    new THREE.VectorKeyframeTrack(
      "pelvis.position",
      [0, 1],
      [0, 0, 0, endPelvis.x, endPelvis.y, endPelvis.z],
    ),
    new THREE.QuaternionKeyframeTrack(
      "hand_r.quaternion",
      [0, 1],
      [0, 0, 0, 1, endHand.x, endHand.y, endHand.z, endHand.w],
    ),
  ]);

  return { clip, pelvis, hand, nodes: new Map<string, THREE.Object3D>([["pelvis", pelvis], ["hand_r", hand]]) };
}

function pose(pelvis: THREE.Object3D, hand: THREE.Object3D) {
  return {
    position: pelvis.position.toArray(),
    quaternion: hand.quaternion.toArray(),
  };
}

test("direct combat pose sampling is independent of previous rendered pose", () => {
  const { clip, pelvis, hand, nodes } = fixture();

  pelvis.position.set(9, -4, 3);
  hand.quaternion.setFromEuler(new THREE.Euler(1.1, -0.7, 0.35));
  assert.equal(sampleCombatClipPose(clip, 0.5, nodes), 2);
  const first = pose(pelvis, hand);

  pelvis.position.set(-12, 8, 5);
  hand.quaternion.setFromEuler(new THREE.Euler(-0.4, 1.3, -1.1));
  assert.equal(sampleCombatClipPose(clip, 0.5, nodes), 2);
  const second = pose(pelvis, hand);

  assert.deepEqual(second, first);
  assert.ok(Math.abs(new THREE.Quaternion().fromArray(first.quaternion).length() - 1) < 1e-7);
});

test("direct combat pose sampling clamps phase and reports compiled track count", () => {
  const { clip, pelvis, hand, nodes } = fixture();
  assert.equal(combatPoseSamplerTrackCount(clip), 2);

  sampleCombatClipPose(clip, -10, nodes);
  assert.deepEqual(pelvis.position.toArray(), [0, 0, 0]);
  assert.deepEqual(hand.quaternion.toArray(), [0, 0, 0, 1]);

  sampleCombatClipPose(clip, 10, nodes);
  assert.ok(pelvis.position.distanceTo(new THREE.Vector3(0.2, 0.4, -0.1)) < 1e-6);
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.75);
  assert.ok(hand.quaternion.angleTo(expected) < 1e-6);
});
