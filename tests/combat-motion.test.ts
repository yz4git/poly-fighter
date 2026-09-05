import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { AUTHORED_CONTACT_PHASE, combatAttackPhase, combatFootCycle, locomotionDirection } from "../src/game/combat-motion-clock";
import { retargetMotionClips } from "../src/game/visual-quaternius-runtime";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";

test("every move reaches its authored contact on the first active tick and returns completely", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) for (const move of Object.values(definition.moves)) {
    for (const impact of Object.values(AUTHORED_CONTACT_PHASE)) {
      const total = move.startup + move.active + move.recovery;
      let previous = -1;
      for (let tick = 0; tick < total; tick += .25) {
        const phase = combatAttackPhase(move, tick, impact);
        assert.ok(phase >= previous && phase >= 0 && phase <= 1, `${move.id}: monotonic phase`);
        previous = phase;
      }
      assert.equal(combatAttackPhase(move, move.startup, impact), impact);
      assert.equal(combatAttackPhase(move, total - 1, impact), 1);
    }
  }
});

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

async function glb(name: string) {
  const bytes = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

for (const [body, definition] of [["male", FIGHTER_DEFINITIONS.red], ["female", FIGHTER_DEFINITIONS.blue]] as const) {
  test(`${body}: full motion library has finite transforms, planted stance and coherent recovery`, async () => {
    const [target, base] = await Promise.all([glb(`ubc-superhero-${body}-flat.glb`), glb("ual-fight-core.glb")]);
    const sources = retargetMotionClips(base.scene, target.scene, base.animations);
    const library = createCombatMotionLibrary(target.scene, sources, definition);
    assert.equal([...library.keys()].filter(name => name.startsWith("CM_")).length, 27);
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
      const action = mixer.clipAction(library.get(name)!);
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
    mixer.stopAllAction(); mixer.uncacheRoot(target.scene);
  });
}
