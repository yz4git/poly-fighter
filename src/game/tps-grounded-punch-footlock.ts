import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { solveCombatLimb } from "./combat-motion-authoring";
import { PresentationAnimationController } from "./presentation-animation";
import { tpsClosePunchFamily } from "./tps-close-punch-lane";

export const TPS_GROUNDED_PUNCH_FOOTLOCK_VERSION = "CONTACT_FOOT_IK_V2";

/**
 * The close-neutral/punch presentation lanes translate the imported model,
 * including its boots, sideways. Keep the upper-body punch and screen lane,
 * but let the planted ankles resist that drift with bounded two-bone IK.
 * Only the last idle/guard feet seed an anchor: never freeze a moving kick,
 * sidestep, combo follow-up or ungrounded fighter.
 */
type FootSnapshot = { l: THREE.Vector3; r: THREE.Vector3 };
type FootlockState = {
  lastState: string;
  lastMove: string | null;
  idleFeet: FootSnapshot | null;
  currentFeet: FootSnapshot | null;
  startPosition: THREE.Vector3 | null;
  cachedRig: ReturnType<typeof importedRig>;
};

const states = new WeakMap<FighterRuntime, FootlockState>();
let installed = false;
const MAX_ANKLE_CORRECTION = 0.16; // world units, not character-local coordinates

/**
 * The jab's lead (left) boot is the only outlier in real 60 Hz WebGL traces:
 * 0.127 world units of remaining neutral-to-contact glide vs 0.056 for its
 * support boot. Its original 0.16 * 0.76 reach limit was saturated. Increase
 * ONLY that leg's target envelope slightly. Keeping the support leg and
 * other punches on V1 limits avoids changing their proven knee silhouettes.
 */
export function tpsPunchFootlockCorrectionCap(family: string, side: "l" | "r"): number {
  return family === "jab" && side === "l" ? 0.20 : MAX_ANKLE_CORRECTION;
}

export function tpsPunchFootlockLegWeight(family: string, side: "l" | "r"): number {
  if (family === "jab") return side === "l" ? 0.90 : 1;
  if (family === "straight") return side === "l" ? 1 : 0.76;
  return side === "r" ? 1 : 0.72;
}
const ELIGIBLE_STATES = new Set(["IDLE", "GUARD", "CROUCH"]);

function smooth01(value: number): number {
  const u = THREE.MathUtils.clamp(value, 0, 1);
  return u * u * (3 - 2 * u);
}

/** Keep both boots on the floor through punch contact, then release in recovery. */
export function tpsGroundedPunchFootlockWeight(
  moveFamily: string | null,
  moveTick: number,
  startup: number,
  active: number,
  recovery: number,
  originatedFromNeutral: boolean,
): number {
  if (!originatedFromNeutral || !moveFamily || !["jab", "straight", "bodyBlow"].includes(moveFamily)
      || !Number.isFinite(moveTick)) return 0;
  const activeEnd = Math.max(0, startup + active);
  if (moveTick <= activeEnd) return 1;
  const releaseFrames = Math.max(4, Math.min(9, recovery));
  return 1 - smooth01((moveTick - activeEnd) / releaseFrames);
}

function importedRig(fighter: FighterRuntime) {
  const host = fighter.visual.root.children.find((child) =>
    child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"));
  if (!host) return null;
  const model = host.children.find((child) => child.type === "Group" || child.children.length > 0);
  if (!model) return null;
  const get = (name: string) => model.getObjectByName(name);
  const legs = {
    l: { thigh: get("thigh_l"), knee: get("calf_l"), foot: get("foot_l") },
    r: { thigh: get("thigh_r"), knee: get("calf_r"), foot: get("foot_r") },
  };
  if (Object.values(legs).some(({ thigh, knee, foot }) => !thigh || !knee || !foot)) return null;
  return { host, model, legs };
}

function snapshotFeet(rig: NonNullable<ReturnType<typeof importedRig>>): FootSnapshot {
  rig.model.updateMatrixWorld(true);
  return {
    l: rig.legs.l.foot!.getWorldPosition(new THREE.Vector3()),
    r: rig.legs.r.foot!.getWorldPosition(new THREE.Vector3()),
  };
}

function setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion): void {
  const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(world)).normalize();
}

