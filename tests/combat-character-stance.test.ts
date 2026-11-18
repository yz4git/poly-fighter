import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PLAYABLE_FIGHTERS } from "../src/game/playable-fighters";
import { combatCharacterStance, COMBAT_CHARACTER_STANCE_VERSION } from "../src/game/combat-character-stance";
import { motionDnaForFighter } from "../src/game/motion-profile";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { retargetMotionClips } from "../src/game/visual-quaternius-runtime";

const fighters = Object.fromEntries(PLAYABLE_FIGHTERS.map(f => [f.name, f]));
const names = ["KAIRO", "SERA", "VANTA", "AXION"] as const;

test("all four playable fighters have separately authored full-body identities", () => {
  assert.equal(COMBAT_CHARACTER_STANCE_VERSION, "FOUR_FIGHTER_AUTHORED_STANCE_V1");
  assert.deepEqual(Object.keys(fighters).sort(), [...names].sort());
  const stanceIds = new Set<string>();
  const dnaIds = new Set<string>();
  for (const name of names) {
    const f = fighters[name];
    const stance = combatCharacterStance(f.name, f.archetype);
    const dna = motionDnaForFighter(f);
    assert.equal(stance.id.split("_")[0], name);
    assert.equal(dna.id.split("_")[0], name);
    assert.ok(!stanceIds.has(stance.id), name + " must own its own ready/guard/step body pose");
    assert.ok(!dnaIds.has(dna.id), name + " cannot silently reuse SPEED/POWER kinetic DNA");
    stanceIds.add(stance.id); dnaIds.add(dna.id);
    assert.ok(stance.widthScale >= .9 && stance.widthScale <= 1.14);
    assert.ok(Math.abs(stance.pelvisYaw) <= .11);
    for (const hand of [stance.leftGuard, stance.rightGuard]) {
      assert.ok(hand.every(Number.isFinite));
      assert.ok(hand[1] >= .71 && hand[1] <= .8, "guard covers upper body, not sky");
      assert.ok(hand[2] >= .10 && hand[2] <= .19, "guard stays forward of chin");
    }
    for (const channel of [dna.hipLead, dna.chestFollow, dna.recoil, dna.lateral, dna.guardDiscipline]) {
      assert.ok(Number.isFinite(channel) && channel > 0 && channel < 1.8);
    }
  }
  assert.equal(stanceIds.size, 4);
  assert.equal(dnaIds.size, 4);
  assert.ok(motionDnaForFighter(fighters.AXION).hipLead > motionDnaForFighter(fighters.KAIRO).hipLead);
  assert.ok(motionDnaForFighter(fighters.VANTA).chestFollow > motionDnaForFighter(fighters.SERA).chestFollow);
  assert.ok(combatCharacterStance("AXION", "POWER").gaitBounce < combatCharacterStance("SERA", "SPEED").gaitBounce);
});

async function glb(name: string) {
  const bytes = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

function track(clip: THREE.AnimationClip, target: string): THREE.KeyframeTrack {
  const found = clip.tracks.find(t => t.name === target);
  assert.ok(found, clip.name + "/" + target + ": missing actual bone channel");
  return found;
}
function separated(a: THREE.KeyframeTrack, b: THREE.KeyframeTrack): boolean {
  assert.equal(a.values.length, b.values.length);
  return [...a.values].some((v, i) => Math.abs(v - b.values[i]) > 1e-5);
}

for (const [first, second, body] of [
  ["KAIRO", "AXION", "male"],
  ["SERA", "VANTA", "female"],
] as const) {
  test(`${first}/${second}: same underlying imported skeleton, different full-body stance and movement clips`, async () => {
    const [base, target] = await Promise.all([
      glb("ual-fight-core.glb"),
      glb(`ubc-superhero-${body}-flat.glb`),
    ]);
    const sourceClips = retargetMotionClips(base.scene, target.scene, base.animations);
    const a = createCombatMotionLibrary(target.scene, sourceClips, fighters[first]);
    const b = createCombatMotionLibrary(target.scene, sourceClips, fighters[second]);
    assert.ok(a.has("CM_Ready") && b.has("CM_Ready"));
    for (const name of ["CM_Ready", "CM_Guard", "CM_Move_F", "CM_Move_R"]) {
      const ac = a.get(name)!, bc = b.get(name)!;
      assert.ok(separated(track(ac, "pelvis.quaternion"), track(bc, "pelvis.quaternion")),
        `${first}/${second}: ${name} must have a different hip silhouette`);
      for (const clip of [ac, bc]) {
        for (const channel of clip.tracks) {
          assert.ok([...channel.values].every(Number.isFinite), `${clip.name}/${channel.name}: non-finite key`);
        }
        const pelvis = track(clip, "pelvis.position");
        assert.deepEqual([...pelvis.values.slice(0, 3)], [...pelvis.values.slice(-3)],
          `${clip.name}: the model must keep its looping root seam`);
      }
    }
    const ag = a.get("CM_Guard")!, bg = b.get("CM_Guard")!;
    assert.ok(
      separated(track(ag, "upperarm_l.quaternion"), track(bg, "upperarm_l.quaternion"))
      || separated(track(ag, "upperarm_r.quaternion"), track(bg, "upperarm_r.quaternion")),
      "guard silhouette must be different beyond just head/hip animation",
    );
    for (const clips of [a, b]) {
      const ready = clips.get("CM_Ready")!, wake = clips.get("CM_Wakeup")!;
      for (const name of ["pelvis.quaternion", "pelvis.position", "hand_l.quaternion", "hand_r.quaternion"]) {
        const original = track(ready, name);
        const recovery = track(wake, name);
        const size = original.getValueSize();
        for (let i = 0; i < size; i++) {
          assert.ok(Math.abs(original.values[i] - recovery.values[recovery.values.length - size + i]) < 1e-5,
            `${first}/${second}: wakeup must return to the uniquely authored guard (${name}/${i})`);
        }
      }
    }
  });
}
