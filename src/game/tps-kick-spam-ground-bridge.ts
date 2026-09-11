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

type KickSpamGroundState = {
  support: LegSnapshot;
  strike: LegSnapshot;
  host: THREE.Object3D | null;
  hostDelta: THREE.Vector3;
  groundReady: boolean;
  groundLeftPosition: THREE.Vector3;
  groundRightPosition: THREE.Vector3;
  groundLeftRotation: THREE.Quaternion;
  groundRightRotation: THREE.Quaternion;
  groundRuntimePosition: THREE.Vector3;
};

const REFERENCE_STATES = new Set(["IDLE", "WALK", "CROUCH", "SIDESTEP", "GUARD"]);
const GROUND_KICK_IDS = new Set(["kick", "lowKick", "risingKick"]);
const states = new WeakMap<FighterRuntime, KickSpamGroundState>();
let installed = false;

function newSnapshot(): LegSnapshot {
  return {
    leg: null,
    thighQ: new THREE.Quaternion(),
    calfQ: new THREE.Quaternion(),
    footQ: new THREE.Quaternion(),
  };
}

function ensureState(fighter: FighterRuntime): KickSpamGroundState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    support: newSnapshot(),
    strike: newSnapshot(),
    host: null,
    hostDelta: new THREE.Vector3(),
    groundReady: false,
    groundLeftPosition: new THREE.Vector3(),
    groundRightPosition: new THREE.Vector3(),
    groundLeftRotation: new THREE.Quaternion(),
    groundRightRotation: new THREE.Quaternion(),
    groundRuntimePosition: new THREE.Vector3(),
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

function restorePrevious(state: KickSpamGroundState): void {
  if (state.host) {
    state.host.position.sub(state.hostDelta);
    state.host = null;
    state.hostDelta.set(0, 0, 0);
  }
  restoreLeg(state.support);
  restoreLeg(state.strike);
}

function clearDiagnostics(fighter: FighterRuntime): void {
  const data = fighter.visual.root.userData;
  data.tpsKickSpamGroundBridge = 0;
  data.tpsKickSpamGroundBridgeMove = "NONE";
  data.tpsKickSpamGroundBridgeSupportHeight = 0;
  data.tpsKickSpamGroundBridgeMinFootHeight = 0;
  data.tpsKickSpamGroundBridgeBodyDrop = 0;
}

function setWorldQuaternion(object: THREE.Object3D, desiredWorld: THREE.Quaternion): void {
  if (!object.parent) {
    object.quaternion.copy(desiredWorld).normalize();
    return;
  }
  const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
  object.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
}

function limitedRotation(
  anchor: THREE.Quaternion,
  current: THREE.Quaternion,
  maxDegrees: number,
): THREE.Quaternion {
  const angle = anchor.angleTo(current);
  const maximum = THREE.MathUtils.degToRad(maxDegrees);
  if (angle <= maximum || angle <= 1e-6) return current.clone();
  return anchor.clone().slerp(current, maximum / angle).normalize();
}

function solveLeg(
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
    .addScaledVector(bend, 0.028 * scale);
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

function captureGroundReference(fighter: FighterRuntime, state: KickSpamGroundState): void {
  const root = fighter.visual.root;
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || !fighter.grounded
    || !REFERENCE_STATES.has(fighter.state)
  ) return;

  const host = runtimeHost(fighter);
  const model = host ? runtimeModel(host) : null;
  const left = model ? importedLeg(model, "l") : null;
  const right = model ? importedLeg(model, "r") : null;
  if (!model || !left || !right) return;

  model.updateMatrixWorld(true);
  state.groundLeftPosition.copy(left.foot.getWorldPosition(new THREE.Vector3()));
  state.groundRightPosition.copy(right.foot.getWorldPosition(new THREE.Vector3()));
  state.groundLeftRotation.copy(left.foot.getWorldQuaternion(new THREE.Quaternion()));
  state.groundRightRotation.copy(right.foot.getWorldQuaternion(new THREE.Quaternion()));
  state.groundRuntimePosition.copy(fighter.position);
  state.groundReady = true;
  root.userData.tpsKickSpamGroundReferenceReady = 1;
}

function clampPlanarOffset(offset: THREE.Vector3, maximum: number): THREE.Vector3 {
  const planar = new THREE.Vector3(offset.x, 0, offset.z);
  const length = planar.length();
  if (length > maximum && length > 1e-8) planar.multiplyScalar(maximum / length);
  return planar;
}

