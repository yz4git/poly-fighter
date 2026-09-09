import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type ImpactFollowthroughState = {
  host: THREE.Object3D | null;
  positionY: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  rootOffsetX: number;
  rootOffsetZ: number;
  leftThighX: number;
  leftShinX: number;
  leftFootX: number;
  rightThighX: number;
  rightShinX: number;
  rightFootX: number;
  recoverySeconds: number;
  recoveryDuration: number;
  recoveryFactor: number;
  lastTimeSeconds: number;
};

const RECOVERY_READY_STATES = new Set(["IDLE", "WALK", "CROUCH", "GUARD", "SIDESTEP"]);
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
    rootOffsetX: 0,
    rootOffsetZ: 0,
    leftThighX: 0,
    leftShinX: 0,
    leftFootX: 0,
    rightThighX: 0,
    rightShinX: 0,
    rightFootX: 0,
    recoverySeconds: 0,
    recoveryDuration: 0,
    recoveryFactor: 0,
    lastTimeSeconds: 0,
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
  const root = fighter.visual.root;
  const bones = fighter.visual.rig.bones;
  if (state.host) {
    state.host.position.y -= state.positionY;
    state.host.rotation.x -= state.rotationX;
    state.host.rotation.y -= state.rotationY;
    state.host.rotation.z -= state.rotationZ;
  }

  root.position.x -= state.rootOffsetX;
  root.position.z -= state.rootOffsetZ;
  bones.leftThigh.rotation.x -= state.leftThighX;
  bones.leftShin.rotation.x -= state.leftShinX;
  bones.leftFoot.rotation.x -= state.leftFootX;
  bones.rightThigh.rotation.x -= state.rightThighX;
  bones.rightShin.rotation.x -= state.rightShinX;
  bones.rightFoot.rotation.x -= state.rightFootX;

  state.host = null;
  state.positionY = 0;
  state.rotationX = 0;
  state.rotationY = 0;
  state.rotationZ = 0;
  state.rootOffsetX = 0;
  state.rootOffsetZ = 0;
  state.leftThighX = 0;
  state.leftShinX = 0;
  state.leftFootX = 0;
  state.rightThighX = 0;
  state.rightShinX = 0;
  state.rightFootX = 0;
  root.userData.tpsImpactFollowthrough = 0;
  root.userData.tpsImpactFootwork = 0;
  root.userData.tpsImpactFootworkStep = 0;
}

function reactionScale(kind: FighterRuntime["reactionKind"]): number {
  if (kind === "COUNTER") return 1.18;
  if (kind === "HEAVY") return 1.08;
  if (kind === "MID") return 0.92;
  return 0.74;
}

function reactionResidual(kind: FighterRuntime["reactionKind"]): number {
  if (kind === "COUNTER") return 0.24;
  if (kind === "HEAVY") return 0.20;
  if (kind === "MID") return 0.14;
  return 0.09;
}

function reactionRecoveryDuration(kind: FighterRuntime["reactionKind"]): number {
  if (kind === "COUNTER") return 0.18;
  if (kind === "HEAVY") return 0.15;
  if (kind === "MID") return 0.11;
  return 0.08;
}

function reactionFootworkScale(kind: FighterRuntime["reactionKind"]): number {
  if (kind === "COUNTER") return 1;
  if (kind === "HEAVY") return 0.88;
  if (kind === "MID") return 0.54;
  return 0.30;
}

