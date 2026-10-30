import type { HitLevel, MoveDefinition } from "./types";

/**
 * Fighting-game defensive triangle for two-button touch controls.
 * A STEP tap evades; holding STEP AFTER the committed evade enters guard.
 * Back + held STEP crouch guards low; standing guard covers high/mid.
 * Neither guard can protect against a throw.
 */
export type TpsGuardResult = "BLOCK" | "DUCK" | "HIT";
export function resolveTpsGuard(
  hitLevel: HitLevel,
  guarding: boolean,
  crouchGuard: boolean,
): TpsGuardResult {
  if (!guarding || hitLevel === "THROW") return "HIT";
  if (crouchGuard && hitLevel === "HIGH") return "DUCK";
  if (hitLevel === "LOW") return crouchGuard ? "BLOCK" : "HIT";
  return crouchGuard ? "HIT" : "BLOCK";
}

export function shouldHoldTpsGuard(input: {
  heldStep: boolean;
  evadeTicks: number;
  actionable: boolean;
}): boolean {
  return input.heldStep && input.evadeTicks <= 0 && input.actionable;
}

export function canTpsGuardThrow(input: {
  guarding: boolean;
  attackPressed: boolean;
  distance: number;
  opponentGrounded: boolean;
}): boolean {
  return input.guarding && input.attackPressed
    && input.opponentGrounded && input.distance <= 1.28;
}

/** Positive values are defender's time to retaliate before the attacker recovers. */
export function tpsGuardFrameAdvantage(
  attack: Pick<MoveDefinition, "startup" | "active" | "recovery" | "blockStun">,
  attackTick: number,
): number {
  const total = attack.startup + attack.active + attack.recovery;
  const attackerRemaining = Math.max(0, total - Math.max(0, attackTick));
  return Math.max(-40, Math.min(40, Math.floor(attackerRemaining - attack.blockStun)));
}

/** A hint, not artificial priority or guaranteed damage: player still needs a fast attack in range. */
export function tpsPunishWindowTicks(advantage: number): number {
  return advantage >= 5 ? Math.min(24, advantage + 2) : 0;
}

/** CPU can only lower its guard against a visibly committed low attack.
 * EASY never reads; NORMAL only sometimes reads slower lows; HARD needs
 * at least eight visible windup ticks. No instant frame-zero input reading.
 */
export function tpsCpuReadLowGuard(input: {
  defenderGuarding: boolean;
  move: Pick<MoveDefinition, "hitLevel" | "startup"> | null;
  attackTick: number;
  difficulty: "EASY" | "NORMAL" | "HARD";
  exchangeTick: number;
}): boolean {
  if (!input.defenderGuarding || input.move?.hitLevel !== "LOW") return false;
  if (input.difficulty === "EASY") return false;
  const visibleTicks = input.attackTick;
  if (input.difficulty === "HARD") return visibleTicks >= Math.max(8, Math.ceil(input.move.startup * .75));
  return (Math.floor(input.exchangeTick / 90) % 3 === 0)
    && visibleTicks >= Math.max(10, input.move.startup - 1);
}
