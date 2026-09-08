import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type BodyBlowState = {
  host: THREE.Object3D | null;
  positionX: number;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
};

const states = new WeakMap<FighterRuntime, BodyBlowState>();
let installed = false;

function ensureState(fighter: FighterRuntime): BodyBlowState {
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

function contactSide(contact: string | undefined): -1 | 1 {
  return contact === "LEFT_FIST" || contact === "LEFT_FOOT" ? -1 : 1;
}

function removeBodyBlowAccent(fighter: FighterRuntime, state: BodyBlowState): void {
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
  fighter.visual.root.userData.tpsBodyBlowLevelChange = 0;
}

function applyBodyBlowAccent(fighter: FighterRuntime, state: BodyBlowState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const eligible = root.userData.combatTps
    && root.userData.quaterniusModelState === "ready"
    && fighter.state === "ATTACK"
    && move?.id === "bodyBlow";
  if (!eligible || !move) return;

  const activeStart = move.startup;
  const activeEnd = move.startup + Math.max(1, move.active);
  const sinkIn = THREE.MathUtils.smoothstep(
    fighter.moveTick,
    Math.max(0, activeStart - 5),
    activeStart + 1,
  );
  const sinkOut = 1 - THREE.MathUtils.smoothstep(
    fighter.moveTick,
    activeEnd + 1,
    activeEnd + 8,
  );
  const factor = THREE.MathUtils.clamp(sinkIn * sinkOut, 0, 1);
  if (factor <= 1e-4) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  // The Blender clip remains authoritative. This pass only gives the full-body
  // silhouette a modest level change so BODY BLOW reads lower than jab/straight
  // from the TPS shoulder camera without recreating the old waist-fold problem.
  const side = contactSide(move.visualContact);
  const scale = root.scale.x;
  state.host = host;
  state.positionX = -side * 0.012 * scale * factor;
  state.positionY = -0.038 * scale * factor;
  state.rotationX = 0.043 * factor;
  state.rotationY = side * 0.064 * factor;
  state.rotationZ = -side * 0.026 * factor;

  host.position.x += state.positionX;
  host.position.y += state.positionY;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsBodyBlowLevelChange = factor;
  root.userData.tpsBodyBlowSinkY = state.positionY;
  root.userData.tpsBodyBlowHostX = state.positionX;
  root.userData.tpsBodyBlowRotX = state.rotationX;
  root.userData.tpsBodyBlowRotY = state.rotationY;
  root.userData.tpsBodyBlowRotZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsBodyBlowLevelChangePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsBodyBlowLevelChange(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeBodyBlowAccent(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyBodyBlowAccent(fighter, state);
  };
}
