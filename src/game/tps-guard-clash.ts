import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";

type AppliedBoneDelta = {
  bone: THREE.Object3D;
  x: number;
  y: number;
  z: number;
};

type GuardClashState = {
  host: THREE.Object3D | null;
  positionX: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  bones: AppliedBoneDelta[];
};

const states = new WeakMap<FighterRuntime, GuardClashState>();
let installed = false;

function ensureState(fighter: FighterRuntime): GuardClashState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    positionX: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    bones: [],
  };
  states.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findImportedBone(host: THREE.Object3D, aliases: readonly string[]): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  host.traverse((object) => {
    if (result) return;
    const bone = object as THREE.Bone;
    if (!bone.isBone || !object.name) return;
    const name = normalizedName(object.name);
    if (aliases.some((alias) => name.includes(alias))) result = object;
  });
  return result;
}

function addBoneDelta(
  state: GuardClashState,
  bone: THREE.Object3D | null,
  x: number,
  y: number,
  z: number,
): void {
  if (!bone) return;
  bone.rotation.x += x;
  bone.rotation.y += y;
  bone.rotation.z += z;
  state.bones.push({ bone, x, y, z });
}

function removeGuardClash(fighter: FighterRuntime, state: GuardClashState): void {
  if (state.host) {
    state.host.position.x -= state.positionX;
    state.host.rotation.x -= state.rotationX;
    state.host.rotation.y -= state.rotationY;
    state.host.rotation.z -= state.rotationZ;
  }
  for (const delta of state.bones) {
    delta.bone.rotation.x -= delta.x;
    delta.bone.rotation.y -= delta.y;
    delta.bone.rotation.z -= delta.z;
  }
  state.host = null;
  state.positionX = 0;
  state.rotationX = 0;
  state.rotationY = 0;
  state.rotationZ = 0;
  state.bones.length = 0;
  fighter.visual.root.userData.tpsGuardClashPose = 0;
}

function smoothRelease(ticks: number, hitStop: number): number {
  if (hitStop > 0) return 1;
  const normalized = THREE.MathUtils.clamp(ticks / 9, 0, 1);
  return THREE.MathUtils.smoothstep(normalized, 0, 1);
}

function applyGuardClash(fighter: FighterRuntime, opponent: FighterRuntime, state: GuardClashState): void {
  const root = fighter.visual.root;
  if (!root.userData.combatTps || root.userData.quaterniusModelState !== "ready") return;

  const defending = fighter.state === "BLOCK_STUN";
  const attackingIntoGuard = fighter.state === "ATTACK"
    && Boolean(fighter.currentMove)
    && opponent.state === "BLOCK_STUN";
  if (!defending && !attackingIntoGuard) return;

  const blockedFighter = defending ? fighter : opponent;
  const factor = smoothRelease(blockedFighter.blockStun, blockedFighter.hitStop);
  if (factor <= 1e-4) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;

  const side = blockedFighter.reactionSide === "LEFT" ? -1 : 1;
  const scale = root.scale.x;
  state.host = host;

  if (defending) {
    // Brace into the strike: a small body compression plus both arms tightening
    // toward the chest makes the block read as an active catch instead of an
    // upright idle overlap. These are additive presentation deltas only.
    state.positionX = -side * 0.010 * scale * factor;
    state.rotationX = 0.050 * factor;
    state.rotationY = side * 0.052 * factor;
    state.rotationZ = side * 0.028 * factor;
    host.position.x += state.positionX;
    host.rotation.x += state.rotationX;
    host.rotation.y += state.rotationY;
    host.rotation.z += state.rotationZ;

    const leftUpper = findImportedBone(host, ["leftarm", "upperarml", "lupperarm"]);
    const rightUpper = findImportedBone(host, ["rightarm", "upperarmr", "rupperarm"]);
    const leftForearm = findImportedBone(host, ["leftforearm", "leftlowerarm", "forearml", "lowerarml"]);
    const rightForearm = findImportedBone(host, ["rightforearm", "rightlowerarm", "forearmr", "lowerarmr"]);
    addBoneDelta(state, leftUpper, -0.024 * factor, 0, 0.032 * factor);
    addBoneDelta(state, rightUpper, -0.024 * factor, 0, -0.032 * factor);
    addBoneDelta(state, leftForearm, -0.034 * factor, 0.018 * factor, 0.012 * factor);
    addBoneDelta(state, rightForearm, -0.034 * factor, -0.018 * factor, -0.012 * factor);
  } else {
    // The attacker gives a tiny visual rebound when the strike meets a guard.
    // Keep it much smaller than hit recoil so the authored attack still owns
    // the contact point and timing.
    const attackerFactor = factor * 0.62;
    state.positionX = side * 0.006 * scale * attackerFactor;
    state.rotationX = -0.022 * attackerFactor;
    state.rotationY = -side * 0.038 * attackerFactor;
    state.rotationZ = -side * 0.016 * attackerFactor;
    host.position.x += state.positionX;
    host.rotation.x += state.rotationX;
    host.rotation.y += state.rotationY;
    host.rotation.z += state.rotationZ;
  }

  root.userData.tpsGuardClashPose = factor;
  root.userData.tpsGuardClashRole = defending ? "DEFENDER" : "ATTACKER";
  root.userData.tpsGuardClashSide = side;
  root.userData.tpsGuardClashHostX = state.positionX;
  root.userData.tpsGuardClashHostRotX = state.rotationX;
  root.userData.tpsGuardClashHostRotY = state.rotationY;
  root.userData.tpsGuardClashHostRotZ = state.rotationZ;
  root.userData.tpsGuardClashBoneCount = state.bones.length;
  root.updateMatrixWorld(true);
}

export function installTpsGuardClashPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsGuardClash(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removeGuardClash(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyGuardClash(fighter, opponent, state);
  };
}
