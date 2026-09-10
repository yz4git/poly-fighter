import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type CounterattackHandoffSource = "HIT" | "BLOCK" | "PUNISH";

type CounterattackHandoffState = {
  host: THREE.Object3D | null;
  positionX: number;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  sourcePositionX: number;
  sourcePositionY: number;
  sourceRotationX: number;
  sourceRotationY: number;
  sourceRotationZ: number;
  bridgeSeconds: number;
  bridgeDuration: number;
  initialFactor: number;
  sourcePose: number;
  source: CounterattackHandoffSource | null;
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
    positionX: 0,
    positionY: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sourcePositionX: 0,
    sourcePositionY: 0,
    sourceRotationX: 0,
    sourceRotationY: 0,
    sourceRotationZ: 0,
    bridgeSeconds: 0,
    bridgeDuration: 0,
    initialFactor: 0,
    sourcePose: 0,
    source: null,
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
  fighter.visual.root.userData.tpsCounterattackHandoff = 0;
}

function hitBridgeDuration(fighter: FighterRuntime): number {
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
  // keep a trace of the outgoing pose slightly longer without blurring impact.
  return Math.max(2, Math.min(move.startup - 1, move.startup * 0.62));
}

function clearBridgeState(state: CounterattackHandoffState): void {
  state.bridgeSeconds = 0;
  state.bridgeDuration = 0;
  state.initialFactor = 0;
  state.sourcePose = 0;
  state.source = null;
  state.sourcePositionX = 0;
  state.sourcePositionY = 0;
  state.sourceRotationX = 0;
  state.sourceRotationY = 0;
  state.sourceRotationZ = 0;
}

function canStartBridge(fighter: FighterRuntime, state: CounterattackHandoffState): boolean {
  return fighter.state === "ATTACK"
    && state.lastRenderedState !== "ATTACK"
    && Boolean(fighter.currentMove);
}

function startHitBridge(
  fighter: FighterRuntime,
  state: CounterattackHandoffState,
  previousRecoverySeconds: number,
  previousRecoveryFactor: number,
): boolean {
  if (
    !canStartBridge(fighter, state)
    || previousRecoverySeconds <= 0
    || previousRecoveryFactor <= 1e-4
  ) return false;

  state.bridgeDuration = hitBridgeDuration(fighter);
  state.bridgeSeconds = state.bridgeDuration;
  // The previous recovery factor is already tiered. Preserve only a portion of
  // it during attack startup so the authored strike immediately becomes the
  // dominant pose while still inheriting the direction of the outgoing recoil.
  state.initialFactor = THREE.MathUtils.clamp(previousRecoveryFactor * 0.82, 0, 0.24);
  state.sourcePose = previousRecoveryFactor;
  state.source = "HIT";
  return true;
}

function startStoredPoseBridge(
  fighter: FighterRuntime,
  state: CounterattackHandoffState,
  source: Exclude<CounterattackHandoffSource, "HIT">,
  sourcePose: number,
  sourcePositionX: number,
  sourcePositionY: number,
  sourceRotationX: number,
  sourceRotationY: number,
  sourceRotationZ: number,
): boolean {
  if (!canStartBridge(fighter, state) || sourcePose <= 1e-4) return false;

  const magnitude = Math.abs(sourcePositionX)
    + Math.abs(sourcePositionY)
    + Math.abs(sourceRotationX)
    + Math.abs(sourceRotationY)
    + Math.abs(sourceRotationZ);
  if (magnitude <= 1e-6) return false;

  state.bridgeDuration = source === "BLOCK" ? 0.072 : 0.082;
  state.bridgeSeconds = state.bridgeDuration;
  // These source offsets are the exact host-space deltas shown on the previous
  // rendered frame. Keep most of that silhouette on frame one, then yield to the
  // authored attack before its active window.
  state.initialFactor = source === "BLOCK" ? 0.76 : 0.72;
  state.sourcePose = sourcePose;
  state.source = source;
  state.sourcePositionX = sourcePositionX;
  state.sourcePositionY = sourcePositionY;
  state.sourceRotationX = sourceRotationX;
  state.sourceRotationY = sourceRotationY;
  state.sourceRotationZ = sourceRotationZ;
  return true;
}

