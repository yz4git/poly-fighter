import * as THREE from "three";
import type { FighterVisual } from "./visual";

type LimbRegion =
  | "LEFT_UPPER_ARM" | "RIGHT_UPPER_ARM"
  | "LEFT_FOREARM" | "RIGHT_FOREARM"
  | "LEFT_HAND" | "RIGHT_HAND"
  | "LEFT_THIGH" | "RIGHT_THIGH"
  | "LEFT_SHIN" | "RIGHT_SHIN"
  | "LEFT_FOOT" | "RIGHT_FOOT";

const LIMB_REGIONS = new Set<LimbRegion>([
  "LEFT_UPPER_ARM", "RIGHT_UPPER_ARM",
  "LEFT_FOREARM", "RIGHT_FOREARM",
  "LEFT_HAND", "RIGHT_HAND",
  "LEFT_THIGH", "RIGHT_THIGH",
  "LEFT_SHIN", "RIGHT_SHIN",
  "LEFT_FOOT", "RIGHT_FOOT",
]);

function matte(color: number, roughness = 0.78): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness,
    metalness: 0.01,
  });
}

function segmentGeometry(direction: THREE.Vector3, radiusTop: number, radiusBottom: number): THREE.BufferGeometry {
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radiusBottom, radiusTop, length, 7, 1, false);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  ));
  geometry.translate(direction.x * 0.5, direction.y * 0.5, direction.z * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

function addSegment(
  parent: THREE.Bone,
  child: THREE.Bone,
  radiusTop: number,
  radiusBottom: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh | null {
  const direction = child.position.clone();
  if (direction.lengthSq() < 1e-6) return null;
  const mesh = new THREE.Mesh(segmentGeometry(direction, radiusTop, radiusBottom), material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.userData.v10CoherentLimb = true;
  parent.add(mesh);
  return mesh;
}

function addJoint(
  bone: THREE.Bone,
  radius: number,
  material: THREE.Material,
  name: string,
  scale = new THREE.Vector3(1, 1, 1),
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 7, 5);
  geometry.scale(scale.x, scale.y, scale.z);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.userData.v10CoherentLimb = true;
  bone.add(mesh);
  return mesh;
}

function addHand(bone: THREE.Bone, side: "left" | "right", skin: THREE.Material): void {
  const geometry = new THREE.BoxGeometry(0.046, 0.072, 0.052);
  geometry.rotateZ(side === "left" ? -0.08 : 0.08);
  const mesh = new THREE.Mesh(geometry, skin);
  mesh.name = `v10-4-coherent-${side}-hand`;
  mesh.position.set(0, -0.034, 0.018);
  mesh.frustumCulled = false;
  mesh.userData.v10CoherentLimb = true;
  bone.add(mesh);
}

function addFoot(bone: THREE.Bone, side: "left" | "right", dark: THREE.Material): void {
  const geometry = new THREE.BoxGeometry(0.070, 0.050, 0.145);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (z > 0) {
      position.setX(i, position.getX(i) * 0.58);
      position.setY(i, position.getY(i) - 0.008);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, dark);
  mesh.name = `v10-4-coherent-${side}-foot`;
  mesh.position.set(0, -0.020, 0.070);
  mesh.frustumCulled = false;
  mesh.userData.v10CoherentLimb = true;
  bone.add(mesh);
}

function hideReconstructedLimbFragments(visual: FighterVisual): void {
  if (visual.root.userData.v10CoherentLimbSourceHidden) return;
  let hidden = 0;
  visual.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const region = object.userData.v10FragmentRegion as LimbRegion | undefined;
    if (region && LIMB_REGIONS.has(region)) {
      object.visible = false;
      hidden += 1;
    }
    if (object.userData.v10Underbody) object.visible = false;
  });
  if (hidden > 0) {
    visual.root.userData.v10CoherentLimbSourceHidden = hidden;
    visual.root.userData.v10LimbPresentation = "V10.4_COHERENT_FACETED_SHELLS";
  }
}

