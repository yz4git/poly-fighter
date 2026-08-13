import * as THREE from "three";
import { orientBoneForward, solveTwoBoneIK } from "./rig";
import type { FighterVisual } from "./visual";

type ReferencePose = "IDLE" | "GUARD" | "PUNCH" | "KICK" | "OTHER";

function rootPoint(visual: FighterVisual, x: number, y: number, z: number): THREE.Vector3 {
  visual.root.updateMatrixWorld(true);
  return visual.root.localToWorld(new THREE.Vector3(x, y, z));
}

function endpointInRoot(visual: FighterVisual, object: THREE.Object3D): THREE.Vector3 {
  const world = object.getWorldPosition(new THREE.Vector3());
  return visual.root.worldToLocal(world);
}

function solveReferenceArm(
  visual: FighterVisual,
  side: -1 | 1,
  targetLocal: THREE.Vector3,
  poleLocal: THREE.Vector3,
): void {
  const prefix = side < 0 ? "left" : "right";
  const scale = visual.root.scale.x;
  const origin = rootPoint(visual, 0, 0, 0);
  const up = rootPoint(visual, 0, 1, 0).sub(origin).normalize();
  const forward = rootPoint(visual, 0, 0, 1).sub(origin).normalize();
  const target = rootPoint(visual, targetLocal.x, targetLocal.y, targetLocal.z)
    .addScaledVector(up, visual.layout.handLength * 0.46 * scale)
    .addScaledVector(forward, -0.026 * scale);
  const pole = rootPoint(visual, poleLocal.x, poleLocal.y, poleLocal.z);
  solveTwoBoneIK({
    root: visual.rig.bones[`${prefix}UpperArm`],
    mid: visual.rig.bones[`${prefix}Forearm`],
    end: visual.rig.bones[`${prefix}Hand`],
    target,
    pole,
  });
  orientBoneForward(visual.rig.bones[`${prefix}Hand`], forward);
}

function classifyReferencePose(visual: FighterVisual): ReferencePose {
  const leftFist = endpointInRoot(visual, visual.leftArm.end);
  const rightFist = endpointInRoot(visual, visual.rightArm.end);
  const leftFoot = endpointInRoot(visual, visual.leftLeg.end);
  const rightFoot = endpointInRoot(visual, visual.rightLeg.end);

  if (Math.max(leftFoot.y, rightFoot.y) > 0.29) return "KICK";
  if (Math.max(leftFist.z, rightFist.z) > 0.255) return "PUNCH";
  if (leftFist.y > 0.72 && rightFist.y > 0.72) return "GUARD";

  const b = visual.rig.bones;
  const locomotionLike = Math.max(
    Math.abs(b.leftUpperArm.rotation.z),
    Math.abs(b.rightUpperArm.rotation.z),
    Math.abs(b.leftThigh.rotation.z),
    Math.abs(b.rightThigh.rotation.z),
  ) > 0.145;
  const passiveLike = Math.abs(b.spineUpper.rotation.z) > 0.14 || Math.abs(b.head.rotation.z) > 0.145;
  const crouchLike = Math.abs(b.spineLower.rotation.x) + Math.abs(b.spineUpper.rotation.x) > 0.17;
  if (locomotionLike || passiveLike || crouchLike) return "OTHER";
  return "IDLE";
}

function applyIdleReference(visual: FighterVisual): void {
  const b = visual.rig.bones;
  b.spineLower.rotation.y += 0.045;
  b.spineUpper.rotation.y -= 0.075;
  b.chest.rotation.y += 0.060;
  b.head.rotation.y -= 0.030;
  solveReferenceArm(visual, -1, new THREE.Vector3(-0.135, 0.830, 0.135), new THREE.Vector3(-0.245, 0.750, 0.045));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.170, 0.590, 0.100), new THREE.Vector3(0.255, 0.655, 0.030));
}

