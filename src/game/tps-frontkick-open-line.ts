import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type FrontKickLineState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
};

const states = new WeakMap<FighterRuntime, FrontKickLineState>();
let installed = false;

function ensureState(fighter: FighterRuntime): FrontKickLineState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    positionX: 0,
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
  return contact === "LEFT_FOOT" ? -1 : 1;
}

function removeFrontKickLine(fighter: FighterRuntime, state: FrontKickLineState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.rotation.x -= state.rotationX;
    state.host.rotation.y -= state.rotationY;
    state.host.rotation.z -= state.rotationZ;
  }
  state.host = null;
  state.positionX = 0;
  state.rotationX = 0;
  state.rotationY = 0;
  state.rotationZ = 0;
  fighter.visual.root.userData.tpsFrontKickOpenLine = 0;
}

function applyFrontKickLine(fighter: FighterRuntime, state: FrontKickLineState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const eligible = root.userData.combatTps
    && root.userData.quaterniusModelState === "ready"
    && fighter.state === "ATTACK"
    && move?.id === "kick";
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

  // The Blender front-kick clip already has a clean knee/ankle chain in Model
  // View. In close TPS combat the striking shin disappears behind the opponent,
  // so open only the rendered body angle a few degrees around active frames.
  // The authored leg pose, ankle orientation, reach and hitbox stay untouched.
  const side = contactSide(move.visualContact);
  const scale = root.scale.x;
  state.host = host;
  state.positionX = -side * 0.020 * scale * factor;
  state.rotationX = -0.014 * factor;
  state.rotationY = -side * 0.065 * factor;
  state.rotationZ = side * 0.018 * factor;

  host.position.x += state.positionX;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsFrontKickOpenLine = factor;
  root.userData.tpsFrontKickOpenLineX = state.positionX;
  root.userData.tpsFrontKickOpenLineRotX = state.rotationX;
  root.userData.tpsFrontKickOpenLineRotY = state.rotationY;
  root.userData.tpsFrontKickOpenLineRotZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsFrontKickOpenLinePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsFrontKickOpenLine(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeFrontKickLine(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyFrontKickLine(fighter, state);
  };
}
