import type { MoveDefinition } from "./types";

export type TpsAirCombo = {
  attackerId: string;
  defenderId: string;
  hits: number;
  remainingTicks: number;
};

export const TPS_AIR_COMBO_DURATION_TICKS = 112;
export const TPS_AIR_COMBO_MAX_HITS = 4;

/**
 * Real, bounded physical juggling: no fake auto-combo and no magnetic hits.
 * Standard punches cannot damage a rival suspended several meters in the air.
 */
export function canCinematicStrikeAirborne(
  move: MoveDefinition,
  airCombo: TpsAirCombo | null,
  attackerId: string,
  defenderId: string,
  defenderHeight: number,
): boolean {
  const aerial = defenderHeight > 0.48;
  if (!aerial) return move.cinematicRole !== "airChase" && move.cinematicRole !== "meteorSlam";
  if (!airCombo || airCombo.remainingTicks <= 0
    || airCombo.attackerId !== attackerId || airCombo.defenderId !== defenderId) return false;
  if (defenderHeight > 3.5) return false;
  if (move.cinematicRole === "airChase") return airCombo.hits >= 1 && airCombo.hits < 3;
  if (move.cinematicRole === "meteorSlam") return airCombo.hits >= 3;
  return false;
}

/** Only the launcher opens a chain; only genuine airborne hits advance it. */
export function nextTpsAirCombo(
  move: MoveDefinition,
  existing: TpsAirCombo | null,
  attackerId: string,
  defenderId: string,
): TpsAirCombo | null {
  if (move.cinematicRole === "skyBreaker") {
    return { attackerId, defenderId, hits: 1, remainingTicks: TPS_AIR_COMBO_DURATION_TICKS };
  }
  if (!existing || existing.attackerId !== attackerId || existing.defenderId !== defenderId) return null;
  if (move.cinematicRole === "meteorSlam") return null;
  if (move.cinematicRole === "airChase") {
    return { ...existing, hits: Math.min(TPS_AIR_COMBO_MAX_HITS, existing.hits + 1), remainingTicks: TPS_AIR_COMBO_DURATION_TICKS };
  }
  return existing;
}

export function tickTpsAirCombo(
  existing: TpsAirCombo | null,
  defenderGrounded: boolean,
  defenderHealth: number,
): TpsAirCombo | null {
  if (!existing || defenderGrounded || defenderHealth <= 0 || existing.remainingTicks <= 1) return null;
  return { ...existing, remainingTicks: existing.remainingTicks - 1 };
}

/** Air follow-ups have diminishing returns; launch and ender pay normal damage. */
export function tpsAirComboDamage(
  baseDamage: number,
  move: MoveDefinition,
  existing: TpsAirCombo | null,
): number {
  if (move.cinematicRole !== "airChase" || !existing) return baseDamage;
  return Math.max(2, Math.round(baseDamage * (existing.hits === 1 ? .8 : .63)));
}

/** The air chain extends only while a clean hit was earned. */
export function maxTpsComboStage(airCombo: TpsAirCombo | null): number {
  return airCombo ? 5 : 3;
}
