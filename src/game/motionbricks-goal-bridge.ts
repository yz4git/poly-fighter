import * as THREE from "three";
import type { AuthoredMotionGoal } from "./motionbricks-authored-target-window";

/**
 * Lightweight, deterministic MotionBricks-inspired pose-goal bridge.
 *
 * MotionBricks predicts between recorded context poses and target poses. The
 * browser game cannot run the NVIDIA TensorRT model, so this only borrows the
 * context/target separation: authored animation remains the goal, and outgoing
 * momentum is allowed to carry toward it, not kick the skeleton away from it.
 * No NVIDIA model, weights, sample motions or third-party runtime are bundled.
 */
export const MOTIONBRICKS_GOAL_BRIDGE_VERSION = "GOAL_CONDITIONED_CONTEXT4_TARGET2_V2";

const MAX_PREDICTED_ROTATION = THREE.MathUtils.degToRad(24);
const ROTATION_SLACK = THREE.MathUtils.degToRad(1.5);

export type GoalBridgePrediction = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  /** Number of channels in which momentum away from the goal was suppressed. */
  rejectedChannels: number;
  /** Channels using a future pose from the actual incoming authored clip. */
  lookaheadChannels: number;
};

function shortestArc(from: THREE.Quaternion, to: THREE.Quaternion): { axis: THREE.Vector3; angle: number } {
  const q = from.clone().invert().multiply(to).normalize();
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(q.w, -1, 1));
  const sinHalf = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  if (angle < 1e-7 || sinHalf < 1e-7) {
    return { axis: new THREE.Vector3(1, 0, 0), angle: 0 };
  }
  return { axis: new THREE.Vector3(q.x / sinHalf, q.y / sinHalf, q.z / sinHalf), angle };
}

/**
 * Predict an outgoing pose toward the ACTUALLY SAMPLED incoming clip goal.
 * Restrict only the velocity component opposing the target and the maximum
 * overshoot. Root/gameplay location, strike timing and authored targets are not
 * modified. The caller applies its existing contact/skeleton masks afterwards.
 */
export function predictPoseTowardGoal(
  sourcePosition: THREE.Vector3,
  sourceRotation: THREE.Quaternion,
  linearVelocity: THREE.Vector3,
  angularVelocity: THREE.Vector3,
  destinationPosition: THREE.Vector3,
  destinationRotation: THREE.Quaternion,
  predictionSeconds: number,
  futureGoal?: AuthoredMotionGoal,
): GoalBridgePrediction {
  const seconds = Number.isFinite(predictionSeconds) ? THREE.MathUtils.clamp(predictionSeconds, 0, 0.1) : 0;
  let rejectedChannels = 0;
  let lookaheadChannels = 0;
  const goal = destinationPosition.clone().sub(sourcePosition);
  // Treat the real incoming clip as a two-target path: current pose and a
  // short lookahead. Use the latter only if it does not contradict the current
  // target. In particular, a fast jab retracting into guard cannot anticipate
  // the following punch by reversing the recovery pose.
  if (futureGoal?.position) {
    const future = futureGoal.position.clone().sub(sourcePosition);
    if (future.lengthSq() > 1e-9 && (goal.lengthSq() < 1e-9 || goal.dot(future) > 0)) {
      goal.lerp(future, goal.lengthSq() < 1e-9 ? 0.28 : 0.22);
      lookaheadChannels += 1;
    }
  }
  const linearOffset = linearVelocity.clone().multiplyScalar(seconds);
  const goalDistance = goal.length();
  if (goalDistance > 1e-7) {
    const direction = goal.multiplyScalar(1 / goalDistance);
    const toward = linearOffset.dot(direction);
    if (toward < 0) {
      // Retain a little natural recoil without sending the limb the wrong way.
      linearOffset.addScaledVector(direction, -toward * 0.88);
      rejectedChannels += 1;
    }
    const maxOffset = 0.003 + goalDistance * 0.48;
    if (linearOffset.length() > maxOffset) linearOffset.setLength(maxOffset);
  } else {
    // A newly sampled goal already matches the outgoing pose. Prevent the
    // velocity extrapolation from visibly creating an artificial detour.
    linearOffset.multiplyScalar(0.12);
    if (linearOffset.length() > 0.003) linearOffset.setLength(0.003);
  }

  const goalRotation = shortestArc(sourceRotation, destinationRotation);
  const rotationalTarget = goalRotation.axis.clone().multiplyScalar(goalRotation.angle);
  if (futureGoal?.rotation) {
    const futureRotation = shortestArc(sourceRotation, futureGoal.rotation);
    const future = futureRotation.axis.multiplyScalar(futureRotation.angle);
    if (future.lengthSq() > 1e-9 && (rotationalTarget.lengthSq() < 1e-9 || rotationalTarget.dot(future) > 0)) {
      rotationalTarget.lerp(future, rotationalTarget.lengthSq() < 1e-9 ? 0.28 : 0.22);
      lookaheadChannels += 1;
    }
  }
  const angularOffset = angularVelocity.clone().multiplyScalar(seconds);
  if (rotationalTarget.lengthSq() > 1e-14) {
    const goalAxis = rotationalTarget.clone().normalize();
    const toward = angularOffset.dot(goalAxis);
    if (toward < 0) {
      angularOffset.addScaledVector(goalAxis, -toward * 0.88);
      rejectedChannels += 1;
    }
    const maximum = Math.min(MAX_PREDICTED_ROTATION, rotationalTarget.length() * 0.48 + ROTATION_SLACK);
    if (angularOffset.length() > maximum) angularOffset.setLength(maximum);
  } else {
    angularOffset.multiplyScalar(0.12);
    if (angularOffset.length() > ROTATION_SLACK) angularOffset.setLength(ROTATION_SLACK);
  }

  const predictedRotation = sourceRotation.clone();
  const angle = angularOffset.length();
  if (angle > 1e-7) {
    predictedRotation.multiply(
      new THREE.Quaternion().setFromAxisAngle(angularOffset.multiplyScalar(1 / angle), angle),
    ).normalize();
  }
  return {
    position: sourcePosition.clone().add(linearOffset),
    rotation: predictedRotation,
    rejectedChannels,
    lookaheadChannels,
  };
}
