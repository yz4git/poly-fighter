/**
 * Optional full GLTFLoader+retarget smoke on actual upstream CMU GLBs and both
 * committed UBC skins. Run with: node --import tsx scripts/check-cmu-runtime.mjs
 * This test is deliberately outside the mandatory build: it needs network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import {
  CMU_MOCAP_PILOT_CLIPS,
  cmuMocapPilotUrl,
  retargetCmuPilotClip,
} from "../src/game/cmu-mocap-pilot.ts";

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const loader = new GLTFLoader();
const targets = await Promise.all(["male", "female"].map(async (variant) => {
  const bytes = readFileSync(`public/models/quaternius/ubc-superhero-${variant}-flat.glb`);
  const gltf = await loader.parseAsync(asArrayBuffer(bytes), "");
  return { variant, target: gltf.scene };
}));

let errors = 0;
for (const entry of CMU_MOCAP_PILOT_CLIPS) {
  try {
    const response = await fetch(cmuMocapPilotUrl(entry.id), {
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`CMU ${entry.id}: HTTP ${response.status}`);
    const gltf = await loader.parseAsync(await response.arrayBuffer(), "");
    for (const { variant, target } of targets) {
      const diagnostics = { fitted: [], fallback: [], alignment: [] };
      const clip = retargetCmuPilotClip(gltf.scene, target, gltf.animations, entry.id, "WORLD", diagnostics);
      const names = clip.tracks.map((track) => track.name);
      const jointCount = clip.tracks.filter((track) => track.name.endsWith(".quaternion")).length;
      assert.equal(new Set(names).size, names.length, "duplicate target animation track");
      assert.ok(jointCount >= 20, `Expected >=20 compatible joints; got ${jointCount}`);
      for (const track of clip.tracks) {
        assert.ok([...track.values].every(Number.isFinite), `non-finite values in ${track.name}`);
        if (track.name.endsWith(".position")) {
          assert.equal(track.name, "pelvis.position", "only vertical contact correction may move the root");
        }
      }
      // Evaluate the resulting UBC skeleton, not just its track names.
      // Crossed ankles have a *negative* signed projection onto the current
      // left-to-right hip axis, independent of fighter turning/yaw.
      const mixer = new THREE.AnimationMixer(target);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      let worstFoot = { separation: Infinity, time: 0 };
      let worstKnee = { separation: Infinity, time: 0 };
      let minFootY = Infinity;
      let maxFootY = -Infinity;
      let minToeY = Infinity;
      let maxToeY = -Infinity;
      const frames = Math.ceil(clip.duration * 30);
      const P = (name) => target.getObjectByName(name).getWorldPosition(new THREE.Vector3());
      for (let frame = 0; frame <= frames; frame++) {
        const time = clip.duration * frame / Math.max(1, frames);
        mixer.setTime(time);
        target.updateWorldMatrix(true, true);
        const side = P("thigh_l").sub(P("thigh_r")).normalize();
        const fL = P("foot_l");
        const fR = P("foot_r");
        const kL = P("calf_l");
        const kR = P("calf_r");
        const footSep = fL.clone().sub(fR).dot(side);
        const kneeSep = kL.sub(kR).dot(side);
        if (footSep < worstFoot.separation) worstFoot = { separation: footSep, time };
        if (kneeSep < worstKnee.separation) worstKnee = { separation: kneeSep, time };
        minFootY = Math.min(minFootY, fL.y, fR.y);
        maxFootY = Math.max(maxFootY, fL.y, fR.y);
        const toeLeft = P("ball_l").y;
        const toeRight = P("ball_r").y;
        minToeY = Math.min(minToeY, toeLeft, toeRight);
        maxToeY = Math.max(maxToeY, toeLeft, toeRight);
      }
      // Source/target kinematic fidelity: compare actual segment directions
      // in both played skeletons, not just animation track names. This
      // detects the previous T-pose bug even when ankle clearance passes.
      const comparison = [
        ["lhumerus", "lradius", "upperarm_l", "lowerarm_l"],
        ["lradius", "lwrist", "lowerarm_l", "hand_l"],
        ["rhumerus", "rradius", "upperarm_r", "lowerarm_r"],
        ["rradius", "rwrist", "lowerarm_r", "hand_r"],
        ["lfemur", "ltibia", "thigh_l", "calf_l"],
        ["ltibia", "lfoot", "calf_l", "foot_l"],
        ["rfemur", "rtibia", "thigh_r", "calf_r"],
        ["rtibia", "rfoot", "calf_r", "foot_r"],
      ];
      assert.equal(diagnostics.fitted.includes("upperarm_l"), true);
      assert.equal(diagnostics.fitted.includes("lowerarm_l"), true);
      const aligned = new THREE.Quaternion().fromArray(diagnostics.alignment);
      // Re-arm the target action: the preceding full-clip stance audit leaves
      // LoopOnce/clampWhenFinished paused at the end pose. Merely seeking the
      // mixer again will otherwise compare a frozen final pose to live source.
      action.reset().play();
      const sourceMixer = new THREE.AnimationMixer(gltf.scene);
      const sourceAction = sourceMixer.clipAction(gltf.animations[0]).play();
      sourceAction.setLoop(THREE.LoopOnce, 1);
      sourceAction.clampWhenFinished = true;
      let maxAngularErrorDegrees = 0;
      let totalAngularErrorDegrees = 0;
      let measurements = 0;
      let biggestError = null;
      for (let sample = 0; sample <= 32; sample++) {
        const time = clip.duration * sample / 32;
        sourceMixer.setTime(time);
        mixer.setTime(time);
        gltf.scene.updateWorldMatrix(true, true);
        target.updateWorldMatrix(true, true);
        for (const [srcA, srcB, dstA, dstB] of comparison) {
          const sourceA = gltf.scene.getObjectByName(srcA);
          const sourceB = gltf.scene.getObjectByName(srcB);
          const targetA = target.getObjectByName(dstA);
          const targetB = target.getObjectByName(dstB);
          assert.ok(sourceA && sourceB && targetA && targetB);
          const sourceDirection = sourceB.getWorldPosition(new THREE.Vector3())
            .sub(sourceA.getWorldPosition(new THREE.Vector3()))
            .normalize().applyQuaternion(aligned);
          const targetDirection = targetB.getWorldPosition(new THREE.Vector3())
            .sub(targetA.getWorldPosition(new THREE.Vector3()))
            .normalize();
          const degrees = THREE.MathUtils.radToDeg(sourceDirection.angleTo(targetDirection));
          measurements++;
          totalAngularErrorDegrees += degrees;
          if (degrees > maxAngularErrorDegrees) {
            maxAngularErrorDegrees = degrees;
            biggestError = { time, srcA, srcB, dstA, dstB };
          }
        }
      }
      assert.ok(totalAngularErrorDegrees / measurements < 1,
        "CMU mean anatomical source/target direction error is too high");
      sourceMixer.stopAllAction();
      sourceMixer.uncacheRoot(gltf.scene);
      console.log("CMU_ANATOMICAL_FIDELITY", JSON.stringify({
        source: entry.file, target: variant,
        trackedBones: diagnostics.fitted, fallback: diagnostics.fallback,
        measurements, maxAngularErrorDegrees, meanAngularErrorDegrees: totalAngularErrorDegrees / measurements,
        biggestError,
      }));
      assert.ok(maxAngularErrorDegrees < 5,
        "CMU anatomical limb aim differs from source by " + maxAngularErrorDegrees.toFixed(2) + " deg");
      mixer.stopAllAction();
      mixer.uncacheRoot(target);
      // Later source clips must retarget against the original UBC bind pose.
      target.traverse((object) => {
        if (object.isSkinnedMesh) object.skeleton.pose();
      });
      target.updateWorldMatrix(true, true);
      console.log("CMU_STANCE_AUDIT", JSON.stringify({
        source: entry.file, target: variant, frames, worstFoot, worstKnee,
        minFootY, maxFootY, minToeY, maxToeY,
      }));
      // This quantitative gate caught the original release's swapped ankles.
      // Compare against an absolute, model-space lane rather than only
      // checking for duplicate bone tracks / finite GLB values.
      assert.ok(worstFoot.separation > 0.035,
        `CMU ${entry.id} ${variant}: ankles cross/overlap (${worstFoot.separation.toFixed(3)}m at ${worstFoot.time.toFixed(2)}s)`);
      assert.ok(worstKnee.separation > 0.07,
        `CMU ${entry.id} ${variant}: knees cross (${worstKnee.separation.toFixed(3)}m at ${worstKnee.time.toFixed(2)}s)`);
      assert.ok(minToeY > -0.035,
        "CMU " + entry.id + " " + variant + ": toes penetrate floor (" + minToeY.toFixed(3) + "m)");
      assert.ok(minFootY > 0.0,
        `CMU ${entry.id} ${variant}: imported leg sinks beneath platform (${minFootY.toFixed(3)}m)`);
      console.log(JSON.stringify({
        source: entry.file, target: variant, duration: clip.duration,
        transferredJointCount: jointCount, tracks: names,
      }));
    }
  } catch (error) {
    ++errors;
    console.error(`CMU runtime probe failed for ${entry.id}: ${error instanceof Error ? error.stack : error}`);
  }
}
if (errors) process.exitCode = 1;
