import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { retargetMotionClips } from "../src/game/visual-quaternius-runtime";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";

async function glb(name: string) {
  const b = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
}
for (const [body, definition] of [["male", FIGHTER_DEFINITIONS.red], ["female", FIGHTER_DEFINITIONS.blue]] as const) {
  test(`${body}: contact reactions retain limb lengths, grounded support and distinct hit regions`, async () => {
    const [target, source] = await Promise.all([glb(`ubc-superhero-${body}-flat.glb`), glb("ual-fight-core.glb")]);
    const clips = createCombatMotionLibrary(target.scene, retargetMotionClips(source.scene, target.scene, source.animations), definition);
    const mixer = new THREE.AnimationMixer(target.scene);
    const names = ["Head", "pelvis", "hand_l", "hand_r", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"];
    const pose = (name: string, phase: number) => {
      mixer.stopAllAction();
      const a = mixer.clipAction(clips.get(name)!).reset().setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true; a.play(); a.time = a.getClip().duration * phase;
      mixer.update(0); target.scene.updateMatrixWorld(true);
      return Object.fromEntries(names.map(n => [n, target.scene.getObjectByName(n)!.getWorldPosition(new THREE.Vector3())]));
    };
    const ready = pose("CM_Ready", 0);
    for (const region of ["HEAD", "BODY", "LEGS", "BLOCK"]) for (const side of ["L", "R"]) {
      const name = region === "BLOCK" ? `CM_Block_${side}` : `CM_Hit_${region}_${side}`;
      assert.ok(clips.has(name));
      for (let i = 0; i <= 36; i++) {
        const p = pose(name, i / 36);
        const grounded = ["l", "r"].some(s => Math.abs(p[`foot_${s}`].y - ready[`foot_${s}`].y) < .003);
        assert.ok(grounded, `${name}/${i}: reaction lifted both feet`);
        for (const s of ["l", "r"]) for (const [a, b] of [[`thigh_${s}`, `calf_${s}`], [`calf_${s}`, `foot_${s}`]]) {
          assert.ok(Math.abs(p[a].distanceTo(p[b]) - ready[a].distanceTo(ready[b])) < 1e-5, `${name}: changed a leg length`);
        }
        for (const v of Object.values(p)) assert.ok(v.toArray().every(Number.isFinite));
      }
      if (region !== "BLOCK") for (const phase of [0, 1]) {
        const p = pose(name, phase);
        for (const n of names) assert.ok(p[n].distanceTo(ready[n]) < .005, `${name}/${phase}: failed to return to guard at ${n}`);
      }
    }
    const head = pose("CM_Hit_HEAD_L", .17), bodyHit = pose("CM_Hit_BODY_L", .17);
    assert.ok(head.Head.distanceTo(bodyHit.Head) > .04, "head and body hits must have different silhouettes");
    const low = pose("CM_Hit_LEGS_L", .29);
    assert.ok(low.pelvis.y < ready.pelvis.y - .07, "low kick must visibly buckle the stance");
    mixer.stopAllAction(); mixer.uncacheRoot(target.scene);
  });
}