function installCoherentLimbs(visual: FighterVisual): void {
  if (visual.root.userData.v10CoherentLimbsInstalled) return;
  const skin = matte(0xd7a38a, 0.82);
  const dark = matte(0x11121a, 0.80);
  const b = visual.rig.bones;

  // Arms: exposed upper arm, dark fitted forearm, compact hands. The separate
  // silver bracer from visual-v10-stance remains readable on top.
  addSegment(b.leftUpperArm, b.leftForearm, 0.036, 0.030, skin, "v10-4-coherent-left-upper-arm");
  addSegment(b.rightUpperArm, b.rightForearm, 0.036, 0.030, skin, "v10-4-coherent-right-upper-arm");
  addSegment(b.leftForearm, b.leftHand, 0.030, 0.022, dark, "v10-4-coherent-left-forearm");
  addSegment(b.rightForearm, b.rightHand, 0.030, 0.022, dark, "v10-4-coherent-right-forearm");
  addJoint(b.leftUpperArm, 0.035, skin, "v10-4-coherent-left-shoulder-joint", new THREE.Vector3(1.08, 0.86, 1.0));
  addJoint(b.rightUpperArm, 0.035, skin, "v10-4-coherent-right-shoulder-joint", new THREE.Vector3(1.08, 0.86, 1.0));
  addJoint(b.leftForearm, 0.029, dark, "v10-4-coherent-left-elbow-joint");
  addJoint(b.rightForearm, 0.029, dark, "v10-4-coherent-right-elbow-joint");
  addHand(b.leftHand, "left", skin);
  addHand(b.rightHand, "right", skin);

  // Legs: dark athletic base shells. Blue knee/shin/toe armor from the costume
  // layer overlays these masses, matching the supplied combat sheets.
  addSegment(b.leftThigh, b.leftShin, 0.050, 0.039, dark, "v10-4-coherent-left-thigh");
  addSegment(b.rightThigh, b.rightShin, 0.050, 0.039, dark, "v10-4-coherent-right-thigh");
  addSegment(b.leftShin, b.leftFoot, 0.039, 0.030, dark, "v10-4-coherent-left-shin");
  addSegment(b.rightShin, b.rightFoot, 0.039, 0.030, dark, "v10-4-coherent-right-shin");
  addJoint(b.leftThigh, 0.051, dark, "v10-4-coherent-left-hip-joint", new THREE.Vector3(1.05, 0.82, 1.0));
  addJoint(b.rightThigh, 0.051, dark, "v10-4-coherent-right-hip-joint", new THREE.Vector3(1.05, 0.82, 1.0));
  addJoint(b.leftShin, 0.040, dark, "v10-4-coherent-left-knee-joint", new THREE.Vector3(1.0, 0.86, 0.95));
  addJoint(b.rightShin, 0.040, dark, "v10-4-coherent-right-knee-joint", new THREE.Vector3(1.0, 0.86, 0.95));
  addFoot(b.leftFoot, "left", dark);
  addFoot(b.rightFoot, "right", dark);

  visual.root.userData.v10CoherentLimbsInstalled = true;
}

/**
 * V10.4 limb cleanup. The four-view reconstruction remains the torso/hips
 * source, while ragged limb fragments are replaced by persistent bone-owned
 * faceted shells so Guard/Punch/Kick read as one coherent fighter.
 */
export function applyV104CoherentLimbs(visual: FighterVisual): FighterVisual {
  installCoherentLimbs(visual);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0], 3));
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const anchor = new THREE.Mesh(geometry, material);
  anchor.name = "v10-4-coherent-limb-cleanup-anchor";
  anchor.frustumCulled = false;
  anchor.renderOrder = 10000;
  anchor.onBeforeRender = () => hideReconstructedLimbFragments(visual);
  visual.root.add(anchor);
  return visual;
}