function applyHostRecoil(
  fighter: FighterRuntime,
  state: ImpactFollowthroughState,
  host: THREE.Object3D,
  factor: number,
): void {
  const root = fighter.visual.root;
  const side = fighter.reactionSide === "LEFT" ? -1 : 1;
  const scale = root.scale.x;

  // Keep the feet close to their authored placement and let the production
  // model pivot through the chest/hips. The tiny compression reads as the knees
  // taking load without changing simulation position or sinking the fighter.
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

function applyLowerBodyWeightTransfer(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: ImpactFollowthroughState,
  factor: number,
  stepRelease: number,
): void {
  const root = fighter.visual.root;
  const bones = fighter.visual.rig.bones;
  const brace = THREE.MathUtils.clamp(factor * reactionFootworkScale(fighter.reactionKind), 0, 1.05);
  if (brace <= 1e-4) return;

  // Keep the frozen contact frame planted. Once hit-stop releases, the rendered
  // body is allowed to give a few centimetres away from the attacker. This is a
  // visual weight transfer only: FighterRuntime.position, velocity, collision,
  // reach and hitboxes are untouched.
  const away = fighter.position.clone().sub(opponent.position);
  away.y = 0;
  if (away.lengthSq() <= 1e-6) away.set(-fighter.facing, 0, 0);
  else away.normalize();
  const step = 0.0155 * root.scale.x * brace * THREE.MathUtils.clamp(stepRelease, 0, 1);
  state.rootOffsetX = away.x * step;
  state.rootOffsetZ = away.z * step;
  root.position.x += state.rootOffsetX;
  root.position.z += state.rootOffsetZ;

  // One leg catches the load while the other yields. Keeping the offsets small
  // preserves the authored mocap silhouette but removes the old symmetric,
  // mannequin-like lower body during strong recoil and the first recovery beat.
  const supportLeft = fighter.reactionSide === "LEFT";
  const supportThigh = 0.040 * brace;
  const supportShin = -0.078 * brace;
  const supportFoot = 0.032 * brace;
  const flowThigh = -0.018 * brace;
  const flowShin = 0.031 * brace;
  const flowFoot = -0.014 * brace;

  if (supportLeft) {
    state.leftThighX = supportThigh;
    state.leftShinX = supportShin;
    state.leftFootX = supportFoot;
    state.rightThighX = flowThigh;
    state.rightShinX = flowShin;
    state.rightFootX = flowFoot;
  } else {
    state.rightThighX = supportThigh;
    state.rightShinX = supportShin;
    state.rightFootX = supportFoot;
    state.leftThighX = flowThigh;
    state.leftShinX = flowShin;
    state.leftFootX = flowFoot;
  }

  bones.leftThigh.rotation.x += state.leftThighX;
  bones.leftShin.rotation.x += state.leftShinX;
  bones.leftFoot.rotation.x += state.leftFootX;
  bones.rightThigh.rotation.x += state.rightThighX;
  bones.rightShin.rotation.x += state.rightShinX;
  bones.rightFoot.rotation.x += state.rightFootX;

  root.userData.tpsImpactFootwork = brace;
  root.userData.tpsImpactFootworkStep = step;
  root.userData.tpsImpactFootworkSupport = supportLeft ? "LEFT" : "RIGHT";
  root.updateMatrixWorld(true);
}

function applyImpactFollowthrough(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: ImpactFollowthroughState,
  timeSeconds: number,
): void {
  const root = fighter.visual.root;
  const deltaSeconds = state.lastTimeSeconds > 0
    ? THREE.MathUtils.clamp(timeSeconds - state.lastTimeSeconds, 0, 1 / 15)
    : 0;
  state.lastTimeSeconds = timeSeconds;

  if (!root.userData.combatTps || root.userData.quaterniusModelState !== "ready") {
    state.recoverySeconds = 0;
    state.recoveryDuration = 0;
    state.recoveryFactor = 0;
    root.userData.tpsImpactRecovery = 0;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  if (fighter.state === "HIT") {
    const tier = reactionScale(fighter.reactionKind);
    const residual = reactionResidual(fighter.reactionKind);
    const dynamicRelease = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp(fighter.hitStun / 12, 0, 1),
      0,
      1,
    );

    // Keep a small residual lean at the end of hitstun instead of fading all the
    // way to zero. The following ready-state tail can then continue from the same
    // pose rather than snapping directly from HIT into neutral.
    const release = fighter.hitStop > 0
      ? 1
      : residual + (1 - residual) * dynamicRelease;
    const factor = THREE.MathUtils.clamp(release * tier, 0, 1.25);

    state.recoveryDuration = reactionRecoveryDuration(fighter.reactionKind);
    state.recoverySeconds = state.recoveryDuration;
    state.recoveryFactor = THREE.MathUtils.clamp(residual * tier, 0, 0.32);

    root.userData.tpsImpactRecovery = 0;
    root.userData.tpsImpactRecoverySeconds = state.recoverySeconds;
    root.userData.tpsImpactRecoveryKind = fighter.reactionKind;
    applyHostRecoil(fighter, state, host, factor);
    applyLowerBodyWeightTransfer(
      fighter,
      opponent,
      state,
      factor,
      fighter.hitStop > 0 ? 0.34 : 1,
    );
    return;
  }

  if (!RECOVERY_READY_STATES.has(fighter.state) || state.recoverySeconds <= 0 || state.recoveryDuration <= 0) {
    state.recoverySeconds = 0;
    state.recoveryDuration = 0;
    state.recoveryFactor = 0;
    root.userData.tpsImpactRecovery = 0;
    root.userData.tpsImpactRecoverySeconds = 0;
    return;
  }

  // Once hitstun releases, preserve only the final residual recoil and let it
  // settle over a reaction-tier-specific window. Heavy/counter hits therefore
  // feel like the defender has to regain posture, while light hits recover fast.
  state.recoverySeconds = Math.max(0, state.recoverySeconds - deltaSeconds);
  const remaining = THREE.MathUtils.clamp(state.recoverySeconds / state.recoveryDuration, 0, 1);
  const settle = THREE.MathUtils.smoothstep(remaining, 0, 1);
  const factor = state.recoveryFactor * settle;

  root.userData.tpsImpactRecovery = settle;
  root.userData.tpsImpactRecoverySeconds = state.recoverySeconds;
  root.userData.tpsImpactRecoveryFactor = factor;

  if (factor > 1e-4) {
    applyHostRecoil(fighter, state, host, factor);
    // Legs settle a little more slowly than the torso. The defender therefore
    // looks as if they regain their base under the body instead of instantly
    // returning to the idle stance the moment hitstun ends.
    applyLowerBodyWeightTransfer(
      fighter,
      opponent,
      state,
      THREE.MathUtils.clamp(factor * 2.2, 0, 1),
      settle,
    );
  }
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
    applyImpactFollowthrough(fighter, opponent, state, timeSeconds);
  };
}
