import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { solveCombatLimb } from "./combat-motion-authoring";
import { PresentationAnimationController } from "./presentation-animation";

type SupportSuffix = "l" | "r";

type ImportedLeg = {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
};

type SupportProfile = {
  maxPlanarDrift: number;
  maxPivotDegrees: number;
  verticalLock: number;
  maxBodyCompensation: number;
};

type SupportFootState = {
  moveId: string;
  suffix: SupportSuffix | null;
  anchorPosition: THREE.Vector3;
  anchorRotation: THREE.Quaternion;
  leg: ImportedLeg | null;
  thighQ: THREE.Quaternion;
  calfQ: THREE.Quaternion;
  footQ: THREE.Quaternion;
  host: THREE.Object3D | null;
  hostDelta: THREE.Vector3;
};

const PROFILES: Readonly<Record<string, SupportProfile>> = {
  kick: { maxPlanarDrift: 0.035, maxPivotDegrees: 18, verticalLock: 0.84, maxBodyCompensation: 0.040 },
  lowKick: { maxPlanarDrift: 0.040, maxPivotDegrees: 24, verticalLock: 0.78, maxBodyCompensation: 0.045 },
  risingKick: { maxPlanarDrift: 0.030, maxPivotDegrees: 16, verticalLock: 0.88, maxBodyCompensation: 0.035 },
};

const states = new WeakMap<FighterRuntime, SupportFootState>();
let installed = false;

function ensureState(fighter: FighterRuntime): SupportFootState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    moveId: "",
    suffix: null,
    anchorPosition: new THREE.Vector3(),
    anchorRotation: new THREE.Quaternion(),
    leg: null,
    thighQ: new THREE.Quaternion(),
    calfQ: new THREE.Quaternion(),
    footQ: new THREE.Quaternion(),
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

function importedLeg(model: THREE.Object3D, suffix: SupportSuffix): ImportedLeg | null {
  const thigh = model.getObjectByName(`thigh_${suffix}`);
  const calf = model.getObjectByName(`calf_${suffix}`);
  const foot = model.getObjectByName(`foot_${suffix}`);
  return thigh && calf && foot ? { thigh, calf, foot } : null;
}

function setWorldQuaternion(object: THREE.Object3D, desiredWorld: THREE.Quaternion): void {
  if (!object.parent) {
    object.quaternion.copy(desiredWorld).normalize();
    return;
  }
  const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
  object.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
}

function restorePreviousSupport(state: SupportFootState): void {
  if (state.host) {
    state.host.position.sub(state.hostDelta);
    state.host = null;
    state.hostDelta.set(0, 0, 0);
  }
  if (state.leg) {
    state.leg.thigh.quaternion.copy(state.thighQ);
    state.leg.calf.quaternion.copy(state.calfQ);
    state.leg.foot.quaternion.copy(state.footQ);
    state.leg = null;
  }
}

function clearSupportState(fighter: FighterRuntime, state: SupportFootState): void {
  state.moveId = "";
  state.suffix = null;
  state.leg = null;
  state.host = null;
  state.hostDelta.set(0, 0, 0);
  const data = fighter.visual.root.userData;
  data.tpsKickSupportFoot = 0;
  data.tpsKickSupportFootMove = "NONE";
  data.tpsKickSupportFootRawDrift = 0;
  data.tpsKickSupportFootDrift = 0;
  data.tpsKickSupportFootRawAngle = 0;
  data.tpsKickSupportFootAngle = 0;
  data.tpsKickSupportFootBodyCompensation = 0;
  data.tpsKickSupportFootStrikeError = 0;
}

function supportEnvelope(fighter: FighterRuntime): number {
  const move = fighter.currentMove;
  if (!move) return 0;
  const total = move.startup + move.active + move.recovery;
  const activeEnd = move.startup + move.active;
  const settleEnd = Math.max(2, move.startup - 3);
  const releaseStart = activeEnd + 2;
  const releaseEnd = Math.max(releaseStart + 2, total - 2);
  const enter = THREE.MathUtils.smoothstep(fighter.moveTick, 0, settleEnd);
  const exit = 1 - THREE.MathUtils.smoothstep(fighter.moveTick, releaseStart, releaseEnd);
  return THREE.MathUtils.clamp(enter * exit, 0, 1);
}