function applyKickSpamGroundBridge(fighter: FighterRuntime, state: KickSpamGroundState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const moveId = move?.id ?? "";
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || !fighter.grounded
    || !move
    || !GROUND_KICK_IDS.has(moveId)
  ) {
    captureGroundReference(fighter, state);
    clearDiagnostics(fighter);
    return;
  }

  const host = runtimeHost(fighter);
  const model = host ? runtimeModel(host) : null;
  const strikeSuffix: LegSuffix = move.visualContact === "LEFT_FOOT" ? "l" : "r";
  const supportSuffix: LegSuffix = strikeSuffix === "l" ? "r" : "l";
  const left = model ? importedLeg(model, "l") : null;
  const right = model ? importedLeg(model, "r") : null;
  const support = supportSuffix === "l" ? left : right;
  const strike = strikeSuffix === "l" ? left : right;
  if (!host || !model || !left || !right || !support || !strike || !state.groundReady) {
    clearDiagnostics(fighter);
    return;
  }

  model.updateMatrixWorld(true);
  const scale = Math.max(0.5, root.scale.x);
  const runtimeDelta = fighter.position.clone().sub(state.groundRuntimePosition);
  runtimeDelta.y = 0;
  const leftAnchor = state.groundLeftPosition.clone().add(runtimeDelta);
  const rightAnchor = state.groundRightPosition.clone().add(runtimeDelta);
  const leftPosition = left.foot.getWorldPosition(new THREE.Vector3());
  const rightPosition = right.foot.getWorldPosition(new THREE.Vector3());

  // The normal support-foot presentation already handles ordinary single kicks.
  // This bridge only intervenes when a rapid restart/crossfade has lifted BOTH
  // boots away from their last trustworthy grounded stance at the same time.
  const liftThreshold = 0.105 * scale;
  const leftLift = leftPosition.y - leftAnchor.y;
  const rightLift = rightPosition.y - rightAnchor.y;
  if (leftLift <= liftThreshold || rightLift <= liftThreshold) {
    clearDiagnostics(fighter);
    return;
  }

  const supportAnchor = supportSuffix === "l" ? leftAnchor : rightAnchor;
  const supportAnchorRotation = (
    supportSuffix === "l" ? state.groundLeftRotation : state.groundRightRotation
  ).clone();
  const supportPosition = support.foot.getWorldPosition(new THREE.Vector3());
  const supportRotation = support.foot.getWorldQuaternion(new THREE.Quaternion());
  const strikePosition = strike.foot.getWorldPosition(new THREE.Vector3());
  const strikeRotation = strike.foot.getWorldQuaternion(new THREE.Quaternion());

  snapshotLeg(state.support, support);
  snapshotLeg(state.strike, strike);

  const planarOffset = clampPlanarOffset(
    supportPosition.clone().sub(supportAnchor),
    0.055 * scale,
  );
  const target = supportAnchor.clone().add(planarOffset);
  target.y = supportAnchor.y;

  solveLeg(support, supportSuffix, target, scale);
  setWorldQuaternion(
    support.foot,
    limitedRotation(supportAnchorRotation, supportRotation, 22),
  );
  model.updateMatrixWorld(true);

  // If the transition clip has lifted the pelvis so far that the support leg
  // cannot reach the stored floor anchor, lower only the imported visible body
  // by the residual. Restore the striking boot to its pre-shift world target so
  // combat reach and the authored kick line do not change.
  const supportAfterSolve = support.foot.getWorldPosition(new THREE.Vector3());
  const residual = target.clone().sub(supportAfterSolve);
  const planarResidual = clampPlanarOffset(residual, 0.045 * scale);
  residual.x = planarResidual.x;
  residual.z = planarResidual.z;
  residual.y = THREE.MathUtils.clamp(residual.y, -0.42 * scale, 0.08 * scale);

  state.host = host;
  state.hostDelta.copy(hostLocalDeltaForWorldDelta(host, residual));
  host.position.add(state.hostDelta);
  root.updateMatrixWorld(true);

  solveLeg(strike, strikeSuffix, strikePosition, scale);
  setWorldQuaternion(strike.foot, strikeRotation);
  model.updateMatrixWorld(true);

  const finalLeft = left.foot.getWorldPosition(new THREE.Vector3());
  const finalRight = right.foot.getWorldPosition(new THREE.Vector3());
  const finalSupport = support.foot.getWorldPosition(new THREE.Vector3());
  const data = root.userData;
  data.tpsKickSpamGroundBridge = 1;
  data.tpsKickSpamGroundBridgeMove = moveId;
  data.tpsKickSpamGroundBridgeSide = supportSuffix.toUpperCase();
  data.tpsKickSpamGroundBridgeSupportHeight = finalSupport.y;
  data.tpsKickSpamGroundBridgeMinFootHeight = Math.min(finalLeft.y, finalRight.y);
  data.tpsKickSpamGroundBridgeBodyDrop = Math.max(0, -residual.y);
}

export function installTpsKickSpamGroundBridgePresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsKickSpamGroundBridge(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    restorePrevious(state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyKickSpamGroundBridge(fighter, state);
  };
}
