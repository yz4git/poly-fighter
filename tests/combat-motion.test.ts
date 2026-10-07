import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { combatFootCycle, locomotionDirection, locomotionBlendAtHeading, approachLocomotionHeading } from "../src/game/combat-motion-clock";
import { isKineticKick, sampleKickKineticChain } from "../src/game/combat-kinetic-chain";
import { isKineticPunch, punchStrikeSide, samplePunchKineticChain } from "../src/game/combat-punch-kinetics";
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
  assert.ok(Math.abs(Math.atan2(Math.sin(next - 3.13), Math.cos(next - 3.13))) < .15, "shortest turn crosses the backwards seam");
  const turn = approachLocomotionHeading(0, 1, 0, 1 / 60);
  assert.ok(turn > 0 && turn <= 9 / 60 + 1e-8, "direction changes are rate limited");
});

test("four distinct kick kinetic chains preserve endpoints and bounded bone counter-rotation", () => {
  const names = ["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"];
  const profiles = new Set<string>();
  for (const name of names) {
    assert.equal(isKineticKick(name), true);
    for (const edge of [0, 1]) {
      const pose = sampleKickKineticChain(name, edge);
      for (const value of Object.values(pose)) assert.ok(Math.abs(value) < 1e-10, `${name} endpoint is not neutral`);
    }
    let last = sampleKickKineticChain(name, 0);
    for (let frame = 1; frame <= 120; frame++) {
      const pose = sampleKickKineticChain(name, frame / 120);
      for (const [key, value] of Object.entries(pose)) {
        assert.ok(Number.isFinite(value), `${name}/${key} not finite`);
        const isEnvelope = ["preparation", "drive", "recovery"].includes(key);
        assert.ok(Math.abs(value) <= (isEnvelope ? 1.001 : .25),
          `${name}/${key} excessive displacement`);
        const maximumFrameChange = isEnvelope ? .18 : .05;
        assert.ok(Math.abs(value - last[key as keyof typeof pose]) < maximumFrameChange,
          `${name}/${key} snapped between 120 Hz samples`);
      }
      last = pose;
    }
    const contact = sampleKickKineticChain(name, .55);
    assert.ok(contact.drive > .5, `${name} missing transfer into strike`);
    profiles.add(contact.supportPivot.toFixed(5) + ":" + contact.torsoPitch.toFixed(5));
  }
  assert.equal(profiles.size, 4, "front, low, rising and dash should not share a generic motion");
  assert.equal(isKineticKick("BF_Cross_R"), false);
  assert.equal(sampleKickKineticChain("BF_Cross_R", .5).torsoYaw, 0);
});

test("eight authored punch styles use bounded, independent kinetic chains", () => {
  const names = [
    "BF_Jab_L", "BF_Cross_R", "BF_BodyBlow_L", "BF_BodyBlow_R",
    "BF_Backfist_R", "BF_Backfist_L", "BF_Power_R", "BF_Counter_R",
  ];
  for (const name of names) {
    assert.equal(isKineticPunch(name), true);
    assert.ok(punchStrikeSide(name) === "l" || punchStrikeSide(name) === "r");
    for (const edge of [0, 1]) {
      const pose = samplePunchKineticChain(name, edge);
      for (const value of Object.values(pose)) assert.ok(Math.abs(value) < 1e-10, `${name}: boundary must return to common guard`);
    }
    let last = samplePunchKineticChain(name, 0);
    let peakDrive = 0;
    for (let frame = 1; frame <= 120; frame++) {
      const p = samplePunchKineticChain(name, frame / 120);
      peakDrive = Math.max(peakDrive, p.drive);
      for (const [channel, value] of Object.entries(p)) {
        const normalized = ["preparation", "drive", "recovery", "guardRetention", "contactLock"].includes(channel);
        assert.ok(Number.isFinite(value) && Math.abs(value) <= (normalized ? 1.001 : .19),
          `${name}/${channel}: excess body displacement or nonfinite channel`);
        assert.ok(Math.abs(value - last[channel as keyof typeof p]) < (normalized ? .20 : .04),
          `${name}/${channel}: 120 Hz kinetic-chain snap`);
      }
      last = p;
    }
    assert.ok(peakDrive > .9, `${name}: peak force missing from contact`);
  }
  const left = samplePunchKineticChain("BF_BodyBlow_L", .51);
  const right = samplePunchKineticChain("BF_BodyBlow_R", .51);
  assert.ok(Math.abs(left.comSide + right.comSide) < 1e-10, "mirrored weight shift must reverse laterally");
  assert.ok(Math.abs(left.pelvisYaw + right.pelvisYaw) < 1e-10, "mirrored hip torque must reverse");
  assert.ok(samplePunchKineticChain("BF_Power_R", .50).torsoYaw >
    samplePunchKineticChain("BF_Jab_L", .50).torsoYaw, "power strike must rotate trunk more than jab");
  assert.equal(isKineticPunch("BF_FrontKick_R"), false);
  assert.equal(samplePunchKineticChain("BF_FrontKick_R", .5).torsoYaw, 0);
});

