import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type QuickstepBodyState = {
  lastX: number;
  lastZ: number;
  lastState: FighterRuntime["state"];
  startedAt: number;
  sideSign: -1 | 0 | 1;
  forwardSign: -1 | 0 | 1;
  sideWeight: number;
  appliedPositionX: number;
  appliedRotationX: number;
  appliedRotationY: number;
  appliedRotationZ: number;
};

const quickstepStates = new WeakMap<FighterRuntime, QuickstepBodyState>();
let installed = false;

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function smooth01(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function ensureState(fighter: FighterRuntime): QuickstepBodyState {
  let state = quickstepStates.get(fighter);
  if (state) return state;
  state = {
    lastX: fighter.position.x,
    lastZ: fighter.position.z,
    lastState: fighter.state,
    startedAt: 0,
    sideSign: 0,
    forwardSign: 0,
    sideWeight: 0,
    appliedPositionX: 0,
    appliedRotationX: 0,
    appliedRotationY: 0,
    appliedRotationZ: 0,
  };
  quickstepStates.set(fighter, state);
  return state;
}

function removeQuickstepTransform(fighter: FighterRuntime, state: QuickstepBodyState): void {
  const active = Math.abs(state.appliedPositionX) > 1e-7
    || Math.abs(state.appliedRotationX) > 1e-7
    || Math.abs(state.appliedRotationY) > 1e-7
    || Math.abs(state.appliedRotationZ) > 1e-7;
  if (active) {
    const host = importedRuntimeHost(fighter);
    if (host) {
      host.position.x -= state.appliedPositionX;
      host.rotation.x -= state.appliedRotationX;
      host.rotation.y -= state.appliedRotationY;
      host.rotation.z -= state.appliedRotationZ;
      fighter.visual.root.updateMatrixWorld(true);
    }
  }
  state.appliedPositionX = 0;
  state.appliedRotationX = 0;
  state.appliedRotationY = 0;
  state.appliedRotationZ = 0;
  fighter.visual.root.userData.tpsQuickstepBodyAccent = 0;
}

function classifyStepDirection(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: QuickstepBodyState,
): void {
  const delta = new THREE.Vector3(
    fighter.position.x - state.lastX,
    0,
    fighter.position.z - state.lastZ,
  );
  if (delta.lengthSq() <= 1e-8) return;

  const forward = opponent.position.clone().sub(fighter.position);
  forward.y = 0;
  if (forward.lengthSq() <= 1e-8) forward.set(fighter.facing, 0, 0);
  else forward.normalize();
  const side = new THREE.Vector3(-forward.z, 0, forward.x);
  const sideMotion = delta.dot(side);
  const forwardMotion = delta.dot(forward);
  const total = Math.abs(sideMotion) + Math.abs(forwardMotion);
  if (total <= 1e-7) return;

  state.sideWeight = THREE.MathUtils.clamp(Math.abs(sideMotion) / total, 0, 1);
  if (Math.abs(sideMotion) > 1e-4) state.sideSign = sideMotion < 0 ? -1 : 1;
  if (Math.abs(forwardMotion) > 1e-4) state.forwardSign = forwardMotion < 0 ? -1 : 1;
}

function applyQuickstepBody(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: QuickstepBodyState,
  timeSeconds: number,
): void {
  const root = fighter.visual.root;
  const stepping = root.userData.combatTps
    && root.userData.quaterniusModelState === "ready"
    && fighter.state === "SIDESTEP";
  if (!stepping) {
    root.userData.tpsQuickstepBodyAccent = 0;
    return;
  }

  classifyStepDirection(fighter, opponent, state);
  const host = importedRuntimeHost(fighter);
  if (!host) return;

  const age = Math.max(0, timeSeconds - state.startedAt);
  const driveIn = smooth01(age / 0.045);
  const driveOut = 1 - smooth01((age - 0.115) / 0.095);
  const accent = THREE.MathUtils.clamp(driveIn * driveOut, 0, 1);
  if (accent <= 1e-4) {
    root.userData.tpsQuickstepBodyAccent = 0;
    return;
  }

  const sideWeight = state.sideWeight;
  const sideSign = state.sideSign;
  const forwardWeight = 1 - sideWeight;
  const scale = root.scale.x;

  // The simulation already provides the full STEP displacement. This is only a
  // tiny rendered-body lead and lean so the close shoulder camera can read the
  // acceleration instead of seeing an upright model slide sideways.
  state.appliedPositionX = sideSign * 0.030 * scale * sideWeight * accent;
  state.appliedRotationX = (-0.018 - state.forwardSign * 0.032 * forwardWeight) * accent;
  state.appliedRotationY = sideSign * 0.050 * sideWeight * accent;
  state.appliedRotationZ = -sideSign * 0.110 * sideWeight * accent;

  host.position.x += state.appliedPositionX;
  host.rotation.x += state.appliedRotationX;
  host.rotation.y += state.appliedRotationY;
  host.rotation.z += state.appliedRotationZ;

  root.userData.tpsQuickstepBodyAccent = accent;
  root.userData.tpsQuickstepBodySide = sideSign;
  root.userData.tpsQuickstepBodySideWeight = sideWeight;
  root.userData.tpsQuickstepBodyShift = state.appliedPositionX;
  root.userData.tpsQuickstepBodyLean = state.appliedRotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsQuickstepBodyPresentation(): void {
  if (installed) return;
  installed = true;
  const baseUpdate = PresentationAnimationController.prototype.update;

  PresentationAnimationController.prototype.update = function updateWithTpsQuickstepBody(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeQuickstepTransform(fighter, state);

    const enteringStep = state.lastState !== "SIDESTEP" && fighter.state === "SIDESTEP";
    if (enteringStep) {
      state.startedAt = timeSeconds;
      state.sideSign = 0;
      state.forwardSign = 0;
      state.sideWeight = 0;
    }

    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyQuickstepBody(fighter, opponent, state, timeSeconds);

    state.lastX = fighter.position.x;
    state.lastZ = fighter.position.z;
    state.lastState = fighter.state;
  };
}
