import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type BackfistSweepState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationY: number;
};

const states = new WeakMap<FighterRuntime, BackfistSweepState>();
let installed = false;

function ensureState(fighter: FighterRuntime): BackfistSweepState {
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

function removeSweepBoost(fighter: FighterRuntime, state: BackfistSweepState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.rotation.y -= state.rotationY;
  }
  state.host = null;
  state.positionX = 0;
  state.rotationY = 0;
  fighter.visual.root.userData.tpsBackfistSweepBoost = 0;
}

function applySweepBoost(fighter: FighterRuntime, state: BackfistSweepState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const accent = Number(root.userData.tpsBackfistImportedAccent ?? 0);
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || move?.id !== "backfist"
    || !Number.isFinite(accent)
    || accent <= 1e-4
  ) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  // The Blender clip and the existing imported backfist pass already own the arm
  // path and torso twist. This pass only widens the existing lateral lane a few
  // centimeters so the sweep remains readable from the close TPS shoulder view.
  const baseSlip = Number(root.userData.tpsBackfistImportedSlip ?? 0);
  const fallbackSign = move.visualContact === "LEFT_FIST" ? 1 : -1;
  const sweepSign = Math.sign(baseSlip) || fallbackSign;
  const scale = root.scale.x;

  state.host = host;
  state.positionX = sweepSign * 0.022 * scale * accent;
  state.rotationY = sweepSign * 0.040 * accent;
  host.position.x += state.positionX;
  host.rotation.y += state.rotationY;

  root.userData.tpsBackfistSweepBoost = accent;
  root.userData.tpsBackfistSweepBoostX = state.positionX;
  root.userData.tpsBackfistSweepBoostYaw = state.rotationY;
  root.updateMatrixWorld(true);
}

export function installTpsBackfistSweepBoostPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsBackfistSweepBoost(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeSweepBoost(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applySweepBoost(fighter, state);
  };
}
