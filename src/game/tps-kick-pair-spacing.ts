import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { solveCombatLimb } from "./combat-motion-authoring";
import { PresentationAnimationController } from "./presentation-animation";

type LegSuffix = "l" | "r";

type ImportedLeg = {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
};

type LegSnapshot = {
  leg: ImportedLeg | null;
  thighQ: THREE.Quaternion;
  calfQ: THREE.Quaternion;
  footQ: THREE.Quaternion;
};

type KickPairSpacingState = {
  left: LegSnapshot;
  right: LegSnapshot;
  host: THREE.Object3D | null;
  hostDelta: THREE.Vector3;
};

const RETREAT_BY_MOVE: Readonly<Record<string, number>> = {
  kick: 0.060,
  risingKick: 0.050,
  dashKick: 0.045,
};

const states = new WeakMap<FighterRuntime, KickPairSpacingState>();
let installed = false;

function newLegSnapshot(): LegSnapshot {
  return {
    leg: null,
    thighQ: new THREE.Quaternion(),
    calfQ: new THREE.Quaternion(),
    footQ: new THREE.Quaternion(),
  };
}

function ensureState(fighter: FighterRuntime): KickPairSpacingState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    left: newLegSnapshot(),
    right: newLegSnapshot(),
    host: null,
    hostDelta: new THREE.Vector3(),
  };
  states.set(fighter, state);
  return state;
}

function runtimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function runtimeModel(host: THREE.Object3D): THREE.Object3D | null {
  return host.children.find((child) => child.type === "Group" || child.children.length > 0)
    ?? host.children[0]
    ?? null;
}

function importedLeg(model: THREE.Object3D, suffix: LegSuffix): ImportedLeg | null {
  const thigh = model.getObjectByName(`thigh_${suffix}`);
  const calf = model.getObjectByName(`calf_${suffix}`);
  const foot = model.getObjectByName(`foot_${suffix}`);
  return thigh && calf && foot ? { thigh, calf, foot } : null;
}

function snapshotLeg(snapshot: LegSnapshot, leg: ImportedLeg): void {
  snapshot.leg = leg;
  snapshot.thighQ.copy(leg.thigh.quaternion);
  snapshot.calfQ.copy(leg.calf.quaternion);
  snapshot.footQ.copy(leg.foot.quaternion);
}

function restoreLeg(snapshot: LegSnapshot): void {
  if (!snapshot.leg) return;
  snapshot.leg.thigh.quaternion.copy(snapshot.thighQ);
  snapshot.leg.calf.quaternion.copy(snapshot.calfQ);
  snapshot.leg.foot.quaternion.copy(snapshot.footQ);
  snapshot.leg = null;
}

function restorePrevious(state: KickPairSpacingState): void {
  if (state.host) {
    state.host.position.sub(state.hostDelta);
    state.host = null;
    state.hostDelta.set(0, 0, 0);
  }
  restoreLeg(state.left);
  restoreLeg(state.right);
}

function clearDiagnostics(fighter: FighterRuntime): void {
  const data = fighter.visual.root.userData;
  data.tpsKickPairSpacing = 0;
  data.tpsKickPairSpacingMove = "NONE";
  data.tpsKickPairBodyRetreat = 0;
  data.tpsKickPairLeftFootError = 0;
  data.tpsKickPairRightFootError = 0;
  data.tpsKickPairChestDistance = 0;
}

function envelope(fighter: FighterRuntime): number {
  const move = fighter.currentMove;
  if (!move) return 0;
  const activeStart = move.startup;
  const activeEnd = move.startup + Math.max(1, move.active);
  const enter = THREE.MathUtils.smoothstep(
    fighter.moveTick,
    Math.max(0, activeStart - 3),
    activeStart + 1,
  );
  const exit = 1 - THREE.MathUtils.smoothstep(
    fighter.moveTick,
    activeEnd + 1,
    activeEnd + 7,
  );
  return THREE.MathUtils.clamp(enter * exit, 0, 1);
}

function setWorldQuaternion(object: THREE.Object3D, desiredWorld: THREE.Quaternion): void {
  if (!object.parent) {
    object.quaternion.copy(desiredWorld).normalize();
    return;
  }
  const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
  object.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
}

function solveLegToTarget(
  leg: ImportedLeg,
  suffix: LegSuffix,
  target: THREE.Vector3,
  scale: number,
): void {
  const hip = leg.thigh.getWorldPosition(new THREE.Vector3());
  const knee = leg.calf.getWorldPosition(new THREE.Vector3());
  const bend = knee.clone().sub(hip);
  bend.y = 0;
  if (bend.lengthSq() < 1e-8) bend.set(suffix === "l" ? -1 : 1, 0, 0);
  bend.normalize();
  const pole = knee.clone()
    .add(new THREE.Vector3(0, 0.055 * scale, 0))
    .addScaledVector(bend, 0.025 * scale);
  solveCombatLimb(leg.thigh, leg.calf, leg.foot, target, pole);
}

