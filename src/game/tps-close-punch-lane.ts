import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import type { MoveDefinition } from "./types";
import { PresentationAnimationController } from "./presentation-animation";

type ClosePunchLaneState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationY: number;
  rotationZ: number;
};

type ClosePunchProfile = {
  lane: number;
  yaw: number;
  roll: number;
  direction: 1 | -1;
};

const states = new WeakMap<FighterRuntime, ClosePunchLaneState>();
const CLOSE_PUNCH_MOVES = new Set(["jab", "straight", "bodyBlow"]);

/** A derived punch keeps its base hand lane, while its gameplay ID is intact. */
export function tpsClosePunchFamily(
  move: Pick<MoveDefinition, "id" | "motionBase"> | null,
): string | null {
  const base = move?.motionBase ?? move?.id;
  return base && CLOSE_PUNCH_MOVES.has(base) ? base : null;
}
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

export const TPS_CLOSE_PUNCH_LANE_VERSION = "SHOULDER_CONTACT_LANE_V3";

/**
 * For a lead jab, begin opening the already-authored punch lane one tick
 * earlier, before the neutral lane's release reaches its fastest point.
 * This replaces excessive whole-body lane motion with a smoother transfer:
 * the support boots require less IK correction and the punch still peaks
 * at its normal ACTIVE contact. Longer crosses and body blows stay unchanged.
 */
export function tpsClosePunchLaneInFactor(
  family: string,
  moveTick: number,
  startup: number,
): number {
  const preparation = family === "jab" ? 5 : 4;
  return THREE.MathUtils.smoothstep(
    moveTick,
    Math.max(0, startup - preparation),
    startup + 1,
  );
}

/**
 * The closer lead jab must expose both torsos without detaching its glove from
 * the authored Blender path. A bounded contact-time shoulder opening, not a
 * camera snap or an arena-root displacement, provides the extra silhouette.
 */
export function tpsClosePunchProfile(moveId: string): ClosePunchProfile {
  if (moveId === "bodyBlow") return { lane: .044, yaw: .090, roll: .020, direction: 1 };
  // The rear-hand cross enters from the opposite screen side.
  if (moveId === "straight") return { lane: .050, yaw: .092, roll: .012, direction: -1 };
  return { lane: .050, yaw: .078, roll: .012, direction: 1 };
}

function applyClosePunchLane(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: ClosePunchLaneState,
): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const moveFamily = tpsClosePunchFamily(move);
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || opponent.visual.root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || !move
    || !moveFamily
  ) return;

  const dx = opponent.position.x - fighter.position.x;
  const dz = opponent.position.z - fighter.position.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance >= 1.92) return;

  const activeStart = move.startup;
  const activeEnd = move.startup + Math.max(1, move.active);
  const laneIn = tpsClosePunchLaneInFactor(moveFamily, fighter.moveTick, activeStart);
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
  const profile = tpsClosePunchProfile(moveFamily);
  const scale = root.scale.x;
  const screenDirection = profile.direction;

  // Keep the authored fist/elbow path authoritative. Move only the imported
  // presentation host a bounded distance across the target line and open the
  // torso slightly away from the striking side. From the shoulder camera this
  // leaves a readable strip of background between the two chests while the fist
  // still crosses that strip into contact. Runtime position, reach, hitboxes and
  // lock-on/camera targeting remain untouched.
  state.host = host;
  state.positionX = -side * screenDirection * profile.lane * scale * factor;
  state.rotationY = side * screenDirection * profile.yaw * factor;
  state.rotationZ = -side * screenDirection * profile.roll * factor;

  host.position.x += state.positionX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsClosePunchLaneVersion = TPS_CLOSE_PUNCH_LANE_VERSION;
  root.userData.tpsClosePunchLane = factor;
  root.userData.tpsClosePunchLaneMove = move.id;
  root.userData.tpsClosePunchLaneDistance = distance;
  root.userData.tpsClosePunchLaneX = state.positionX;
  root.userData.tpsClosePunchLaneYaw = state.rotationY;
  root.userData.tpsClosePunchLaneRoll = state.rotationZ;
  root.userData.tpsClosePunchLaneContactSide = side;
  root.userData.tpsClosePunchLaneDirection = screenDirection;
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
