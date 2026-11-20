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
      const clip = retargetCmuPilotClip(gltf.scene, target, gltf.animations, entry.id);
      const names = clip.tracks.map((track) => track.name);
      const jointCount = clip.tracks.filter((track) => track.name.endsWith(".quaternion")).length;
      assert.equal(new Set(names).size, names.length, "duplicate target animation track");
      assert.ok(jointCount >= 20, `Expected >=20 compatible joints; got ${jointCount}`);
      for (const track of clip.tracks) {
        assert.ok([...track.values].every(Number.isFinite), `non-finite values in ${track.name}`);
        assert.ok(!track.name.endsWith(".position"), "CMU preview must be in-place");
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
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(target);
      console.log("CMU_STANCE_AUDIT", JSON.stringify({
        source: entry.file, target: variant, frames, worstFoot, worstKnee,
        minFootY, maxFootY,
      }));
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
