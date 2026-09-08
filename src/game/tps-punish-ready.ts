import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";
import { TpsFightGame } from "./tps-game";

type PunishReadyState = {
  host: THREE.Object3D | null;
  positionX: number;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
};

type TpsPunishRuntime = TpsFightGame & {
  playerReversalTicks: number;
  playerPerfectEvadeTicks: number;
  playerEvadeSign: number;
  p1: FighterRuntime;
};

type TpsVisualPrototype = {
  updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
};

const states = new WeakMap<FighterRuntime, PunishReadyState>();
let installed = false;

function ensureState(fighter: FighterRuntime): PunishReadyState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    positionX: 0,
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

function smooth01(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function removePunishReady(fighter: FighterRuntime, state: PunishReadyState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.position.y -= state.positionY;
    state.host.rotation.x -= state.rotationX;
    state.host.rotation.y -= state.rotationY;
    state.host.rotation.z -= state.rotationZ;
  }
  state.host = null;
  state.positionX = 0;
  state.positionY = 0;
  state.rotationX = 0;
  state.rotationY = 0;
  state.rotationZ = 0;
  fighter.visual.root.userData.tpsPunishReadyPose = 0;
}

function applyPunishReady(fighter: FighterRuntime, state: PunishReadyState): void {
  const root = fighter.visual.root;
  const readyTicks = Number(root.userData.tpsPunishReadyTicks ?? 0);
  const eligibleState = fighter.state === "IDLE" || fighter.state === "WALK" || fighter.state === "GUARD";
  const eligible = root.userData.combatTps
    && root.userData.quaterniusModelState === "ready"
    && readyTicks > 0
    && eligibleState;
  if (!eligible) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  // Hold a compact counter-ready coil through most of the punish window, then
  // release it over the final few ticks. This changes only the imported render
  // host; the underlying reversal/perfect-step timers stay authoritative.
  const factor = smooth01(Math.min(1, readyTicks / 8));
  if (factor <= 1e-4) return;

  const sideValue = Number(root.userData.tpsPunishReadySide ?? 0);
  const side: -1 | 1 = sideValue < 0 ? -1 : 1;
  const scale = root.scale.x;

  state.host = host;
  state.positionX = side * 0.018 * scale * factor;
  state.positionY = -0.024 * scale * factor;
  state.rotationX = 0.045 * factor;
  state.rotationY = -side * 0.105 * factor;
  state.rotationZ = side * 0.048 * factor;

  host.position.x += state.positionX;
  host.position.y += state.positionY;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsPunishReadyPose = factor;
  root.userData.tpsPunishReadyHostX = state.positionX;
  root.userData.tpsPunishReadyHostY = state.positionY;
  root.userData.tpsPunishReadyRotX = state.rotationX;
  root.userData.tpsPunishReadyRotY = state.rotationY;
  root.userData.tpsPunishReadyRotZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsPunishReadyPresentation(): void {
  if (installed) return;
  installed = true;

  // Publish the existing player punish timers as presentation metadata before
  // the normal visual update. No simulation field is written or extended.
  const gamePrototype = TpsFightGame.prototype as unknown as TpsVisualPrototype;
  const baseVisualUpdate = gamePrototype.updateVisual;
  gamePrototype.updateVisual = function updateVisualWithPunishReadyMetadata(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    time: number,
  ): void {
    const game = this as unknown as TpsPunishRuntime;
    const root = fighter.visual.root;
    if (fighter === game.p1) {
      root.userData.tpsPunishReadyTicks = Math.max(game.playerReversalTicks, game.playerPerfectEvadeTicks);
      root.userData.tpsPunishReadySide = game.playerEvadeSign;
    } else {
      root.userData.tpsPunishReadyTicks = 0;
      root.userData.tpsPunishReadySide = 0;
    }
    baseVisualUpdate.call(this, fighter, opponent, time);
  };

  const baseAnimationUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsPunishReady(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removePunishReady(fighter, state);
    baseAnimationUpdate.call(this, fighter, opponent, timeSeconds);
    applyPunishReady(fighter, state);
  };
}
