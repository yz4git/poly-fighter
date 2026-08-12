import * as THREE from "three";
import type { HitLevel } from "./types";

/**
 * POLY FIGHTER's one canonical coordinate convention.
 *
 * Gameplay fights on X, model geometry is authored with its face/toes toward
 * +Z, and the model root rotates that local forward vector onto the fighter's
 * world facing vector.  Keeping this conversion here prevents animation code
 * from accumulating left/right Euler sign special cases.
 */
export const WORLD_UP = new THREE.Vector3(0, 1, 0);
export const FIGHT_AXIS = new THREE.Vector3(1, 0, 0);
export const STAGE_DEPTH = new THREE.Vector3(0, 0, 1);
export const MODEL_UP = new THREE.Vector3(0, 1, 0);
export const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
export const MODEL_RIGHT = new THREE.Vector3(1, 0, 0);

export interface FighterBasis {
  forward: THREE.Vector3;
  up: THREE.Vector3;
  side: THREE.Vector3;
}

export function fighterBasis(facing: number, opponentDelta?: THREE.Vector3): FighterBasis {
  const projected = opponentDelta
    ? new THREE.Vector3(opponentDelta.x, 0, opponentDelta.z)
    : new THREE.Vector3();
  const forward = projected.lengthSq() > 1e-8
    ? projected.normalize()
    : new THREE.Vector3(facing >= 0 ? 1 : -1, 0, 0);
  if (forward.x * (facing >= 0 ? 1 : -1) < -0.05) forward.set(facing >= 0 ? 1 : -1, 0, 0);
  const up = WORLD_UP.clone();
  // This is the model's local +X after the root yaw. It is also the stable
  // left/right pole direction used by arm and leg IK.
  const side = up.clone().cross(forward).normalize();
  return { forward, up, side };
}

export function fighterRootQuaternion(facing: number): THREE.Quaternion {
  const forward = new THREE.Vector3(facing >= 0 ? 1 : -1, 0, 0);
  return new THREE.Quaternion().setFromUnitVectors(MODEL_FORWARD, forward);
}

export function modelPointToWorld(root: THREE.Object3D, point: THREE.Vector3): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return root.localToWorld(point.clone());
}

export function worldPointToModel(root: THREE.Object3D, point: THREE.Vector3): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return root.worldToLocal(point.clone());
}

export interface TwoBoneIKOptions {
  root: THREE.Bone;
  mid: THREE.Bone;
  end: THREE.Bone;
  target: THREE.Vector3;
  pole: THREE.Vector3;
  minBendRadians?: number;
  maxBendRadians?: number;
}

export interface TwoBoneIKResult {
  target: THREE.Vector3;
  rootPosition: THREE.Vector3;
  jointPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  rootLength: number;
  midLength: number;
  bendRadians: number;
  reachable: boolean;
}

const EPSILON = 1e-6;

function projectPole(direction: THREE.Vector3, from: THREE.Vector3, pole: THREE.Vector3): THREE.Vector3 {
  const poleVector = pole.clone().sub(from);
  poleVector.addScaledVector(direction, -poleVector.dot(direction));
  if (poleVector.lengthSq() < EPSILON) {
    poleVector.copy(WORLD_UP);
    poleVector.addScaledVector(direction, -poleVector.dot(direction));
  }
  return poleVector.normalize();
}

function worldOrientationForBone(direction: THREE.Vector3, poleDirection: THREE.Vector3): THREE.Quaternion {
  const down = direction.clone().normalize().multiplyScalar(-1);
  const x = poleDirection.clone().addScaledVector(down, -poleDirection.dot(down)).normalize();
  const z = x.clone().cross(down).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, down, z);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function setWorldQuaternion(bone: THREE.Bone, worldQuaternion: THREE.Quaternion): void {
  if (!bone.parent) {
    bone.quaternion.copy(worldQuaternion);
    return;
  }
  const parentWorld = new THREE.Quaternion();
  bone.parent.getWorldQuaternion(parentWorld);
  bone.quaternion.copy(parentWorld.invert().multiply(worldQuaternion));
}

/**
 * Analytic two-bone solve. Bones are authored down their local -Y axis. The
 * pole is projected into the solve plane, so a small target movement cannot
 * make an elbow or knee flip to the opposite side.
 */
