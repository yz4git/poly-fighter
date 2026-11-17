import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";
import { tpsClosePunchFamily } from "./tps-close-punch-lane";

export const TPS_PUNCH_SILHOUETTE_VERSION = "AUTHORED_UPPER_BODY_ARC_V1";

type PunchFamily = "jab" | "straight" | "bodyBlow";
type PunchProfile = Readonly<{
  yaw: number; pitch: number; coil: number;
  strikePitch: number; coverPitch: number;
  strikeRoll: number; coverRoll: number;
}>;

const PROFILES: Readonly<Record<PunchFamily, PunchProfile>> = {
  // Deliberately not one generic punch: lead jab is compact and fast, rear
  // straight has more torso drive, and the body blow drops the shoulder line.
  jab:      { yaw: .056, pitch: -.012, coil: .018, strikePitch: -.018, coverPitch: -.022, strikeRoll: .020, coverRoll: .022 },
  straight: { yaw: .082, pitch: -.027, coil: .029, strikePitch: -.031, coverPitch: -.035, strikeRoll: .031, coverRoll: .032 },
  bodyBlow: { yaw: .066, pitch:  .041, coil: .025, strikePitch:  .026, coverPitch: -.030, strikeRoll: .025, coverRoll: .027 },
};

export type TpsPunchSilhouettePose = Readonly<{
  factor: number;
  spineYaw: number;
  spinePitch: number;
  strikePitch: number;
  coverPitch: number;
  strikeRoll: number;
  coverRoll: number;
}>;

const NEUTRAL: TpsPunchSilhouettePose = Object.freeze({
  factor: 0, spineYaw: 0, spinePitch: 0,
  strikePitch: 0, coverPitch: 0, strikeRoll: 0, coverRoll: 0,
});

function smooth(value: number): number {
  const u = THREE.MathUtils.clamp(value, 0, 1);
  return u * u * (3 - 2 * u);
}

/**
 * Render-only upper-body arc layered over the authored GLB. The first frame
 * stays at the outgoing pose, a short counter-rotation precedes contact, and
 * all accents release during the authored recovery. No root translation,
 * added reach, hitbox modifications, or global animation-clock changes.
 */
export function tpsPunchSilhouettePose(input: {
  family: string | null;
  tick: number;
  startup: number;
  active: number;
  recovery: number;
  contactSide: -1 | 1;
}): TpsPunchSilhouettePose {
  const { family, tick, startup, active, recovery, contactSide } = input;
  if (!family || !(family in PROFILES) || !Number.isFinite(tick) || tick < 0
      || !Number.isFinite(startup) || startup <= 0
      || !Number.isFinite(active) || active <= 0
      || !Number.isFinite(recovery) || recovery < 0) return NEUTRAL;
  const profile = PROFILES[family as PunchFamily];
  const ramp = smooth(tick / startup);
  const activeEnd = startup + active;
  const releaseFrames = Math.max(4, Math.min(9, recovery));
  const release = 1 - smooth((tick - activeEnd) / releaseFrames);
  const factor = ramp * release;
  if (factor <= 1e-6) return NEUTRAL;
  // The counter-rotation is zero at contact, preventing a tick-zero pop.
  const coil = tick < startup
    ? Math.sin(Math.PI * THREE.MathUtils.clamp(tick / startup, 0, 1)) * profile.coil * release
    : 0;
  const travel = tick >= startup && tick < activeEnd
    ? Math.sin(Math.PI * THREE.MathUtils.clamp((tick - startup) / active, 0, 1)) * .009
    : 0;
  return {
    factor,
    spineYaw: contactSide * (profile.yaw * factor - coil + travel),
    spinePitch: profile.pitch * factor,
    strikePitch: profile.strikePitch * factor,
    coverPitch: profile.coverPitch * factor,
    strikeRoll: contactSide * profile.strikeRoll * factor,
    coverRoll: -contactSide * profile.coverRoll * factor,
  };
}

type BoneDelta = { bone: THREE.Object3D; x: number; y: number; z: number };
type PoseState = { last: BoneDelta[]; host: THREE.Object3D | null };
type UpperRig = {
  spine: THREE.Object3D | null;
  left: THREE.Object3D | null;
  right: THREE.Object3D | null;
};

