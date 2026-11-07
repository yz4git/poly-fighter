import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";
import { tpsTelegraphPoseCue, type TpsTelegraphPoseCue } from "./tps-telegraph-pose-cue";

type TelegraphKind = "PUNCH" | "KICK" | "HEAVY" | "SWEEP";

type TelegraphHandoffState = {
  appliedPositionX: number;
  appliedRotationX: number;
  appliedRotationY: number;
  appliedRotationZ: number;
};

const handoffStates = new WeakMap<FighterRuntime, TelegraphHandoffState>();
let installed = false;

function ensureState(fighter: FighterRuntime): TelegraphHandoffState {
  let state = handoffStates.get(fighter);
  if (state) return state;
  state = {
    appliedPositionX: 0,
    appliedRotationX: 0,
    appliedRotationY: 0,
    appliedRotationZ: 0,
  };
  handoffStates.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime) {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function smooth01(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function sideForVisualContact(contact: string | undefined): -1 | 1 {
  if (contact === "LEFT_FIST" || contact === "LEFT_FOOT") return -1;
  return 1;
}

function kindForMove(moveId: string): TelegraphKind {
  if (["kick", "lowKick", "risingKick", "dashKick"].includes(moveId)) return "KICK";
  if (["power", "throw"].includes(moveId)) return "HEAVY";
  if (["backfist", "counter"].includes(moveId)) return "SWEEP";
  return "PUNCH";
}

function removeHandoffTransform(fighter: FighterRuntime, state: TelegraphHandoffState): void {
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
  fighter.visual.root.userData.tpsTelegraphHandoff = 0;
}

function applyTelegraphHandoff(fighter: FighterRuntime, state: TelegraphHandoffState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const directorMove = String(root.userData.tpsCpuDirectorMove ?? "");
  const strikePhase = root.userData.tpsEnemyTelegraphPhase === "STRIKE";
  const eligible = root.userData.combatTps
    && root.userData.quaterniusModelState === "ready"
    && fighter.state === "ATTACK"
    && move
    && strikePhase
    && directorMove === move.id
    && !["throw", "dashKick"].includes(move.id);
  if (!eligible || !move) {
    root.userData.tpsTelegraphHandoff = 0;
    return;
  }

  // The final LOAD frame reaches a full body coil. Keep that same authored
  // direction for only the first few startup ticks, then smoothly hand control
  // to the Blender attack clip. No attack timing or simulation data is changed.
  const handoffTicks = Math.max(3, Math.min(5, Math.floor(move.startup * 0.5)));
  const factor = 1 - smooth01(fighter.moveTick / Math.max(1, handoffTicks));
  if (factor <= 1e-4) {
    root.userData.tpsTelegraphHandoff = 0;
    return;
  }

  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const side = sideForVisualContact(move.visualContact);
  const kind = kindForMove(move.id);
  const scale = root.scale.x;

  let positionX = -side * 0.005 * scale;
  let rotationX = 0.012;
  let rotationY = side * 0.090;
  let rotationZ = -side * 0.018;

  if (kind === "KICK") {
    positionX = -side * 0.008 * scale;
    rotationX = 0.040;
    rotationY = -side * 0.100;
    rotationZ = side * 0.025;
  } else if (kind === "HEAVY") {
    positionX = -side * 0.007 * scale;
    rotationX = 0.026;
    rotationY = side * 0.140;
    rotationZ = -side * 0.034;
  } else if (kind === "SWEEP") {
    positionX = side * 0.007 * scale;
    rotationX = 0.010;
    rotationY = side * 0.125;
    rotationZ = -side * 0.030;
  }

  state.appliedPositionX = positionX * factor;
  state.appliedRotationX = rotationX * factor;
  state.appliedRotationY = rotationY * factor;
  state.appliedRotationZ = rotationZ * factor;
  host.position.x += state.appliedPositionX;
  host.rotation.x += state.appliedRotationX;
  host.rotation.y += state.appliedRotationY;
  host.rotation.z += state.appliedRotationZ;

  root.userData.tpsTelegraphHandoff = factor;
  root.userData.tpsTelegraphHandoffMove = move.id;
  root.userData.tpsTelegraphHandoffKind = kind;
  root.userData.tpsTelegraphHandoffTicks = handoffTicks;
  root.userData.tpsTelegraphHandoffSide = side;
  root.updateMatrixWorld(true);
}

// These deltas are applied only to the displayed Quaternius rig (not the
// legacy hidden proxy). All deltas are removed before the next animation mixer
// sample so they cannot accumulate or contaminate the authored animations.
type ImportedBoneDelta = { bone: THREE.Object3D; x: number; y: number; z: number };
type TelegraphIntentState = {
  host: THREE.Object3D | null;
  hostX: number; hostY: number; hostZ: number;
  pitch: number; yaw: number; roll: number;
  bones: ImportedBoneDelta[];
};
const intentStates = new WeakMap<FighterRuntime, TelegraphIntentState>();
const importedBoneCache = new WeakMap<THREE.Object3D, {
  spine: THREE.Object3D | null;
  leftArm: THREE.Object3D | null; rightArm: THREE.Object3D | null;
  leftThigh: THREE.Object3D | null; rightThigh: THREE.Object3D | null;
}>();

function intentState(fighter: FighterRuntime): TelegraphIntentState {
  let state = intentStates.get(fighter);
  if (!state) {
    state = { host: null, hostX: 0, hostY: 0, hostZ: 0,
      pitch: 0, yaw: 0, roll: 0, bones: [] };
    intentStates.set(fighter, state);
  }
  return state;
}

function findImportedBone(host: THREE.Object3D, aliases: string[]): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  host.traverse(object => {
    if (match || !(object as THREE.Bone).isBone) return;
    const name = object.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (aliases.some(alias => name === alias || name.endsWith(alias))) match = object;
  });
  return match;
}

function importedIntentBones(host: THREE.Object3D) {
  let bones = importedBoneCache.get(host);
  if (!bones) {
    bones = {
      spine: findImportedBone(host, ["spine02", "spine2", "chest", "spine01", "spine"]),
      leftArm: findImportedBone(host, ["upperarml", "leftarm", "lupperarm"]),
      rightArm: findImportedBone(host, ["upperarmr", "rightarm", "rupperarm"]),
      leftThigh: findImportedBone(host, ["thighl", "leftupleg", "leftthigh"]),
      rightThigh: findImportedBone(host, ["thighr", "rightupleg", "rightthigh"]),
    };
    importedBoneCache.set(host, bones);
  }
  return bones;
}

function resetIntentPose(fighter: FighterRuntime, state: TelegraphIntentState): void {
  if (state.host) {
    state.host.position.x -= state.hostX;
    state.host.position.y -= state.hostY;
    state.host.position.z -= state.hostZ;
    state.host.rotation.x -= state.pitch;
    state.host.rotation.y -= state.yaw;
    state.host.rotation.z -= state.roll;
  }
  for (const delta of state.bones) {
    delta.bone.rotation.x -= delta.x;
    delta.bone.rotation.y -= delta.y;
    delta.bone.rotation.z -= delta.z;
  }
  state.host = null;
  state.hostX = 0; state.hostY = 0; state.hostZ = 0;
  state.pitch = 0; state.yaw = 0; state.roll = 0;
  state.bones.length = 0;
  const data = fighter.visual.root.userData;
  data.tpsEnemyTelegraphPoseKind = "NONE";
  data.tpsEnemyTelegraphPoseIntensity = 0;
  data.tpsEnemyTelegraphPoseShoulder = 0;
  data.tpsEnemyTelegraphPoseHip = 0;
  data.tpsEnemyTelegraphPoseHostYaw = 0;
}

function addIntentBone(
  state: TelegraphIntentState,
  bone: THREE.Object3D | null,
  x: number,
  y: number,
  z: number,
): void {
  if (!bone || Math.abs(x) + Math.abs(y) + Math.abs(z) <= 1e-7) return;
  bone.rotation.x += x;
  bone.rotation.y += y;
  bone.rotation.z += z;
  state.bones.push({ bone, x, y, z });
}

function applyTelegraphIntent(
  fighter: FighterRuntime,
  state: TelegraphIntentState,
): void {
  const data = fighter.visual.root.userData;
  if (!data.combatTps || data.quaterniusModelState !== "ready") return;
  // A stun or real ATTACK is never overridden by the trick silhouette.
  // Once a real strike begins, the existing authored motion/handoff owns it.
  if (!["IDLE", "GUARD", "WALK"].includes(fighter.state)) return;
  const cue: TpsTelegraphPoseCue = tpsTelegraphPoseCue({
    phase: String(data.tpsEnemyTelegraphPhase ?? "NONE"),
    telegraphProgress: Number(data.tpsEnemyTelegraphProgress ?? 0),
    plannedFeint: data.tpsEnemyTelegraphFeintPlanned === true,
    moveId: typeof data.tpsEnemyTelegraphMove === "string" ? data.tpsEnemyTelegraphMove : null,
    orbitSign: Number(data.tpsEnemyTelegraphOrbitSign ?? 1),
    feintReadTicks: Number(data.tpsCpuFeintReadTicks ?? 0),
  });
  if (cue.phase === "NONE") return;
  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const scale = fighter.visual.root.scale.x;
  state.host = host;
  state.hostX = cue.hostX * scale;
  state.hostY = cue.hostY * scale;
  state.hostZ = cue.hostZ * scale;
  state.pitch = cue.pitch; state.yaw = cue.yaw; state.roll = cue.roll;
  host.position.x += state.hostX;
  host.position.y += state.hostY;
  host.position.z += state.hostZ;
  host.rotation.x += state.pitch;
  host.rotation.y += state.yaw;
  host.rotation.z += state.roll;
  const bones = importedIntentBones(host);
  addIntentBone(state, bones.spine, cue.spinePitch, cue.spineYaw, 0);
  addIntentBone(state, bones.leftArm, cue.leftArmPitch, 0, 0);
  addIntentBone(state, bones.rightArm, cue.rightArmPitch, 0, 0);
  addIntentBone(state, bones.leftThigh, 0, 0, cue.leftThighRoll);
  addIntentBone(state, bones.rightThigh, 0, 0, cue.rightThighRoll);
  data.tpsEnemyTelegraphPoseKind = cue.phase;
  data.tpsEnemyTelegraphPoseIntensity = cue.intensity;
  data.tpsEnemyTelegraphPoseShoulder = cue.leftArmPitch - cue.rightArmPitch;
  data.tpsEnemyTelegraphPoseHip = cue.leftThighRoll - cue.rightThighRoll;
  data.tpsEnemyTelegraphPoseHostYaw = state.yaw;
  data.tpsEnemyTelegraphPoseImportedBoneCount = state.bones.length;
  fighter.visual.root.updateMatrixWorld(true);
}

export function installTpsTelegraphHandoffPresentation(): void {
  if (installed) return;
  installed = true;
  const baseUpdate = PresentationAnimationController.prototype.update;

  PresentationAnimationController.prototype.update = function updateWithTpsTelegraphHandoff(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    const pose = intentState(fighter);
    removeHandoffTransform(fighter, state);
    resetIntentPose(fighter, pose);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyTelegraphHandoff(fighter, state);
    applyTelegraphIntent(fighter, pose);
  };
}
