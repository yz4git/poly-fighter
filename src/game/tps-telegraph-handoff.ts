import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type TelegraphKind = "PUNCH" | "KICK" | "HEAVY" | "SWEEP";

type TelegraphHandoffState = {
  appliedPositionX: number;
  appliedRotationX: number;
  appliedRotationY: number;
  appliedRotationZ: number;
};

const handoffStates = new WeakMap<FighterRuntime, TelegraphHandoffState>();
let installed = false;

function ensureState(fighter: FighterRuntime): TelegraphHandoffState {
  let state = handoffStates.get(fighter);
  if (state) return state;
  state = {
    appliedPositionX: 0,
    appliedRotationX: 0,
    appliedRotationY: 0,
    appliedRotationZ: 0,
  };
  handoffStates.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime) {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function smooth01(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function sideForVisualContact(contact: string | undefined): -1 | 1 {
  if (contact === "LEFT_FIST" || contact === "LEFT_FOOT") return -1;
  return 1;
}

function kindForMove(moveId: string): TelegraphKind {
  if (["kick", "lowKick", "risingKick", "dashKick"].includes(moveId)) return "KICK";
  if (["power", "throw"].includes(moveId)) return "HEAVY";
  if (["backfist", "counter"].includes(moveId)) return "SWEEP";
  return "PUNCH";
}

function removeHandoffTransform(fighter: FighterRuntime, state: TelegraphHandoffState): void {
  const active = Math.abs(state.appliedPositionX) > 1e-7
    || Math.abs(state.appliedRotationX) > 1e-7
    || Math.abs(state.appliedRotationY) > 1e-7
    || Math.abs(state.appliedRotationZ) > 1e-7;
  if (active) {
    const host = importedRuntimeHost(fighter);
    if (host) {
      host.position.x -= state.appliedPositionX;
      host.rotation.x -= state.appliedRotationX;
      host.rotation.y -= state.appliedRotationY;
      host.rotation.z -= state.appliedRotationZ;
      fighter.visual.root.updateMatrixWorld(true);
    }
  }
  state.appliedPositionX = 0;
  state.appliedRotationX = 0;
  state.appliedRotationY = 0;
  state.appliedRotationZ = 0;
  fighter.visual.root.userData.tpsTelegraphHandoff = 0;
}

function applyTelegraphHandoff(fighter: FighterRuntime, state: TelegraphHandoffState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const directorMove = String(root.userData.tpsCpuDirectorMove ?? "");
  const strikePhase = root.userData.tpsEnemyTelegraphPhase === "STRIKE";
  const eligible = root.userData.combatTps
    && root.userData.quaterniusModelState === "ready"
    && fighter.state === "ATTACK"
    && move
    && strikePhase
    && directorMove === move.id
    && !["throw", "dashKick"].includes(move.id);
  if (!eligible || !move) {
    root.userData.tpsTelegraphHandoff = 0;
    return;
  }

  // The final LOAD frame reaches a full body coil. Keep that same authored
  // direction for only the first few startup ticks, then smoothly hand control
  // to the Blender attack clip. No attack timing or simulation data is changed.
  const handoffTicks = Math.max(3, Math.min(5, Math.floor(move.startup * 0.5)));
  const factor = 1 - smooth01(fighter.moveTick / Math.max(1, handoffTicks));
  if (factor <= 1e-4) {
    root.userData.tpsTelegraphHandoff = 0;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const side = sideForVisualContact(move.visualContact);
  const kind = kindForMove(move.id);
  const scale = root.scale.x;

  let positionX = -side * 0.005 * scale;
  let rotationX = 0.012;
  let rotationY = side * 0.090;
  let rotationZ = -side * 0.018;

  if (kind === "KICK") {
    positionX = -side * 0.008 * scale;
    rotationX = 0.040;
    rotationY = -side * 0.100;
    rotationZ = side * 0.025;
  } else if (kind === "HEAVY") {
    positionX = -side * 0.007 * scale;
    rotationX = 0.026;
    rotationY = side * 0.140;
    rotationZ = -side * 0.034;
  } else if (kind === "SWEEP") {
    positionX = side * 0.007 * scale;
    rotationX = 0.010;
    rotationY = side * 0.125;
    rotationZ = -side * 0.030;
  }

  state.appliedPositionX = positionX * factor;
  state.appliedRotationX = rotationX * factor;
  state.appliedRotationY = rotationY * factor;
  state.appliedRotationZ = rotationZ * factor;
  host.position.x += state.appliedPositionX;
  host.rotation.x += state.appliedRotationX;
  host.rotation.y += state.appliedRotationY;
  host.rotation.z += state.appliedRotationZ;

  root.userData.tpsTelegraphHandoff = factor;
  root.userData.tpsTelegraphHandoffMove = move.id;
  root.userData.tpsTelegraphHandoffKind = kind;
  root.userData.tpsTelegraphHandoffTicks = handoffTicks;
  root.userData.tpsTelegraphHandoffSide = side;
  root.updateMatrixWorld(true);
}

export function installTpsTelegraphHandoffPresentation(): void {
  if (installed) return;
  installed = true;
  const baseUpdate = PresentationAnimationController.prototype.update;

  PresentationAnimationController.prototype.update = function updateWithTpsTelegraphHandoff(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeHandoffTransform(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyTelegraphHandoff(fighter, state);
  };
}