export function solveTwoBoneIK(options: TwoBoneIKOptions): TwoBoneIKResult {
  const { root, mid, end } = options;
  root.updateWorldMatrix(true, true);
  const rootPosition = root.getWorldPosition(new THREE.Vector3());
  const midPosition = mid.getWorldPosition(new THREE.Vector3());
  const endPosition = end.getWorldPosition(new THREE.Vector3());
  const rootLength = Math.max(EPSILON, rootPosition.distanceTo(midPosition));
  const midLength = Math.max(EPSILON, midPosition.distanceTo(endPosition));
  const requested = options.target.clone();
  const delta = requested.clone().sub(rootPosition);
  const rawDistance = delta.length();
  const minBend = options.minBendRadians ?? 0.035;
  const maxBend = options.maxBendRadians ?? Math.PI * 0.98;
  const distanceForBend = (angle: number): number => Math.sqrt(Math.max(EPSILON, rootLength * rootLength + midLength * midLength - 2 * rootLength * midLength * Math.cos(angle)));
  const minimumDistance = Math.max(Math.abs(rootLength - midLength) + 0.0005, distanceForBend(minBend));
  const maximumDistance = Math.min(rootLength + midLength - 0.0005, distanceForBend(maxBend));
  const distance = THREE.MathUtils.clamp(rawDistance || maximumDistance, minimumDistance, maximumDistance);
  const direction = rawDistance > EPSILON
    ? delta.normalize()
    : new THREE.Vector3(0, -1, 0);
  const solvedTarget = rootPosition.clone().addScaledVector(direction, distance);
  const poleDirection = projectPole(direction, rootPosition, options.pole);
  const cosRoot = THREE.MathUtils.clamp(
    (rootLength * rootLength + distance * distance - midLength * midLength) /
      (2 * rootLength * distance),
    -1,
    1,
  );
  const along = rootLength * cosRoot;
  const height = Math.sqrt(Math.max(0, rootLength * rootLength - along * along));
  const joint = rootPosition.clone()
    .addScaledVector(direction, along)
    .addScaledVector(poleDirection, height);
  const bend = Math.acos(THREE.MathUtils.clamp(
    (rootLength * rootLength + midLength * midLength - distance * distance) /
      (2 * rootLength * midLength),
    -1,
    1,
  ));
  const safeBend = THREE.MathUtils.clamp(bend, minBend, maxBend);
  const rootDirection = joint.clone().sub(rootPosition).normalize();
  const midDirection = solvedTarget.clone().sub(joint).normalize();
  setWorldQuaternion(root, worldOrientationForBone(rootDirection, poleDirection));
  root.updateWorldMatrix(true, true);
  // The elbow/pole plane remains defined in world space after the root solve.
  const midPole = poleDirection.clone();
  setWorldQuaternion(mid, worldOrientationForBone(midDirection, midPole));
  mid.updateWorldMatrix(true, true);
  const actualEnd = end.getWorldPosition(new THREE.Vector3());
  return {
    target: solvedTarget,
    rootPosition,
    jointPosition: joint,
    endPosition: actualEnd,
    rootLength,
    midLength,
    bendRadians: safeBend,
    reachable: rawDistance >= minimumDistance - 0.001 && rawDistance <= maximumDistance + 0.001,
  };
}

/** Set a bone so its local +Z points along a supplied world forward vector. */
export function orientBoneForward(bone: THREE.Bone, forward: THREE.Vector3, up = WORLD_UP): void {
  const z = forward.clone().normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z)).normalize();
  const x = y.clone().cross(z).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  setWorldQuaternion(bone, new THREE.Quaternion().setFromRotationMatrix(matrix));
}

export function jointAngle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const first = a.clone().sub(b).normalize();
  const second = c.clone().sub(b).normalize();
  return Math.acos(THREE.MathUtils.clamp(first.dot(second), -1, 1));
}

/** The renderer uses this same deterministic contact target as CombatSystem. */
export function attackHitboxCenter(
  position: THREE.Vector3,
  facing: number,
  move: { hitLevel: HitLevel; reach: number; animation?: string },
): THREE.Vector3 {
  // The combat boxes live in the same world scale as the generated fighter.
  // Punches contact the upper chest/shoulder line; kicks retain their level
  // specific heights. This prevents a visually reachable fist from being
  // asked to solve to a low, out-of-reach box.
  const centerY = move.hitLevel === "LOW"
    ? position.y + 0.48
    : move.animation === "punch"
      ? position.y + 1.94
      : move.hitLevel === "HIGH"
        ? position.y + 1.78
        : position.y + 1.2;
  return new THREE.Vector3(position.x + facing * move.reach * 0.72, centerY, position.z);
}