function applyGuardReference(visual: FighterVisual): void {
  const b = visual.rig.bones;
  b.spineLower.rotation.y += 0.035;
  b.spineUpper.rotation.y -= 0.060;
  b.chest.rotation.y += 0.045;
  b.head.rotation.x -= 0.020;
  solveReferenceArm(visual, -1, new THREE.Vector3(-0.120, 0.805, 0.135), new THREE.Vector3(-0.230, 0.745, 0.050));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.105, 0.775, 0.180), new THREE.Vector3(0.220, 0.710, 0.065));
}

function applyPunchReference(visual: FighterVisual): void {
  const leftFist = endpointInRoot(visual, visual.leftArm.end);
  const rightFist = endpointInRoot(visual, visual.rightArm.end);
  const punchSide: -1 | 1 = leftFist.z > rightFist.z ? -1 : 1;
  const supportSide = (punchSide * -1) as -1 | 1;
  const b = visual.rig.bones;
  b.spineLower.rotation.y += punchSide * -0.035;
  b.spineUpper.rotation.y += punchSide * 0.060;
  b.chest.rotation.y += punchSide * 0.045;
  solveReferenceArm(
    visual,
    supportSide,
    new THREE.Vector3(supportSide * 0.110, 0.775, 0.130),
    new THREE.Vector3(supportSide * 0.225, 0.710, 0.045),
  );
}

function applyKickReference(visual: FighterVisual): void {
  const leftFoot = endpointInRoot(visual, visual.leftLeg.end);
  const rightFoot = endpointInRoot(visual, visual.rightLeg.end);
  const kickSide: -1 | 1 = leftFoot.y > rightFoot.y ? -1 : 1;
  const b = visual.rig.bones;
  b.spineLower.rotation.x -= 0.055;
  b.spineUpper.rotation.x -= 0.035;
  b.chest.rotation.y += kickSide * -0.060;
  solveReferenceArm(visual, -1, new THREE.Vector3(-0.105, 0.790, 0.130), new THREE.Vector3(-0.220, 0.720, 0.040));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.125, 0.735, 0.090), new THREE.Vector3(0.230, 0.670, 0.020));
}

function applyReferencePresentationPose(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  visual.root.updateMatrixWorld(true);
  const pose = classifyReferencePose(visual);
  if (pose === "IDLE") applyIdleReference(visual);
  else if (pose === "GUARD") applyGuardReference(visual);
  else if (pose === "PUNCH") applyPunchReference(visual);
  else if (pose === "KICK") applyKickReference(visual);
  else return;
  visual.root.userData.v10ReferencePose = pose;
  visual.root.updateMatrixWorld(true);
}

function installReferencePoseAnchor(visual: FighterVisual): void {
  if (visual.root.getObjectByName("v10-4-reference-pose-anchor")) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0], 3));
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, colorWrite: false, depthWrite: false, depthTest: false });
  const anchor = new THREE.Mesh(geometry, material);
  anchor.name = "v10-4-reference-pose-anchor";
  anchor.frustumCulled = false;
  anchor.renderOrder = -10000;
  anchor.userData.v10ReferencePoseAnchor = true;
  anchor.onBeforeRender = () => applyReferencePresentationPose(visual);
  visual.root.add(anchor);
}

/**
 * V10.4 leaves every leg/foot result from the deterministic animation intact.
 * It only shapes torso and arm presentation toward the supplied references,
 * avoiding the second foot-IK pass that folded the V10.4 prototype stance.
 */
export function applyV10SafeStance(visual: FighterVisual): FighterVisual {
  visual.root.userData.bindSafeStance = "V10.4_EXACT_BIND_TRANSLATIONS";
  visual.root.userData.v10CombatPoseReference = "IDLE_GUARD_PUNCH_KICK_SIGNATURE_A_B";
  visual.root.userData.v10ReferencePoseController = "RIG_ENDPOINT_UPPER_BODY_ONLY";
  installReferencePoseAnchor(visual);
  visual.root.updateMatrixWorld(true);
  return visual;
}
