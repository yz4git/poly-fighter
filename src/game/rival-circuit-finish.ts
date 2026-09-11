export type RivalCircuitFinishArchetype = "POWER" | "SPEED";
export type RivalCircuitFinishMoveId = "power" | "risingKick";

export const RIVAL_CIRCUIT_FINISH_HEALTH = 14;
export const RIVAL_CIRCUIT_FINISH_MAX_DISTANCE = 2.18;
export const RIVAL_CIRCUIT_FINISH_CHORD_TICKS = 3;
export const RIVAL_CIRCUIT_FINISH_TARGET_DISTANCE = 1.26;

export interface RivalCircuitFinishWindowInput {
  stage: number;
  defenderHealth: number;
  distance: number;
  defenderState?: string;
  consumed?: boolean;
}

export function rivalCircuitFinishMoveForArchetype(
  archetype: RivalCircuitFinishArchetype,
): RivalCircuitFinishMoveId {
  return archetype === "SPEED" ? "risingKick" : "power";
}

export function rivalCircuitFinishWindowOpen(input: RivalCircuitFinishWindowInput): boolean {
  if (input.stage < 1 || input.stage > 5 || input.consumed) return false;
  if (input.defenderHealth <= 0 || input.defenderHealth > RIVAL_CIRCUIT_FINISH_HEALTH) return false;
  if (input.distance > RIVAL_CIRCUIT_FINISH_MAX_DISTANCE) return false;
  if (["KO", "RING_OUT"].includes(input.defenderState ?? "")) return false;
  return true;
}

export function rivalCircuitFinishChordReady(
  lastAttackTick: number,
  lastStepTick: number,
  currentTick: number,
  windowTicks = RIVAL_CIRCUIT_FINISH_CHORD_TICKS,
): boolean {
  if (lastAttackTick < 0 || lastStepTick < 0) return false;
  if (currentTick - lastAttackTick > windowTicks || currentTick - lastStepTick > windowTicks) return false;
  return Math.abs(lastAttackTick - lastStepTick) <= windowTicks;
}

export function rivalCircuitFinishPursuitDistance(distance: number): number {
  return Math.max(0, Math.min(0.92, distance - RIVAL_CIRCUIT_FINISH_TARGET_DISTANCE));
}