function supportSuffixFor(fighter: FighterRuntime): SupportSuffix | null {
  const contact = fighter.currentMove?.visualContact;
  if (contact === "LEFT_FOOT") return "r";
  if (contact === "RIGHT_FOOT") return "l";
  return null;
}

function strikeSuffixFor(fighter: FighterRuntime): SupportSuffix | null {
  const contact = fighter.currentMove?.visualContact;
  if (contact === "LEFT_FOOT") return "l";
  if (contact === "RIGHT_FOOT") return "r";
  return null;
}

function clampPlanarOffset(offset: THREE.Vector3, maximum: number): THREE.Vector3 {
  const planar = new THREE.Vector3(offset.x, 0, offset.z);
  const length = planar.length();
  if (length > maximum && length > 1e-8) planar.multiplyScalar(maximum / length);
  return planar;
}

function limitedFootRotation(
  anchor: THREE.Quaternion,
  current: THREE.Quaternion,
  maxDegrees: number,
): THREE.Quaternion {
  const angle = anchor.angleTo(current);
  const maximum = THREE.MathUtils.degToRad(maxDegrees);
  if (angle <= maximum || angle <= 1e-6) return current.clone();
  return anchor.clone().slerp(current, maximum / angle).normalize();
}

function solveLegToWorldTarget(
  leg: ImportedLeg,
  suffix: SupportSuffix,
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

function applySupportFootPlant(fighter: FighterRuntime, state: SupportFootState): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const moveId = move?.id ?? "";
  const profile = PROFILES[moveId];
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || !move
    || !profile
  ) {
    clearSupportState(fighter, state);
    return;
  }

  const host = runtimeHost(fighter);
  const model = host ? runtimeModel(host) : null;
  const supportSuffix = supportSuffixFor(fighter);
  const strikeSuffix = strikeSuffixFor(fighter);
  const supportLeg = model && supportSuffix ? importedLeg(model, supportSuffix) : null;
  const strikeLeg = model && strikeSuffix ? importedLeg(model, strikeSuffix) : null;
  if (!host || !model || !supportSuffix || !strikeSuffix || !supportLeg || !strikeLeg) {
    clearSupportState(fighter, state);
    return;
  }

  model.updateMatrixWorld(true);
  const currentPosition = supportLeg.foot.getWorldPosition(new THREE.Vector3());
  const currentRotation = supportLeg.foot.getWorldQuaternion(new THREE.Quaternion());

  // The first rendered tick of a grounded kick becomes the plant reference.
  // This happens after the authored clip has been sampled, so the anchor is the
  // actual in-game stance foot rather than a guessed floor coordinate.
  if (state.moveId !== moveId || state.suffix !== supportSuffix) {
    state.moveId = moveId;
    state.suffix = supportSuffix;
    state.anchorPosition.copy(currentPosition);
    state.anchorRotation.copy(currentRotation);
  }

  const factor = supportEnvelope(fighter);
  if (factor <= 1e-4) {
    const data = root.userData;
    data.tpsKickSupportFoot = 0;
    data.tpsKickSupportFootMove = moveId;
    data.tpsKickSupportFootRawDrift = currentPosition.distanceTo(state.anchorPosition);
    data.tpsKickSupportFootDrift = data.tpsKickSupportFootRawDrift;
    data.tpsKickSupportFootRawAngle = THREE.MathUtils.radToDeg(state.anchorRotation.angleTo(currentRotation));
    data.tpsKickSupportFootAngle = data.tpsKickSupportFootRawAngle;
    data.tpsKickSupportFootBodyCompensation = 0;
    data.tpsKickSupportFootStrikeError = 0;
    return;
  }

  state.leg = supportLeg;
  state.thighQ.copy(supportLeg.thigh.quaternion);
  state.calfQ.copy(supportLeg.calf.quaternion);
  state.footQ.copy(supportLeg.foot.quaternion);

  const scale = Math.max(0.5, root.scale.x);
  const rawOffset = currentPosition.clone().sub(state.anchorPosition);
  const allowedPlanar = clampPlanarOffset(rawOffset, profile.maxPlanarDrift * scale);
  const target = state.anchorPosition.clone().add(allowedPlanar);
  target.y = THREE.MathUtils.lerp(
    currentPosition.y,
    state.anchorPosition.y,
    profile.verticalLock * factor,
  );

  const solvedTarget = currentPosition.clone().lerp(target, factor);
  solveLegToWorldTarget(supportLeg, supportSuffix, solvedTarget, scale);

  // Permit a controlled pivot around the planted foot, but cap the combined
  // ankle yaw/roll excursion so the sole cannot corkscrew onto its edge.
  const limitedRotation = limitedFootRotation(
    state.anchorRotation,
    currentRotation,
    profile.maxPivotDegrees,
  );
  const finalRotation = currentRotation.clone().slerp(limitedRotation, factor).normalize();
  setWorldQuaternion(supportLeg.foot, finalRotation);
  model.updateMatrixWorld(true);

  // Some authored kicks move the pelvis far enough that the support leg alone
  // cannot reach the plant anchor without over-straightening. Move the visible
  // body a few centimetres back over the planted foot, then re-solve the strike
  // leg to the exact pre-compensation boot position. This is presentation-only:
  // FighterRuntime.position, hitboxes and combat reach remain untouched.
  const strikePositionBeforeBodyShift = strikeLeg.foot.getWorldPosition(new THREE.Vector3());
  const strikeRotationBeforeBodyShift = strikeLeg.foot.getWorldQuaternion(new THREE.Quaternion());
  const supportAfterLegSolve = supportLeg.foot.getWorldPosition(new THREE.Vector3());
  const residual = target.clone().sub(supportAfterLegSolve);
  residual.y = 0;
  const maximumCompensation = profile.maxBodyCompensation * scale * factor;
  if (residual.length() > maximumCompensation && residual.length() > 1e-8) {
    residual.multiplyScalar(maximumCompensation / residual.length());
  }

  state.host = host;
  state.hostDelta.copy(hostLocalDeltaForWorldDelta(host, residual));
  host.position.add(state.hostDelta);
  root.updateMatrixWorld(true);

  solveLegToWorldTarget(strikeLeg, strikeSuffix, strikePositionBeforeBodyShift, scale);
  setWorldQuaternion(strikeLeg.foot, strikeRotationBeforeBodyShift);
  model.updateMatrixWorld(true);

  const finalPosition = supportLeg.foot.getWorldPosition(new THREE.Vector3());
  const finalWorldRotation = supportLeg.foot.getWorldQuaternion(new THREE.Quaternion());
  const finalStrikePosition = strikeLeg.foot.getWorldPosition(new THREE.Vector3());
  const data = root.userData;
  data.tpsKickSupportFoot = factor;
  data.tpsKickSupportFootMove = moveId;
  data.tpsKickSupportFootSide = supportSuffix.toUpperCase();
  data.tpsKickSupportFootRawDrift = currentPosition.distanceTo(state.anchorPosition);
  data.tpsKickSupportFootDrift = finalPosition.distanceTo(state.anchorPosition);
  data.tpsKickSupportFootRawPlanarDrift = Math.hypot(rawOffset.x, rawOffset.z);
  data.tpsKickSupportFootPlanarDrift = Math.hypot(
    finalPosition.x - state.anchorPosition.x,
    finalPosition.z - state.anchorPosition.z,
  );
  data.tpsKickSupportFootRawAngle = THREE.MathUtils.radToDeg(state.anchorRotation.angleTo(currentRotation));
  data.tpsKickSupportFootAngle = THREE.MathUtils.radToDeg(state.anchorRotation.angleTo(finalWorldRotation));
  data.tpsKickSupportFootAnchor = state.anchorPosition.toArray();
  data.tpsKickSupportFootBodyCompensation = residual.length();
  data.tpsKickSupportFootStrikeError = finalStrikePosition.distanceTo(strikePositionBeforeBodyShift);
}

export function installTpsKickSupportFootPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsKickSupportFoot(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    // Restore the exact authored local pose and body offset before the next mixer
    // sample so this late presentation correction can never leak into simulation
    // or become part of the imported transition pose.
    restorePreviousSupport(state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applySupportFootPlant(fighter, state);
  };
}
