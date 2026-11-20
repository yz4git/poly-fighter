/**
 * Optional full GLTFLoader+retarget smoke on actual upstream CMU GLBs and both
 * committed UBC skins. Run with: node --import tsx scripts/check-cmu-runtime.mjs
 * This test is deliberately outside the mandatory build: it needs network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
