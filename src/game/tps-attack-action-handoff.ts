import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type AttackActionTarget = "GUARD" | "SIDESTEP";

type AttackActionHandoffState = {
  host: THREE.Object3D | null;
  appliedPositionX: number;
  appliedRotationX: number;
  appliedRotationY: number;
  appliedRotationZ: number;
  sourcePositionX: number;
  sourceRotationX: number;
  sourceRotationY: number;
  sourceRotationZ: number;
  sourceFactor: number;
  sourceMove: string;
  target: AttackActionTarget | null;
  seconds: number;
  duration: number;
  initialEnvelope: number;
  lastTimeSeconds: number;
  lastRenderedState: FighterRuntime["state"];
};

const states = new WeakMap<FighterRuntime, AttackActionHandoffState>();
const ATTACK_AFTERFEEL_SOURCE_STATES = new Set<FighterRuntime["state"]>(["IDLE", "WALK", "CROUCH"]);
let installed = false;

function ensureState(fighter: FighterRuntime): AttackActionHandoffState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    appliedPositionX: 0,
    appliedRotationX: 0,
    appliedRotationY: 0,
    appliedRotationZ: 0,
    sourcePositionX: 0,
    sourceRotationX: 0,
    sourceRotationY: 0,
    sourceRotationZ: 0,
    sourceFactor: 0,
    sourceMove: "",
    target: null,
    seconds: 0,
    duration: 0,
    initialEnvelope: 0,
    lastTimeSeconds: 0,
    lastRenderedState: fighter.state,
  };
  states.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function targetForState(state: FighterRuntime["state"]): AttackActionTarget | null {
  if (state === "GUARD") return "GUARD";
  if (state === "SIDESTEP") return "SIDESTEP";
  return null;
}

function removeAppliedHandoff(fighter: FighterRuntime, state: AttackActionHandoffState): void {
  if (state.host) {
    state.host.position.x -= state.appliedPositionX;
    state.host.rotation.x -= state.appliedRotationX;
    state.host.rotation.y -= state.appliedRotationY;
    state.host.rotation.z -= state.appliedRotationZ;
  }
  state.host = null;
  state.appliedPositionX = 0;
  state.appliedRotationX = 0;
  state.appliedRotationY = 0;
  state.appliedRotationZ = 0;
  fighter.visual.root.userData.tpsAttackActionHandoff = 0;
}

function clearBridge(state: AttackActionHandoffState): void {
  state.sourcePositionX = 0;
  state.sourceRotationX = 0;
  state.sourceRotationY = 0;
  state.sourceRotationZ = 0;
  state.sourceFactor = 0;
  state.sourceMove = "";
  state.target = null;
  state.seconds = 0;
  state.duration = 0;
  state.initialEnvelope = 0;
}

function startFromPreviousAttackAfterfeel(
  fighter: FighterRuntime,
  state: AttackActionHandoffState,
  data: Record<string, unknown>,
): void {
  const target = targetForState(fighter.state);
  if (!target || !ATTACK_AFTERFEEL_SOURCE_STATES.has(state.lastRenderedState)) return;

  const sourceFactor = Number(data.tpsAttackAfterfeel ?? 0);
  const sourceMove = String(data.tpsAttackAfterfeelMove ?? "");
  const sourcePositionX = Number(data.tpsAttackAfterfeelPositionX ?? 0);
  const sourceRotationX = Number(data.tpsAttackAfterfeelRotationX ?? 0);
  const sourceRotationY = Number(data.tpsAttackAfterfeelRotationY ?? 0);
  const sourceRotationZ = Number(data.tpsAttackAfterfeelRotationZ ?? 0);
  const finite = [
    sourceFactor,
    sourcePositionX,
    sourceRotationX,
    sourceRotationY,
    sourceRotationZ,
  ].every(Number.isFinite);
  const magnitude = Math.abs(sourcePositionX)
    + Math.abs(sourceRotationX)
    + Math.abs(sourceRotationY)
    + Math.abs(sourceRotationZ);
  if (!finite || sourceFactor <= 1e-4 || !sourceMove || magnitude <= 1e-6) return;

  state.sourceFactor = sourceFactor;
  state.sourceMove = sourceMove;
  state.sourcePositionX = sourcePositionX;
  state.sourceRotationX = sourceRotationX;
  state.sourceRotationY = sourceRotationY;
  state.sourceRotationZ = sourceRotationZ;
  state.target = target;
  state.duration = target === "GUARD" ? 0.090 : 0.075;
  state.seconds = state.duration;
  // Guard can keep slightly more of the finishing torso coil. Sidestep gives
  // locomotion ownership sooner so the feet and evade silhouette stay crisp.
  state.initialEnvelope = target === "GUARD" ? 0.86 : 0.72;
}