async function glb(name: string) {
  const bytes = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

for (const [body, definition] of [["male", FIGHTER_DEFINITIONS.red], ["female", FIGHTER_DEFINITIONS.blue]] as const) {
  test(`${body}: imported punch gloves follow Blender contact with grounded foot plants and mirrored guards`, async () => {
    const [target, base, cross, strikes] = await Promise.all([
      glb(`ubc-superhero-${body}-flat.glb`), glb("ual-fight-core.glb"),
      glb("blender-cross-core.glb"), glb("blender-strikes-core.glb"),
    ]);
    const sources = new Map([base, cross, strikes].flatMap(pack =>
      [...retargetMotionClips(pack.scene, target.scene, pack.animations)]));
    const library = createCombatMotionLibrary(target.scene, sources, definition);
    const corePunches = ["BF_Jab_L", "BF_Cross_R", "BF_BodyBlow_L", "BF_Backfist_R"];
    for (const name of corePunches) {
      assert.ok(sources.has(name), `${name} source motion missing`);
      assert.ok(library.has(name), `${name} authored motion missing`);
    }
    for (const mirror of ["BF_BodyBlow_R", "BF_Backfist_L"]) assert.ok(library.has(mirror), `${mirror} mirrored motion missing`);
    const mixer = new THREE.AnimationMixer(target.scene);
    const bone = (name: string) => target.scene.getObjectByName(name)!;
    const evaluate = (clip: THREE.AnimationClip, u: number) => {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.time = clip.duration * u;
      mixer.update(0);
      target.scene.updateMatrixWorld(true);
      return Object.fromEntries(
        ["pelvis", "Head", "hand_l", "hand_r", "foot_l", "foot_r", "lowerarm_l", "lowerarm_r"].map(n =>
          [n, bone(n).getWorldPosition(new THREE.Vector3())],
        ),
      );
    };
    const ready = evaluate(library.get("CM_Ready")!, 0);
    const bodyHeight = new THREE.Box3().setFromObject(target.scene).getSize(new THREE.Vector3()).y;
    for (const name of [...corePunches, "BF_BodyBlow_R", "BF_Backfist_L"]) {
      const clip = library.get(name)!;
      const side = punchStrikeSide(name)!;
      const other = side === "l" ? "r" : "l";
      let previous: Record<string, THREE.Vector3> | null = null;
      for (let frame = 0; frame <= 60; frame++) {
        const u = frame / 60;
        const p = evaluate(clip, u);
        for (const point of Object.values(p)) for (const coordinate of point) assert.ok(Number.isFinite(coordinate), `${name}/${u} nonfinite pose`);
        if (u >= .25 && u <= .76) {
          for (const suffix of ["l", "r"]) {
            assert.ok(Math.abs(p[`foot_${suffix}`].y - ready[`foot_${suffix}`].y) < .012,
              `${name}/${u}: stance foot ${suffix} drifted from floor`);
          }
          const planar = Math.hypot(p.pelvis.x - ready.pelvis.x, p.pelvis.z - ready.pelvis.z);
          assert.ok(planar < bodyHeight * .22, `${name}/${u}: torso tunnels into opponent`);
        }
        // Source end effectors are the goal, not the old shoulder-driven arc.
        if (sources.has(name) && u >= .38 && u <= .68) {
          const original = evaluate(sources.get(name)!, u);
          const before = original[`hand_${side}`].clone().sub(original.pelvis);
          const after = p[`hand_${side}`].clone().sub(p.pelvis);
          assert.ok(before.distanceTo(after) < bodyHeight * .060,
            `${name}/${u}: striking glove deviated from authored contact path`);
        }
        if (previous) {
          assert.ok(p[`hand_${side}`].distanceTo(previous[`hand_${side}`]) < bodyHeight * .16,
            `${name}/${u}: snapping striking glove`);
          assert.ok(p[`hand_${other}`].distanceTo(previous[`hand_${other}`]) < bodyHeight * .16,
            `${name}/${u}: snapping guard`);
        }
        previous = p;
      }
      for (const u of [0, 1]) {
        const p = evaluate(clip, u);
        for (const part of Object.keys(ready)) assert.ok(p[part].distanceTo(ready[part]) < .009, `${name}: pose pop at ${part}/${u}`);
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(target.scene);
  });
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
