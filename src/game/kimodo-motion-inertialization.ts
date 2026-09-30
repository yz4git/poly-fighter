import * as THREE from "three";

export const KIMODO_MOTION_INERTIALIZATION_VERSION = "KIMODO_INSPIRED_INERTIAL_V1";

export type InertialPoseSample = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  linearVelocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
};

export type InertialTransitionSample = InertialPoseSample;

export type InertializationTelemetry = {
  weight: number;
  maxLinearVelocity: number;
  maxAngularVelocity: number;
  activeBones: number;
};

const MAX_LOCAL_LINEAR_SPEED = 3.0;
const MAX_LOCAL_ANGULAR_SPEED = 18.0;
const MAX_ROTATION_PREDICTION = THREE.MathUtils.degToRad(24);

function clampVectorLength(vector: THREE.Vector3, maximum: number): THREE.Vector3 {
  const length = vector.length();
  if (length > maximum && length > 1e-8) vector.multiplyScalar(maximum / length);
  return vector;
}

function angularVelocity(
  previous: THREE.Quaternion,
  current: THREE.Quaternion,
  deltaSeconds: number,
): THREE.Vector3 {
  if (!(deltaSeconds > 1e-5)) return new THREE.Vector3();
  const delta = previous.clone().invert().multiply(current).normalize();
  // Keep the shortest quaternion arc so a 359-degree representation cannot
  // appear as a one-frame spin.
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const w = THREE.MathUtils.clamp(delta.w, -1, 1);
  const angle = 2 * Math.acos(w);
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  if (angle < 1e-6 || sinHalf < 1e-6) return new THREE.Vector3();
  const axis = new THREE.Vector3(delta.x / sinHalf, delta.y / sinHalf, delta.z / sinHalf);
  return clampVectorLength(axis.multiplyScalar(angle / deltaSeconds), MAX_LOCAL_ANGULAR_SPEED);
}

function rotationFromAngularVelocity(velocity: THREE.Vector3, seconds: number): THREE.Quaternion {
  const speed = velocity.length();
  if (!(speed > 1e-6) || !(seconds > 0)) return new THREE.Quaternion();
  const angle = Math.min(MAX_ROTATION_PREDICTION, speed * seconds);
  return new THREE.Quaternion().setFromAxisAngle(velocity.clone().multiplyScalar(1 / speed), angle);
}

function transitionWeight(age: number, duration: number): number {
  if (!(duration > 1e-5)) return 0;
  const u = THREE.MathUtils.clamp(age / duration, 0, 1);
  // Smoothstep complement has zero weight derivative at both boundaries.
  // Because the outgoing pose itself is extrapolated with its measured velocity,
  // the rendered derivative starts near the outgoing velocity instead of zero.
  return 1 - u * u * (3 - 2 * u);
}

function predictionSeconds(age: number, duration: number): number {
  if (!(age > 0) || !(duration > 1e-5)) return 0;
  // Integrate an exponentially decaying velocity. Derivative at t=0 is 1,
  // then velocity dies before the transition completes instead of overshooting.
  const tau = Math.max(1 / 240, duration * 0.34);
  return tau * (1 - Math.exp(-age / tau));
}

export function recordInertialPose(
  bones: Map<string, THREE.Object3D>,
  history: Map<string, InertialPoseSample>,
  deltaSeconds: number,
): void {
  const validDelta = deltaSeconds > 1e-5 && deltaSeconds <= 0.08;
  for (const [name, bone] of bones) {
    if (!(bone as THREE.Bone).isBone) continue;
    const currentPosition = bone.position.clone();
    const currentRotation = bone.quaternion.clone().normalize();
    const previous = history.get(name);
    const measuredLinear = previous && validDelta
      ? clampVectorLength(
        currentPosition.clone().sub(previous.position).multiplyScalar(1 / deltaSeconds),
        MAX_LOCAL_LINEAR_SPEED,
      )
      : new THREE.Vector3();
    const measuredAngular = previous && validDelta
      ? angularVelocity(previous.rotation, currentRotation, deltaSeconds)
      : new THREE.Vector3();

    // Low-pass measured velocity rather than pose. This retains authored arcs
    // while preventing one noisy retarget sample from contaminating a transition.
    const linearVelocity = previous
      ? previous.linearVelocity.clone().lerp(measuredLinear, validDelta ? 0.62 : 1)
      : measuredLinear;
    const angular = previous
      ? previous.angularVelocity.clone().lerp(measuredAngular, validDelta ? 0.62 : 1)
      : measuredAngular;

    history.set(name, {
      position: currentPosition,
      rotation: currentRotation,
      linearVelocity,
      angularVelocity: angular,
    });
  }
}

export function beginInertialTransition(
  bones: Map<string, THREE.Object3D>,
  history: Map<string, InertialPoseSample>,
  transition: Map<string, InertialTransitionSample>,
): void {
  transition.clear();
  for (const [name, bone] of bones) {
    if (!(bone as THREE.Bone).isBone) continue;
    const previous = history.get(name);
    transition.set(name, {
      position: bone.position.clone(),
      rotation: bone.quaternion.clone().normalize(),
      linearVelocity: previous?.linearVelocity.clone() ?? new THREE.Vector3(),
      angularVelocity: previous?.angularVelocity.clone() ?? new THREE.Vector3(),
    });
  }
}

export function applyInertialTransition(
  bones: Map<string, THREE.Object3D>,
  transition: Map<string, InertialTransitionSample>,
  age: number,
  duration: number,
): InertializationTelemetry {
  const weight = transitionWeight(age, duration);
  if (!(weight > 0) || transition.size === 0) {
    transition.clear();
    return { weight: 0, maxLinearVelocity: 0, maxAngularVelocity: 0, activeBones: 0 };
  }

  const predict = predictionSeconds(age, duration);
  let maxLinearVelocity = 0;
  let maxAngularVelocity = 0;
  let activeBones = 0;

  for (const [name, from] of transition) {
    const bone = bones.get(name);
    if (!bone) continue;

    // At this point the mixer already sampled the destination clip. Preserve it
    // as the target, then blend from a short velocity-extrapolated outgoing pose.
    const destinationPosition = bone.position.clone();
    const destinationRotation = bone.quaternion.clone().normalize();

    const predictedPosition = from.position.clone().addScaledVector(from.linearVelocity, predict);
    const predictedRotation = from.rotation.clone()
      .multiply(rotationFromAngularVelocity(from.angularVelocity, predict))
      .normalize();

    bone.position.copy(destinationPosition).lerp(predictedPosition, weight);
    bone.quaternion.copy(destinationRotation).slerp(predictedRotation, weight).normalize();

    maxLinearVelocity = Math.max(maxLinearVelocity, from.linearVelocity.length());
    maxAngularVelocity = Math.max(maxAngularVelocity, from.angularVelocity.length());
    activeBones += 1;
  }

  return { weight, maxLinearVelocity, maxAngularVelocity, activeBones };
}
