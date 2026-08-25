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
    Math.abs(b.leftUpperArm.rotation.z), Math.abs(b.rightUpperArm.rotation.z),
    Math.abs(b.leftThigh.rotation.z), Math.abs(b.rightThigh.rotation.z),
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
  solveReferenceArm(visual, -1, new THREE.Vector3(-0.105, 0.715, 0.150), new THREE.Vector3(-0.185, 0.665, 0.050));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.115, 0.665, 0.125), new THREE.Vector3(0.190, 0.620, 0.045));
}

function applyGuardReference(visual: FighterVisual): void {
  const b = visual.rig.bones;
  b.spineLower.rotation.y += 0.035;
  b.spineUpper.rotation.y -= 0.060;
  b.chest.rotation.y += 0.045;
  b.head.rotation.x -= 0.020;
  solveReferenceArm(visual, -1, new THREE.Vector3(-0.100, 0.735, 0.155), new THREE.Vector3(-0.190, 0.675, 0.055));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.100, 0.715, 0.165), new THREE.Vector3(0.190, 0.655, 0.055));
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
    new THREE.Vector3(supportSide * 0.095, 0.715, 0.145),
    new THREE.Vector3(supportSide * 0.185, 0.655, 0.050),
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
  solveReferenceArm(visual, -1, new THREE.Vector3(-0.095, 0.725, 0.145), new THREE.Vector3(-0.185, 0.665, 0.050));
  solveReferenceArm(visual, 1, new THREE.Vector3(0.105, 0.690, 0.125), new THREE.Vector3(0.190, 0.635, 0.045));
}

function applyReferencePresentationPose(visual: FighterVisual): void {
  const assetState = visual.root.userData.blenderRuntimeAssetState ?? visual.root.userData.reconstructionAssetState;
  if (assetState !== "ready") return;
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

function addArmorBox(
  bone: THREE.Bone,
  name: string,
  size: THREE.Vector3,
  position: THREE.Vector3,
  material: THREE.Material,
  rotation = new THREE.Euler(),
): void {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.frustumCulled = false;
  mesh.userData.v10ReferenceCostume = true;
  bone.add(mesh);
}

function addBonePlate(
  parent: THREE.Bone,
  child: THREE.Bone,
  name: string,
  width: number,
  coverage: number,
  depth: number,
  offsetZ: number,
  material: THREE.Material,
): void {
  const direction = child.position.clone();
  const length = direction.length();
  if (length < 1e-4) return;
  const geometry = new THREE.BoxGeometry(width, length * coverage, depth);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, -1, 0), direction.clone().normalize(),
  ));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(direction).multiplyScalar(0.45);
  mesh.position.z += offsetZ;
  mesh.frustumCulled = false;
  mesh.userData.v10ReferenceCostume = true;
  parent.add(mesh);
}

function installReferenceCostume(visual: FighterVisual): void {
  if (visual.root.userData.v10ReferenceCostume) return;
  const blue = new THREE.MeshBasicMaterial({ color: 0x3168db, toneMapped: false });
  const blueDark = new THREE.MeshBasicMaterial({ color: 0x173b91, toneMapped: false });
  const silver = new THREE.MeshBasicMaterial({ color: 0xb7c4d7, toneMapped: false });
  const black = new THREE.MeshBasicMaterial({ color: 0x0b0c13, toneMapped: false });
  const b = visual.rig.bones;

  // Cropped vest and split high collar: broad blue masses readable at fight-camera scale.
  addArmorBox(b.chest, "v10-4-vest-left", new THREE.Vector3(0.078, 0.135, 0.052),
    new THREE.Vector3(-0.052, -0.030, 0.058), blue, new THREE.Euler(0, -0.12, -0.06));
  addArmorBox(b.chest, "v10-4-vest-right", new THREE.Vector3(0.078, 0.135, 0.052),
    new THREE.Vector3(0.052, -0.030, 0.058), blue, new THREE.Euler(0, 0.12, 0.06));
  addArmorBox(b.chest, "v10-4-collar-left", new THREE.Vector3(0.045, 0.082, 0.044),
    new THREE.Vector3(-0.046, 0.070, 0.025), blueDark, new THREE.Euler(0, -0.12, -0.28));
  addArmorBox(b.chest, "v10-4-collar-right", new THREE.Vector3(0.045, 0.082, 0.044),
    new THREE.Vector3(0.046, 0.070, 0.025), blueDark, new THREE.Euler(0, 0.12, 0.28));

  // Exposed-midriff break plus asymmetric waist panels.
  addArmorBox(b.hips, "v10-4-waist-band", new THREE.Vector3(0.205, 0.034, 0.105),
    new THREE.Vector3(0, 0.045, 0.010), black);
  addArmorBox(b.hips, "v10-4-skirt-front", new THREE.Vector3(0.135, 0.205, 0.038),
    new THREE.Vector3(0, -0.080, 0.088), blue, new THREE.Euler(-0.08, 0, 0));
  addArmorBox(b.hips, "v10-4-skirt-left", new THREE.Vector3(0.078, 0.180, 0.034),
    new THREE.Vector3(-0.092, -0.070, 0.018), blueDark, new THREE.Euler(0, -0.30, -0.10));
  addArmorBox(b.hips, "v10-4-skirt-right", new THREE.Vector3(0.078, 0.180, 0.034),
    new THREE.Vector3(0.092, -0.070, 0.018), blueDark, new THREE.Euler(0, 0.30, 0.10));

  // Silver bracers and blue lower-leg armor from the combat sheets.
  addBonePlate(b.leftForearm, b.leftHand, "v10-4-left-bracer", 0.072, 0.62, 0.040, 0.028, silver);
  addBonePlate(b.rightForearm, b.rightHand, "v10-4-right-bracer", 0.072, 0.62, 0.040, 0.028, silver);
  for (const [side, shin, foot] of [["left", b.leftShin, b.leftFoot], ["right", b.rightShin, b.rightFoot]] as const) {
    addBonePlate(shin, foot, `v10-4-${side}-shin-plate`, 0.070, 0.72, 0.036, 0.030, blue);
    const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.047, 0), blueDark);
    knee.name = `v10-4-${side}-knee-cap`;
    knee.position.set(0, 0.004, 0.032);
    knee.rotation.set(0.12, 0, Math.PI / 4);
    knee.frustumCulled = false;
    knee.userData.v10ReferenceCostume = true;
    shin.add(knee);
    addArmorBox(foot, `v10-4-${side}-toe-cap`, new THREE.Vector3(0.074, 0.040, 0.120),
      new THREE.Vector3(0, -0.012, 0.080), blue, new THREE.Euler(-0.08, 0, 0));
  }
  visual.root.userData.v10ReferenceCostume = "V10.4_BLUE_BLACK_SILVER_READABLE_MASSES";
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

/** V10.4 reference styling without re-solving planted legs. */
export function applyV10SafeStance(visual: FighterVisual): FighterVisual {
  visual.root.userData.bindSafeStance = "V10.4_EXACT_BIND_TRANSLATIONS";
  visual.root.userData.v10CombatPoseReference = "V16_COMPACT_CHIN_GUARD_A_B";
  visual.root.userData.v10ReferencePoseController = "RIG_ENDPOINT_UPPER_BODY_ONLY";
  installReferenceCostume(visual);
  installReferencePoseAnchor(visual);
  visual.root.updateMatrixWorld(true);
  return visual;
}
