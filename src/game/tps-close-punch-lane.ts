import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type ClosePunchLaneState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationY: number;
  rotationZ: number;
};

const states = new WeakMap<FighterRuntime, ClosePunchLaneState>();
const CLOSE_PUNCH_MOVES = new Set(["jab", "straight", "bodyBlow"]);
let installed = false;

function ensureState(fighter: FighterRuntime): ClosePunchLaneState {
  let state = states.get(fighter);
  if (state) return state;
  state = { host: null, positionX: 0, rotationY: 0, rotationZ: 0 };
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

function removeClosePunchLane(fighter: FighterRuntime, state: ClosePunchLaneState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.rotation.y -= state.rotationY;
    state.host.rotation.z -= state.rotationZ;
  }
  state.host = null;
  state.positionX = 0;
  state.rotationY = 0;
  state.rotationZ = 0;
  fighter.visual.root.userData.tpsClosePunchLane = 0;
}

function moveProfile(moveId: string): { lane: number; yaw: number; roll: number } {
  if (moveId === "bodyBlow") return { lane: 0.044, yaw: 0.090, roll: 0.020 };
  if (moveId === "straight") return { lane: 0.038, yaw: 0.076, roll: 0.012 };
  return { lane: 0.032, yaw: 0.062, roll: 0.010 };
}

function applyClosePunchLane(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: ClosePunchLaneState,
): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || opponent.visual.root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || !move
    || !CLOSE_PUNCH_MOVES.has(move.id)
  ) return;

  const dx = opponent.position.x - fighter.position.x;
  const dz = opponent.position.z - fighter.position.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance >= 1.92) return;

  const activeStart = move.startup;
  const activeEnd = move.startup + Math.max(1, move.active);
  const laneIn = THREE.MathUtils.smoothstep(
    fighter.moveTick,
    Math.max(0, activeStart - 4),
    activeStart + 1,
  );
  const laneOut = 1 - THREE.MathUtils.smoothstep(
    fighter.moveTick,
    activeEnd + 1,
    activeEnd + 7,
  );
  const proximity = 1 - THREE.MathUtils.smoothstep(distance, 1.28, 1.92);
  const factor = THREE.MathUtils.clamp(laneIn * laneOut * proximity, 0, 1);
  if (factor <= 1e-4) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  const side = contactSide(move.visualContact);
  const profile = moveProfile(move.id);
  const scale = root.scale.x;

  // Keep the authored fist/elbow path authoritative. Move only the imported
  // presentation host a few centimetres across the target line and open the
  // torso slightly away from the striking side. From the shoulder camera this
  // leaves a readable strip of background between the two chests while the fist
  // still crosses that strip into contact. Runtime position, reach, hitboxes and
  // lock-on/camera targeting remain untouched.
  state.host = host;
  state.positionX = -side * profile.lane * scale * factor;
  state.rotationY = side * profile.yaw * factor;
  state.rotationZ = -side * profile.roll * factor;

  host.position.x += state.positionX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsClosePunchLane = factor;
  root.userData.tpsClosePunchLaneMove = move.id;
  root.userData.tpsClosePunchLaneDistance = distance;
  root.userData.tpsClosePunchLaneX = state.positionX;
  root.userData.tpsClosePunchLaneYaw = state.rotationY;
  root.userData.tpsClosePunchLaneRoll = state.rotationZ;
  root.userData.tpsClosePunchLaneContactSide = side;
  root.updateMatrixWorld(true);
}

export function installTpsClosePunchLanePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsClosePunchLane(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeClosePunchLane(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyClosePunchLane(fighter, opponent, state);
  };
}
