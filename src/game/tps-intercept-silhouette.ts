import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";
import { TpsFightGame } from "./tps-game";

type InterceptState = {
  armed: boolean;
  host: THREE.Object3D | null;
  positionX: number;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
};

type TpsInterceptRuntime = TpsFightGame & {
  playerInterceptTicks: number;
  p1: FighterRuntime;
};

type TpsVisualPrototype = {
  updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void;
};

const states = new WeakMap<FighterRuntime, InterceptState>();
let installed = false;

function ensureState(fighter: FighterRuntime): InterceptState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    armed: false,
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

function contactSide(contact: string | undefined): -1 | 1 {
  return contact === "LEFT_FIST" || contact === "LEFT_FOOT" ? -1 : 1;
}

function removeInterceptAccent(fighter: FighterRuntime, state: InterceptState): void {
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
  fighter.visual.root.userData.tpsInterceptSilhouette = 0;
}

function applyInterceptAccent(fighter: FighterRuntime, state: InterceptState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const readyTicks = Number(root.userData.tpsInterceptPresentationTicks ?? 0);

  if (fighter.state !== "ATTACK" || !move) {
    state.armed = false;
    root.userData.tpsInterceptSilhouette = 0;
    return;
  }

  // Latch the presentation identity while the intercept move is in flight. The
  // gameplay timer is intentionally cleared by resolveAttack on contact, but the
  // authored strike still needs to read as the same action through hit-stop and
  // the first recovery beat.
  if (readyTicks > 0) state.armed = true;
  if (!state.armed) return;
  if (!root.userData.combatTps || root.userData.quaterniusModelState !== "ready") return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  const activeEnd = move.startup + Math.max(1, move.active);
  const entryTicks = Math.max(2, Math.min(5, Math.floor(move.startup * 0.55)));
  const entry = 0.48 + smooth01((fighter.moveTick + 1) / entryTicks) * 0.52;
  const releaseStart = activeEnd + 2;
  const release = fighter.moveTick <= releaseStart
    ? 1
    : 1 - smooth01((fighter.moveTick - releaseStart) / 6);
  const factor = THREE.MathUtils.clamp(entry * release, 0, 1);
  if (factor <= 1e-4) return;

  const side = contactSide(move.visualContact);
  const scale = root.scale.x;

  // BREAK LINE / BLUE SHIFT should read as a pre-emptive outside-lane cut, not
  // another square-on jab. Keep the hand-authored clip intact and stage only the
  // imported body a few centimeters off-line with a small shoulder lead.
  state.host = host;
  state.positionX = side * 0.042 * scale * factor;
  state.positionY = -0.010 * scale * factor;
  state.rotationX = -0.020 * factor;
  state.rotationY = -side * 0.092 * factor;
  state.rotationZ = side * 0.042 * factor;

  host.position.x += state.positionX;
  host.position.y += state.positionY;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsInterceptSilhouette = factor;
  root.userData.tpsInterceptSilhouetteMove = move.id;
  root.userData.tpsInterceptSilhouetteSide = side;
  root.userData.tpsInterceptSilhouetteHostX = state.positionX;
  root.userData.tpsInterceptSilhouetteHostY = state.positionY;
  root.userData.tpsInterceptSilhouetteRotX = state.rotationX;
  root.userData.tpsInterceptSilhouetteRotY = state.rotationY;
  root.userData.tpsInterceptSilhouetteRotZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsInterceptSilhouettePresentation(): void {
  if (installed) return;
  installed = true;

  // Expose the existing intercept opportunity to the render layer before the
  // normal animation update. The underlying timer is read-only here.
  const gamePrototype = TpsFightGame.prototype as unknown as TpsVisualPrototype;
  const baseVisualUpdate = gamePrototype.updateVisual;
  gamePrototype.updateVisual = function updateVisualWithInterceptMetadata(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    time: number,
  ): void {
    const game = this as unknown as TpsInterceptRuntime;
    fighter.visual.root.userData.tpsInterceptPresentationTicks = fighter === game.p1
      ? game.playerInterceptTicks
      : 0;
    baseVisualUpdate.call(this, fighter, opponent, time);
  };

  const baseAnimationUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsInterceptSilhouette(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeInterceptAccent(fighter, state);
    baseAnimationUpdate.call(this, fighter, opponent, timeSeconds);
    applyInterceptAccent(fighter, state);
  };
}
