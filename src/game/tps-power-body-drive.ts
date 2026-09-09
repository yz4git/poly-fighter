import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type PowerDriveState = {
  host: THREE.Object3D | null;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
};

const states = new WeakMap<FighterRuntime, PowerDriveState>();
let installed = false;

function ensureState(fighter: FighterRuntime): PowerDriveState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    positionY: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
  };
  states.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function contactSide(contact: string | undefined): -1 | 1 {
  return contact === "LEFT_FIST" ? -1 : 1;
}

function removePowerDrive(fighter: FighterRuntime, state: PowerDriveState): void {
  if (state.host) {
    state.host.position.y -= state.positionY;
    state.host.rotation.x -= state.rotationX;
    state.host.rotation.y -= state.rotationY;
    state.host.rotation.z -= state.rotationZ;
  }
  state.host = null;
  state.positionY = 0;
  state.rotationX = 0;
  state.rotationY = 0;
  state.rotationZ = 0;
  fighter.visual.root.userData.tpsPowerBodyDriveBoost = 0;
}

function applyPowerDrive(fighter: FighterRuntime, state: PowerDriveState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const drive = Number(root.userData.tpsPowerDrive ?? 0);
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || move?.id !== "power"
    || !Number.isFinite(drive)
    || drive <= 1e-4
  ) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  // The Blender clip owns the fist/elbow path and the existing POWER pass owns
  // gameplay-facing body separation. This layer only makes the production model
  // read as one heavy chain from rear hip through chest into the striking shoulder.
  // Keep the accent compact so contact stays visually attached to the opponent.
  const factor = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(drive, 0, 1), 0, 1);
  const side = contactSide(move.visualContact);
  const scale = root.scale.x;

  state.host = host;
  state.positionY = -0.010 * scale * factor;
  state.rotationX = -0.026 * factor;
  state.rotationY = -side * 0.040 * factor;
  state.rotationZ = -side * 0.018 * factor;

  host.position.y += state.positionY;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsPowerBodyDriveBoost = factor;
  root.userData.tpsPowerBodyDriveBoostY = state.positionY;
  root.userData.tpsPowerBodyDriveBoostRotX = state.rotationX;
  root.userData.tpsPowerBodyDriveBoostRotY = state.rotationY;
  root.userData.tpsPowerBodyDriveBoostRotZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsPowerBodyDrivePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsPowerBodyDrive(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removePowerDrive(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyPowerDrive(fighter, state);
  };
}
