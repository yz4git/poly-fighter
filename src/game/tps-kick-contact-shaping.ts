import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { solveCombatLimb } from "./combat-motion-authoring";
import { PresentationAnimationController } from "./presentation-animation";

type ImportedLeg = {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
};

type KickContactShapeState = {
  host: THREE.Object3D | null;
  hostX: number;
  hostYaw: number;
  leg: ImportedLeg | null;
  thighQ: THREE.Quaternion;
  calfQ: THREE.Quaternion;
  footQ: THREE.Quaternion;
};

const states = new WeakMap<FighterRuntime, KickContactShapeState>();
let installed = false;

function ensureState(fighter: FighterRuntime): KickContactShapeState {
  let state = states.get(fighter);
  if (state) return state;
  state = {
    host: null,
    hostX: 0,
    hostYaw: 0,
    leg: null,
    thighQ: new THREE.Quaternion(),
    calfQ: new THREE.Quaternion(),
    footQ: new THREE.Quaternion(),
  };
  states.set(fighter, state);
  return state;
}

function importedRuntimeHost(fighter: FighterRuntime): THREE.Object3D | null {
  return fighter.visual.root.children.find(
    (child) => child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  ) ?? null;
}

function importedModel(host: THREE.Object3D): THREE.Object3D | null {
  return host.children.find((child) => child.type === "Group" || child.children.length > 0)
    ?? host.children[0]
    ?? null;
}