function hostLocalDeltaForWorldDelta(host: THREE.Object3D, worldDelta: THREE.Vector3): THREE.Vector3 {
  const parent = host.parent;
  if (!parent) return worldDelta.clone();
  parent.updateMatrixWorld(true);
  const originWorld = host.getWorldPosition(new THREE.Vector3());
  const destinationWorld = originWorld.clone().add(worldDelta);
  const originLocal = parent.worldToLocal(originWorld.clone());
  const destinationLocal = parent.worldToLocal(destinationWorld.clone());
  return destinationLocal.sub(originLocal);
}

function chestPoint(fighter: FighterRuntime): THREE.Vector3 | null {
  const host = runtimeHost(fighter);
  const model = host ? runtimeModel(host) : null;
  const chest = model?.getObjectByName("spine_03");
  return chest ? chest.getWorldPosition(new THREE.Vector3()) : null;
}

function applyKickPairSpacing(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: KickPairSpacingState,
): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const moveId = move?.id ?? "";
  const retreatBase = RETREAT_BY_MOVE[moveId];
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || opponent.visual.root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || !move
    || retreatBase === undefined
  ) {
    clearDiagnostics(fighter);
    return;
  }

  const factor = envelope(fighter);
  if (factor <= 1e-4) {
    clearDiagnostics(fighter);
    return;
  }

  const host = runtimeHost(fighter);
  const model = host ? runtimeModel(host) : null;
  const left = model ? importedLeg(model, "l") : null;
  const right = model ? importedLeg(model, "r") : null;
  if (!host || !model || !left || !right) return;

  model.updateMatrixWorld(true);
  const leftTarget = left.foot.getWorldPosition(new THREE.Vector3());
  const rightTarget = right.foot.getWorldPosition(new THREE.Vector3());
  const leftRotation = left.foot.getWorldQuaternion(new THREE.Quaternion());
  const rightRotation = right.foot.getWorldQuaternion(new THREE.Quaternion());
  snapshotLeg(state.left, left);
  snapshotLeg(state.right, right);

  // At close TPS range the authored kick hips can visually arrive before the
  // boot, making the two fighters read as one merged silhouette. Move only the
  // imported rendered body a few centimetres away from the opponent, then solve
  // both legs back to their exact incoming world-space boot targets. Grounding,
  // strike reach and contact lanes therefore remain intact while the torso/hip
  // gap becomes readable. FighterRuntime and hitboxes are never moved.
  const away = fighter.position.clone().sub(opponent.position);
  away.y = 0;
  if (away.lengthSq() <= 1e-8) away.set(-fighter.facing, 0, 0);
  else away.normalize();
  const scale = Math.max(0.5, root.scale.x);
  const retreat = retreatBase * scale * factor;
  const worldDelta = away.multiplyScalar(retreat);

  state.host = host;
  state.hostDelta.copy(hostLocalDeltaForWorldDelta(host, worldDelta));
  host.position.add(state.hostDelta);
  root.updateMatrixWorld(true);

  solveLegToTarget(left, "l", leftTarget, scale);
  setWorldQuaternion(left.foot, leftRotation);
  model.updateMatrixWorld(true);
  solveLegToTarget(right, "r", rightTarget, scale);
  setWorldQuaternion(right.foot, rightRotation);
  model.updateMatrixWorld(true);

  const finalLeft = left.foot.getWorldPosition(new THREE.Vector3());
  const finalRight = right.foot.getWorldPosition(new THREE.Vector3());
  const attackerChest = chestPoint(fighter);
  const opponentChest = chestPoint(opponent);
  const data = root.userData;
  data.tpsKickPairSpacing = factor;
  data.tpsKickPairSpacingMove = moveId;
  data.tpsKickPairBodyRetreat = retreat;
  data.tpsKickPairLeftFootError = finalLeft.distanceTo(leftTarget);
  data.tpsKickPairRightFootError = finalRight.distanceTo(rightTarget);
  data.tpsKickPairChestDistance = attackerChest && opponentChest
    ? Math.hypot(attackerChest.x - opponentChest.x, attackerChest.z - opponentChest.z)
    : 0;
}

export function installTpsKickPairSpacingPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsKickPairSpacing(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    restorePrevious(state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyKickPairSpacing(fighter, opponent, state);
  };
}
