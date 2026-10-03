import type { FighterDna } from "./fighter-dna";
import type { MoveDefinition, ReactionTarget } from "./types";

export type TpsReactionType =
  | "FINISHER"
  | "INTERCEPT"
  | "REVERSAL"
  | "COUNTER"
  | "BLOCK"
  | "HEAVY"
  | "NORMAL";

export type TpsHitResolution = {
  blocked: boolean;
  resolvedDamage: number;
  lethalImpact: boolean;
  reactionStrength: number;
  reactionType: TpsReactionType;
  reactionRegion: ReactionTarget;
  reactionVariant: number;
  impactPairStrength: number;
  counter: boolean;
};

const TPS_IMPACT_HEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  jab: 2.62,
  straight: 2.60,
  backfist: 2.48,
  bodyBlow: 2.12,
  power: 2.35,
  kick: 1.80,
  lowKick: 0.92,
  risingKick: 2.06,
  dashKick: 1.98,
  throw: 1.75,
  counter: 2.66,
});

export function tpsImpactHeightForMove(move: MoveDefinition): number {
  return TPS_IMPACT_HEIGHTS[move.id] ?? (move.hitLevel === "LOW" ? 0.55 : 1.35);
}

export function computeTpsHitResolution(input: {
  move: MoveDefinition;
  defenderHealth: number;
  defenderGuarding: boolean;
  defenderWasAttacking: boolean;
  interceptStrike: boolean;
  reversalStrike: boolean;
  playerDna: FighterDna;
  simulationTicks: number;
  attackerIsPlayer: boolean;
}): TpsHitResolution {
  const {
    move,
    defenderHealth,
    defenderGuarding,
    defenderWasAttacking,
    interceptStrike,
    reversalStrike,
    playerDna,
    simulationTicks,
    attackerIsPlayer,
  } = input;

  const blocked = defenderGuarding
    && move.hitLevel !== "THROW"
    && !reversalStrike
    && !interceptStrike;

  const damageScale = interceptStrike
    ? 1.22 * playerDna.interceptDamageScale
    : reversalStrike
      ? 1.18 * playerDna.reversalDamageScale
      : defenderWasAttacking ? 1.12 : 1;

  const resolvedDamage = blocked ? 0 : Math.max(1, Math.round(move.damage * damageScale));
  const lethalImpact = !blocked && defenderHealth <= resolvedDamage;
  const reactionStrength = blocked
    ? 0.72
    : 1
      + Math.max(0, move.power - 1) * 0.22
      + (interceptStrike ? 0.24 : reversalStrike ? 0.18 : defenderWasAttacking ? 0.12 : 0);

  const reactionType: TpsReactionType = lethalImpact
    ? "FINISHER"
    : interceptStrike
      ? "INTERCEPT"
      : reversalStrike
        ? "REVERSAL"
        : defenderWasAttacking
          ? "COUNTER"
          : blocked
            ? "BLOCK"
            : move.power >= 1.45 ? "HEAVY" : "NORMAL";

  const reactionRegion = move.reactionTarget ?? (move.hitLevel === "LOW" ? "LEGS" : "BODY");
  const reactionVariant = (simulationTicks + move.id.length * 3 + (attackerIsPlayer ? 0 : 1)) % 3;
  const impactPairStrength = Math.min(
    1.9,
    Math.max(0.7, reactionStrength * (lethalImpact ? 1.18 : 1)),
  );

  return {
    blocked,
    resolvedDamage,
    lethalImpact,
    reactionStrength,
    reactionType,
    reactionRegion,
    reactionVariant,
    impactPairStrength,
    counter: defenderWasAttacking || interceptStrike,
  };
}