function startBridgeFromPreviousFrame(
  fighter: FighterRuntime,
  state: CounterattackHandoffState,
  data: Record<string, unknown>,
): void {
  if (!canStartBridge(fighter, state)) return;

  const previousRecoverySeconds = Number(data.tpsImpactRecoverySeconds ?? 0);
  const previousRecoveryFactor = Math.max(
    Number(data.tpsImpactRecoveryFactor ?? 0),
    Number(data.tpsImpactFollowthrough ?? 0),
  );
  if (startHitBridge(fighter, state, previousRecoverySeconds, previousRecoveryFactor)) return;

  if (state.lastRenderedState === "BLOCK_STUN") {
    const role = data.tpsGuardClashRole;
    if (role === "DEFENDER") {
      const started = startStoredPoseBridge(
        fighter,
        state,
        "BLOCK",
        Number(data.tpsGuardClashPose ?? 0),
        Number(data.tpsGuardClashHostX ?? 0),
        0,
        Number(data.tpsGuardClashHostRotX ?? 0),
        Number(data.tpsGuardClashHostRotY ?? 0),
        Number(data.tpsGuardClashHostRotZ ?? 0),
      );
      if (started) return;
    }
  }

  // Reversal/perfect-evade punish windows already author a compact counter-ready
  // coil. If the player attacks directly from that pose, carry the exact host
  // delta into startup rather than snapping through neutral for one frame.
  startStoredPoseBridge(
    fighter,
    state,
    "PUNISH",
    Number(data.tpsPunishReadyPose ?? 0),
    Number(data.tpsPunishReadyHostX ?? 0),
    Number(data.tpsPunishReadyHostY ?? 0),
    Number(data.tpsPunishReadyRotX ?? 0),
    Number(data.tpsPunishReadyRotY ?? 0),
    Number(data.tpsPunishReadyRotZ ?? 0),
  );
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
    || !state.source
  ) {
    clearBridgeState(state);
    root.userData.tpsCounterattackHandoff = 0;
    root.userData.tpsCounterattackHandoffSeconds = 0;
    root.userData.tpsCounterattackHandoffMove = null;
    root.userData.tpsCounterattackHandoffSource = null;
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
  const envelope = state.initialFactor * timeRelease * startupRelease;
  const factor = state.source === "HIT"
    ? envelope
    : state.sourcePose * envelope;

  if (factor <= 1e-4 || envelope <= 1e-4) {
    const source = state.source;
    clearBridgeState(state);
    root.userData.tpsCounterattackHandoff = 0;
    root.userData.tpsCounterattackHandoffSeconds = 0;
    root.userData.tpsCounterattackHandoffMove = fighter.currentMove.id;
    root.userData.tpsCounterattackHandoffSource = source;
    return;
  }

  state.host = host;
  if (state.source === "HIT") {
    const side = fighter.reactionSide === "LEFT" ? -1 : 1;
    const scale = root.scale.x;
    state.positionY = -0.0045 * scale * factor;
    state.rotationX = 0.045 * factor;
    state.rotationY = side * 0.060 * factor;
    state.rotationZ = side * 0.036 * factor;
  } else {
    state.positionX = state.sourcePositionX * envelope;
    state.positionY = state.sourcePositionY * envelope;
    state.rotationX = state.sourceRotationX * envelope;
    state.rotationY = state.sourceRotationY * envelope;
    state.rotationZ = state.sourceRotationZ * envelope;
  }

  // Additive host-space offsets preserve every authored shoulder, elbow, knee
  // and ankle keyframe. No gameplay root, velocity, hitbox, reach, startup or
  // input timing is changed.
  host.position.x += state.positionX;
  host.position.y += state.positionY;
  host.rotation.x += state.rotationX;
  host.rotation.y += state.rotationY;
  host.rotation.z += state.rotationZ;

  root.userData.tpsCounterattackHandoff = factor;
  root.userData.tpsCounterattackHandoffSeconds = state.bridgeSeconds;
  root.userData.tpsCounterattackHandoffMove = fighter.currentMove.id;
  root.userData.tpsCounterattackHandoffReaction = fighter.reactionKind;
  root.userData.tpsCounterattackHandoffReleaseTick = attackReleaseTick(fighter);
  root.userData.tpsCounterattackHandoffSource = state.source;
  root.userData.tpsCounterattackHandoffEnvelope = envelope;
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

    // Capture outgoing presentation markers before the inner layers see ATTACK
    // and clear them. This is the exact visual state shown on the previous frame.
    const data = fighter.visual.root.userData as Record<string, unknown>;
    startBridgeFromPreviousFrame(fighter, state, data);

    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyCounterattackHandoff(fighter, state, timeSeconds);
    state.lastRenderedState = fighter.state;
  };
}
