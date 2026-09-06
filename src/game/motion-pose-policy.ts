import type { FighterState, MoveDefinition } from "./types";

export const MOTION_POSE_POLICY_VERSION = "MOTION_POSE_OWNER_V1" as const;

export type MotionPoseOwner =
  | "AUTHORED_COMBAT_TIMELINE"
  | "LOCOMOTION_CLIP_WITH_FOOT_LOCK"
  | "STATE_CLIP";

/**
 * Exactly one system owns the rendered skeleton for each gameplay state.
 *
 * ATTACK: the authored combat clip sampled by fixed gameplay moveTick.
 * WALK: the directional locomotion clip, followed only by grounded foot lock.
 * Other states: their state clip; no locomotion or attack post-solve may rewrite it.
 */
export function motionPoseOwner(state: FighterState): MotionPoseOwner {
  if (state === "ATTACK") return "AUTHORED_COMBAT_TIMELINE";
  if (state === "WALK") return "LOCOMOTION_CLIP_WITH_FOOT_LOCK";
  return "STATE_CLIP";
}

/**
 * Attack entry blending is gameplay-tick based, not render-time based.
 * Keeping the blend inside the first three startup ticks makes repeated attacks
 * readable while guaranteeing that the first ACTIVE tick is 100% authored pose.
 */
export function attackEntryBlendTicks(move: Pick<MoveDefinition, "startup">): number {
  return Math.max(1, Math.min(3, Math.max(1, move.startup)));
}

export function attackEntryPreviousPoseWeight(
  move: Pick<MoveDefinition, "startup">,
  moveTick: number,
): number {
  const fadeTicks = attackEntryBlendTicks(move);
  const progress = Math.max(0, Math.min(1, (Math.max(0, moveTick) + 1) / fadeTicks));
  const eased = progress * progress * (3 - 2 * progress);
  return 1 - eased;
}

/**
 * Hitstop is a rendered-pose hold, not merely a zero-delta mixer update.
 * A newly reached gameplay sample is evaluated once, then repeated render frames
 * at the same state/move/reaction sample leave the skeleton byte-for-byte alone.
 */
export function shouldResamplePose(hitStop: number, poseSampleChanged: boolean): boolean {
  return hitStop <= 0 || poseSampleChanged;
}

export function shouldApplyLocomotionFootLock(state: FighterState, hitStop: number): boolean {
  return state === "WALK" && hitStop <= 0;
}
