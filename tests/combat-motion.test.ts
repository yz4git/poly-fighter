import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { combatFootCycle, locomotionDirection, locomotionBlendAtHeading, approachLocomotionHeading } from "../src/game/combat-motion-clock";
import { retargetMotionClips } from "../src/game/visual-quaternius-runtime";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";

test("all eight movement sectors distinguish backward and lateral travel", () => {
  assert.equal(locomotionDirection(0, 1), "F");
  assert.equal(locomotionDirection(0, -1), "B");
  assert.equal(locomotionDirection(1, 0), "R");
  assert.equal(locomotionDirection(-1, 0), "L");
  assert.equal(locomotionDirection(1, 1), "FR");
  assert.equal(locomotionDirection(-1, -1), "BL");
  const first = combatFootCycle(.10), second = combatFootCycle(.20);
  assert.ok(first.planted && second.planted);
  assert.ok(Math.abs(second.travel - first.travel + .10 / .62) < 1e-9, "stance speed cancels distance-driven root travel");
  assert.deepEqual(combatFootCycle(0), combatFootCycle(1));
  assert.ok(combatFootCycle(.81).lift > .99);
});

test("eight-way analogue motion blends without phase or sector discontinuities", () => {
  for (let i = -400; i <= 400; i++) {
    const heading = i * Math.PI / 100;
    const a = locomotionBlendAtHeading(heading);
    assert.ok(Math.abs(a.firstWeight + a.secondWeight - 1) < 1e-9);
    assert.ok(a.firstWeight >= 0 && a.secondWeight >= 0);
    assert.ok(a.firstWeight <= 1 && a.secondWeight <= 1);
    const mid = locomotionBlendAtHeading(heading + 1e-5);
    assert.ok(Math.abs(mid.secondWeight - a.secondWeight) < 0.001
      || a.second !== mid.second, "blend weights are continuous within a sector");
  }
  const forward = locomotionBlendAtHeading(0);
  assert.equal(forward.first, "F");
  assert.equal(forward.firstWeight, 1);
  const diagonal = locomotionBlendAtHeading(Math.PI / 8);
  assert.equal(diagonal.first, "F");
  assert.equal(diagonal.second, "FR");
  assert.ok(Math.abs(diagonal.secondWeight - .5) < 1e-9);
  const wrap = locomotionBlendAtHeading(-Math.PI / 8);
  assert.equal(wrap.first, "FL");
  assert.equal(wrap.second, "F");
  assert.ok(Math.abs(wrap.secondWeight - .5) < 1e-9);
  const next = approachLocomotionHeading(3.13, -0.01, -1, 1 / 60);
  assert.ok(Math.abs(next - 3.13) < .15, "shortest turn crosses the backwards seam");
  const turn = approachLocomotionHeading(0, 1, 0, 1 / 60);
  assert.ok(turn > 0 && turn <= 9 / 60 + 1e-8, "direction changes are rate limited");
});

async function glb(name: string) {
  const bytes = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

for (const [body, definition] of [["male", FIGHTER_DEFINITIONS.red], ["female", FIGHTER_DEFINITIONS.blue]] as const) {
  test(`${body}: full motion library has finite transforms, planted stance and coherent recovery`, async () => {
    const [target, base] = await Promise.all([glb(`ubc-superhero-${body}-flat.glb`), glb("ual-fight-core.glb")]);
    const sources = retargetMotionClips(base.scene, target.scene, base.animations);
    const library = createCombatMotionLibrary(target.scene, sources, definition);
    for (const [name, clip] of library) {
      for (const track of clip.tracks) for (const value of track.values) assert.ok(Number.isFinite(value), `${name}/${track.name}`);
      if (name.startsWith("CM_Move") || ["CM_Ready", "CM_Guard", "CM_Crouch"].includes(name)) {
        for (const track of clip.tracks) {
          const size = track.getValueSize();
          for (let i = 0; i < size; i++) assert.ok(Math.abs(track.values[i] - track.values[track.values.length - size + i]) < 1e-5, `${name}: loop seam ${track.name}`);
        }
      }
    }
    const mixer = new THREE.AnimationMixer(target.scene);
    const pose = (name: string, phase: number) => {
      mixer.stopAllAction();
      const action = mixer.clipAction(library.get(name)!).reset();
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); action.time = action.getClip().duration * phase;
      mixer.update(0); target.scene.updateMatrixWorld(true);
      return Object.fromEntries(["pelvis", "Head", "hand_l", "hand_r", "foot_l", "foot_r"].map(bone => [bone, target.scene.getObjectByName(bone)!.getWorldPosition(new THREE.Vector3())]));
    };
    const ready = pose("CM_Ready", 0);
    assert.ok(ready.hand_l.y > ready.pelvis.y + .25 && ready.hand_r.y > ready.pelvis.y + .25, "both fists protect the upper body");
    assert.ok(ready.foot_l.x > ready.foot_r.x, "anatomical left and right legs never cross in guard");
    const recovered = pose("CM_Wakeup", 1);
    for (const name of Object.keys(ready)) assert.ok(ready[name].distanceTo(recovered[name]) < .025, `wakeup returns to the same ${name} position`);
    const down = pose("CM_Down", 1);
    assert.ok(down.Head.y < ready.Head.y * .4, "down stays on the floor");
    assert.ok(down.Head.y > -.02, "down never puts the head below the floor");
    for (const direction of ["F", "FR", "R", "BR", "B", "BL", "L", "FL"]) {
      for (let i = 0; i < 40; i++) {
        const moving = pose(`CM_Move_${direction}`, i / 40);
        assert.ok(moving.foot_l.x > moving.foot_r.x, `${direction}/${i}: locomotion keeps feet separated`);
      }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(target.scene);
  });
}
