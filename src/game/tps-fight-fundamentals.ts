import type { MoveDefinition } from "./types";

/**
 * TPS neutral is decided by spatial commitment, not cinematic auto-contact.
 * Gamepad/touch input stays unchanged; these functions only define where a
 * committed strike can make contact and how far its windup may carry the root.
 */
export const TPS_CONTACT_REACH_TOLERANCE = 0.20;
export const TPS_ATTACK_LANE_PADDING = 0.23;
export const TPS_ATTACK_AIM_TURN_PER_TICK = 0.028; // ~96 degrees/sec at 60Hz

export type TpsStrikeGeometry = Readonly<{
  connected: boolean;
  longitudinal: number;
  lateral: number;
  reach: number;
  halfWidth: number;
}>;

export function evaluateTpsStrikeGeometry(input: {
  move: Pick<MoveDefinition, "reach" | "width" | "hitLevel">;
  attackerX: number;
  attackerZ: number;
  defenderX: number;
  defenderZ: number;
  forwardX: number;
  forwardZ: number;
}): TpsStrikeGeometry {
  const dx = input.defenderX - input.attackerX;
  const dz = input.defenderZ - input.attackerZ;
  const length = Math.hypot(input.forwardX, input.forwardZ);
  const fx = length > 1e-6 ? input.forwardX / length : 1;
  const fz = length > 1e-6 ? input.forwardZ / length : 0;
  const longitudinal = dx * fx + dz * fz;
  const lateral = Math.abs(dx * fz - dz * fx);
  const reach = input.move.reach + (input.move.hitLevel === "THROW" ? .16 : TPS_CONTACT_REACH_TOLERANCE);
  const halfWidth = Math.max(.58, input.move.width + TPS_ATTACK_LANE_PADDING);
  return {
    connected: longitudinal >= .36 && longitudinal <= reach && lateral <= halfWidth,
    longitudinal, lateral, reach, halfWidth,
  };
}

/**
 * Windup only receives a small authored weight shift, never enough movement
 * to erase a spacing error. The player must get into range by walking/STEP.
 */
export function tpsAttackWindupAdvance(
  move: Pick<MoveDefinition, "reach" | "power" | "hitLevel">,
  distance: number,
): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (move.hitLevel === "THROW") return 0;
  const desired = move.reach + .035;
  if (distance <= desired || distance > desired + .35) return 0;
  return Math.min(distance - desired, .020 + .008 * Math.max(.5, Math.min(2.4, move.power)));
}

/** Approach the opponent-facing direction only within a bounded windup arc.
 * Sidestepping across that arc now matters, but the attack doesn't point away
 * from a moving opponent in a single frame.
 */
export function turnTpsCommittedAttackAim(
  previousX: number, previousZ: number, targetX: number, targetZ: number,
): { x: number; z: number } {
  const origin = Math.atan2(previousX, previousZ);
  const target = Math.atan2(targetX, targetZ);
  const delta = Math.atan2(Math.sin(target - origin), Math.cos(target - origin));
  const heading = origin + Math.max(-TPS_ATTACK_AIM_TURN_PER_TICK, Math.min(TPS_ATTACK_AIM_TURN_PER_TICK, delta));
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/** Existing combo input buffering only confirms a clean damaging strike.
 * Block contact still creates clash/stun, but cannot be promoted to a free link.
 */
export function tpsCanConfirmCombo(attackerConnected: boolean, unblocked: boolean): boolean {
  return attackerConnected && unblocked;
}

/**
 * Existing ATTACK + movement stick inputs now express player intent on the
 * opener. No new buttons or gauges: short jab is neutral, forward commits to
 * a cross, backward protects range, and lateral commits to the body.
 * Opponent distance still decides which *existing* strike can physically reach.
 */
export function chooseTpsOpeningStrike(input: {
  distance: number;
  forward: boolean;
  back: boolean;
  lateral: boolean;
}): { moveId: "jab" | "straight" | "kick" | "lowKick" | "backfist" | "bodyBlow"; route: "CLOSE_A" | "CLOSE_B" | "FAR" } {
  const far = input.distance > 1.65;
  if (far) {
    return { moveId: input.back || input.lateral ? "lowKick" : "kick", route: "FAR" };
  }
  if (input.forward) return { moveId: "straight", route: "CLOSE_A" };
  if (input.back) return { moveId: "backfist", route: "CLOSE_B" };
  if (input.lateral) return { moveId: "bodyBlow", route: "CLOSE_B" };
  return { moveId: "jab", route: "CLOSE_A" };
}
