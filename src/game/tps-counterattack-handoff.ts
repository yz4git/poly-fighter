import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type CounterattackHandoffState = {
  host: THREE.Object3D | null;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  bridgeSeconds: number;
  bridgeDuration: number;
  initialFactor: number;
  lastTimeSeconds: number;
  lastRenderedState: FighterRuntime["state"];
};

const states = new WeakMap<FighterRuntime, CounterattackHandoffState>();
let installed = false;

function ensureState(fighter: FighterRuntime): CounterattackHandoffState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    positionY: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    bridgeSeconds: 0,
    bridgeDuration: 0,
    initialFactor: 0,
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

function removeCounterattackHandoff(fighter: FighterRuntime, state: CounterattackHandoffState): void {
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
  fighter.visual.root.userData.tpsCounterattackHandoff = 0;
}

function bridgeDuration(fighter: FighterRuntime): number {
  if (fighter.reactionKind === "COUNTER") return 0.10;
  if (fighter.reactionKind === "HEAVY") return 0.085;
  if (fighter.reactionKind === "MID") return 0.070;
  return 0.055;
}

function attackReleaseTick(fighter: FighterRuntime): number {
  const move = fighter.currentMove;
  if (!move) return 1;
  // The bridge must be gone well before active frames. Fast attacks therefore
  // release in only a couple of rendered frames, while slow/heavy startups can
  // keep a trace of the outgoing recoil slightly longer without blurring impact.
  return Math.max(2, Math.min(move.startup - 1, move.startup * 0.62));
}

function startBridgeFromPreviousRecovery(
  fighter: FighterRuntime,
  state: CounterattackHandoffState,
  previousRecoverySeconds: number,
  previousRecoveryFactor: number,
): void {
  if (
    fighter.state !== "ATTACK"
    || state.lastRenderedState === "ATTACK"
    || !fighter.currentMove
    || previousRecoverySeconds <= 0
    || previousRecoveryFactor <= 1e-4
  ) return;

  state.bridgeDuration = bridgeDuration(fighter);
  state.bridgeSeconds = state.bridgeDuration;
  // The previous recovery factor is already tiered. Preserve only a portion of
  // it during attack startup so the authored strike immediately becomes the
  // dominant pose while still inheriting the direction of the outgoing recoil.
  state.initialFactor = THREE.MathUtils.clamp(previousRecoveryFactor * 0.82, 0, 0.24);
}

function applyCounterattackHandoff(
  fighter: FighterRuntime,
  state: CounterattackHandoffState,
  timeSeconds: number,
): void {
  const root = fighter.visual.root;
  const deltaSeconds = state.lastTimeSeconds > 0
    ? THREE.MathUtils.clamp(timeSeconds - state.lastTimeSeconds, 0, 1 / 15)
    : 0;
  state.lastTimeSeconds = timeSeconds;

  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || !fighter.currentMove
    || state.bridgeSeconds <= 0
    || state.bridgeDuration <= 0
    || state.initialFactor <= 0
  ) {
    state.bridgeSeconds = 0;
    state.bridgeDuration = 0;
    state.initialFactor = 0;
    root.userData.tpsCounterattackHandoff = 0;
    root.userData.tpsCounterattackHandoffSeconds = 0;
    root.userData.tpsCounterattackHandoffMove = null;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  state.bridgeSeconds = Math.max(0, state.bridgeSeconds - deltaSeconds);
  const remaining = THREE.MathUtils.clamp(state.bridgeSeconds / state.bridgeDuration, 0, 1);
  const timeRelease = THREE.MathUtils.smoothstep(remaining, 0, 1);
  const startupRelease = 1 - THREE.MathUtils.smoothstep(
    fighter.moveTick,
    0,
    attackReleaseTick(fighter),
  );
  const factor = state.initialFactor * timeRelease * startupRelease;

  if (factor <= 1e-4) {
    state.bridgeSeconds = 0;
    state.initialFactor = 0;
    root.userData.tpsCounterattackHandoff = 0;
    root.userData.tpsCounterattackHandoffSeconds = 0;
    root.userData.tpsCounterattackHandoffMove = fighter.currentMove.id;
    return;
  }

  const side = fighter.reactionSide === "LEFT" ? -1 : 1;
  const scale = root.scale.x;
  state.host = host;
  state.positionY = -0.0045 * scale * factor;
  state.rotationX = 0.045 * factor;
  state.rotationY = side * 0.060 * factor;
  state.rotationZ = side * 0.036 * factor;

  // Additive host-space offsets preserve every authored shoulder, elbow, knee
  // and ankle keyframe. No gameplay root, velocity, hitbox, reach, startup or
  // input timing is changed.
  host.position.y += state.positionY;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsCounterattackHandoff = factor;
  root.userData.tpsCounterattackHandoffSeconds = state.bridgeSeconds;
  root.userData.tpsCounterattackHandoffMove = fighter.currentMove.id;
  root.userData.tpsCounterattackHandoffReaction = fighter.reactionKind;
  root.userData.tpsCounterattackHandoffReleaseTick = attackReleaseTick(fighter);
  root.updateMatrixWorld(true);
}

export function installTpsCounterattackHandoffPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsCounterattackHandoff(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeCounterattackHandoff(fighter, state);

    // Capture the outgoing recovery markers before the existing followthrough
    // layer sees ATTACK and clears them. This is the exact visual state the
    // player saw on the previous rendered frame.
    const data = fighter.visual.root.userData;
    const previousRecoverySeconds = Number(data.tpsImpactRecoverySeconds ?? 0);
    const previousRecoveryFactor = Math.max(
      Number(data.tpsImpactRecoveryFactor ?? 0),
      Number(data.tpsImpactFollowthrough ?? 0),
    );
    startBridgeFromPreviousRecovery(
      fighter,
      state,
      previousRecoverySeconds,
      previousRecoveryFactor,
    );

    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyCounterattackHandoff(fighter, state, timeSeconds);
    state.lastRenderedState = fighter.state;
  };
}
