import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CMU_MOCAP_PILOT_CLIPS,
  buildCmuBoneMap,
  cmuMocapClipName,
  cmuMocapPilotUrl,
  retargetCmuPilotClip,
} from "../src/game/cmu-mocap-pilot";

const mappedNames: ReadonlyArray<readonly [string, string]> = [
  ["Hips", "pelvis"],
  ["Spine", "spine_01"],
  ["LeftArm", "upperarm_l"],
  ["RightArm", "upperarm_r"],
  ["LeftForeArm", "lowerarm_l"],
  ["RightForeArm", "lowerarm_r"],
  ["LeftUpLeg", "thigh_l"],
  ["RightUpLeg", "thigh_r"],
  ["LeftLeg", "calf_l"],
  ["RightLeg", "calf_r"],
  ["Head", "Head"],
];

function rig(names: readonly string[]): THREE.Group {
  const root = new THREE.Group();
  for (const name of names) {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
  }
  return root;
}

test("CMU pilot references verified skeleton-only files and does not bundle GLBs", () => {
  assert.equal(CMU_MOCAP_PILOT_CLIPS.length, 3);
  for (const clip of CMU_MOCAP_PILOT_CLIPS) {
    assert.equal(cmuMocapClipName(clip.id), `CMU_${clip.id}`);
    assert.equal(cmuMocapPilotUrl(clip.id),
      `https://huggingface.co/datasets/codepawl/cmu-mocap-glb/resolve/main/skeleton/${clip.file}/${clip.file}_skeleton.glb`);
  }
});

test("CMU/Mixamo joint names resolve onto the actual Quaternius rig", () => {
  const source = rig([...mappedNames.map(([sourceName]) => sourceName), "mixamorig:LeftHand"]);
  const target = rig([...mappedNames.map(([, targetName]) => targetName), "hand_l"]);
  const map = buildCmuBoneMap(source, target);
  for (const [sourceName, targetName] of mappedNames) {
    assert.equal(map[sourceName], targetName);
  }
  assert.equal(map["mixamorig:LeftHand"], "hand_l");
});

test("WORLD CMU pilot transfers rotations but never imports world translation", () => {
  const source = rig(mappedNames.map(([name]) => name));
  const target = rig(mappedNames.map(([, name]) => name));
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .25);
  const tracks: THREE.KeyframeTrack[] = mappedNames.map(([name]) =>
    new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, ...quaternion.toArray()]));
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", [0, 1], [0, 1, 0, 20, 1, 0]));
  const clip = new THREE.AnimationClip("original-cmu", 1, tracks);
  const output = retargetCmuPilotClip(source, target, [clip], "BOXING", "WORLD");

  assert.equal(output.name, "CMU_BOXING");
  assert.equal(output.tracks.filter((track) => track.name.endsWith(".quaternion")).length, mappedNames.length);
  assert.equal(output.tracks.filter((track) => track.name.endsWith(".position")).length, 0);
  assert.ok(output.tracks.some((track) => track.name === "upperarm_l.quaternion"));
  assert.equal(source.getObjectByName("Hips")?.position.y, 0, "source bind pose must not change");
  assert.equal(target.getObjectByName("pelvis")?.position.y, 0, "target bind pose must not change");
});

test("CMU pilot explicitly refuses an insufficient bone match", () => {
  const source = rig(["Head"]);
  const target = rig(["Head"]);
  const clip = new THREE.AnimationClip("bad", 1, [
    new THREE.QuaternionKeyframeTrack("Head.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
  assert.throws(() => retargetCmuPilotClip(source, target, [clip], "KICK"),
    /skeleton mapping insufficient/);
});
