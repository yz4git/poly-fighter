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
  maxBodyCompensation: number;
  maxBodyDrop: number;
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
  groundReady: boolean;
  groundLeftPosition: THREE.Vector3;
  groundRightPosition: THREE.Vector3;
  groundLeftRotation: THREE.Quaternion;
  groundRightRotation: THREE.Quaternion;
  groundRuntimePosition: THREE.Vector3;
};

const PROFILES: Readonly<Record<string, SupportProfile>> = {
  kick: { maxPlanarDrift: 0.035, maxPivotDegrees: 18, maxBodyCompensation: 0.040, maxBodyDrop: 0.34 },
  lowKick: { maxPlanarDrift: 0.040, maxPivotDegrees: 24, maxBodyCompensation: 0.045, maxBodyDrop: 0.38 },
  risingKick: { maxPlanarDrift: 0.030, maxPivotDegrees: 16, maxBodyCompensation: 0.035, maxBodyDrop: 0.40 },
};

const REFERENCE_STATES = new Set(["IDLE", "WALK", "CROUCH", "SIDESTEP", "GUARD"]);
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
  data.tpsKickSupportFootBodyDrop = 0;
  data.tpsKickSupportFootStrikeError = 0;
}

function captureGroundReference(fighter: FighterRuntime, state: SupportFootState): void {
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
  root.userData.tpsKickSupportFootGroundReferenceReady = 1;
}

function supportEnvelope(fighter: FighterRuntime): number {
  // Grounded kicks need a continuous plant from the first startup frame through
  // the final recovery frame. A previous fade-in/fade-out was visually harmless
  // for isolated moves, but rapid TPS combo links can replace one kick with the
  // next before a neutral frame is rendered, exposing a one-to-several-frame gap
  // where both authored boots are airborne. The plant now owns the whole move.
  return fighter.currentMove ? 1 : 0;
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
    || !fighter.grounded
    || !move
    || !profile
  ) {
    captureGroundReference(fighter, state);
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

  // Never take a new kick's first blended frame as its floor reference. During a
  // rapid combo link that first frame can already have both feet in the air. Use
  // the latest trustworthy neutral/walk/guard stance instead, and carry that
  // reference across links even when no neutral frame is rendered between moves.
  if (state.moveId !== moveId || state.suffix !== supportSuffix) {
    state.moveId = moveId;
    state.suffix = supportSuffix;
    if (state.groundReady) {
      const runtimeDelta = fighter.position.clone().sub(state.groundRuntimePosition);
      runtimeDelta.y = 0;
      const groundPosition = supportSuffix === "l"
        ? state.groundLeftPosition
        : state.groundRightPosition;
      const groundRotation = supportSuffix === "l"
        ? state.groundLeftRotation
        : state.groundRightRotation;
      state.anchorPosition.copy(groundPosition).add(runtimeDelta);
      state.anchorRotation.copy(groundRotation);
    } else {
      state.anchorPosition.copy(currentPosition);
      state.anchorRotation.copy(currentRotation);
    }
  }

  const factor = supportEnvelope(fighter);
  state.leg = supportLeg;
  state.thighQ.copy(supportLeg.thigh.quaternion);
  state.calfQ.copy(supportLeg.calf.quaternion);
  state.footQ.copy(supportLeg.foot.quaternion);

  const scale = Math.max(0.5, root.scale.x);
  const rawOffset = currentPosition.clone().sub(state.anchorPosition);
  const allowedPlanar = clampPlanarOffset(rawOffset, profile.maxPlanarDrift * scale);
  const target = state.anchorPosition.clone().add(allowedPlanar);
  target.y = state.anchorPosition.y;

  const solvedTarget = currentPosition.clone().lerp(target, factor);
  solveLegToWorldTarget(supportLeg, supportSuffix, solvedTarget, scale);

  const limitedRotation = limitedFootRotation(
    state.anchorRotation,
    currentRotation,
    profile.maxPivotDegrees,
  );
  const finalRotation = currentRotation.clone().slerp(limitedRotation, factor).normalize();
  setWorldQuaternion(supportLeg.foot, finalRotation);
  model.updateMatrixWorld(true);

  // If the linked source clip leaves the pelvis too high for the support leg to
  // reach the floor, compensate on the imported presentation host only. Planar
  // compensation stays tiny, while vertical drop may be larger because it is
  // exactly what removes the visible two-feet-airborne pop. Re-solve the strike
  // boot afterward so gameplay reach and the authored contact line are unchanged.
  const strikePositionBeforeBodyShift = strikeLeg.foot.getWorldPosition(new THREE.Vector3());
  const strikeRotationBeforeBodyShift = strikeLeg.foot.getWorldQuaternion(new THREE.Quaternion());
  const supportAfterLegSolve = supportLeg.foot.getWorldPosition(new THREE.Vector3());
  const residual = target.clone().sub(supportAfterLegSolve);
  const planarResidual = clampPlanarOffset(
    residual,
    profile.maxBodyCompensation * scale * factor,
  );
  residual.x = planarResidual.x;
  residual.z = planarResidual.z;
  residual.y = THREE.MathUtils.clamp(
    residual.y,
    -profile.maxBodyDrop * scale * factor,
    0.08 * scale * factor,
  );

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
  data.tpsKickSupportFootGroundReferenceReady = state.groundReady ? 1 : 0;
  data.tpsKickSupportFootBodyCompensation = residual.length();
  data.tpsKickSupportFootBodyDrop = Math.max(0, -residual.y);
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
    restorePreviousSupport(state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applySupportFootPlant(fighter, state);
  };
}
