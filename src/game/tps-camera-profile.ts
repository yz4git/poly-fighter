import * as THREE from "three";

// Camera-only TPS tuning. Keep this separate from deterministic gameplay tuning
// so visual composition can be reviewed/refined without mixing it into combat rules.
export const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3.75;
export const TPS_CAMERA_CLOSE_BACK_DELTA = -0.95;
export const TPS_CAMERA_CLOSE_ANCHOR_BLEND = 0.88;
export const TPS_CAMERA_CLOSE_TARGET_MIDPOINT_BLEND = 0.42;
export const TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.36;
export const TPS_CAMERA_CLOSE_TARGET_LIFT = 0.14;
export const TPS_CAMERA_IMPACT_BACK_DELTA = 0.24;
export const TPS_CAMERA_IMPACT_SHOULDER = 0.18;

// Authored-contact framing offsets are presentation-only. They change camera
// composition, never gameplay position, hitboxes, reach, or animation timing.
export const TPS_CAMERA_CONTACT_BACK_BONUS = 0.18;
export const TPS_CAMERA_CONTACT_SHOULDER_BONUS = 0.32;
export const TPS_CAMERA_KICK_CONTACT_BACK_BONUS = 0.10;
export const TPS_CAMERA_KICK_CONTACT_SHOULDER_BONUS = 0.20;
export const TPS_CAMERA_CONTACT_TARGET_SIDE_BONUS = 0.10;
export const TPS_CAMERA_KICK_TARGET_SIDE_BONUS = 0.08;
export const TPS_CAMERA_FRONT_KICK_SHOULDER_BONUS = 0.98;
export const TPS_CAMERA_FRONT_KICK_TARGET_SIDE_BONUS = 0.24;
export const TPS_CAMERA_FRONT_KICK_BACK_BONUS = 0.10;
export const TPS_CAMERA_LOW_KICK_TARGET_DROP = 0.16;

export const TPS_CAMERA_MAX_TRAVEL_SPEED = 13.2;
export const TPS_CLOSE_ORBIT_SPEED_SCALE = 0.65;

export type TpsCameraFramingInput = {
  fightDistance: number;
  aspect: number;
  playerPerfectEvadeTicks: number;
  playerFlankWindowTicks: number;
  playerFlankAttackTicks: number;
  flankWindowTicks: number;
  playerEvadeSign: number;
  maxHitStop: number;
  attackMoveId: string | null;
  authoredContactWeight: number;
  dramaPhase: string;
  dramaIntensity: number;
};

export type TpsCameraFraming = {
  closeFactor: number;
  compactLandscapeFactor: number;
  flankCameraFactor: number;
  flankLaneShift: number;
  impactReadabilityFactor: number;
  authoredContactReadabilityFactor: number;
  kickContactReadabilityFactor: number;
  frontKickReadabilityFactor: number;
  lowKickReadabilityFactor: number;
  dramaCinematicFactor: number;
  backDistance: number;
  shoulderOffset: number;
  cameraHeight: number;
  targetHeight: number;
  closeAnchorBlend: number;
  closeTargetBlend: number;
  targetSideShift: number;
  desiredShoulderOffset: number;
  cameraPositionRate: number;
};

