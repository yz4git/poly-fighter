import * as THREE from "three";
import {
  QUATERNIUS_MOTIONS,
  type QuaterniusMotionSample,
} from "./generated/quaternius-motion-data";

export type QuaterniusMotionPoint =
  | "hipsDelta"
  | "chest"
  | "head"
  | "leftHand"
  | "rightHand"
  | "leftFoot"
  | "rightFoot";

export type MotionBasis = {
  side: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function lerpTuple(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    THREE.MathUtils.lerp(first[0], second[0], amount),
    THREE.MathUtils.lerp(first[1], second[1], amount),
    THREE.MathUtils.lerp(first[2], second[2], amount),
  ];
}

export function motionClipDuration(name: string): number {
  const clip = QUATERNIUS_MOTIONS[name];
  if (!clip) throw new Error(`Unknown Quaternius motion clip: ${name}`);
  return clip.duration;
}

export function sampleQuaterniusMotion(
  name: string,
  phase: number,
  loop = false,
): QuaterniusMotionSample {
  const clip = QUATERNIUS_MOTIONS[name];
  if (!clip || clip.samples.length === 0) {
    throw new Error(`Unknown or empty Quaternius motion clip: ${name}`);
  }
  const normalized = loop
    ? ((phase % 1) + 1) % 1
    : clamp01(phase);
  const position = normalized * (clip.samples.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(clip.samples.length - 1, lowerIndex + 1);
  const amount = position - lowerIndex;
  const lower = clip.samples[lowerIndex];
  const upper = clip.samples[upperIndex];
  return {
    t: normalized,
    hipsDelta: lerpTuple(lower.hipsDelta, upper.hipsDelta, amount),
    chest: lerpTuple(lower.chest, upper.chest, amount),
    head: lerpTuple(lower.head, upper.head, amount),
    leftHand: lerpTuple(lower.leftHand, upper.leftHand, amount),
    rightHand: lerpTuple(lower.rightHand, upper.rightHand, amount),
    leftFoot: lerpTuple(lower.leftFoot, upper.leftFoot, amount),
    rightFoot: lerpTuple(lower.rightFoot, upper.rightFoot, amount),
  };
}

export function quaterniusMotionDelta(
  name: string,
  phase: number,
  point: QuaterniusMotionPoint,
  loop = false,
): [number, number, number] {
  const current = sampleQuaterniusMotion(name, phase, loop)[point];
  const origin = sampleQuaterniusMotion(name, 0)[point];
  return [
    current[0] - origin[0],
    current[1] - origin[1],
    current[2] - origin[2],
  ];
}

/**
 * Converts a Quaternius point (source-hips local, normalized by body height)
 * into the canonical POLY FIGHTER world basis. The optional X mirror lets the
 * left-lead Punch_Jab clip drive a right-hand fighter without changing hit
 * detection or the target rig.
 */
export function retargetQuaterniusPoint(
  point: readonly [number, number, number],
  hipsWorld: THREE.Vector3,
  basis: MotionBasis,
  worldBodyHeight: number,
  mirrorX = false,
): THREE.Vector3 {
  const lateral = (mirrorX ? -point[0] : point[0]) * worldBodyHeight;
  return hipsWorld
    .clone()
    .addScaledVector(basis.side, lateral)
    .addScaledVector(basis.up, point[1] * worldBodyHeight)
    .addScaledVector(basis.forward, point[2] * worldBodyHeight);
}
