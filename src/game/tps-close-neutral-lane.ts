import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type CloseNeutralLaneState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationY: number;
};

const states = new WeakMap<FighterRuntime, CloseNeutralLaneState>();
let installed = false;

const CLOSE_NEUTRAL_STATES = new Set<FighterRuntime["state"]>([
  "IDLE",
  "WALK",
  "CROUCH",
  "GUARD",
]);
const CLOSE_NEUTRAL_MAX_LANE = 0.062;
const CLOSE_NEUTRAL_MAX_YAW = 0.024;

function ensureState(fighter: FighterRuntime): CloseNeutralLaneState {
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

function residueActive(fighter: FighterRuntime): boolean {
  const data = fighter.visual.root.userData;
  return Math.max(
    Number(data.tpsAttackAfterfeel ?? 0),
    Number(data.tpsDamageAfterfeel ?? 0),
    Number(data.tpsPunishReadyPose ?? 0),
  ) > 1e-4;
}

function removeCloseNeutralLane(fighter: FighterRuntime, state: CloseNeutralLaneState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.rotation.y -= state.rotationY;
  }
  state.host = null;
  state.positionX = 0;
  state.rotationY = 0;
  fighter.visual.root.userData.tpsCloseNeutralLane = 0;
}

function applyCloseNeutralLane(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: CloseNeutralLaneState,
): void {
  const root = fighter.visual.root;
  const opponentRoot = opponent.visual.root;
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || opponentRoot.userData.quaterniusModelState !== "ready"
    || !CLOSE_NEUTRAL_STATES.has(fighter.state)
    || !CLOSE_NEUTRAL_STATES.has(opponent.state)
    || fighter.currentMove
    || opponent.currentMove
    || residueActive(fighter)
    || residueActive(opponent)
  ) return;

  const dx = opponent.position.x - fighter.position.x;
  const dz = opponent.position.z - fighter.position.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance >= 1.95) return;

  // The camera-continuity path ends in close neutral locomotion rather than a
  // strike. At that range the two production meshes can occupy the same screen
  // lane even though gameplay spacing is valid. Open only the imported render
  // hosts as distance closes. Because the fighters face each other, the same
  // local-X offset moves them into opposite world-space lanes. Runtime position,
  // collision, targeting, ground rings and camera math stay authoritative.
  const proximity = 1 - THREE.MathUtils.smoothstep(distance, 1.30, 1.95);
  const factor = THREE.MathUtils.clamp(proximity, 0, 1);
  if (factor <= 1e-4) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  const scale = root.scale.x;
  state.host = host;
  // The first production pass proved the lane concept but remained too subtle
  // at the closest audited neutral spacing. Increase only the final imported
  // host separation enough to preserve two distinct shoulder/torso silhouettes;
  // gameplay roots, contact distance and floor markers remain untouched.
  state.positionX = CLOSE_NEUTRAL_MAX_LANE * scale * factor;
  state.rotationY = CLOSE_NEUTRAL_MAX_YAW * factor;
  host.position.x += state.positionX;
  host.rotation.y += state.rotationY;

  root.userData.tpsCloseNeutralLane = factor;
  root.userData.tpsCloseNeutralLaneX = state.positionX;
  root.userData.tpsCloseNeutralLaneYaw = state.rotationY;
  root.userData.tpsCloseNeutralLaneDistance = distance;
  root.updateMatrixWorld(true);
}

export function installTpsCloseNeutralLanePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsCloseNeutralLane(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeCloseNeutralLane(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyCloseNeutralLane(fighter, opponent, state);
  };
}
