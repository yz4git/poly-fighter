import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { motionDnaForFighter } from "../src/game/motion-profile";
import { samplePunchKineticChain } from "../src/game/combat-punch-kinetics";
import { sampleKickKineticChain } from "../src/game/combat-kinetic-chain";
import {
  MOTIONBRICKS_FULLBODY_FORCE_VERSION,
  ballAnchoredStancePivot,
  stylePunchKinetics,
  styleKickUpperBody,
} from "../src/game/combat-force-transfer";
import { createCombatMotionLibrary } from "../src/game/combat-motion-authoring";
import { retargetMotionClips } from "../src/game/motion-retarget";

const kairo = motionDnaForFighter(FIGHTER_DEFINITIONS.red);
const sera = motionDnaForFighter(FIGHTER_DEFINITIONS.blue);

test("style motion DNA drives different pelvis, spine, recoil and lateral force without changing impact locks", () => {
  assert.equal(MOTIONBRICKS_FULLBODY_FORCE_VERSION, "AUTHORED_GROUNDUP_FORCE_V1");
  const source = samplePunchKineticChain("BF_Cross_R", .50);
  const heavy = stylePunchKinetics(source, kairo);
  const quick = stylePunchKinetics(source, sera);
  assert.ok(Math.abs(heavy.pelvisYaw) > Math.abs(quick.pelvisYaw));
  assert.ok(Math.abs(heavy.torsoYaw) > Math.abs(quick.torsoYaw));
  assert.ok(Math.abs(heavy.comForward) > Math.abs(quick.comForward));
  assert.ok(Math.abs(quick.comSide) > Math.abs(heavy.comSide), "SERA retains agile lateral balance");
  assert.equal(heavy.contactLock, source.contactLock);
  assert.equal(quick.contactLock, source.contactLock);
  const tail = samplePunchKineticChain("BF_Cross_R", .78);
  assert.notEqual(stylePunchKinetics(tail, kairo).torsoYaw, stylePunchKinetics(tail, sera).torsoYaw);
  for (const name of ["BF_Jab_L", "BF_Cross_R", "BF_BodyBlow_L", "BF_Backfist_R", "BF_Power_R"]) {
    for (const edge of [0, 1]) {
      const styled = stylePunchKinetics(samplePunchKineticChain(name, edge), kairo);
      for (const value of Object.values(styled)) assert.ok(Math.abs(value) < 1e-10, name + " neutral seam");
    }
  }
});

test("kick upper body impulse is authored-contact synced and cannot move hips or ankles", () => {
  const kickNames = ["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"];
  const signatures = new Set();
  for (const name of kickNames) {
    const event = sampleKickKineticChain(name, .52);
    const heavy = styleKickUpperBody(event, kairo);
    const quick = styleKickUpperBody(event, sera);
    assert.ok(Math.abs(heavy.torsoYaw) > Math.abs(quick.torsoYaw));
    signatures.add(heavy.torsoYaw.toFixed(5) + heavy.torsoPitch.toFixed(5));
    assert.deepEqual(Object.keys(heavy).sort(), ["torsoYaw", "torsoPitch", "shoulderYaw", "chestRoll", "headCounterYaw"].sort());
    for (const value of Object.values(heavy)) assert.ok(Number.isFinite(value) && Math.abs(value) < .25);
    for (const edge of [0, 1]) {
      for (const value of Object.values(styleKickUpperBody(sampleKickKineticChain(name, edge), kairo)))
        assert.ok(Math.abs(value) < 1e-10, name + " starts and ends in neutral");
    }
  }
  assert.equal(signatures.size, 4, "four kicking silhouettes must keep distinct full-body counter-rotation");
});