export function computeTpsCameraFraming(input: TpsCameraFramingInput): TpsCameraFraming {
  const closeFactor = THREE.MathUtils.clamp((2.6 - input.fightDistance) / 1.7, 0, 1);
  const compactLandscapeFactor = THREE.MathUtils.clamp((2.45 - input.aspect) / 0.45, 0, 1);
  const flankCameraFactor = THREE.MathUtils.clamp(
    Math.max(
      input.playerPerfectEvadeTicks,
      input.playerFlankWindowTicks,
      input.playerFlankAttackTicks,
    ) / input.flankWindowTicks,
    0,
    1,
  );
  const flankLaneShift = input.playerEvadeSign * flankCameraFactor * 0.56;
  const impactReadabilityFactor = THREE.MathUtils.clamp(input.maxHitStop / 9, 0, 1);
  const authoredContactReadabilityFactor = THREE.MathUtils.clamp(
    input.authoredContactWeight * closeFactor,
    0,
    1,
  );
  const kickContactReadabilityFactor = authoredContactReadabilityFactor * (
    input.attackMoveId && ["kick", "lowKick", "risingKick", "dashKick"].includes(input.attackMoveId) ? 1 : 0
  );
  const frontKickReadabilityFactor = input.attackMoveId === "kick"
    ? authoredContactReadabilityFactor
    : 0;
  const lowKickReadabilityFactor = input.attackMoveId === "lowKick"
    ? authoredContactReadabilityFactor
    : 0;
  const dramaCinematicFactor = ["COMEBACK", "CLUTCH", "FINISH"].includes(input.dramaPhase)
    ? input.dramaIntensity
    : 0;

  const backDistance = 4.70
    + closeFactor * TPS_CAMERA_CLOSE_BACK_DELTA
    + compactLandscapeFactor * 0.18
    + impactReadabilityFactor * TPS_CAMERA_IMPACT_BACK_DELTA
    + authoredContactReadabilityFactor * TPS_CAMERA_CONTACT_BACK_BONUS
    + kickContactReadabilityFactor * TPS_CAMERA_KICK_CONTACT_BACK_BONUS
    + frontKickReadabilityFactor * TPS_CAMERA_FRONT_KICK_BACK_BONUS
    - dramaCinematicFactor * 0.16;

  const shoulderOffset = 2.50
    + closeFactor * TPS_CAMERA_CLOSE_SHOULDER_BONUS
    + compactLandscapeFactor * (0.52 + closeFactor * 0.48)
    + impactReadabilityFactor * TPS_CAMERA_IMPACT_SHOULDER
    + authoredContactReadabilityFactor * TPS_CAMERA_CONTACT_SHOULDER_BONUS
    + kickContactReadabilityFactor * TPS_CAMERA_KICK_CONTACT_SHOULDER_BONUS
    + frontKickReadabilityFactor * TPS_CAMERA_FRONT_KICK_SHOULDER_BONUS
    + dramaCinematicFactor * 0.08;

  const cameraHeight = 2.36
    + closeFactor * 0.24
    + compactLandscapeFactor * 0.06
    + impactReadabilityFactor * 0.035
    + dramaCinematicFactor * 0.025;

  const targetHeight = 1.22
    + closeFactor * TPS_CAMERA_CLOSE_TARGET_LIFT
    - lowKickReadabilityFactor * TPS_CAMERA_LOW_KICK_TARGET_DROP;

  const closeAnchorBlend = closeFactor * TPS_CAMERA_CLOSE_ANCHOR_BLEND;
  const closeTargetBlend = closeFactor * TPS_CAMERA_CLOSE_TARGET_MIDPOINT_BLEND;
  const targetSideShift = TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT * closeFactor
    - flankLaneShift
    + impactReadabilityFactor * 0.080
    + authoredContactReadabilityFactor * TPS_CAMERA_CONTACT_TARGET_SIDE_BONUS
    + kickContactReadabilityFactor * TPS_CAMERA_KICK_TARGET_SIDE_BONUS
    + frontKickReadabilityFactor * TPS_CAMERA_FRONT_KICK_TARGET_SIDE_BONUS;

  return {
    closeFactor,
    compactLandscapeFactor,
    flankCameraFactor,
    flankLaneShift,
    impactReadabilityFactor,
    authoredContactReadabilityFactor,
    kickContactReadabilityFactor,
    frontKickReadabilityFactor,
    lowKickReadabilityFactor,
    dramaCinematicFactor,
    backDistance,
    shoulderOffset,
    cameraHeight,
    targetHeight,
    closeAnchorBlend,
    closeTargetBlend,
    targetSideShift,
    desiredShoulderOffset: shoulderOffset + flankLaneShift * 0.36,
    cameraPositionRate: THREE.MathUtils.lerp(10.2, 8.0, closeFactor)
      + authoredContactReadabilityFactor * 1.6,
  };
}
