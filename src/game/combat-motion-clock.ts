import type { MoveDefinition } from "./types";

export const COMBAT_MOTION_VERSION = "COMBAT_MOTION_V7";

/** Contact phases are measured from the committed Foundry assets (frame - 1). */
export const AUTHORED_CONTACT_PHASE: Readonly<Record<string, number>> = {
  BF_Jab_L: 16 / 32,
  BF_Cross_R: 20 / 41,
  BF_BodyBlow_L: 22 / 43,
  BF_BodyBlow_R: 22 / 43,
  BF_Backfist_R: 20 / 40,
  BF_Backfist_L: 20 / 40,
  BF_Power_R: 29 / 51,
  BF_FrontKick_R: 23 / 42,
  BF_LowKick_L: 24 / 45,
  BF_RisingKick_R: 27 / 48,
  BF_DashKick_R: 22 / 44,
  CM_Counter_L: .5,
  CM_Counter_R: .5,
  CM_Throw: .5,
};

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function smoothMotion(value: number): number {
  const u = clamp01(value);
  return u * u * u * (10 + u * (-15 + u * 6));
}

/** Gameplay owns time, including hitstop. No animation can run ahead of a hit. */
export function combatAttackPhase(move: Pick<MoveDefinition, "startup" | "active" | "recovery">, tick: number, impact: number): number {
  const end = Math.max(1, move.startup + move.active + move.recovery - 1);
  const start = Math.min(end, Math.max(0, move.startup));
  const activeEnd = Math.min(end, start + Math.max(1, move.active) - 1);
  const t = Math.max(0, Math.min(end, tick));
  const release = Math.min(.68, impact + .035);
  if (t <= start) return start === 0 ? impact : impact * t / start;
  if (t <= activeEnd) return impact + (release - impact) * (t - start) / Math.max(1, activeEnd - start);
  return release + (1 - release) * (t - activeEnd) / Math.max(1, end - activeEnd);
}

export const LOCOMOTION_DIRECTIONS = ["F", "FR", "R", "BR", "B", "BL", "L", "FL"] as const;
export type LocomotionDirection = typeof LOCOMOTION_DIRECTIONS[number];

export function locomotionDirection(x: number, z: number): LocomotionDirection {
  const sector = Math.round(Math.atan2(x, z) / (Math.PI / 4));
  return LOCOMOTION_DIRECTIONS[(sector + 8) % 8];
}

/** The stance part is linear: world travel exactly cancels the planted foot. */
export function combatFootCycle(phase: number): { travel: number; lift: number; planted: boolean; roll: number } {
  const u = ((phase % 1) + 1) % 1;
  const stance = .62;
  if (u < stance) {
    const t = u / stance;
    return { travel: .5 - t, lift: 0, planted: true, roll: .08 * smoothMotion((t - .82) / .18) };
  }
  const t = (u - stance) / (1 - stance);
  return { travel: -.5 + smoothMotion(t), lift: Math.sin(Math.PI * t) ** 2, planted: false, roll: -.10 * Math.sin(Math.PI * t) };
}