const states = new WeakMap<FighterRuntime, PoseState>();
const rigCache = new WeakMap<THREE.Object3D, UpperRig>();
let installed = false;

function findHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(child =>
    child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime")) ?? null;
}

function getRig(host: THREE.Object3D): UpperRig {
  let rig = rigCache.get(host);
  if (!rig) {
    const model = host.children.find(child => child.type === "Group" || child.children.length > 0)
      ?? host.children[0];
    rig = {
      spine: model?.getObjectByName("spine_02") ?? null,
      left: model?.getObjectByName("upperarm_l") ?? null,
      right: model?.getObjectByName("upperarm_r") ?? null,
    };
    rigCache.set(host, rig);
  }
  return rig;
}

function resetApplied(state: PoseState): void {
  for (const { bone, x, y, z } of state.last) {
    bone.rotation.x -= x;
    bone.rotation.y -= y;
    bone.rotation.z -= z;
  }
  state.last.length = 0;
  state.host = null;
}

function add(state: PoseState, bone: THREE.Object3D | null, x: number, y: number, z: number): void {
  if (!bone || Math.abs(x) + Math.abs(y) + Math.abs(z) <= 1e-7) return;
  bone.rotation.x += x;
  bone.rotation.y += y;
  bone.rotation.z += z;
  state.last.push({ bone, x, y, z });
}

function apply(fighter: FighterRuntime, state: PoseState): void {
  const data = fighter.visual.root.userData;
  data.tpsPunchSilhouetteVersion = TPS_PUNCH_SILHOUETTE_VERSION;
  data.tpsPunchSilhouetteFactor = 0;
  data.tpsPunchSilhouetteYaw = 0;
  data.tpsPunchSilhouettePitch = 0;
  data.tpsPunchSilhouetteBoneCount = 0;
  data.tpsPunchSilhouetteFamily = null;
  const move = fighter.currentMove;
  const family = tpsClosePunchFamily(move);
  if (fighter.state !== "ATTACK" || !fighter.grounded || !family || !move
      || data.combatTps !== true || data.quaterniusModelState !== "ready") return;
  const side: -1 | 1 = move.visualContact === "LEFT_FIST" ? -1 : 1;
  const pose = tpsPunchSilhouettePose({
    family, tick: fighter.moveTick, startup: move.startup,
    active: move.active, recovery: move.recovery, contactSide: side,
  });
  if (pose.factor <= 1e-6) return;
  const host = findHost(fighter);
  if (!host) return;
  const rig = getRig(host);
  if (!rig.spine || !rig.left || !rig.right) return;
  state.host = host;
  // Bone-space additions preserve the animation's authored wrist path and
  // leave hips/boots entirely alone. Upper-body exaggeration is deliberately
  // small (<0.1 rad) to keep imported skin weights anatomical on iPhone.
  add(state, rig.spine, pose.spinePitch, pose.spineYaw, 0);
  if (side === -1) {
    add(state, rig.left, pose.strikePitch, 0, pose.strikeRoll);
    add(state, rig.right, pose.coverPitch, 0, pose.coverRoll);
  } else {
    add(state, rig.right, pose.strikePitch, 0, pose.strikeRoll);
    add(state, rig.left, pose.coverPitch, 0, pose.coverRoll);
  }
  data.tpsPunchSilhouetteFactor = pose.factor;
  data.tpsPunchSilhouetteYaw = pose.spineYaw;
  data.tpsPunchSilhouettePitch = pose.spinePitch;
  data.tpsPunchSilhouetteFamily = family;
  data.tpsPunchSilhouetteBoneCount = state.last.length;
  fighter.visual.root.updateMatrixWorld(true);
}

export function installTpsPunchSilhouettePresentation(): void {
  if (installed) return;
  installed = true;
  const previous = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function withPunchSilhouette(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    let state = states.get(fighter);
    if (!state) {
      state = { last: [], host: null };
      states.set(fighter, state);
    }
    // Remove before the mixer samples again: no additive rotation drift on
    // hitstop, combo links, rematch or a different model.
    resetApplied(state);
    previous.call(this, fighter, opponent, timeSeconds);
    apply(fighter, state);
  };
}
