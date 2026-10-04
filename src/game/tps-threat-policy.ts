import type { FighterState, MoveDefinition } from "./types";

export type TpsEnemyThreat = {
  windup: boolean;
  incoming: boolean;
};

export function computeTpsEnemyThreat(input: {
  pendingMove: MoveDefinition | null;
  pendingTelegraphTicks: number;
  reactionWindowTicks: number;
  activeState: FighterState;
  activeMove: MoveDefinition | null;
  activeMoveTick: number;
  distance: number;
}): TpsEnemyThreat {
  const pending = Boolean(
    input.pendingMove
    && input.pendingTelegraphTicks > 0,
  );
  const pendingThreatReach = input.pendingMove
    ? input.pendingMove.reach + (input.pendingMove.id === "dashKick" ? 1.8 : 0.9)
    : 0;
  const lateWindup = Boolean(
    pending
    && input.pendingMove
    && input.pendingTelegraphTicks <= input.reactionWindowTicks
    && input.distance <= pendingThreatReach
  );
  const windup = pending && !lateWindup;

  if (input.activeState !== "ATTACK" || !input.activeMove) {
    return { windup, incoming: lateWindup };
  }

  const canStillHit = input.activeMoveTick
    < input.activeMove.startup + Math.max(1, input.activeMove.active);
  const inThreatReach = input.distance <= input.activeMove.reach + 0.9;
  return { windup, incoming: canStillHit && inThreatReach };
}
