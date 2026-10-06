import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { retargetMotionClips } from "../src/game/visual-quaternius-runtime";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";

async function glb(name: string) {
  const bytes = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

for (const [body, definition] of [["male", FIGHTER_DEFINITIONS.red], ["female", FIGHTER_DEFINITIONS.blue]] as const) {
  test(`${body}: kicks preserve strike geometry with grounded support and continuous ankles`, async () => {
    const [target, base, kicks, air] = await Promise.all([
      glb(`ubc-superhero-${body}-flat.glb`), glb("ual-fight-core.glb"), glb("blender-kicks-core.glb"), glb("blender-airborne-core.glb"),
    ]);
    target.scene.updateMatrixWorld(true);
    const node = (name: string) => target.scene.getObjectByName(name)!;
    const upLocal = Object.fromEntries(["l", "r"].map(s => [s, new THREE.Vector3(0, 1, 0).applyQuaternion(node(`foot_${s}`).getWorldQuaternion(new THREE.Quaternion()).invert())]));
    const source = new Map([base, kicks, air].flatMap(pack => [...retargetMotionClips(pack.scene, target.scene, pack.animations)]));
    const library = createCombatMotionLibrary(target.scene, source, definition);
    const mixer = new THREE.AnimationMixer(target.scene);
    const pose = (clip: THREE.AnimationClip, u: number) => {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true; action.play(); action.time = clip.duration * u;
      mixer.update(0); target.scene.updateMatrixWorld(true);
      const points = Object.fromEntries(["pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r", "ball_l", "ball_r", "ball_leaf_l", "ball_leaf_r"].map(n => [n, node(n).getWorldPosition(new THREE.Vector3())]));
      const feet = Object.fromEntries(["l", "r"].map(s => {
        const shin = points[`foot_${s}`].clone().sub(points[`calf_${s}`]).normalize();
        const toe = points[`ball_leaf_${s}`].clone().sub(points[`ball_${s}`]).normalize();
        const q = node(`foot_${s}`).getWorldQuaternion(new THREE.Quaternion());
        return [s, { ankleDegrees: THREE.MathUtils.radToDeg(shin.angleTo(toe)), soleTilt: THREE.MathUtils.radToDeg(upLocal[s].clone().applyQuaternion(q).angleTo(new THREE.Vector3(0, 1, 0))), q }];
      }));
      return { points, feet };
    };
    const ready = pose(library.get("CM_Ready")!, 0);
    const diagnostics: Record<string, unknown> = {};
    for (const name of ["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"]) {
      const strike = name === "BF_LowKick_L" ? "l" : "r";
      const support = strike === "l" ? "r" : "l";
      const frames = [];
      let previous: ReturnType<typeof pose> | null = null;
      const corrected = library.get(name)!;
      for (let frame = 0; frame <= 60; frame++) {
        const u = frame / 60;
        const before = pose(source.get(name)!, u);
        const after = pose(corrected, u);
        assert.ok(Math.abs(after.points[`foot_${support}`].y - ready.points[`foot_${support}`].y) < .003, `${name}/${u}: support foot left the floor`);
        assert.ok(after.feet[support].soleTilt <= ready.feet[support].soleTilt + .05, `${name}/${u}: banked support sole ${after.feet[support].soleTilt}`);
        if (u >= .27 && u <= .73) {
          const expected = name === "BF_LowKick_L" ? [45, 75] : name === "BF_RisingKick_R" ? [65, 95] : [85, 115];
          assert.ok(after.feet[strike].ankleDegrees >= expected[0] && after.feet[strike].ankleDegrees <= expected[1], `${name}/${u}: ankle ${after.feet[strike].ankleDegrees}`);
          for (const n of [`thigh_${strike}`, `calf_${strike}`, `foot_${strike}`]) {
            const original = before.points[n].clone().sub(before.points.pelvis);
            const authored = after.points[n].clone().sub(after.points.pelvis);
            assert.ok(original.distanceTo(authored) < .002, `${name}/${u}: reshaped strike ${n}`);
          }
          const knee = (p: typeof after.points) => p[`thigh_${strike}`].clone().sub(p[`calf_${strike}`]).angleTo(p[`foot_${strike}`].clone().sub(p[`calf_${strike}`]));
          assert.ok(Math.abs(knee(before.points) - knee(after.points)) < .01, `${name}/${u}: changed strike knee angle`);
          if (name === "BF_DashKick_R") assert.ok(after.points.pelvis.y <= ready.points.pelvis.y + .003, `${name}/${u}: source jump was not removed`);
        }
        if (previous) for (const s of ["l", "r"]) {
          const delta = THREE.MathUtils.radToDeg(previous.feet[s].q.angleTo(after.feet[s].q));
          assert.ok(delta < 45, `${name}/${u}/foot_${s}: ankle rotation discontinuity ${delta.toFixed(3)} deg`);
        }
        previous = after;
        frames.push({ u, before: { strike: before.feet[strike].ankleDegrees, sole: before.feet[support].soleTilt }, after: { strike: after.feet[strike].ankleDegrees, sole: after.feet[support].soleTilt } });
      }
      for (const u of [0, 1]) {
        const recovered = pose(corrected, u);
        for (const n of Object.keys(ready.points)) assert.ok(ready.points[n].distanceTo(recovered.points[n]) < .005, `${name}/${u}: entry or recovery pops at ${n}`);
      }
      diagnostics[name] = frames;
    }
    await mkdir("artifacts/kick-ankle", { recursive: true });
    await writeFile(`artifacts/kick-ankle/${body}.json`, JSON.stringify(diagnostics, null, 2));
    mixer.stopAllAction(); mixer.uncacheRoot(target.scene);
  });
}