function applyAttackActionHandoff(
  fighter: FighterRuntime,
  state: AttackActionHandoffState,
  timeSeconds: number,
): void {
  const root = fighter.visual.root;
  const deltaSeconds = state.lastTimeSeconds > 0
    ? THREE.MathUtils.clamp(timeSeconds - state.lastTimeSeconds, 0, 1 / 15)
    : 0;
  state.lastTimeSeconds = timeSeconds;

  const liveTarget = targetForState(fighter.state);
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || !liveTarget
    || liveTarget !== state.target
    || state.seconds <= 0
    || state.duration <= 0
    || state.initialEnvelope <= 0
  ) {
    const lastTarget = state.target;
    clearBridge(state);
    root.userData.tpsAttackActionHandoff = 0;
    root.userData.tpsAttackActionHandoffSeconds = 0;
    root.userData.tpsAttackActionHandoffTarget = lastTarget;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  state.seconds = Math.max(0, state.seconds - deltaSeconds);
  const remaining = THREE.MathUtils.clamp(state.seconds / state.duration, 0, 1);
  const timeRelease = THREE.MathUtils.smoothstep(remaining, 0, 1);
  const envelope = state.initialEnvelope * timeRelease;
  if (envelope <= 1e-4) {
    const lastTarget = state.target;
    clearBridge(state);
    root.userData.tpsAttackActionHandoff = 0;
    root.userData.tpsAttackActionHandoffSeconds = 0;
    root.userData.tpsAttackActionHandoffTarget = lastTarget;
    return;
  }

  state.host = host;
  state.appliedPositionX = state.sourcePositionX * envelope;
  state.appliedRotationX = state.sourceRotationX * envelope;
  state.appliedRotationY = state.sourceRotationY * envelope;
  state.appliedRotationZ = state.sourceRotationZ * envelope;
  host.position.x += state.appliedPositionX;
  host.rotation.x += state.appliedRotationX;
  host.rotation.y += state.appliedRotationY;
  host.rotation.z += state.appliedRotationZ;

  root.userData.tpsAttackActionHandoff = state.sourceFactor * envelope;
  root.userData.tpsAttackActionHandoffEnvelope = envelope;
  root.userData.tpsAttackActionHandoffSeconds = state.seconds;
  root.userData.tpsAttackActionHandoffDuration = state.duration;
  root.userData.tpsAttackActionHandoffSourceFactor = state.sourceFactor;
  root.userData.tpsAttackActionHandoffSourceMove = state.sourceMove;
  root.userData.tpsAttackActionHandoffTarget = state.target;
  root.userData.tpsAttackActionHandoffPositionX = state.appliedPositionX;
  root.userData.tpsAttackActionHandoffRotationX = state.appliedRotationX;
  root.userData.tpsAttackActionHandoffRotationY = state.appliedRotationY;
  root.userData.tpsAttackActionHandoffRotationZ = state.appliedRotationZ;
  root.updateMatrixWorld(true);
}

export function installTpsAttackActionHandoffPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsAttackActionHandoff(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeAppliedHandoff(fighter, state);

    // motion-reaction clears attack-afterfeel when GUARD/SIDESTEP takes over.
    // Read the exact residual that was visible on the previous rendered frame
    // before the inner presentation stack clears it, then carry only that host
    // delta into the new action for a few frames.
    const previousData = fighter.visual.root.userData as Record<string, unknown>;
    startFromPreviousAttackAfterfeel(fighter, state, previousData);

    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyAttackActionHandoff(fighter, state, timeSeconds);
    state.lastRenderedState = fighter.state;
  };
}
