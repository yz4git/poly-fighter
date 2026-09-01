import type { FighterRuntime } from "./fighter";
import { reactionKindForMove } from "./motion-profile";
import type { HitEvent, ReactionKind } from "./types";

export type MotionReactionState = {
  kind: ReactionKind;
  side: -1 | 1;
  tier: 1 | 2 | 3;
  serial: number;
  lastGrounded: boolean;
  lastState: FighterRuntime["state"];
};

const fighters = new Map<string, FighterRuntime>();
const reactions = new WeakMap<FighterRuntime, MotionReactionState>();

function tierForPower(power: number, blocked: boolean): 1 | 2 | 3 {
  if (blocked) return 1;
  if (power >= 1.55) return 3;
  if (power >= 1.05) return 2;
  return 1;
}

function sideForEvent(event: HitEvent): -1 | 1 {
  if (event.move.visualContact === "LEFT_FIST" || event.move.visualContact === "LEFT_FOOT") return -1;
  return 1;
}

function ensure(fighter: FighterRuntime): MotionReactionState {
  let state = reactions.get(fighter);
  if (state) return state;
  state = {
    kind: "NONE",
    side: 1,
    tier: 1,
    serial: 0,
    lastGrounded: fighter.grounded,
    lastState: fighter.state,
  };
  reactions.set(fighter, state);
  return state;
}

export function trackMotionFighter(fighter: FighterRuntime): MotionReactionState {
  fighters.set(fighter.id, fighter);
  const state = ensure(fighter);
  const landed = !state.lastGrounded && fighter.grounded;
  if (landed && ["KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(fighter.state)) {
    state.kind = fighter.health <= 0 || fighter.state === "KO" ? "KO" : "DOWN";
    state.serial += 1;
  } else if (fighter.state === "WAKEUP" && state.lastState !== "WAKEUP") {
    state.kind = "DOWN";
    state.serial += 1;
  } else if (["IDLE", "WALK", "CROUCH", "GUARD", "SIDESTEP", "JUMP"].includes(fighter.state) && !["WAKEUP"].includes(state.lastState)) {
    state.kind = "NONE";
  }
  state.lastGrounded = fighter.grounded;
  state.lastState = fighter.state;
  return state;
}

export function recordMotionHit(event: HitEvent): void {
  const defender = fighters.get(event.defender);
  if (!defender) return;
  const state = ensure(defender);
  state.side = sideForEvent(event);
  state.tier = tierForPower(event.move.power, event.blocked);
  if (event.blocked) state.kind = "BLOCK";
  else if (event.move.hitLevel === "THROW") state.kind = defender.health <= 0 ? "KO" : "THROW";
  else state.kind = reactionKindForMove(
    event.move,
    ["KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(defender.state),
    defender.health,
  );
  state.serial += 1;
  state.lastGrounded = defender.grounded;
  state.lastState = defender.state;
}

export function motionReactionFor(fighter: FighterRuntime): MotionReactionState {
  return trackMotionFighter(fighter);
}

export function clearMotionReaction(fighter: FighterRuntime): void {
  const state = ensure(fighter);
  state.kind = "NONE";
  state.side = 1;
  state.tier = 1;
  state.serial += 1;
  state.lastGrounded = fighter.grounded;
  state.lastState = fighter.state;
}
