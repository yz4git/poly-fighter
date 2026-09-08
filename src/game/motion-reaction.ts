import type { FighterRuntime } from "./fighter";
import { reactionKindForMove } from "./motion-profile";
import { PresentationAnimationController } from "./presentation-animation";
import { TpsHypeDirector } from "./tps-hype";
import type { HitEvent, ReactionKind } from "./types";
import { getVisualContactPoint } from "./visual";

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

type ComboMomentumKind = "PUNCH" | "KICK" | "HEAVY" | "SWEEP";

type ComboMomentumCarryState = {
  serial: number;
  until: number;
  duration: number;
  fromMove: string;
  side: -1 | 1;
  kind: ComboMomentumKind;
  appliedPositionX: number;
  appliedRotationX: number;
  appliedRotationY: number;
  appliedRotationZ: number;
};

type AttackAfterfeelState = {
  lastState: FighterRuntime["state"];
  lastMoveId: string;
  until: number;
  duration: number;
  side: -1 | 1;
  kind: ComboMomentumKind;
  appliedPositionX: number;
  appliedRotationX: number;
  appliedRotationY: number;
  appliedRotationZ: number;
};

const fighters = new Map<string, FighterRuntime>();
const reactions = new WeakMap<FighterRuntime, MotionReactionState>();
const damageAfterfeel = new WeakMap<FighterRuntime, DamageAfterfeelState>();
const comboMomentumCarry = new WeakMap<FighterRuntime, ComboMomentumCarryState>();
const attackAfterfeel = new WeakMap<FighterRuntime, AttackAfterfeelState>();
const DAMAGE_AFTERFEEL_SECONDS = 0.20;
const DAMAGE_AFTERFEEL_SETTLE_STATES = new Set<FighterRuntime["state"]>(["IDLE", "WALK", "CROUCH"]);

function tierForPower(power: number, blocked: boolean): 1 | 2 | 3 {
  if (blocked) return 1;
  if (power >= 1.55) return 3;
  if (power >= 1.05) return 2;
  return 1;
}

function sideForVisualContact(contact: string | undefined): -1 | 1 {
  if (contact === "LEFT_FIST" || contact === "LEFT_FOOT") return -1;
  return 1;
}

function sideForEvent(event: HitEvent): -1 | 1 {
  return sideForVisualContact(event.move.visualContact);
}

function comboMomentumKindForMove(moveId: string): ComboMomentumKind {
  if (["kick", "lowKick", "risingKick", "dashKick"].includes(moveId)) return "KICK";
  if (["power", "throw"].includes(moveId)) return "HEAVY";
  if (["backfist", "counter"].includes(moveId)) return "SWEEP";
  return "PUNCH";
}

