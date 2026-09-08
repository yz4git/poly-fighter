import { FighterAnimationController, type FighterRuntime } from "./fighter";
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

type DamageAfterfeelState = {
  lastState: FighterRuntime["state"];
  until: number;
  side: -1 | 1;
  tier: 1 | 2 | 3;
  appliedX: number;
  appliedZ: number;
};

const fighters = new Map<string, FighterRuntime>();
const reactions = new WeakMap<FighterRuntime, MotionReactionState>();
const damageAfterfeel = new WeakMap<FighterRuntime, DamageAfterfeelState>();
const DAMAGE_AFTERFEEL_SECONDS = 0.20;
const DAMAGE_AFTERFEEL_SETTLE_STATES = new Set<FighterRuntime["state"]>(["IDLE", "WALK", "CROUCH"]);

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

function ensureDamageAfterfeel(fighter: FighterRuntime): DamageAfterfeelState {
  let state = damageAfterfeel.get(fighter);
  if (state) return state;
  state = {
    lastState: fighter.state,
    until: 0,
    side: 1,
    tier: 1,
    appliedX: 0,
    appliedZ: 0,
  };
  damageAfterfeel.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime) {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function removeDamageAfterfeelTransform(fighter: FighterRuntime, state: DamageAfterfeelState): void {
  if (Math.abs(state.appliedX) <= 1e-6 && Math.abs(state.appliedZ) <= 1e-6) return;
  const host = importedRuntimeHost(fighter);
  if (host) {
    host.rotation.x -= state.appliedX;
    host.rotation.z -= state.appliedZ;
    fighter.visual.root.updateMatrixWorld(true);
  }
  state.appliedX = 0;
  state.appliedZ = 0;
  fighter.visual.root.userData.tpsDamageAfterfeel = 0;
}

function smooth01(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

// Presentation-only hit residue. The base gameplay controller is still the sole
// owner of hit stun and action timing; this hook just keeps a few degrees of the
// last recoil on the imported production model after HIT returns to a neutral
// locomotion state. The previous frame's contribution is removed before any new
// committed action so attacks, guard, STEP, jump and a second hit start cleanly.
const baseAnimationUpdate = FighterAnimationController.prototype.update;
FighterAnimationController.prototype.update = function updateWithDamageAfterfeel(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  timeSeconds: number,
): void {
  const afterfeel = ensureDamageAfterfeel(fighter);
  const settling = DAMAGE_AFTERFEEL_SETTLE_STATES.has(fighter.state);

  if (!settling) {
    removeDamageAfterfeelTransform(fighter, afterfeel);
    afterfeel.until = 0;
  }

  if (afterfeel.lastState === "HIT" && settling && fighter.visual.root.userData.combatTps) {
    const reaction = ensure(fighter);
    afterfeel.until = timeSeconds + DAMAGE_AFTERFEEL_SECONDS;
    afterfeel.side = reaction.side;
    afterfeel.tier = reaction.tier;
  }
  afterfeel.lastState = fighter.state;

  baseAnimationUpdate.call(this, fighter, opponent, timeSeconds);

  if (!fighter.visual.root.userData.combatTps || fighter.visual.root.userData.quaterniusModelState !== "ready") {
    removeDamageAfterfeelTransform(fighter, afterfeel);
    return;
  }

  const remaining = settling ? Math.max(0, afterfeel.until - timeSeconds) : 0;
  const normalized = DAMAGE_AFTERFEEL_SECONDS > 0 ? remaining / DAMAGE_AFTERFEEL_SECONDS : 0;
  const factor = smooth01(normalized);
  const tierScale = afterfeel.tier === 3 ? 1.22 : afterfeel.tier === 2 ? 1 : 0.72;
  const nextX = 0.046 * tierScale * factor;
  const nextZ = afterfeel.side * 0.032 * tierScale * factor;

  // The imported model is sampled later in PresentationAnimationController.
  // Apply the residue after the current synchronous frame finishes so it is
  // already present for the next render without interfering with clip sampling.
  queueMicrotask(() => {
    const stillSettling = DAMAGE_AFTERFEEL_SETTLE_STATES.has(fighter.state);
    const host = importedRuntimeHost(fighter);
    if (!host || !stillSettling || !fighter.visual.root.userData.combatTps) {
      removeDamageAfterfeelTransform(fighter, afterfeel);
      return;
    }
    host.rotation.x += nextX - afterfeel.appliedX;
    host.rotation.z += nextZ - afterfeel.appliedZ;
    afterfeel.appliedX = nextX;
    afterfeel.appliedZ = nextZ;
    fighter.visual.root.userData.tpsDamageAfterfeel = factor;
    fighter.visual.root.userData.tpsDamageAfterfeelTier = afterfeel.tier;
    fighter.visual.root.userData.tpsDamageAfterfeelSide = afterfeel.side;
    fighter.visual.root.updateMatrixWorld(true);
  });
};

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
  const afterfeel = ensureDamageAfterfeel(fighter);
  removeDamageAfterfeelTransform(fighter, afterfeel);
  afterfeel.until = 0;
  afterfeel.lastState = fighter.state;
}
