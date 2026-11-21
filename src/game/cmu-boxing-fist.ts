import * as THREE from "three";
import type { CmuStrikeContact } from "./cmu-strike-extraction";

/**
 * Non-destructive, target-rig-calibrated boxing fist pose for MODEL VIEW.
 *
 * The source CMU ASF mocap has no fingers. We animate the actual five
 * fully skinned UBC fingers on each hand in target local joint coordinates,
 * inferred from geometry rather than assuming Blender Euler axes.
 */
type Side = "l" | "r";
type Digit = "index" | "middle" | "ring" | "pinky" | "thumb";
type Joint = {
  bone: THREE.Object3D;
  bind: THREE.Quaternion;
  hinge: THREE.Vector3 | null;
  target: THREE.Quaternion | null;
  angle: number;
  side: Side;
  digit: Digit;
};
export interface CmuFistReport {
  joints: number;
  leftJoints: number;
  rightJoints: number;
  minStrength: number;
  maxStrength: number;
}

const LONG_DIGITS: readonly Exclude<Digit, "thumb">[] =
  ["index", "middle", "ring", "pinky"];
const LONG_FLEX = [1.11, 1.52, 0.93] as const;
const THUMB_FLEX = [0, 0.67, 0.51] as const;

function required(root: THREE.Object3D, name: string): THREE.Object3D {
  const bone = root.getObjectByName(name);
  if (!bone || !bone.isObject3D) {
    throw new Error("CMU fist requires actual skinned UBC finger joint " + name);
  }
  return bone;
}

const pos = (node: THREE.Object3D): THREE.Vector3 =>
  node.getWorldPosition(new THREE.Vector3());

function fingerHinge(
  node: THREE.Object3D,
  child: THREE.Object3D,
  palmNormal: THREE.Vector3,
): THREE.Vector3 {
  const forward = pos(child).sub(pos(node)).normalize();
  // Cross of fingertip direction and palm-facing normal is the true
  // flexion axis; map into this joint's LOCAL bind space.
  const axis = forward.cross(palmNormal).normalize();
  if (axis.lengthSq() < 0.4) {
    throw new Error("CMU fist cannot calibrate finger flexion axis " + node.name);
  }
  return axis.applyQuaternion(
    node.getWorldQuaternion(new THREE.Quaternion()).invert(),
  ).normalize();
}

function buildHand(target: THREE.Object3D, side: Side): Joint[] {
  const hand = required(target, "hand_" + side);
  const index = required(target, "index_01_" + side);
  const pinky = required(target, "pinky_01_" + side);
  const middle = required(target, "middle_01_" + side);
  const middleTip = required(target, "middle_02_" + side);

  // In UBC's original T pose the fingers extend longitudinally, while
  // index -> pinky spans the palm. Works on either mirrored hand.
  const longitudinal = pos(middleTip).sub(pos(middle)).normalize();
  const across = pos(index).sub(pos(pinky)).normalize();
  const palmNormal = longitudinal.clone().cross(across).normalize();
  if (palmNormal.lengthSq() < 0.9) {
    throw new Error("Cannot derive UBC palm normal for " + side);
  }

  const joints: Joint[] = [];
  for (const digit of LONG_DIGITS) {
    for (let i = 1; i <= 3; i++) {
      const node = required(target, digit + "_0" + i + "_" + side);
      const child = required(target, digit + "_0" + (i + 1) +
        (i === 3 ? "_leaf" : "") + "_" + side);
      joints.push({
        bone: node,
        bind: node.quaternion.clone(),
        hinge: fingerHinge(node, child, palmNormal),
        target: null,
        angle: LONG_FLEX[i - 1],
        side,
        digit,
      });
    }
  }

  const thumbBase = required(target, "thumb_01_" + side);
  const thumbNext = required(target, "thumb_02_" + side);
  const ring = required(target, "ring_01_" + side);

  // Thumb oppositional motion is the only non-hinge joint here: swing the
  // thumb FROM its actual rest direction TOWARD the palm center. No fixed
  // guessed X/Z sign, and both male and female rigs use their own rest pose.
  const palmCenter = pos(middle).add(pos(ring)).multiplyScalar(0.5);
  const desired = palmCenter.clone().sub(pos(thumbBase))
    .addScaledVector(palmNormal, 0.015).normalize();
  const current = pos(thumbNext).sub(pos(thumbBase)).normalize();
  if (desired.lengthSq() < 0.8 || current.lengthSq() < 0.8) {
    throw new Error("Cannot derive UBC thumb opposition for " + side);
  }
  const worldSwing = new THREE.Quaternion().setFromUnitVectors(current, desired);
  const newWorld = worldSwing.multiply(
    thumbBase.getWorldQuaternion(new THREE.Quaternion()),
  );
  const parentWorld = thumbBase.parent
    ? thumbBase.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  const thumbTargetLocal = parentWorld.invert().multiply(newWorld).normalize();
  joints.push({
    bone: thumbBase,
    bind: thumbBase.quaternion.clone(),
    hinge: null,
    target: thumbTargetLocal,
    angle: THUMB_FLEX[0],
    side,
    digit: "thumb",
  });
  for (let i = 2; i <= 3; i++) {
    const node = required(target, "thumb_0" + i + "_" + side);
    const child = required(target, "thumb_0" + (i + 1) +
      (i === 3 ? "_leaf" : "") + "_" + side);
    joints.push({
      bone: node,
      bind: node.quaternion.clone(),
      hinge: fingerHinge(node, child, palmNormal),
      target: null,
      angle: THUMB_FLEX[i - 1],
      side,
      digit: "thumb",
    });
  }
  return joints;
}