function importedLeg(model: THREE.Object3D, suffix: "l" | "r"): ImportedLeg | null {
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

function removePreviousShape(fighter: FighterRuntime, state: KickContactShapeState): void {
  if (state.host) {
    state.host.position.x -= state.hostX;
    state.host.rotation.y -= state.hostYaw;
  }
  if (state.leg) {
    state.leg.thigh.quaternion.copy(state.thighQ);
    state.leg.calf.quaternion.copy(state.calfQ);
    state.leg.foot.quaternion.copy(state.footQ);
  }
  state.host = null;
  state.hostX = 0;
  state.hostYaw = 0;
  state.leg = null;
  fighter.visual.root.userData.tpsKickContactShape = 0;
  fighter.visual.root.userData.tpsKickContactShapeMove = "NONE";
}

function contactEnvelope(fighter: FighterRuntime): number {
  const move = fighter.currentMove;
  if (!move) return 0;
  const activeStart = move.startup;
  const activeEnd = move.startup + Math.max(1, move.active);
  const enter = THREE.MathUtils.smoothstep(fighter.moveTick, Math.max(0, activeStart - 3), activeStart + 1);
  const exit = 1 - THREE.MathUtils.smoothstep(fighter.moveTick, activeEnd, activeEnd + 6);
  return THREE.MathUtils.clamp(enter * exit, 0, 1);
}

function targetBodyPoints(opponent: FighterRuntime): { pelvis: THREE.Vector3; chest: THREE.Vector3 } | null {
  const host = importedRuntimeHost(opponent);
  if (!host) return null;
  const model = importedModel(host);
  const pelvisBone = model?.getObjectByName("pelvis");
  const chestBone = model?.getObjectByName("spine_03");
  if (!pelvisBone || !chestBone) return null;
  return {
    pelvis: pelvisBone.getWorldPosition(new THREE.Vector3()),
    chest: chestBone.getWorldPosition(new THREE.Vector3()),
  };
}

function applyKickContactShape(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  state: KickContactShapeState,
): void {
  const root = fighter.visual.root;
  const move = fighter.currentMove;
  const moveId = move?.id ?? "";
  if (
    !root.userData.combatTps
    || root.userData.quaterniusModelState !== "ready"
    || opponent.visual.root.userData.quaterniusModelState !== "ready"
    || fighter.state !== "ATTACK"
    || !move
    || (moveId !== "kick" && moveId !== "risingKick")
  ) return;

  const factor = contactEnvelope(fighter);
  if (factor <= 1e-4) return;

  const host = importedRuntimeHost(fighter);
  if (!host) return;
  const model = importedModel(host);
  if (!model) return;
  const suffix: "l" | "r" = move.visualContact === "LEFT_FOOT" ? "l" : "r";
  const leg = importedLeg(model, suffix);
  const bodyTarget = targetBodyPoints(opponent);
  if (!leg || !bodyTarget) return;

  model.updateMatrixWorld(true);
  const currentFoot = leg.foot.getWorldPosition(new THREE.Vector3());
  const currentKnee = leg.calf.getWorldPosition(new THREE.Vector3());
  const currentHip = leg.thigh.getWorldPosition(new THREE.Vector3());
  const footWorld = leg.foot.getWorldQuaternion(new THREE.Quaternion());

  // Save the exact incoming pose. It is restored before the wrapped animation
  // stack runs on the next frame, so this late presentation solve can never
  // accumulate or contaminate the authored Blender mixer transition pose.
  state.leg = leg;
  state.thighQ.copy(leg.thigh.quaternion);
  state.calfQ.copy(leg.calf.quaternion);
  state.footQ.copy(leg.foot.quaternion);
  state.host = host;

  const scale = root.scale.x;
  const side = suffix === "l" ? -1 : 1;
  const attackerPelvis = model.getObjectByName("pelvis")?.getWorldPosition(new THREE.Vector3()) ?? currentHip.clone();
  const targetTorso = bodyTarget.pelvis.clone().lerp(bodyTarget.chest, moveId === "kick" ? 0.50 : 0.82);
  const away = attackerPelvis.clone().sub(targetTorso);
  away.y = 0;
  if (away.lengthSq() > 1e-6) away.normalize();
  else away.set(0, 0, 1);

  let requested: THREE.Vector3;
  let targetBlend: number;
  if (moveId === "kick") {
    // The authored reference kick is intentionally athletic/high. In the close
    // TPS camera it overshoots the MID gameplay target and the boot exits past
    // the opponent's shoulder. Draw the visible boot toward the near surface of
    // the lower chest instead: a front kick, not a high side kick. The target is
    // only visual; CombatSystem continues using the canonical MID hitbox.
    const surface = targetTorso.addScaledVector(away, 0.10 * scale);
    targetBlend = 0.58 * factor;
    requested = currentFoot.clone().lerp(surface, targetBlend);
    state.hostX = -side * 0.030 * scale * factor;
    state.hostYaw = -side * 0.025 * factor;
  } else {
    // Rising Flare should travel UP through the opponent rather than extend as a
    // flat side kick. Keep most of the authored forward/depth position, pull a
    // little toward the opponent's centreline, and add clear vertical travel.
    // This preserves the Foundry windup and support foot while steepening only
    // the strike beat.
    requested = currentFoot.clone();
    requested.x = THREE.MathUtils.lerp(currentFoot.x, targetTorso.x, 0.22 * factor);
    requested.z = THREE.MathUtils.lerp(currentFoot.z, targetTorso.z, 0.10 * factor);
    requested.y += 0.16 * scale * factor;
    targetBlend = 1;
    state.hostX = -side * 0.018 * scale * factor;
    state.hostYaw = side * 0.018 * factor;
  }

  host.position.x += state.hostX;
  host.rotation.y += state.hostYaw;
  root.updateMatrixWorld(true);

  // Use the authored knee as the pole seed, biased slightly outward/up so the
  // solve cannot flip the knee plane. Restore the authored boot orientation
  // after changing thigh/calf direction to avoid ankle/toe twisting.
  const pole = currentKnee.clone()
    .add(new THREE.Vector3(0, 0.12 * scale, 0))
    .addScaledVector(currentKnee.clone().sub(currentHip).setY(0).normalize(), 0.04 * scale);
  solveCombatLimb(leg.thigh, leg.calf, leg.foot, requested, pole);
  setWorldQuaternion(leg.foot, footWorld);
  model.updateMatrixWorld(true);

  const shapedFoot = leg.foot.getWorldPosition(new THREE.Vector3());
  root.userData.tpsKickContactShape = factor;
  root.userData.tpsKickContactShapeMove = moveId;
  root.userData.tpsKickContactShapeTargetBlend = targetBlend;
  root.userData.tpsKickContactShapeOriginalY = currentFoot.y;
  root.userData.tpsKickContactShapeY = shapedFoot.y;
  root.userData.tpsKickContactShapeDeltaY = shapedFoot.y - currentFoot.y;
  root.userData.tpsKickContactShapeTravel = shapedFoot.distanceTo(currentFoot);
  root.userData.tpsKickContactShapeHostX = state.hostX;
  root.userData.tpsKickContactShapeHostYaw = state.hostYaw;
}

export function installTpsKickContactShapingPresentation(): void {
  if (installed) return;
  installed = true;

  const baseUpdate = PresentationAnimationController.prototype.update;
  PresentationAnimationController.prototype.update = function updateWithTpsKickContactShaping(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    timeSeconds: number,
  ): void {
    const state = ensureState(fighter);
    removePreviousShape(fighter, state);
    baseUpdate.call(this, fighter, opponent, timeSeconds);
    applyKickContactShape(fighter, opponent, state);
  };
}
