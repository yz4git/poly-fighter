import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type CounterSlipState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationY: number;
};

const states = new WeakMap<FighterRuntime, CounterSlipState>();
let installed = false;

function ensureState(fighter: FighterRuntime): CounterSlipState {
  let state = states.get(fighter);
  if (state) return state;
  state = { host: null, positionX: 0, rotationY: 0 };
  states.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function removeCounterSlipBoost(fighter: FighterRuntime, state: CounterSlipState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.rotation.y -= state.rotationY;
  }
  state.host = null;
  state.positionX = 0;
  state.rotationY = 0;
  fighter.visual.root.userData.tpsCounterSlipBoost = 0;
}

function applyCounterSlipBoost(fighter: FighterRuntime, state: CounterSlipState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const accent = Number(root.userData.tpsCounterImportedAccent ?? 0);
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || move?.id !== "counter"
    || !Number.isFinite(accent)
    || accent <= 1e-4
  ) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  // The authored counter and its existing presentation pass already own the
  // striking arm and core slip. This pass only opens that same outside lane a
  // little farther so the close TPS camera reads "evade then return" rather than
  // another square-on punch. Gameplay spacing and contact remain authoritative.
  const baseSlip = Number(root.userData.tpsCounterImportedSlip ?? 0);
  const fallbackSign = move.visualContact === "LEFT_FIST" ? -1 : 1;
  const slipSign = Math.sign(baseSlip) || fallbackSign;
  const scale = root.scale.x;

  state.host = host;
  state.positionX = slipSign * 0.018 * scale * accent;
  state.rotationY = -slipSign * 0.035 * accent;
  host.position.x += state.positionX;
  host.rotation.y += state.rotationY;

  root.userData.tpsCounterSlipBoost = accent;
  root.userData.tpsCounterSlipBoostX = state.positionX;
  root.userData.tpsCounterSlipBoostYaw = state.rotationY;
  root.updateMatrixWorld(true);
}

export function installTpsCounterSlipBoostPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsCounterSlipBoost(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeCounterSlipBoost(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyCounterSlipBoost(fighter, state);
  };
}