test("ball-anchored pivot keeps the toe world anchor fixed when the heel rotates", () => {
  const ankle = new THREE.Vector3(.15, .12, -.07);
  const ball = new THREE.Vector3(.15, .08, .15);
  const rest = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .02);
  for (const yaw of [-.20, -.10, 0, .12, .24]) {
    const planned = ballAnchoredStancePivot(ankle, ball, rest, yaw);
    const delta = planned.rotation.clone().multiply(rest.clone().invert());
    const toe = planned.ankle.clone().add(ball.clone().sub(ankle).applyQuaternion(delta));
    assert.ok(toe.distanceTo(ball) < 1e-8, "ball of foot cannot skate when heel pivots");
    assert.ok(Math.abs(planned.ankle.y - ankle.y) < 1e-10);
    assert.ok(Math.abs(planned.rotation.length() - 1) < 1e-10);
  }
  const pathological = ballAnchoredStancePivot(ankle, ball, rest, Number.NaN,
    new THREE.Vector3(.01, 999, -.015));
  assert.equal(pathological.ankle.y, ankle.y);
  assert.ok(pathological.ankle.distanceTo(ankle) < .03);
  assert.deepEqual(ankle.toArray(), [.15, .12, -.07], "rest bind is immutable");
});

async function glb(name: string) {
  const data = await readFile(new URL(`../public/models/quaternius/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
}

for (const [body, definition] of [["male", FIGHTER_DEFINITIONS.red], ["female", FIGHTER_DEFINITIONS.blue]] as const) {
  test(`${body}: full-body strike keys retain planted toe and a closed neutral seam`, async () => {
    const [target, base, cross, strikes, kicks] = await Promise.all([
      glb(`ubc-superhero-${body}-flat.glb`), glb("ual-fight-core.glb"),
      glb("blender-cross-core.glb"), glb("blender-strikes-core.glb"),
      glb("blender-kicks-core.glb"),
    ]);
    const clips = new Map([base, cross, strikes, kicks].flatMap(pack =>
      [...retargetMotionClips(pack.scene, target.scene, pack.animations)]));
    const authored = createCombatMotionLibrary(target.scene, clips, definition);
    const mixer = new THREE.AnimationMixer(target.scene);
    const bone = (name: string) => target.scene.getObjectByName(name)!;
    const pose = (clipName: string, u: number, original = false) => {
      mixer.stopAllAction();
      const clip = original ? clips.get(clipName)! : authored.get(clipName)!;
      assert.ok(clip, `missing ${clipName}`);
      const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.time = clip.duration * u;
      mixer.update(0); target.scene.updateMatrixWorld(true);
      return Object.fromEntries(["pelvis", "spine_03", "neck_01", "upperarm_l", "upperarm_r", "hand_l", "hand_r", "foot_l", "foot_r", "ball_l", "ball_r"].map(n =>
        [n, { position: bone(n).getWorldPosition(new THREE.Vector3()), rotation: bone(n).getWorldQuaternion(new THREE.Quaternion()) }]));
    };
    const ready = pose("CM_Ready", 0);
    const height = new THREE.Box3().setFromObject(target.scene).getSize(new THREE.Vector3()).y;

    // Inspect the actual baked contact skeleton, not a hand-edited reference
    // pose or a gameplay hitbox. The same pelvis-relative chest/neck ratios are
    // enforced by scripts/capture-motion-readability-audit.mjs in browser WebGL.
    const palm = pose("CM_Video_Palm", .50);
    const pelvis = palm.pelvis.position;
    const lean = (item: THREE.Vector3) => Math.hypot(item.x - pelvis.x, item.z - pelvis.z)
      / Math.max(1e-6, Math.abs(item.y - pelvis.y));
    assert.ok(lean(palm.spine_03.position) <= .42,
      `${body} palm chest exceeded the 0.42 torso cone: ${lean(palm.spine_03.position).toFixed(4)}`);
    assert.ok(lean(palm.neck_01.position) <= .48,
      `${body} palm neck exceeded the 0.48 torso cone: ${lean(palm.neck_01.position).toFixed(4)}`);
    assert.ok(palm.hand_r.position.distanceTo(ready.hand_r.position) > height * .16,
      `${body} palm lost the right-hand forward strike`);
    for (const suffix of ["l", "r"]) {
      assert.ok(palm[`foot_${suffix}`].position.distanceTo(ready[`foot_${suffix}`].position) < height * .085,
        `${body} palm lost its two-foot base`);
    }

    const kick = pose("CM_Video_SideKick", .50);
    const kickPelvis = kick.pelvis.position;
    const kickLean = (item: THREE.Vector3) => Math.hypot(item.x - kickPelvis.x, item.z - kickPelvis.z)
      / Math.max(1e-6, Math.abs(item.y - kickPelvis.y));
    assert.ok(kickLean(kick.spine_03.position) <= .42,
      `${body} sidekick chest exceeded the torso cone: ${kickLean(kick.spine_03.position).toFixed(4)}`);
    assert.ok(kickLean(kick.neck_01.position) <= .48,
      `${body} sidekick neck exceeded the torso cone: ${kickLean(kick.neck_01.position).toFixed(4)}`);
    assert.ok(kick.foot_r.position.y > ready.foot_r.position.y + height*.30,
      `${body} sidekick lost its real extended raised boot`);
    assert.ok(kick.foot_l.position.distanceTo(ready.foot_l.position) < height*.10,
      `${body} sidekick lost the support foot`);

    for (const clipName of ["BF_Jab_L", "BF_Cross_R", "BF_BodyBlow_L", "BF_Backfist_R", "BF_FrontKick_R", "BF_LowKick_L"]) {
      let previous = pose(clipName, 0);
      for (let frame = 1; frame <= 60; frame++) {
        const u = frame / 60;
        const current = pose(clipName, u);
        for (const item of Object.values(current)) {
          for (const coordinate of item.position) assert.ok(Number.isFinite(coordinate), `${clipName} finite coordinates`);
        }
        if (clipName.includes("Kick") && u > .20 && u < .76) {
          const support = clipName === "BF_LowKick_L" ? "r" : "l";
          assert.ok(current[`ball_${support}`].position.distanceTo(ready[`ball_${support}`].position) < .005,
            `${body}/${clipName}/${u} support toe slipped`);
        } else if (!clipName.includes("Kick") && u >= .25 && u <= .75) {
          for (const suffix of ["l", "r"]) {
            assert.ok(current[`ball_${suffix}`].position.distanceTo(ready[`ball_${suffix}`].position) < height * .035,
              `${body}/${clipName}/${u} toe drift exceeds stance budget`);
            assert.ok(Math.abs(current[`foot_${suffix}`].position.y - ready[`foot_${suffix}`].position.y) < .012,
              `${body}/${clipName}/${u} foot left ground`);
          }
        }
        const authoredChange = current.spine_03.rotation.angleTo(previous.spine_03.rotation);
        if (authoredChange >= .40 && clips.has(clipName)) {
          // The imported Blender clips contain several intentionally fast axial
          // turns. Distinguish a pre-existing source lunge from a NEW generated
          // discontinuity rather than rejecting all fast choreography.
          const sourceBefore = pose(clipName, (frame - 1) / 60, true);
          const sourceNow = pose(clipName, u, true);
          const sourceChange = sourceNow.spine_03.rotation.angleTo(sourceBefore.spine_03.rotation);
          assert.ok(authoredChange < Math.max(.42, sourceChange * 1.20 + .06),
            `${body}/${clipName}/${u} added torso snap: authored=${authoredChange.toFixed(3)} source=${sourceChange.toFixed(3)}`);
        }
        previous = current;
      }
      for (const edge of [0, 1]) {
        const seam = pose(clipName, edge);
        for (const n of ["pelvis", "hand_l", "hand_r", "foot_l", "foot_r"])
          assert.ok(seam[n].position.distanceTo(ready[n].position) < .012,
            `${body}/${clipName}/${edge} neutral seam popped at ${n}`);
      }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(target.scene);
  });
}
