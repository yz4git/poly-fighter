import * as THREE from "three";
import { orientBoneForward, solveTwoBoneIK } from "./rig";
import type { FighterVisual } from "./visual";

type ReferencePose = "IDLE" | "GUARD" | "PUNCH" | "KICK" | "OTHER";

function rootPoint(visual: FighterVisual, x: number, y: number, z: number): THREE.Vector3 {
  visual.root.updateMatrixWorld(true);
  return visual.root.localToWorld(new THREE.Vector3(x, y, z));
}

function rootDirection(visual: FighterVisual, x: number, y: number, z: number): THREE.Vector3 {
  const origin = rootPoint(visual, 0, 0, 0);
  return rootPoint(visual, x, y, z).sub(origin).normalize();
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
  const up = rootDirection(visual, 0, 1, 0);
  const forward = rootDirection(visual, 0, 0, 1);
  const target = rootPoint(visual, targetLocal.x, targetLocal.y, targetLocal.z)
    .addScaledVector(up, visual.layout.handLength * 0.48 * scale)
    .addScaledVector(forward, -0.030 * scale);
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

function solveReferenceFoot(
  visual: FighterVisual,
  side: -1 | 1,
  targetLocal: THREE.Vector3,
  poleLocal: THREE.Vector3,
): void {
  const prefix = side < 0 ? "left" : "right";
  const key = side < 0 ? "left" : "right";
  const scale = visual.root.scale.x;
  const up = rootDirection(visual, 0, 1, 0);
  const forward = rootDirection(visual, 0, 0, 1);
  const soleLocal = visual.footContacts[key].soleLocal;
  const target = rootPoint(visual, targetLocal.x, targetLocal.y, targetLocal.z)
    .addScaledVector(up, -soleLocal.y * scale)
    .addScaledVector(forward, -soleLocal.z * scale);
  const pole = rootPoint(visual, poleLocal.x, poleLocal.y, poleLocal.z);
  solveTwoBoneIK({
    root: visual.rig.bones[`${prefix}Thigh`],
    mid: visual.rig.bones[`${prefix}Shin`],
    end: visual.rig.bones[`${prefix}Foot`],
    target,
    pole,
  });
  orientBoneForward(visual.rig.bones[`${prefix}Foot`], forward);
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
  visual.hips.position.y -= 0.026;
  visual.rig.bones.spineLower.rotation.y += 0.075;
  visual.rig.bones.spineUpper.rotation.y -= 0.110;
  visual.rig.bones.chest.rotation.y += 0.075;
  visual.rig.bones.head.rotation.y -= 0.045;

  solveReferenceArm(visual, -1, new THREE.Vector3(-0.145, 0.842, 0.145), new THREE.Vector3(-0.255, 0.760, 0.050));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.185, 0.565, 0.115), new THREE.Vector3(0.265, 0.650, 0.035));
  solveReferenceFoot(visual, -1, new THREE.Vector3(-0.145, 0.002, -0.125), new THREE.Vector3(-0.190, 0.355, 0.120));
  solveReferenceFoot(visual, 1, new THREE.Vector3(0.155, 0.002, 0.155), new THREE.Vector3(0.205, 0.355, 0.120));
}

function applyGuardReference(visual: FighterVisual): void {
  visual.hips.position.y -= 0.034;
  visual.rig.bones.spineLower.rotation.y += 0.055;
  visual.rig.bones.spineUpper.rotation.y -= 0.080;
  visual.rig.bones.chest.rotation.y += 0.055;
  visual.rig.bones.head.rotation.x -= 0.035;

  solveReferenceArm(visual, -1, new THREE.Vector3(-0.135, 0.815, 0.165), new THREE.Vector3(-0.245, 0.745, 0.060));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.120, 0.785, 0.205), new THREE.Vector3(0.235, 0.720, 0.075));
  solveReferenceFoot(visual, -1, new THREE.Vector3(-0.145, 0.002, -0.120), new THREE.Vector3(-0.190, 0.345, 0.120));
  solveReferenceFoot(visual, 1, new THREE.Vector3(0.155, 0.002, 0.150), new THREE.Vector3(0.205, 0.345, 0.120));
}

function applyPunchReference(visual: FighterVisual): void {
  const leftFist = endpointInRoot(visual, visual.leftArm.end);
  const rightFist = endpointInRoot(visual, visual.rightArm.end);
  const punchSide: -1 | 1 = leftFist.z > rightFist.z ? -1 : 1;
  const supportSide = (punchSide * -1) as -1 | 1;

  visual.hips.position.y -= 0.020;
  visual.rig.bones.spineLower.rotation.y += punchSide * -0.060;
  visual.rig.bones.spineUpper.rotation.y += punchSide * 0.100;
  visual.rig.bones.chest.rotation.y += punchSide * 0.065;
  visual.rig.bones.head.rotation.y += punchSide * -0.035;

  solveReferenceArm(
    visual,
    supportSide,
    new THREE.Vector3(supportSide * 0.125, 0.790, 0.150),
    new THREE.Vector3(supportSide * 0.235, 0.720, 0.050),
  );
  solveReferenceFoot(visual, -1, new THREE.Vector3(-0.145, 0.002, -0.115), new THREE.Vector3(-0.190, 0.350, 0.115));
  solveReferenceFoot(visual, 1, new THREE.Vector3(0.155, 0.002, 0.145), new THREE.Vector3(0.205, 0.350, 0.115));
}

function applyKickReference(visual: FighterVisual): void {
  const leftFoot = endpointInRoot(visual, visual.leftLeg.end);
  const rightFoot = endpointInRoot(visual, visual.rightLeg.end);
  const kickSide: -1 | 1 = leftFoot.y > rightFoot.y ? -1 : 1;

  visual.rig.bones.spineLower.rotation.x -= 0.115;
  visual.rig.bones.spineUpper.rotation.x -= 0.085;
  visual.rig.bones.spineLower.rotation.y += kickSide * 0.070;
  visual.rig.bones.chest.rotation.y += kickSide * -0.105;
  visual.rig.bones.head.rotation.x += 0.040;

  solveReferenceArm(visual, -1, new THREE.Vector3(-0.125, 0.800, 0.155), new THREE.Vector3(-0.235, 0.735, 0.045));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.145, 0.735, 0.105), new THREE.Vector3(0.245, 0.665, 0.020));
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
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,
    0.0001, 0, 0,
    0, 0.0001, 0,
  ], 3));
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  });
  const anchor = new THREE.Mesh(geometry, material);
  anchor.name = "v10-4-reference-pose-anchor";
  anchor.frustumCulled = false;
  anchor.renderOrder = -10000;
  anchor.userData.v10ReferencePoseAnchor = true;
  anchor.onBeforeRender = () => applyReferencePresentationPose(visual);
  visual.root.add(anchor);
}

/**
 * V10.4 keeps the imported reconstruction's bind translations untouched, then
 * applies reference-matched presentation poses immediately before rendering.
 * Combat hitboxes remain deterministic; only the reconstructed SERA visual is
 * posed toward the supplied signature stance / guard / punch / kick sheets.
 */
export function applyV10SafeStance(visual: FighterVisual): FighterVisual {
  visual.root.userData.bindSafeStance = "V10.4_EXACT_BIND_TRANSLATIONS";
  visual.root.userData.authoredNeutralStance = "V10.4_SIGNATURE_A_REFERENCE";
  visual.root.userData.v10CombatPoseReference = "IDLE_GUARD_PUNCH_KICK_SIGNATURE_A_B";
  installReferencePoseAnchor(visual);
  visual.root.updateMatrixWorld(true);
  return visual;
}
