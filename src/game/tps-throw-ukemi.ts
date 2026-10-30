import type { FighterState, MoveDefinition } from "./types";

export const TPS_THROW_TECH_REACTION_TICKS = 12;
export const TPS_UKEMI_ROLL_TICKS = 8;
export const TPS_UKEMI_TOTAL_DISTANCE = 0.48;

/** A throw must visibly start before ATTACK can break it.
 * Tapping the button during a distant telegraph is not a free escape.
 */
export function canBufferTpsThrowTech(input: {
  attackPressed: boolean;
  playerState: FighterState;
  enemyState: FighterState;
  enemyMove: MoveDefinition | null;
  enemyMoveTick: number;
  distance: number;
}): boolean {
  const { attackPressed, playerState, enemyState, enemyMove, enemyMoveTick, distance } = input;
  if (!attackPressed || !["IDLE", "WALK", "GUARD", "SIDESTEP"].includes(playerState)
    || enemyState !== "ATTACK" || enemyMove?.hitLevel !== "THROW" || distance > 1.75) return false;
  const openingTick = Math.max(0, enemyMove.startup - TPS_THROW_TECH_REACTION_TICKS);
  return enemyMoveTick >= openingTick
    && enemyMoveTick <= enemyMove.startup + enemyMove.active;
}

/** A throw-tech is meaningful only while an existing throw is really connected. */
export function canResolveTpsThrowTech(
  attackerMove: MoveDefinition,
  bufferedTicks: number,
  defenderState: FighterState,
): boolean {
  return attackerMove.hitLevel === "THROW" && bufferedTicks > 0
    && !["HIT", "BLOCK_STUN", "KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(defenderState);
}

/** One STEP tap during grounded knockdown initiates an optional, directional
 * physical tech-roll. It does not make the fighter invulnerable.
 */
export function canStartTpsUkemi(input: {
  stepPressed: boolean;
  state: FighterState;
  grounded: boolean;
  knockdownTicks: number;
  forwardAxis: number;
  sideAxis: number;
  alreadyRolling: boolean;
}): boolean {
  return input.stepPressed && input.state === "KNOCKDOWN" && input.grounded
    && input.knockdownTicks > 11 && input.knockdownTicks <= 54
    && !input.alreadyRolling
    && (input.forwardAxis < -.45 || Math.abs(input.sideAxis) > .45);
}

export function tpsUkemiMovePerFrame(): number {
  return TPS_UKEMI_TOTAL_DISTANCE / TPS_UKEMI_ROLL_TICKS;
}
