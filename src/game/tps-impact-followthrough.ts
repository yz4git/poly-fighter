import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type ImpactFollowthroughState = {
  host: THREE.Object3D | null;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
};

const states = new WeakMap<FighterRuntime, ImpactFollowthroughState>();
let installed = false;

function ensureState(fighter: FighterRuntime): ImpactFollowthroughState {
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

function removeImpactFollowthrough(fighter: FighterRuntime, state: ImpactFollowthroughState): void {
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
  fighter.visual.root.userData.tpsImpactFollowthrough = 0;
}

function reactionScale(kind: FighterRuntime["reactionKind"]): number {
  if (kind === "COUNTER") return 1.18;
  if (kind === "HEAVY") return 1.08;
  if (kind === "MID") return 0.92;
  return 0.74;
}

function applyImpactFollowthrough(fighter: FighterRuntime, state: ImpactFollowthroughState): void {
  const root = fighter.visual.root;
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "HIT"
  ) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  // Hitstop owns the clearest impact frame. As hitstun proceeds, ease this
  // production-model recoil out so the defender visibly yields to the strike
  // before the existing damage-afterfeel tail takes over. This is render-only:
  // FighterRuntime position, velocity, stun and hitboxes remain untouched.
  const release = fighter.hitStop > 0
    ? 1
    : THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(fighter.hitStun / 12, 0, 1), 0, 1);
  const tier = reactionScale(fighter.reactionKind);
  const factor = THREE.MathUtils.clamp(release * tier, 0, 1.25);
  if (factor <= 1e-4) return;

  const side = fighter.reactionSide === "LEFT" ? -1 : 1;
  const scale = root.scale.x;

  // Keep the feet close to their authored placement and let the root pivot sell
  // a short chest/hip recoil. The tiny vertical compression helps the knees read
  // as absorbing force without sinking the character into the floor.
  state.host = host;
  state.positionY = -0.006 * scale * factor;
  state.rotationX = 0.052 * factor;
  state.rotationY = side * 0.070 * factor;
  state.rotationZ = side * 0.043 * factor;

  host.position.y += state.positionY;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsImpactFollowthrough = factor;
  root.userData.tpsImpactFollowthroughY = state.positionY;
  root.userData.tpsImpactFollowthroughRotX = state.rotationX;
  root.userData.tpsImpactFollowthroughRotY = state.rotationY;
  root.userData.tpsImpactFollowthroughRotZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsImpactFollowthroughPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsImpactFollowthrough(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeImpactFollowthrough(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyImpactFollowthrough(fighter, state);
  };
}