function fistStrength(
  time: number,
  side: Side,
  contacts: readonly CmuStrikeContact[],
): number {
  let boost = 0;
  for (const contact of contacts) {
    if ((contact.hand === "LEFT" ? "l" : "r") !== side) continue;
    // Closed hands already in guard. Slightly tighten at peak extension.
    const delta = (time - contact.time) / 0.16;
    boost = Math.max(boost, Math.exp(-delta * delta));
  }
  return THREE.MathUtils.clamp(0.91 + 0.09 * boost, 0, 1);
}

/**
 * Adds only 30 index/middle/ring/pinky/thumb rotation tracks to the original
 * 120Hz short strike. Body, wrist, arm, pelvis and leg tracks are untouched.
 *
 * Creates a new named clip; never modifies the anatomical source clip.
 */
export function buildCmuBoxingFistClip(
  target: THREE.Object3D,
  strike: THREE.AnimationClip,
  contacts: readonly CmuStrikeContact[],
  report?: CmuFistReport,
): THREE.AnimationClip {
  if (!strike.name.startsWith("CMU_BOXING_") || strike.name.endsWith("_FIST") ||
      strike.duration <= 0 || !contacts.length) {
    throw new Error("CMU fist bake expects a standalone CMU BOXING strike");
  }
  // Existing source retarget does not control finger bones. Keep a strict
  // refusal if future sources introduce finger tracks, avoiding overwrite.
  const existing = new Set(strike.tracks.map(track => track.name));
  target.updateWorldMatrix(true, true);
  const joints = [...buildHand(target, "l"), ...buildHand(target, "r")];
  if (joints.length !== 30) throw new Error("Both UBC hands must provide 30 articulated finger joints");
  for (const joint of joints) {
    if (existing.has(joint.bone.name + ".quaternion")) {
      throw new Error("Cannot override existing source finger animation " + joint.bone.name);
    }
  }

  const times = strike.tracks.find(t => t.name.endsWith(".quaternion"))?.times;
  if (!times || times.length < 12) throw new Error("CMU fist requires short densely sampled strike");
  const newTracks: THREE.KeyframeTrack[] = [...strike.tracks];
  let minStrength = 1;
  let maxStrength = 0;
  for (const joint of joints) {
    const values = new Float32Array(times.length * 4);
    const q = new THREE.Quaternion();
    const bend = new THREE.Quaternion();
    for (let i = 0; i < times.length; i++) {
      const strength = fistStrength(times[i], joint.side, contacts);
      minStrength = Math.min(minStrength, strength);
      maxStrength = Math.max(maxStrength, strength);
      if (joint.target) {
        q.copy(joint.bind).slerp(joint.target, strength);
      } else {
        bend.setFromAxisAngle(joint.hinge!, joint.angle * strength);
        q.copy(joint.bind).multiply(bend).normalize();
      }
      q.toArray(values, i * 4);
    }
    newTracks.push(new THREE.QuaternionKeyframeTrack(
      joint.bone.name + ".quaternion", times.slice(), values,
    ));
  }

  const output = new THREE.AnimationClip(
    strike.name + "_FIST", strike.duration, newTracks, strike.blendMode,
  );
  output.optimize();
  if (report) {
    report.joints = joints.length;
    report.leftJoints = joints.filter(j => j.side === "l").length;
    report.rightJoints = joints.filter(j => j.side === "r").length;
    report.minStrength = minStrength;
    report.maxStrength = maxStrength;
  }
  return output;
}
