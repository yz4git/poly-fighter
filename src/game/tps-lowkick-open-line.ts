import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type LowKickLineState = {
  host: THREE.Object3D | null;
  positionX: number;
  positionY: number;
  rotationY: number;
  rotationZ: number;
};

const states = new WeakMap<FighterRuntime, LowKickLineState>();
let installed = false;

function ensureState(fighter: FighterRuntime): LowKickLineState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    positionX: 0,
    positionY: 0,
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
  return contact === "LEFT_FOOT" ? -1 : 1;
}

function removeLowKickLine(fighter: FighterRuntime, state: LowKickLineState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.position.y -= state.positionY;
    state.host.rotation.y -= state.rotationY;
    state.host.rotation.z -= state.rotationZ;
  }
  state.host = null;
  state.positionX = 0;
  state.positionY = 0;
  state.rotationY = 0;
  state.rotationZ = 0;
  fighter.visual.root.userData.tpsLowKickOpenLine = 0;
}

function applyLowKickLine(fighter: FighterRuntime, state: LowKickLineState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const eligible = root.userData.combatTps
    && root.userData.quaterniusModelState === "ready"
    && fighter.state === "ATTACK"
    && move?.id === "lowKick";
  if (!eligible || !move) return;

  const activeStart = move.startup;
  const activeEnd = move.startup + Math.max(1, move.active);
  const openIn = THREE.MathUtils.smoothstep(
    fighter.moveTick,
    Math.max(0, activeStart - 4),
    activeStart + 1,
  );
  const openOut = 1 - THREE.MathUtils.smoothstep(
    fighter.moveTick,
    activeEnd + 1,
    activeEnd + 7,
  );
  const factor = THREE.MathUtils.clamp(openIn * openOut, 0, 1);
  if (factor <= 1e-4) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  // The Blender low-kick clip already has a clean sweeping leg in Model View.
  // Close TPS combat hides that line behind the opponent, so open only the final
  // rendered body angle and sink the hips a few millimeters around contact.
  // The authored leg chain, ankle pose, reach and gameplay hitbox stay untouched.
  const side = contactSide(move.visualContact);
  const scale = root.scale.x;
  state.host = host;
  state.positionX = -side * 0.026 * scale * factor;
  state.positionY = -0.008 * scale * factor;
  state.rotationY = -side * 0.085 * factor;
  state.rotationZ = side * 0.028 * factor;

  host.position.x += state.positionX;
  host.position.y += state.positionY;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsLowKickOpenLine = factor;
  root.userData.tpsLowKickOpenLineX = state.positionX;
  root.userData.tpsLowKickOpenLineY = state.positionY;
  root.userData.tpsLowKickOpenLineRotY = state.rotationY;
  root.userData.tpsLowKickOpenLineRotZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsLowKickOpenLinePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsLowKickOpenLine(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeLowKickLine(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyLowKickLine(fighter, state);
  };
}
