import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { retargetMotionClips } from "../src/game/visual-quaternius-runtime";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { authoredMotionEvents } from "../src/game/combat-motion-timeline";

async function glb(name: string) {
  const bytes = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

for (const [body, definition] of [["male", FIGHTER_DEFINITIONS.red], ["female", FIGHTER_DEFINITIONS.blue]] as const) {
  test(`${body}: kicks chamber, extend and retract with a planted support toe and continuous ankles`, async () => {
    const [target, base, kicks, air] = await Promise.all([
      glb(`ubc-superhero-${body}-flat.glb`), glb("ual-fight-core.glb"), glb("blender-kicks-core.glb"), glb("blender-airborne-core.glb"),
    ]);
    target.scene.updateMatrixWorld(true);
    const bodyHeight = new THREE.Box3().setFromObject(target.scene).getSize(new THREE.Vector3()).y;
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
      const { contact, contactExit } = authoredMotionEvents(name);
      for (let frame = 0; frame <= 60; frame++) {
        const u = frame / 60;
        const before = pose(source.get(name)!, u);
        const after = pose(corrected, u);
        assert.ok(Math.abs(after.points[`foot_${support}`].y - ready.points[`foot_${support}`].y) < .003, `${name}/${u}: support foot left the floor`);
        assert.ok(after.feet[support].soleTilt <= ready.feet[support].soleTilt + .05, `${name}/${u}: banked support sole ${after.feet[support].soleTilt}`);
        assert.ok(after.points[`ball_${support}`].distanceTo(ready.points[`ball_${support}`]) < .003,
          `${name}/${u}: support toe skated while the heel pivoted`);
        for (const s of ["l", "r"]) {
          for (const [a, b] of [[`thigh_${s}`, `calf_${s}`], [`calf_${s}`, `foot_${s}`]]) {
            assert.ok(Math.abs(after.points[a].distanceTo(after.points[b]) - ready.points[a].distanceTo(ready.points[b])) < 1e-5,
              `${name}/${u}: bone length changed at ${a}`);
          }
        }
        if (u >= .27 && u <= .73) {
          const expected = name === "BF_LowKick_L" ? [45, 75] : name === "BF_RisingKick_R" ? [65, 95] : [85, 115];
          if (u >= contact - 1 / 60 && u <= contactExit + 1 / 60) {
            assert.ok(after.feet[strike].ankleDegrees >= expected[0] && after.feet[strike].ankleDegrees <= expected[1], `${name}/${u}: contact ankle ${after.feet[strike].ankleDegrees}`);
          }
          // New key poses deliberately replace the source leg trajectory. The
          // physical invariants are finite reach, a stable planted toe and an
          // actual chamber/retraction, not equality with the old imported pose.
          const pelvisDrift = Math.hypot(
            after.points.pelvis.x - ready.points.pelvis.x,
            after.points.pelvis.z - ready.points.pelvis.z,
          );
          assert.ok(pelvisDrift < bodyHeight * .25,
            `${name}/${u}: excessive attack pelvis travel ${pelvisDrift.toFixed(4)}`);
          if (name === "BF_DashKick_R") assert.ok(after.points.pelvis.y <= ready.points.pelvis.y + .003, `${name}/${u}: source jump was not removed`);
        }
        if (previous) for (const s of ["l", "r"]) {
          const delta = THREE.MathUtils.radToDeg(previous.feet[s].q.angleTo(after.feet[s].q));
          assert.ok(delta < 45, `${name}/${u}/foot_${s}: ankle rotation discontinuity ${delta.toFixed(3)} deg`);
        }
        previous = after;
        frames.push({ u, before: { strike: before.feet[strike].ankleDegrees, sole: before.feet[support].soleTilt }, after: { strike: after.feet[strike].ankleDegrees, sole: after.feet[support].soleTilt } });
      }
      const contactPose = pose(corrected, contact);
      const chamberPose = pose(corrected, contact * .60);
      const recoilPose = pose(corrected, contactExit + (1 - contactExit) * .43);
      const kneeAngle = (p: ReturnType<typeof pose>) => THREE.MathUtils.radToDeg(
        p.points[`thigh_${strike}`].clone().sub(p.points[`calf_${strike}`]).angleTo(
          p.points[`foot_${strike}`].clone().sub(p.points[`calf_${strike}`])),
      );
      assert.ok(kneeAngle(contactPose) > 120 && kneeAngle(contactPose) < 170,
        `${name}: contact knee must extend without locking`);
      assert.ok(contactPose.points[`thigh_${strike}`].z > contactPose.points[`thigh_${support}`].z + .015,
        `${name}: the striking hip must drive forward, not wind away from its own kick`);
      assert.ok(kneeAngle(chamberPose) < kneeAngle(contactPose) - 25, `${name}: knee did not chamber before contact`);
      assert.ok(kneeAngle(recoilPose) < kneeAngle(contactPose) - 25, `${name}: leg did not retract after contact`);
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

