/** Risk/reward for the defender who RECOGNIZES a cancelled windup.
 * No new button, damage multiplier, phantom collision or homing attack.
 * All movements occur via ordinary fixed 60Hz fighter root updates. */
export const TPS_FEINT_READ_TICKS = 36;
export const TPS_FEINT_SIDE_EXIT_TICKS = 12;
export const TPS_FEINT_PUNISH_MIN_TICKS = 11;
export const TPS_FEINT_PUNISH_MAX_DISTANCE = 1.92;
export const TPS_FEINT_PUNISH_MAX_TRAVEL = .34;
export const TPS_FEINT_PUNISH_STOP_DISTANCE = 1.37;

export function shouldTpsPlayerPunishFeint(input: {
  readTicks: number;
  distance: number;
  playerCanAct: boolean;
  playerGrounded: boolean;
  defenderGrounded: boolean;
  playerComboStage: number;
  directedTap: boolean;
  availableStraight: boolean;
}): boolean {
  return input.readTicks >= TPS_FEINT_PUNISH_MIN_TICKS
    && Number.isFinite(input.distance)
    && input.distance >= .58
    && input.distance <= TPS_FEINT_PUNISH_MAX_DISTANCE
    && input.playerCanAct && input.playerGrounded && input.defenderGrounded
    && input.playerComboStage === 0 && !input.directedTap
    && input.availableStraight;
}

/** Small forward run-up locked to the ATTACK *tap* heading, limited to startup.
 * A committed angle/side-step can still make it miss. This is not magnetic.
 * Distance and lateral deviation are measured against that original lane. */
export function tpsFeintPunishAdvance(input: {
  attackMove: string | null;
  moveTick: number;
  startup: number;
  hitStop: number;
  connected: boolean;
  longitudinal: number;
  lateral: number;
  travelTotal: number;
}): number {
  if (input.attackMove !== "straight"
    || input.hitStop > 0 || input.connected
    || input.moveTick < 0 || input.moveTick >= input.startup
    || !Number.isFinite(input.longitudinal) || !Number.isFinite(input.lateral)
    || input.longitudinal < .6 || input.lateral > .79
    || input.travelTotal >= TPS_FEINT_PUNISH_MAX_TRAVEL) return 0;
  const remaining = input.longitudinal - TPS_FEINT_PUNISH_STOP_DISTANCE;
  if (remaining <= 0) return 0;
  const eased = .6 + .4 * Math.sin(Math.PI * (input.moveTick + 1) / Math.max(1, input.startup));
  return Math.max(0, Math.min(remaining, TPS_FEINT_PUNISH_MAX_TRAVEL - input.travelTotal, .055 * eased));
}
