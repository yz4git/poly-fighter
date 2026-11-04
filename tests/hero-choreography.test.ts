import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { samplePunchKineticChain } from "../src/game/combat-punch-kinetics";
import { REFERENCE_KICK_VERSION, sampleReferenceKickChoreography } from "../src/game/reference-kick-choreography";
import { bakeCinematicClip, cinematicHeroWeight, cinematicPoseEnvelope } from "../src/game/cinematic-motion-library";
import { CINEMATIC_TECHNIQUES } from "../src/game/cinematic-techniques";

const near = (a: number, b: number, tolerance = 1e-7) => Math.abs(a - b) <= tolerance;

function source(name: string): THREE.AnimationClip {
  const times = [0, .2, .5, .72, 1];
  const neutral = times.flatMap(() => [0, 0, 0, 1]);
  return new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack("pelvis.quaternion", times, neutral),
    new THREE.QuaternionKeyframeTrack("spine_03.quaternion", times, neutral),
    new THREE.QuaternionKeyframeTrack("thigh_r.quaternion", times, neutral),
    new THREE.QuaternionKeyframeTrack("upperarm_l.quaternion", times, neutral),
    new THREE.QuaternionKeyframeTrack("foot_l.quaternion", times, neutral),
    new THREE.VectorKeyframeTrack("pelvis.position", times, times.flatMap(() => [0, 1, 0])),
  ]);
}

test("seven supers use a distinct three-beat full-body animation envelope", () => {
  assert.equal(cinematicPoseEnvelope(0), 0);
  assert.equal(cinematicPoseEnvelope(1), 0);
  assert.ok(cinematicPoseEnvelope(.20) < -.22, "must wind up opposite the strike");
  assert.ok(cinematicPoseEnvelope(.5) > .9, "large contact silhouette");
  assert.ok(cinematicPoseEnvelope(.87) < 0, "a physical counter-swing");
  for (let i = 0; i <= 120; i += 1) {
    const phase = i / 120;
    assert.ok(Number.isFinite(cinematicPoseEnvelope(phase)));
    assert.ok(Math.abs(cinematicPoseEnvelope(phase)) <= 1.01);
  }

  for (const role of CINEMATIC_TECHNIQUES) {
    const base = source("BF_FrontKick_R");
    const cinematic = bakeCinematicClip(base, role, "AXION");
    const foot = cinematic.tracks.find(t => t.name === "foot_l.quaternion")!;
    assert.deepEqual([...foot.values], [...base.tracks[4].values], role + " may not retarget planted foot");
    const torso = cinematic.tracks.find(t => t.name === "spine_03.quaternion")!;
    const first = [...torso.values.slice(0, 4)];
    const middle = [...torso.values.slice(8, 12)];
    const last = [...torso.values.slice(-4)];
    assert.deepEqual(first, [0, 0, 0, 1], role + " must start on shared guard");
    assert.deepEqual(last, [0, 0, 0, 1], role + " must end on shared guard");
    assert.notDeepEqual(middle, first, role + " must have an actual mid-strike pose");
    for (const track of cinematic.tracks) {
      for (const x of track.values) assert.ok(Number.isFinite(x), role + " has a nonfinite keyframe");
    }
  }
});

test("hero motion signatures distinguish heavy, agile, trick and gravity archetypes", () => {
  const heavy = bakeCinematicClip(source("BF_Power_R"), "powerRush", "KAIRO");
  const light = bakeCinematicClip(source("BF_Power_R"), "powerRush", "SERA");
  const heavySpine = heavy.tracks.find(track => track.name === "spine_03.quaternion")!;
  const lightSpine = light.tracks.find(track => track.name === "spine_03.quaternion")!;
  const angle = (track: THREE.KeyframeTrack) => new THREE.Quaternion().fromArray(track.values, 8)
    .angleTo(new THREE.Quaternion());
  assert.ok(angle(heavySpine) > angle(lightSpine), "KAIRO heavy Rush needs deeper thorax rotation");
  assert.ok(cinematicHeroWeight("SERA", "airChase", "thigh_r") >
    cinematicHeroWeight("KAIRO", "airChase", "thigh_r"), "SERA aerial leg has a distinct whip");
  assert.ok(cinematicHeroWeight("VANTA", "cycloneSweep", "spine_03") >
    cinematicHeroWeight("KAIRO", "cycloneSweep", "spine_03"), "VANTA cyclone torques more");
  assert.ok(cinematicHeroWeight("AXION", "skyBreaker", "thigh_r") >
    cinematicHeroWeight("KAIRO", "skyBreaker", "thigh_r"), "AXION launch is heavier");
});

test("kick choreography now has stronger chamber, full-body pivot and a separate recoil phase", () => {
  assert.equal(REFERENCE_KICK_VERSION, "REFERENCE_KICK_CHOREOGRAPHY_V2");
  for (const name of ["BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R"]) {
    const ready = sampleReferenceKickChoreography(name, 0)!;
    const windup = sampleReferenceKickChoreography(name, .13)!;
    const chamber = sampleReferenceKickChoreography(name, .30)!;
    const impact = sampleReferenceKickChoreography(name, .5)!;
    const recovery = sampleReferenceKickChoreography(name, .82)!;
    const finish = sampleReferenceKickChoreography(name, 1)!;
    assert.ok(impact.extension >= .99, name + " needs a committed contact key");
    assert.ok(chamber.foot[1] > ready.foot[1] + .1, name + " should visibly lift and chamber");
    assert.ok(impact.foot[2] > chamber.foot[2] + .08, name + " should visibly thrust or sweep");
    assert.ok(recovery.extension < impact.extension, name + " must retract before settling");
    assert.ok(Math.abs(impact.pivot) > Math.abs(windup.pivot), name + " requires a clear turn");
    assert.ok(near(finish.pivot, 0), name + " must settle the support foot");
    assert.deepEqual(ready.foot, finish.foot);
  }
});

test("punch kinetics contain much stronger opposing windup, contact drive, and bounded recovery", () => {
  for (const name of ["BF_Jab_L", "BF_Cross_R", "BF_BodyBlow_L", "BF_Power_R", "BF_Backfist_R", "BF_Counter_R"]) {
    const ready = samplePunchKineticChain(name, 0);
    const windup = samplePunchKineticChain(name, .20);
    const impact = samplePunchKineticChain(name, .5);
    const finish = samplePunchKineticChain(name, 1);
    assert.equal(ready.torsoYaw, 0);
    assert.equal(finish.torsoYaw, 0);
    assert.ok(Math.abs(windup.pelvisYaw) > .003, name + " no anticipation torque");
    assert.ok(Math.abs(impact.torsoYaw) > Math.abs(windup.torsoYaw), name + " needs accelerated hit torque");
    assert.ok(impact.contactLock > .8, name + " should still aim for the authored glove");
    for (const phase of [0, .1, .2, .4, .5, .65, .85, 1]) {
      for (const value of Object.values(samplePunchKineticChain(name, phase))) assert.ok(Number.isFinite(value));
    }
  }
});
