import type { FighterState, MoveDefinition } from "./types";

export type TpsContactSpacingMode = "THROW" | "IMPACT_PAIR" | "NEUTRAL";

export type TpsContactSpacingInput = {
  p1State: FighterState;
  p2State: FighterState;
  p1Move: MoveDefinition | null;
  p2Move: MoveDefinition | null;
  p1HitStop: number;
  p2HitStop: number;
};

export type TpsContactSpacing = {
  mode: TpsContactSpacingMode;
  minimum: number;
  impactMoveId: string | null;
};

export const TPS_IMPACT_CONTACT_MINIMUM = 1.52;
export const TPS_IMPACT_CONTACT_MINIMUM_HEAVY = 1.58;
export const TPS_IMPACT_CONTACT_MINIMUM_KICK = 1.62;

const TPS_IMPACT_DEFENDER_STATES = new Set<FighterState>([
  "HIT",
  "BLOCK_STUN",
  "KNOCKDOWN",
  "THROW",
  "KO",
  "RING_OUT",
]);

function isThrowContact(state: FighterState, move: MoveDefinition | null): boolean {
  return move?.hitLevel === "THROW" && (state === "ATTACK" || state === "THROW");
}

function isImpacting(
  attackerState: FighterState,
  attackerMove: MoveDefinition | null,
  defenderState: FighterState,
): boolean {
  return attackerState === "ATTACK"
    && Boolean(attackerMove)
    && TPS_IMPACT_DEFENDER_STATES.has(defenderState);
}

function impactMinimumForMove(moveId: string | null): number {
  if (moveId && ["kick", "lowKick", "risingKick", "dashKick"].includes(moveId)) {
    return TPS_IMPACT_CONTACT_MINIMUM_KICK;
  }
  if (moveId && ["power", "backfist", "counter"].includes(moveId)) {
    return TPS_IMPACT_CONTACT_MINIMUM_HEAVY;
  }
  return TPS_IMPACT_CONTACT_MINIMUM;
}

export function computeTpsContactSpacing(input: TpsContactSpacingInput): TpsContactSpacing {
  const p1Throwing = isThrowContact(input.p1State, input.p1Move);
  const p2Throwing = isThrowContact(input.p2State, input.p2Move);
  const throwContact = p1Throwing || p2Throwing;

  const impactFrozen = Math.max(input.p1HitStop, input.p2HitStop) > 0;
  const p1Impacting = isImpacting(input.p1State, input.p1Move, input.p2State);
  const p2Impacting = isImpacting(input.p2State, input.p2Move, input.p1State);
  const impactPair = impactFrozen && (p1Impacting || p2Impacting);
  const impactMove = p1Impacting ? input.p1Move : p2Impacting ? input.p2Move : null;
  const impactMoveId = impactMove?.id ?? null;

  if (throwContact) {
    return { mode: "THROW", minimum: 0.98, impactMoveId };
  }
  if (impactPair) {
    return {
      mode: "IMPACT_PAIR",
      minimum: impactMinimumForMove(impactMoveId),
      impactMoveId,
    };
  }
  return { mode: "NEUTRAL", minimum: 1.12, impactMoveId };
}
