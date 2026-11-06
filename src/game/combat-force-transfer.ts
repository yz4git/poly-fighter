import * as THREE from "three";
import type { PunchKineticPose } from "./combat-punch-kinetics";
import type { KickKineticPose } from "./combat-kinetic-chain";
import type { MotionDna } from "./motion-profile";

/**
 * Ground-up kinetic weighting applied once while authoring each full-body clip.
 * Model inference and live per-frame inverse kinematics are NOT required.
 * World root motion and the actual glove/boot contact paths remain authored.
 */
export const MOTIONBRICKS_FULLBODY_FORCE_VERSION = "AUTHORED_GROUNDUP_FORCE_V1";

export function stylePunchKinetics(
  pose: PunchKineticPose, dna: MotionDna,
): PunchKineticPose {
  return {
    ...pose,
    comSide: pose.comSide * dna.lateral,
    comForward: pose.comForward * dna.hipLead - pose.recovery * (dna.recoil - 1) * .0015,
    comVertical: pose.comVertical * (0.82 + dna.hipLead * .18),
    pelvisYaw: pose.pelvisYaw * dna.hipLead,
    torsoYaw: pose.torsoYaw * dna.chestFollow - pose.recovery * (dna.recoil - 1) * .009,
    torsoPitch: pose.torsoPitch * (.72 + dna.chestFollow * .28),
    chestRoll: pose.chestRoll * dna.lateral,
    strikeClavicleYaw: pose.strikeClavicleYaw * dna.chestFollow,
    guardClavicleYaw: pose.guardClavicleYaw * dna.guardDiscipline,
    headCounterYaw: pose.headCounterYaw * dna.chestFollow,
    stancePivot: pose.stancePivot * (.82 + dna.hipLead * .18),
    guardRetention: Math.min(1, pose.guardRetention * dna.guardDiscipline),
    // NEVER relax the actual striking end-effector to create visual power.
    contactLock: pose.contactLock,
  };
}

export type KickUpperBodyForce = Readonly<{
  torsoYaw: number;
  torsoPitch: number;
  shoulderYaw: number;
  chestRoll: number;
  headCounterYaw: number;
}>;

/**
 * A delayed thorax/shoulder impulse from the kick's existing keyed contact
 * event. Apply ABOVE the pelvis after both legs have been authored and solved.
 * This cannot modify the support foot, kicking ankle, or simulation root.
 */
export function styleKickUpperBody(
  pose: KickKineticPose, dna: MotionDna,
): KickUpperBodyForce {
  return {
    torsoYaw: pose.torsoYaw * dna.chestFollow,
    torsoPitch: pose.torsoPitch * (.72 + dna.chestFollow * .28),
    shoulderYaw: pose.shoulderYaw * dna.guardDiscipline,
    chestRoll: pose.comSide * dna.lateral * 1.65,
    headCounterYaw: -pose.torsoYaw * dna.chestFollow * .42,
  };
}

/**
 * Rotating a foot around the ankle makes the toe scrape across the floor.
 * To keep the ball of the foot planted, rotate the ankle-to-ball vector around
 * the world-up axis, then place the ankle at the rotated offset. The caller
 * solves the original thigh/calf toward that target and preserves bone lengths.
 */
export function ballAnchoredStancePivot(
  ankle: THREE.Vector3,
  ball: THREE.Vector3,
  footWorldRotation: THREE.Quaternion,
  yawRadians: number,
  slide?: THREE.Vector3,
): Readonly<{ ankle: THREE.Vector3; rotation: THREE.Quaternion }> {
  const yaw = THREE.MathUtils.clamp(Number.isFinite(yawRadians) ? yawRadians : 0, -.24, .24);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const movement = slide && [slide.x, slide.z].every(Number.isFinite)
    ? new THREE.Vector3(slide.x, 0, slide.z)
    : new THREE.Vector3();
  return {
    ankle: ball.clone().add(ankle.clone().sub(ball).applyQuaternion(rotation)).add(movement),
    rotation: rotation.multiply(footWorldRotation.clone()).normalize(),
  };
}
