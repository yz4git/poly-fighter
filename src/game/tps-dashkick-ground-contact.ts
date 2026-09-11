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

type DashGroundState = {
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
const states = new WeakMap<FighterRuntime, DashGroundState>();
let installed = false;

function newLegSnapshot(): LegSnapshot {
  return {
    leg: null,
    thighQ: new THREE.Quaternion(),
    calfQ: new THREE.Quaternion(),
    footQ: new THREE.Quaternion(),
  };
}

function ensureState(fighter: FighterRuntime): DashGroundState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    support: newLegSnapshot(),
    strike: newLegSnapshot(),
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

function restorePrevious(state: DashGroundState): void {
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
  data.tpsDashKickGroundContact = 0;
  data.tpsDashKickSupportHeight = 0;
  data.tpsDashKickSupportTargetHeight = 0;
  data.tpsDashKickBodyDrop = 0;
  data.tpsDashKickSupportDrift = 0;
  data.tpsDashKickSupportAngle = 0;
  data.tpsDashKickStrikeError = 0;
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
    .add(new THREE.Vector3(0, 0.06 * scale, 0))
    .addScaledVector(bend, 0.03 * scale);
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

function captureGroundReference(fighter: FighterRuntime, state: DashGroundState): void {
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
}

function dashEnvelope(fighter: FighterRuntime): number {
  const move = fighter.currentMove;
  if (!move) return 0;
  const total = move.startup + move.active + move.recovery;
  const activeEnd = move.startup + move.active;
  const releaseStart = activeEnd + 5;
  const releaseEnd = Math.max(releaseStart + 2, total - 2);
  return THREE.MathUtils.clamp(
    1 - THREE.MathUtils.smoothstep(fighter.moveTick, releaseStart, releaseEnd),
    0,
    1,
  );
}

function clampPlanarOffset(offset: THREE.Vector3, maximum: number): THREE.Vector3 {
  const planar = new THREE.Vector3(offset.x, 0, offset.z);
  const length = planar.length();
  if (length > maximum && length > 1e-8) planar.multiplyScalar(maximum / length);
  return planar;
}

function applyDashKickGroundContact(fighter: FighterRuntime, state: DashGroundState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || move?.id !== "dashKick"
  ) {
    captureGroundReference(fighter, state);
    clearDiagnostics(fighter);
    return;
  }

  const host = runtimeHost(fighter);
  const model = host ? runtimeModel(host) : null;
  const strikeSuffix: LegSuffix = move.visualContact === "LEFT_FOOT" ? "l" : "r";
  const supportSuffix: LegSuffix = strikeSuffix === "l" ? "r" : "l";
  const supportLeg = model ? importedLeg(model, supportSuffix) : null;
  const strikeLeg = model ? importedLeg(model, strikeSuffix) : null;
  if (!host || !model || !supportLeg || !strikeLeg) return;

  model.updateMatrixWorld(true);
  const scale = Math.max(0.5, root.scale.x);
  const currentSupport = supportLeg.foot.getWorldPosition(new THREE.Vector3());
  const currentSupportRotation = supportLeg.foot.getWorldQuaternion(new THREE.Quaternion());
  const currentStrike = strikeLeg.foot.getWorldPosition(new THREE.Vector3());
  const currentStrikeRotation = strikeLeg.foot.getWorldQuaternion(new THREE.Quaternion());

  const runtimeDelta = fighter.position.clone().sub(state.groundRuntimePosition);
  runtimeDelta.y = 0;
  const anchorPosition = (
    supportSuffix === "l" ? state.groundLeftPosition : state.groundRightPosition
  ).clone().add(runtimeDelta);
  const anchorRotation = (
    supportSuffix === "l" ? state.groundLeftRotation : state.groundRightRotation
  ).clone();

  // A normal match always gives us at least one neutral frame before a move.
  // Keep a safe floor-height fallback for direct debug/audit jumps so Dash Kick
  // can never regress to a fully airborne pose just because the reference was
  // not sampled yet.
  if (!state.groundReady) {
    anchorPosition.copy(currentSupport);
    anchorPosition.y = Math.min(currentSupport.y, 0.31 * scale);
    anchorRotation.copy(currentSupportRotation);
  }

  const factor = dashEnvelope(fighter);
  if (factor <= 1e-4) {
    clearDiagnostics(fighter);
    return;
  }

  snapshotLeg(state.support, supportLeg);
  snapshotLeg(state.strike, strikeLeg);

  const rawOffset = currentSupport.clone().sub(anchorPosition);
  const allowedPlanar = clampPlanarOffset(rawOffset, 0.04 * scale);
  const groundedTarget = anchorPosition.clone().add(allowedPlanar);
  groundedTarget.y = anchorPosition.y;
  const target = currentSupport.clone().lerp(groundedTarget, factor);

  solveLeg(supportLeg, supportSuffix, target, scale);
  setWorldQuaternion(
    supportLeg.foot,
    currentSupportRotation.clone().slerp(limitedRotation(anchorRotation, currentSupportRotation, 18), factor),
  );
  model.updateMatrixWorld(true);

  // The authored Dash Kick jumps the entire body, so leg IK alone cannot reach
  // the floor. Translate only the imported visible model by the remaining gap.
  // Then restore the striking boot to its pre-shift world target, turning the
  // old two-feet-airborne jump into a planted, driving side kick without touching
  // FighterRuntime.position, velocity, hitboxes, timing or gameplay reach.
  const supportAfterSolve = supportLeg.foot.getWorldPosition(new THREE.Vector3());
  const residual = target.clone().sub(supportAfterSolve);
  const planar = new THREE.Vector3(residual.x, 0, residual.z);
  const planarMaximum = 0.09 * scale;
  if (planar.length() > planarMaximum && planar.length() > 1e-8) {
    planar.multiplyScalar(planarMaximum / planar.length());
  }
  residual.x = planar.x;
  residual.z = planar.z;
  residual.y = THREE.MathUtils.clamp(residual.y, -1.05 * scale, 0.12 * scale);

  state.host = host;
  state.hostDelta.copy(hostLocalDeltaForWorldDelta(host, residual));
  host.position.add(state.hostDelta);
  root.updateMatrixWorld(true);

  solveLeg(strikeLeg, strikeSuffix, currentStrike, scale);
  setWorldQuaternion(strikeLeg.foot, currentStrikeRotation);
  model.updateMatrixWorld(true);

  const finalSupport = supportLeg.foot.getWorldPosition(new THREE.Vector3());
  const finalSupportRotation = supportLeg.foot.getWorldQuaternion(new THREE.Quaternion());
  const finalStrike = strikeLeg.foot.getWorldPosition(new THREE.Vector3());
  const data = root.userData;
  data.tpsDashKickGroundContact = factor;
  data.tpsDashKickSupportHeight = finalSupport.y;
  data.tpsDashKickSupportTargetHeight = anchorPosition.y;
  data.tpsDashKickBodyDrop = Math.max(0, -residual.y);
  data.tpsDashKickSupportDrift = Math.hypot(
    finalSupport.x - anchorPosition.x,
    finalSupport.z - anchorPosition.z,
  );
  data.tpsDashKickSupportAngle = THREE.MathUtils.radToDeg(anchorRotation.angleTo(finalSupportRotation));
  data.tpsDashKickStrikeError = finalStrike.distanceTo(currentStrike);
  data.tpsDashKickGroundReferenceReady = state.groundReady ? 1 : 0;
}

export function installTpsDashKickGroundContactPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsDashKickGroundContact(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    restorePrevious(state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyDashKickGroundContact(fighter, state);
  };
}
