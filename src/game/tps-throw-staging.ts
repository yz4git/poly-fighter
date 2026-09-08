import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type ThrowStagingState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
};

const states = new WeakMap<FighterRuntime, ThrowStagingState>();
let installed = false;

function ensureState(fighter: FighterRuntime): ThrowStagingState {
  let state = states.get(fighter);
  if (state) return state;
  state = { host: null, positionX: 0, rotationX: 0, rotationY: 0, rotationZ: 0 };
  states.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function removeThrowStaging(fighter: FighterRuntime, state: ThrowStagingState): void {
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
  fighter.visual.root.userData.tpsThrowStaging = 0;
}

function throwGrabFactor(attacker: FighterRuntime): number {
  const move = attacker.currentMove;
  if (attacker.state !== "ATTACK" || move?.id !== "throw") return 0;
  const activeStart = move.startup;
  const activeEnd = move.startup + move.active;
  const inFactor = THREE.MathUtils.smoothstep(attacker.moveTick, Math.max(0, activeStart - 3), activeStart + 1);
  const outFactor = 1 - THREE.MathUtils.smoothstep(attacker.moveTick, activeEnd + 1, activeEnd + 9);
  return THREE.MathUtils.clamp(inFactor * outFactor, 0, 1);
}

function applyThrowStaging(fighter: FighterRuntime, opponent: FighterRuntime, state: ThrowStagingState): void {
  const root = fighter.visual.root;
  if (!root.userData.combatTps || root.userData.quaterniusModelState !== "ready") return;

  const ownGrab = throwGrabFactor(fighter);
  const opponentGrab = throwGrabFactor(opponent);
  const pairedVictim = opponentGrab > 0
    && opponent.currentMove?.id === "throw"
    && opponent.hitTargets.has(fighter.id);
  if (ownGrab <= 1e-4 && !pairedVictim) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const scale = root.scale.x;
  state.host = host;

  if (ownGrab > 1e-4) {
    // CM_Throw already owns the hands and elbows. Move only the imported body
    // around that authored grip: a short lateral stage plus opposing torso turn
    // creates a visible chest lane without re-solving the throw animation.
    state.positionX = -0.040 * scale * ownGrab;
    state.rotationX = -0.018 * ownGrab;
    state.rotationY = 0.095 * ownGrab;
    state.rotationZ = -0.026 * ownGrab;
    root.userData.tpsThrowStagingRole = "ATTACKER";
    root.userData.tpsThrowStaging = ownGrab;
  } else {
    // Both fighters face opposite directions, so the same local-X sign moves the
    // victim to the opposite world-side. Apply only after the throw has actually
    // connected; no pre-emptive gameplay or telegraph displacement is introduced.
    const victimFactor = opponentGrab * 0.82;
    state.positionX = -0.030 * scale * victimFactor;
    state.rotationX = 0.028 * victimFactor;
    state.rotationY = -0.060 * victimFactor;
    state.rotationZ = 0.020 * victimFactor;
    root.userData.tpsThrowStagingRole = "DEFENDER";
    root.userData.tpsThrowStaging = victimFactor;
  }

  host.position.x += state.positionX;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;
  root.userData.tpsThrowStagingPositionX = state.positionX;
  root.userData.tpsThrowStagingRotationX = state.rotationX;
  root.userData.tpsThrowStagingRotationY = state.rotationY;
  root.userData.tpsThrowStagingRotationZ = state.rotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsThrowStagingPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsThrowStaging(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeThrowStaging(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyThrowStaging(fighter, opponent, state);
  };
}
