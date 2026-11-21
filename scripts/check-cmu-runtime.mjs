/**
 * Optional full GLTFLoader+retarget smoke on actual upstream CMU GLBs and both
 * committed UBC skins. Run with: node --import tsx scripts/check-cmu-runtime.mjs
 * This test is deliberately outside the mandatory build: it needs network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { buildCmuStanceLockedClip } from "../src/game/cmu-foot-lock.ts";
import { extractCmuBoxingStrikes } from "../src/game/cmu-strike-extraction.ts";
import { buildCmuBoxingFistClip } from "../src/game/cmu-boxing-fist.ts";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
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
      const diagnostics = { fitted: [], fallback: [], alignment: [] };
      const clip = retargetCmuPilotClip(gltf.scene, target, gltf.animations, entry.id, "WORLD", diagnostics);
      const names = clip.tracks.map((track) => track.name);
      const jointCount = clip.tracks.filter((track) => track.name.endsWith(".quaternion")).length;
      assert.equal(new Set(names).size, names.length, "duplicate target animation track");
      assert.ok(jointCount >= 20, `Expected >=20 compatible joints; got ${jointCount}`);
      for (const track of clip.tracks) {
        assert.ok([...track.values].every(Number.isFinite), `non-finite values in ${track.name}`);
        if (track.name.endsWith(".position")) {
          assert.equal(track.name, "pelvis.position", "only vertical contact correction may move the root");
        }
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
      let minToeY = Infinity;
      let maxToeY = -Infinity;
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
        const toeLeft = P("ball_l").y;
        const toeRight = P("ball_r").y;
        minToeY = Math.min(minToeY, toeLeft, toeRight);
        maxToeY = Math.max(maxToeY, toeLeft, toeRight);
      }
      // Source/target kinematic fidelity: compare actual segment directions
      // in both played skeletons, not just animation track names. This
      // detects the previous T-pose bug even when ankle clearance passes.
      const comparison = [
        ["lhumerus", "lradius", "upperarm_l", "lowerarm_l"],
        ["lradius", "lwrist", "lowerarm_l", "hand_l"],
        ["rhumerus", "rradius", "upperarm_r", "lowerarm_r"],
        ["rradius", "rwrist", "lowerarm_r", "hand_r"],
        ["lfemur", "ltibia", "thigh_l", "calf_l"],
        ["ltibia", "lfoot", "calf_l", "foot_l"],
        ["rfemur", "rtibia", "thigh_r", "calf_r"],
        ["rtibia", "rfoot", "calf_r", "foot_r"],
      ];
      assert.equal(diagnostics.fitted.includes("upperarm_l"), true);
      assert.equal(diagnostics.fitted.includes("lowerarm_l"), true);
      const aligned = new THREE.Quaternion().fromArray(diagnostics.alignment);
      // Re-arm the target action: the preceding full-clip stance audit leaves
      // LoopOnce/clampWhenFinished paused at the end pose. Merely seeking the
      // mixer again will otherwise compare a frozen final pose to live source.
      action.reset().play();
      const sourceMixer = new THREE.AnimationMixer(gltf.scene);
      const sourceAction = sourceMixer.clipAction(gltf.animations[0]).play();
      sourceAction.setLoop(THREE.LoopOnce, 1);
      sourceAction.clampWhenFinished = true;
      let maxAngularErrorDegrees = 0;
      let totalAngularErrorDegrees = 0;
      let measurements = 0;
      let biggestError = null;
      for (let sample = 0; sample <= 32; sample++) {
        const time = clip.duration * sample / 32;
        sourceMixer.setTime(time);
        mixer.setTime(time);
        gltf.scene.updateWorldMatrix(true, true);
        target.updateWorldMatrix(true, true);
        for (const [srcA, srcB, dstA, dstB] of comparison) {
          const sourceA = gltf.scene.getObjectByName(srcA);
          const sourceB = gltf.scene.getObjectByName(srcB);
          const targetA = target.getObjectByName(dstA);
          const targetB = target.getObjectByName(dstB);
          assert.ok(sourceA && sourceB && targetA && targetB);
          const sourceDirection = sourceB.getWorldPosition(new THREE.Vector3())
            .sub(sourceA.getWorldPosition(new THREE.Vector3()))
            .normalize().applyQuaternion(aligned);
          const targetDirection = targetB.getWorldPosition(new THREE.Vector3())
            .sub(targetA.getWorldPosition(new THREE.Vector3()))
            .normalize();
          const degrees = THREE.MathUtils.radToDeg(sourceDirection.angleTo(targetDirection));
          measurements++;
          totalAngularErrorDegrees += degrees;
          if (degrees > maxAngularErrorDegrees) {
            maxAngularErrorDegrees = degrees;
            biggestError = { time, srcA, srcB, dstA, dstB };
          }
        }
      }
      assert.ok(totalAngularErrorDegrees / measurements < 1,
        "CMU mean anatomical source/target direction error is too high");
      sourceMixer.stopAllAction();
      sourceMixer.uncacheRoot(gltf.scene);
      console.log("CMU_ANATOMICAL_FIDELITY", JSON.stringify({
        source: entry.file, target: variant,
        trackedBones: diagnostics.fitted, fallback: diagnostics.fallback,
        measurements, maxAngularErrorDegrees, meanAngularErrorDegrees: totalAngularErrorDegrees / measurements,
        biggestError,
      }));
      assert.ok(maxAngularErrorDegrees < 5,
        "CMU anatomical limb aim differs from source by " + maxAngularErrorDegrees.toFixed(2) + " deg");
      mixer.stopAllAction();
      mixer.uncacheRoot(target);
      // Later source clips must retarget against the original UBC bind pose.
      target.traverse((object) => {
        if (object.isSkinnedMesh) object.skeleton.pose();
      });
      target.updateWorldMatrix(true, true);
      console.log("CMU_STANCE_AUDIT", JSON.stringify({
        source: entry.file, target: variant, frames, worstFoot, worstKnee,
        minFootY, maxFootY, minToeY, maxToeY,
      }));
      // This quantitative gate caught the original release's swapped ankles.
      // Compare against an absolute, model-space lane rather than only
      // checking for duplicate bone tracks / finite GLB values.
      assert.ok(worstFoot.separation > 0.035,
        `CMU ${entry.id} ${variant}: ankles cross/overlap (${worstFoot.separation.toFixed(3)}m at ${worstFoot.time.toFixed(2)}s)`);
      assert.ok(worstKnee.separation > 0.07,
        `CMU ${entry.id} ${variant}: knees cross (${worstKnee.separation.toFixed(3)}m at ${worstKnee.time.toFixed(2)}s)`);
      assert.ok(minToeY > -0.015,
        "CMU " + entry.id + " " + variant + ": toes penetrate floor (" + minToeY.toFixed(3) + "m)");
      assert.ok(minFootY > 0.0,
        `CMU ${entry.id} ${variant}: imported leg sinks beneath platform (${minFootY.toFixed(3)}m)`);
      if (entry.id === "BOXING") {
        const sourceMotion = gltf.animations.reduce((best, next) =>
          next.duration > best.duration ? next : best);
        const candidates = extractCmuBoxingStrikes(gltf.scene, sourceMotion, clip);
        assert.deepEqual(candidates.map(x => x.clip.name), [
          "CMU_BOXING_RIGHT_STRAIGHT",
          "CMU_BOXING_LEFT_RIGHT_COMBO",
        ]);
        assert.deepEqual(candidates.map(x => x.preview.contacts.length), [1, 2]);
        for (const candidate of candidates) {
          const {clip: trial, preview} = candidate;
          assert.ok(trial.duration > 0.6 && trial.duration < 1.2);
          assert.ok(preview.contacts.every(c => c.normalized > 0.18 &&
            c.normalized < 0.80 && c.extensionGain >= 0.12 &&
            c.recoveryGain >= 0.10 && c.peakApproachSpeed > 0.70));
          const names = trial.tracks.map(t => t.name);
          assert.equal(new Set(names).size, names.length);
          assert.equal(names.length, clip.tracks.length,
            "Sliced punch must preserve the complete anatomical skeleton");
          for (const track of trial.tracks) {
            assert.ok(track.times.length >= 3);
            assert.ok(Math.abs(track.times[0]) < 1e-6);
            assert.ok(Math.abs(track.times[track.times.length - 1] - trial.duration) < 1e-5);
            assert.ok(Array.from(track.values).every(Number.isFinite));
            const parent = clip.tracks.find(t => t.name === track.name);
            assert.ok(parent);
            const local = track.createInterpolant();
            const original = parent.createInterpolant();
            for (const t of [0, ...preview.contacts.map(c => c.time), trial.duration]) {
              const a = Array.from(local.evaluate(t));
              const b = Array.from(original.evaluate(preview.sourceStart + t));
              if (track.name.endsWith(".quaternion")) {
                const q1 = new THREE.Quaternion().fromArray(a);
                const q2 = new THREE.Quaternion().fromArray(b);
                assert.ok(q1.angleTo(q2) < THREE.MathUtils.degToRad(1.2),
                  "Punch slicing changed " + track.name + " source animation");
              } else {
                assert.ok(Math.max(...a.map((value, i) => Math.abs(value-b[i]))) < 0.012,
                  "Punch slicing changed " + track.name + " translation");
              }
            }
          }
          const fistReport = {
            joints: 0, leftJoints: 0, rightJoints: 0,
            minStrength: 0, maxStrength: 0,
          };
          const fistClip = buildCmuBoxingFistClip(
            target, trial, preview.contacts, fistReport,
          );
          assert.equal(fistClip.name, trial.name + "_FIST");
          assert.equal(fistReport.joints, 30);
          assert.equal(fistReport.leftJoints, 15);
          assert.equal(fistReport.rightJoints, 15);
          assert.ok(fistReport.minStrength >= 0.89 && fistReport.maxStrength > 0.98);
          assert.equal(fistClip.tracks.length, trial.tracks.length + 30);
          const originalTracks = new Set(trial.tracks.map(t => t.name));
          for (const track of fistClip.tracks) {
            assert.ok([...track.values].every(Number.isFinite),
              "Fist keyframe has nonfinite values " + track.name);
            if (originalTracks.has(track.name)) {
              const original = trial.tracks.find(t => t.name === track.name);
              assert.deepEqual(Array.from(track.values), Array.from(original.values),
                "Fist bake must not alter any body/arm/wrist/leg keys");
            }
          }
          const sampleFingers = (animation, t) => {
            target.traverse(node=>{
              if(node.isSkinnedMesh)node.skeleton.pose();
            });
            const m = new THREE.AnimationMixer(target);
            const a = m.clipAction(animation).play();
            a.setLoop(THREE.LoopOnce, 1);
            a.clampWhenFinished = true;
            m.setTime(t);
            target.updateWorldMatrix(true, true);
            const records = {};
            for(const side of ["l","r"]) {
              records[side] = {};
              const hand = target.getObjectByName("hand_"+side);
              for (const digit of ["index","middle","ring","pinky","thumb"]) {
                const root = target.getObjectByName(digit+"_01_"+side);
                const tip = target.getObjectByName(digit+"_04_leaf_"+side);
                assert.ok(root && tip && hand);
                records[side][digit] = {
                  knuckleToTip: root.getWorldPosition(new THREE.Vector3())
                    .distanceTo(tip.getWorldPosition(new THREE.Vector3())),
                  handToTip: hand.getWorldPosition(new THREE.Vector3())
                    .distanceTo(tip.getWorldPosition(new THREE.Vector3())),
                };
              }
            }
            m.stopAllAction();
            m.uncacheRoot(target);
            return records;
          };
          const at = preview.contacts[0].time;
          const open = sampleFingers(trial, at);
          const closed = sampleFingers(fistClip, at);
          const reductions=[];
          for(const side of ["l","r"]) {
            for(const digit of ["index","middle","ring","pinky"]) {
              const baseline = open[side][digit].knuckleToTip;
              const flexed = closed[side][digit].knuckleToTip;
              assert.ok(flexed < baseline * 0.82,
                "Fist bone geometry not closing: "+side+" "+digit+
                  " baseline="+baseline.toFixed(3)+" flexed="+flexed.toFixed(3));
              reductions.push(1-flexed/baseline);
            }
          }
          console.log("CMU_FIST_BONE_AUDIT", JSON.stringify({
            variant, clip: fistClip.name, report:fistReport,
            minDigitCurlReduction:Math.min(...reductions),
            meanDigitCurlReduction:reductions.reduce((a,b)=>a+b,0)/reductions.length,
            thumbBaseline: {
              left: open.l.thumb.handToTip, right:open.r.thumb.handToTip,
            },
            thumbFlexed: {
              left:closed.l.thumb.handToTip,right:closed.r.thumb.handToTip,
            },
          }));
          target.traverse(node=>{
            if(node.isSkinnedMesh)node.skeleton.pose();
          });
          target.updateWorldMatrix(true,true);
          console.log("CMU_STRIKE_WINDOW_AUDIT", JSON.stringify({
            target: variant, name: trial.name, duration: trial.duration,
            sourceStart: preview.sourceStart, sourceEnd: preview.sourceEnd,
            contacts: preview.contacts,
            transferredTracks: trial.tracks.length,
          }));
        }
      }
      if (entry.id === "WALK" || entry.id === "KICK") {
        const sourceMotion = gltf.animations.reduce((a,b) =>
          b.duration > a.duration ? b : a);
        const contact = {
          lockedFrames: 0, runs: 0, meanBaselineDrift: 0,
          meanCorrectedDrift: 0, maxCorrectedDrift: 0,
          maxLegRotationDegrees: 0,
          sideRuns: {left: 0, right: 0},
        };
        const locked = buildCmuStanceLockedClip(
          gltf.scene, target, sourceMotion, clip, contact,
        );
        assert.equal(locked.name, clip.name + "_STANCE");
        assert.ok(contact.lockedFrames > 20,
          "CMU stance IK did not recognize stable source feet");
        assert.ok(contact.runs >= 2,
          "CMU stance IK did not identify both feet");
        assert.ok(locked.tracks.every(t =>
          [...t.values].every(Number.isFinite)),
          "CMU stance IK generated nonfinite keyframe samples");
        const lockedMixer = new THREE.AnimationMixer(target);
        const lockedAction = lockedMixer.clipAction(locked).play();
        lockedAction.setLoop(THREE.LoopOnce, 1);
        lockedAction.clampWhenFinished = true;
        const lockAudit = {ankleSep:Infinity,kneeSep:Infinity,toeHeight:Infinity};
        const frames = Math.ceil(locked.duration*30);
        for(let i=0;i<=frames;i++) {
          lockedMixer.setTime(locked.duration*i/frames);
          target.updateWorldMatrix(true,true);
          const p = (name)=>target.getObjectByName(name).getWorldPosition(new THREE.Vector3());
          const side = p("thigh_l").sub(p("thigh_r")).normalize();
          lockAudit.ankleSep = Math.min(lockAudit.ankleSep,
            p("foot_l").sub(p("foot_r")).dot(side));
          lockAudit.kneeSep = Math.min(lockAudit.kneeSep,
            p("calf_l").sub(p("calf_r")).dot(side));
          lockAudit.toeHeight = Math.min(lockAudit.toeHeight,p("ball_l").y,p("ball_r").y);
        }
        lockedMixer.stopAllAction();
        lockedMixer.uncacheRoot(target);
        target.traverse(node => {
          if(node.isSkinnedMesh)node.skeleton.pose();
        });
        target.updateWorldMatrix(true,true);
        console.log("CMU_FOOT_LOCK", JSON.stringify({
          source: entry.file, target: variant, ...contact,
          lockAudit,
          reduction: contact.meanBaselineDrift > 0
            ? 1 - contact.meanCorrectedDrift / contact.meanBaselineDrift : 0,
        }));
        assert.ok(lockAudit.ankleSep > 0.01,
          "STANCE IK crossed fighter feet");
        assert.ok(lockAudit.kneeSep > 0.025,
          "STANCE IK inverted fighter knees");
        assert.ok(lockAudit.toeHeight > -0.025,
          "STANCE IK drove foot below floor");
        assert.ok(contact.meanCorrectedDrift < contact.meanBaselineDrift * 0.45,
          "STANCE IK did not materially reduce measured planted-toe drift");
        assert.ok(contact.rejectedCorrections <= contact.lockedFrames * 0.1,
          "STANCE IK is rejecting too many knee-unsafe stance frames");
        assert.ok(contact.maxLegRotationDegrees < 30,
          "STANCE IK generated implausibly large joint corrections");
        assert.ok(contact.maxCorrectedDrift < 0.25,
          "STANCE IK locked an unreachable foot rather than releasing it");
      }
      if (entry.id === "WALK") {
        // Reproduce the actual viewer's clone->normalize->Skeleton.pose flow,
        // not only a raw GLTFLoader scene. Male shoulders previously remained
        // T-posed in Chrome despite clean raw-scene math.
        const cloneRig = cloneSkeleton(target);
        cloneRig.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(cloneRig);
        const center = box.getCenter(new THREE.Vector3());
        const height = Math.max(1e-5, box.getSize(new THREE.Vector3()).y);
        const normalizedHost = new THREE.Group();
        normalizedHost.scale.setScalar(1 / height);
        cloneRig.position.set(-center.x, -box.min.y, -center.z);
        normalizedHost.add(cloneRig);
        const restoredSkeletons = new Set();
        cloneRig.traverse((node) => {
          if (node.isSkinnedMesh && !restoredSkeletons.has(node.skeleton)) {
            node.skeleton.pose();
            restoredSkeletons.add(node.skeleton);
          }
        });
        cloneRig.updateWorldMatrix(true, true);
        const cloneClip = retargetCmuPilotClip(
          gltf.scene, cloneRig, gltf.animations, entry.id,
        );
        for (const joint of ["upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r",
            "thigh_l", "calf_l", "thigh_r", "calf_r"]) {
          const original = clip.tracks.find(t => t.name === joint + ".quaternion");
          const cloned = cloneClip.tracks.find(t => t.name === joint + ".quaternion");
          assert.ok(original && cloned, "Cloned viewer model is missing " + joint);
          const frame = Math.floor((original.times.length - 1) * 0.32);
          const q1 = new THREE.Quaternion().fromArray(original.values, frame * 4);
          const q2 = new THREE.Quaternion().fromArray(cloned.values, frame * 4);
          const difference = THREE.MathUtils.radToDeg(q1.angleTo(q2));
          console.log("CMU_CLONED_RIG_DIFF", JSON.stringify({variant, joint, difference}));
          assert.ok(difference < 3, "Viewer clone/bind-pose changed " + joint +
            " by " + difference.toFixed(1) + " degrees");
        }
      }
      if (entry.id === "WALK") {
        // A real MODEL VIEW nests the same skeleton under a transformed host.
        // This test rejects any retarget that changes merely because a
        // fighter is rotated/positioned/scaled in the scene (KAIRO regression).
        const host = new THREE.Group();
        host.name = "in-game-model-view-host";
        host.position.set(2.3, 0.1, -1.5);
        host.rotation.set(0.41, -0.23, 0.18);
        host.scale.setScalar(0.53);
        host.add(target);
        const mountedClip = retargetCmuPilotClip(
          gltf.scene, target, gltf.animations, entry.id,
        );
        const reference = new Map(clip.tracks.map(t => [t.name, t]));
        for (const track of mountedClip.tracks) {
          const originalTrack = reference.get(track.name);
          assert.ok(originalTrack, "Mounted target changed animated bone set");
          for (const fraction of [0, 0.14, 0.35, 0.7, 1]) {
            const a = new THREE.Quaternion();
            const b = new THREE.Quaternion();
            if (track.name.endsWith(".quaternion")) {
              const index = Math.floor((track.times.length - 1) * fraction);
              a.fromArray(originalTrack.values, index * 4);
              b.fromArray(track.values, index * 4);
              assert.ok(a.angleTo(b) < 0.015,
                "Host placement changed " + track.name + " by " +
                THREE.MathUtils.radToDeg(a.angleTo(b)).toFixed(2) + "°");
            } else if (track.name === "pelvis.position") {
              const index = Math.floor((track.times.length - 1) * fraction);
              const delta = Math.max(...[0, 1, 2].map(offset =>
                Math.abs(originalTrack.values[index * 3 + offset] -
                  track.values[index * 3 + offset])));
              assert.ok(delta < 0.015,
                "Host placement changed planted-foot pelvis height");
            }
          }
        }
        assert.equal(target.parent, host, "Canonical calibration must restore live fighter parent");
        assert.ok(target.position.distanceTo(new THREE.Vector3()) < 1e-5,
          "Canonical calibration must restore model position");
        host.remove(target);
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