function attackAfterfeelDuration(kind: ComboMomentumKind): number {
  if (kind === "HEAVY") return 0.16;
  if (kind === "SWEEP") return 0.13;
  if (kind === "KICK") return 0.12;
  return 0.10;
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

function ensureComboMomentumCarry(fighter: FighterRuntime): ComboMomentumCarryState {
  let state = comboMomentumCarry.get(fighter);
  if (state) return state;
  state = {
    serial: Number(fighter.visual.root.userData.tpsComboLinkSerial ?? 0),
    until: 0,
    duration: 0.09,
    fromMove: "",
    side: 1,
    kind: "PUNCH",
    appliedPositionX: 0,
    appliedRotationX: 0,
    appliedRotationY: 0,
    appliedRotationZ: 0,
  };
  comboMomentumCarry.set(fighter, state);
  return state;
}

function ensureAttackAfterfeel(fighter: FighterRuntime): AttackAfterfeelState {
  let state = attackAfterfeel.get(fighter);
  if (state) return state;
  state = {
    lastState: fighter.state,
    lastMoveId: fighter.currentMove?.id ?? "",
    until: 0,
    duration: 0.10,
    side: 1,
    kind: "PUNCH",
    appliedPositionX: 0,
    appliedRotationX: 0,
    appliedRotationY: 0,
    appliedRotationZ: 0,
  };
  attackAfterfeel.set(fighter, state);
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

function removeComboMomentumTransform(fighter: FighterRuntime, state: ComboMomentumCarryState): void {
  const hasTransform = Math.abs(state.appliedPositionX) > 1e-6
    || Math.abs(state.appliedRotationX) > 1e-6
    || Math.abs(state.appliedRotationY) > 1e-6
    || Math.abs(state.appliedRotationZ) > 1e-6;
  if (!hasTransform) return;
  const host = importedRuntimeHost(fighter);
  if (host) {
    host.position.x -= state.appliedPositionX;
    host.rotation.x -= state.appliedRotationX;
    host.rotation.y -= state.appliedRotationY;
    host.rotation.z -= state.appliedRotationZ;
    fighter.visual.root.updateMatrixWorld(true);
  }
  state.appliedPositionX = 0;
  state.appliedRotationX = 0;
  state.appliedRotationY = 0;
  state.appliedRotationZ = 0;
  fighter.visual.root.userData.tpsComboMomentumCarry = 0;
}

function removeAttackAfterfeelTransform(fighter: FighterRuntime, state: AttackAfterfeelState): void {
  const hasTransform = Math.abs(state.appliedPositionX) > 1e-6
    || Math.abs(state.appliedRotationX) > 1e-6
    || Math.abs(state.appliedRotationY) > 1e-6
    || Math.abs(state.appliedRotationZ) > 1e-6;
  if (!hasTransform) return;
  const host = importedRuntimeHost(fighter);
  if (host) {
    host.position.x -= state.appliedPositionX;
    host.rotation.x -= state.appliedRotationX;
    host.rotation.y -= state.appliedRotationY;
    host.rotation.z -= state.appliedRotationZ;
    fighter.visual.root.updateMatrixWorld(true);
  }
  state.appliedPositionX = 0;
  state.appliedRotationX = 0;
  state.appliedRotationY = 0;
  state.appliedRotationZ = 0;
  fighter.visual.root.userData.tpsAttackAfterfeel = 0;
}

function smooth01(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function beginComboMomentumCarry(fighter: FighterRuntime, state: ComboMomentumCarryState, timeSeconds: number): void {
  const root = fighter.visual.root;
  const serial = Number(root.userData.tpsComboLinkSerial ?? 0);
  if (!Number.isFinite(serial) || serial <= state.serial) return;

  state.serial = serial;
  const fromMove = String(root.userData.tpsComboLinkFromMove ?? "");
  const authoredBlend = Number(root.userData.tpsComboLinkBlendSeconds ?? 0.075);
  const blend = Number.isFinite(authoredBlend) ? authoredBlend : 0.075;
  state.duration = Math.max(0.085, Math.min(0.11, blend * 1.25));
  state.until = timeSeconds + state.duration;
  state.fromMove = fromMove;
  const move = fighter.definition.moves[fromMove];
  state.side = sideForVisualContact(move?.visualContact);
  state.kind = comboMomentumKindForMove(fromMove);

  root.userData.tpsComboMomentumFromMove = fromMove;
  root.userData.tpsComboMomentumKind = state.kind;
  root.userData.tpsComboMomentumSide = state.side;
  root.userData.tpsComboMomentumDuration = state.duration;
}

function applyComboMomentumCarry(fighter: FighterRuntime, state: ComboMomentumCarryState, timeSeconds: number): void {
  const root = fighter.visual.root;
  if (!root.userData.combatTps || root.userData.quaterniusModelState !== "ready" || fighter.state !== "ATTACK") {
    root.userData.tpsComboMomentumCarry = 0;
    return;
  }

  const remaining = Math.max(0, state.until - timeSeconds);
  const normalized = state.duration > 0 ? remaining / state.duration : 0;
  const factor = smooth01(normalized);
  if (factor <= 1e-4) {
    root.userData.tpsComboMomentumCarry = 0;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const scale = root.scale.x;
  let positionX = -state.side * 0.006 * scale;
  let rotationX = -0.014;
  let rotationY = -state.side * 0.030;
  let rotationZ = state.side * 0.010;

  if (state.kind === "SWEEP") {
    positionX = -state.side * 0.012 * scale;
    rotationX = -0.008;
    rotationY = -state.side * 0.050;
    rotationZ = state.side * 0.020;
  } else if (state.kind === "HEAVY") {
    positionX = -state.side * 0.008 * scale;
    rotationX = -0.026;
    rotationY = -state.side * 0.038;
    rotationZ = -state.side * 0.016;
  } else if (state.kind === "KICK") {
    positionX = state.side * 0.006 * scale;
    rotationX = -0.020;
    rotationY = state.side * 0.024;
    rotationZ = -state.side * 0.012;
  }

  state.appliedPositionX = positionX * factor;
  state.appliedRotationX = rotationX * factor;
  state.appliedRotationY = rotationY * factor;
  state.appliedRotationZ = rotationZ * factor;
  host.position.x += state.appliedPositionX;
  host.rotation.x += state.appliedRotationX;
  host.rotation.y += state.appliedRotationY;
  host.rotation.z += state.appliedRotationZ;

  root.userData.tpsComboMomentumCarry = factor;
  root.userData.tpsComboMomentumPositionX = state.appliedPositionX;
  root.userData.tpsComboMomentumRotationX = state.appliedRotationX;
  root.userData.tpsComboMomentumRotationY = state.appliedRotationY;
  root.userData.tpsComboMomentumRotationZ = state.appliedRotationZ;
  root.updateMatrixWorld(true);
}

function beginAttackAfterfeel(fighter: FighterRuntime, state: AttackAfterfeelState, timeSeconds: number, settling: boolean): void {
  const root = fighter.visual.root;
  if (fighter.state === "ATTACK" && fighter.currentMove) {
    state.lastMoveId = fighter.currentMove.id;
  }

  if (state.lastState === "ATTACK" && settling && state.lastMoveId) {
    const move = fighter.definition.moves[state.lastMoveId];
    state.kind = comboMomentumKindForMove(state.lastMoveId);
    state.side = sideForVisualContact(move?.visualContact);
    state.duration = attackAfterfeelDuration(state.kind);
    state.until = timeSeconds + state.duration;
    root.userData.tpsAttackAfterfeelMove = state.lastMoveId;
    root.userData.tpsAttackAfterfeelKind = state.kind;
    root.userData.tpsAttackAfterfeelSide = state.side;
    root.userData.tpsAttackAfterfeelDuration = state.duration;
  } else if (!settling && fighter.state !== "ATTACK") {
    state.until = 0;
  }
  state.lastState = fighter.state;
}

function applyAttackAfterfeel(fighter: FighterRuntime, state: AttackAfterfeelState, timeSeconds: number, settling: boolean): void {
  const root = fighter.visual.root;
  if (!root.userData.combatTps || !settling || root.userData.quaterniusModelState !== "ready") {
    root.userData.tpsAttackAfterfeel = 0;
    return;
  }

  const remaining = Math.max(0, state.until - timeSeconds);
  const normalized = state.duration > 0 ? remaining / state.duration : 0;
  const factor = smooth01(normalized);
  if (factor <= 1e-4) {
    root.userData.tpsAttackAfterfeel = 0;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const scale = root.scale.x;
  let positionX = -state.side * 0.005 * scale;
  let rotationX = -0.012;
  let rotationY = -state.side * 0.024;
  let rotationZ = state.side * 0.008;

  if (state.kind === "SWEEP") {
    positionX = -state.side * 0.009 * scale;
    rotationX = -0.008;
    rotationY = -state.side * 0.042;
    rotationZ = state.side * 0.014;
  } else if (state.kind === "HEAVY") {
    positionX = -state.side * 0.007 * scale;
    rotationX = -0.024;
    rotationY = -state.side * 0.046;
    rotationZ = -state.side * 0.016;
  } else if (state.kind === "KICK") {
    positionX = state.side * 0.005 * scale;
    rotationX = -0.018;
    rotationY = state.side * 0.022;
    rotationZ = -state.side * 0.010;
  }

  state.appliedPositionX = positionX * factor;
  state.appliedRotationX = rotationX * factor;
  state.appliedRotationY = rotationY * factor;
  state.appliedRotationZ = rotationZ * factor;
  host.position.x += state.appliedPositionX;
  host.rotation.x += state.appliedRotationX;
  host.rotation.y += state.appliedRotationY;
  host.rotation.z += state.appliedRotationZ;

  root.userData.tpsAttackAfterfeel = factor;
  root.userData.tpsAttackAfterfeelPositionX = state.appliedPositionX;
  root.userData.tpsAttackAfterfeelRotationX = state.appliedRotationX;
  root.userData.tpsAttackAfterfeelRotationY = state.appliedRotationY;
  root.userData.tpsAttackAfterfeelRotationZ = state.appliedRotationZ;
  root.updateMatrixWorld(true);
}

// Presentation-only hit residue, attack follow-through and combo momentum carry.
// Wrap the final presentation controller rather than the base pose controller so
// the imported model has already been sampled and move-specific host corrections
// have run. Previous-frame contributions are removed before normal sampling,
// then small residuals are added back only to the rendered Quaternius host.
// Gameplay timing, fighter position, hitboxes, reach and deterministic simulation
// stay untouched.
const basePresentationUpdate = PresentationAnimationController.prototype.update;
PresentationAnimationController.prototype.update = function updateWithDamageAfterfeel(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  timeSeconds: number,
): void {
  const afterfeel = ensureDamageAfterfeel(fighter);
  const comboCarry = ensureComboMomentumCarry(fighter);
  const attackTail = ensureAttackAfterfeel(fighter);
  removeDamageAfterfeelTransform(fighter, afterfeel);
  removeComboMomentumTransform(fighter, comboCarry);
  removeAttackAfterfeelTransform(fighter, attackTail);

  const combatTps = Boolean(fighter.visual.root.userData.combatTps);
  const settling = DAMAGE_AFTERFEEL_SETTLE_STATES.has(fighter.state);
  if (combatTps && afterfeel.lastState === "HIT" && settling) {
    const reaction = ensure(fighter);
    afterfeel.until = timeSeconds + DAMAGE_AFTERFEEL_SECONDS;
    afterfeel.side = reaction.side;
    afterfeel.tier = reaction.tier;
  } else if (!settling) {
    afterfeel.until = 0;
  }
  afterfeel.lastState = fighter.state;

  if (combatTps) {
    beginComboMomentumCarry(fighter, comboCarry, timeSeconds);
    beginAttackAfterfeel(fighter, attackTail, timeSeconds, settling);
  } else {
    comboCarry.until = 0;
    attackTail.until = 0;
    attackTail.lastState = fighter.state;
  }

  basePresentationUpdate.call(this, fighter, opponent, timeSeconds);
  applyComboMomentumCarry(fighter, comboCarry, timeSeconds);
  applyAttackAfterfeel(fighter, attackTail, timeSeconds, settling);

  if (!combatTps || !settling || fighter.visual.root.userData.quaterniusModelState !== "ready") {
    fighter.visual.root.userData.tpsDamageAfterfeel = 0;
    return;
  }

  const remaining = Math.max(0, afterfeel.until - timeSeconds);
  const normalized = DAMAGE_AFTERFEEL_SECONDS > 0 ? remaining / DAMAGE_AFTERFEEL_SECONDS : 0;
  const factor = smooth01(normalized);
  if (factor <= 1e-4) {
    fighter.visual.root.userData.tpsDamageAfterfeel = 0;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const tierScale = afterfeel.tier === 3 ? 1.22 : afterfeel.tier === 2 ? 1 : 0.72;
  const nextX = 0.046 * tierScale * factor;
  const nextZ = afterfeel.side * 0.032 * tierScale * factor;
  host.rotation.x += nextX;
  host.rotation.z += nextZ;
  afterfeel.appliedX = nextX;
  afterfeel.appliedZ = nextZ;
  fighter.visual.root.userData.tpsDamageAfterfeel = factor;
  fighter.visual.root.userData.tpsDamageAfterfeelTier = afterfeel.tier;
  fighter.visual.root.userData.tpsDamageAfterfeelSide = afterfeel.side;
  fighter.visual.root.updateMatrixWorld(true);
};

// The core impact system already samples the procedural strike limb for its own
// contact flash. TPS Hype used a separate root-interpolated event position, so
// its ring/burst could appear lower than the fist or foot that visibly landed.
// Reuse the same authored visual contact point for Hype only. The original
// HitEvent remains untouched for audio, damage, hitstop and all gameplay logic.
const baseHypeHit = TpsHypeDirector.prototype.hit;
TpsHypeDirector.prototype.hit = function hitAtMotionContact(
  event: HitEvent,
  camera: Parameters<TpsHypeDirector["hit"]>[1],
): void {
  const attacker = fighters.get(event.attacker);
  const contact = event.move.visualContact;
  if (!attacker || !attacker.visual.root.userData.combatTps || !contact || contact === "BODY") {
    baseHypeHit.call(this, event, camera);
    return;
  }

  const world = getVisualContactPoint(attacker.visual, contact);
  if (![world.x, world.y, world.z].every(Number.isFinite)) {
    baseHypeHit.call(this, event, camera);
    return;
  }

  attacker.visual.root.userData.tpsHypeContactMode = "MOTION_CONTACT";
  attacker.visual.root.userData.tpsHypeContactHeight = world.y;
  attacker.visual.root.userData.tpsHypeContactPoint = { x: world.x, y: world.y, z: world.z };
  baseHypeHit.call(this, {
    ...event,
    position: { x: world.x, y: world.y, z: world.z },
  }, camera);
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
  const comboCarry = ensureComboMomentumCarry(fighter);
  removeComboMomentumTransform(fighter, comboCarry);
  comboCarry.until = 0;
  comboCarry.serial = Number(fighter.visual.root.userData.tpsComboLinkSerial ?? comboCarry.serial);
  const attackTail = ensureAttackAfterfeel(fighter);
  removeAttackAfterfeelTransform(fighter, attackTail);
  attackTail.until = 0;
  attackTail.lastState = fighter.state;
  attackTail.lastMoveId = fighter.currentMove?.id ?? "";
}