function applyFootlock(fighter: FighterRuntime, state: FootlockState): void {
  const data = fighter.visual.root.userData;
  data.tpsPunchFootlockVersion = TPS_GROUNDED_PUNCH_FOOTLOCK_VERSION;
  data.tpsPunchFootlockWeight = 0;
  data.tpsPunchFootlockLeftImprovement = 0;
  data.tpsPunchFootlockRightImprovement = 0;
  data.tpsPunchFootlockActive = false;

  const move = fighter.currentMove;
  const base = tpsClosePunchFamily(move);
  const neutral = ELIGIBLE_STATES.has(fighter.state) && !move && fighter.grounded
    && fighter.velocity.lengthSq() < 0.04;
  const ready = data.combatTps && data.quaterniusModelState === "ready";
  if (!ready) return;
  // Skin and rig remain stable across frames; avoid six scene-tree bone lookups
  // on every 60 Hz iPhone frame, rebuilding only after a model-host replacement.
  const rig = state.cachedRig?.host.parent === fighter.visual.root
    ? state.cachedRig
    : importedRig(fighter);
  state.cachedRig = rig;
  if (!rig) return;

  const feet = snapshotFeet(rig);
  if (neutral && data.tpsCloseNeutralLaneMode === "NEUTRAL"
      && Number(data.tpsCloseNeutralLane ?? 0) >= 0.5) {
    state.idleFeet = { l: feet.l.clone(), r: feet.r.clone() };
  }

  // The saved anchor is consumed only when the FIRST attack follows a real
  // stable close-neutral pose. Combo chains do not get artificial foot locks.
  const newAttack = fighter.state === "ATTACK"
    && (state.lastState !== "ATTACK" || state.lastMove !== move?.id);
  if (newAttack) {
    state.currentFeet = state.lastState === "IDLE" || state.lastState === "GUARD"
      || state.lastState === "CROUCH"
      ? state.idleFeet
      : null;
    state.startPosition = state.currentFeet ? fighter.position.clone() : null;
  } else if (fighter.state !== "ATTACK") {
    state.currentFeet = null;
    state.startPosition = null;
  }

  const anchors = state.currentFeet;
  const weight = fighter.state === "ATTACK" && fighter.grounded
    ? tpsGroundedPunchFootlockWeight(
        base, fighter.moveTick, move?.startup ?? 0, move?.active ?? 0, move?.recovery ?? 0,
        anchors !== null,
      )
    : 0;
  if (!anchors || !state.startPosition || weight <= 0 || !base) return;

  // Anchors track the authoritative gameplay translation, not the extra
  // cosmetic model lane. A forward-moving punch still travels with its actor.
  const travel = fighter.position.clone().sub(state.startPosition);
  travel.y = 0;
  let total = 0;
  for (const side of ["l", "r"] as const) {
    const chain = rig.legs[side];
    const foot = chain.foot!;
    const current = foot.getWorldPosition(new THREE.Vector3());
    const anchor = anchors[side].clone().add(travel);
    const error = anchor.clone().sub(current);
    error.y = 0; // Do not change authored foot height or ankle vertical pose.
    const requested = error.length();
    if (requested < 1e-4) continue;
    // Keep the support leg firmer; allow the stepping leg some authored motion.
    const sideWeight = tpsPunchFootlockLegWeight(base, side);
    const maxCorrection = tpsPunchFootlockCorrectionCap(base, side);
    const amount = Math.min(requested, maxCorrection) * weight * sideWeight;
    const target = current.addScaledVector(error, amount / requested);
    const preservedFootRotation = foot.getWorldQuaternion(new THREE.Quaternion());
    // Preserve the current knee's authored bend direction as the pole. A
    // flat-foot target alone is insufficient when the ankle is approaching
    // full extension; the knee should face the original anatomical direction.
    const pole = chain.knee!.getWorldPosition(new THREE.Vector3());
    solveCombatLimb(chain.thigh!, chain.knee!, foot, target, pole);
    setWorldQuaternion(foot, preservedFootRotation);
    rig.model.updateMatrixWorld(true);
    const newFoot = foot.getWorldPosition(new THREE.Vector3());
    const improvement = requested - newFoot.distanceTo(anchor);
    data[side === "l" ? "tpsPunchFootlockLeftImprovement" : "tpsPunchFootlockRightImprovement"] = improvement;
    total += Math.max(0, improvement);
  }
  data.tpsPunchFootlockWeight = weight;
  data.tpsPunchFootlockActive = total > 1e-5;
}

export function installTpsGroundedPunchFootlockPresentation(): void {
  if (installed) return;
  installed = true;
  // Install as the outermost pose wrapper: authored animation, neutral lane,
  // contact lane and impact layers must all run before final ankle IK.
  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithGroundedPunchFootlock(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = states.get(fighter) ?? {
      lastState: "", lastMove: null, idleFeet: null, currentFeet: null,
      startPosition: null, cachedRig: null,
    };
    states.set(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyFootlock(fighter, state);
    state.lastState = fighter.state;
    state.lastMove = fighter.currentMove?.id ?? null;
  };
}
