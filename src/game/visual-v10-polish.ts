import * as THREE from "three";
import type { FighterVisual } from "./visual";
import { classifyV10SkinRegion, type V10Semantic, type V10SkinRegion } from "./visual-v10";

const PALETTE: Record<Exclude<V10Semantic, "unknown">, THREE.Color> = {
  skin: new THREE.Color(0xd3a184),
  blue: new THREE.Color(0x2452c5),
  black: new THREE.Color(0x0e0e16),
  silver: new THREE.Color(0xb9c3d0),
};

function semanticFromRgb(r: number, g: number, b: number): Exclude<V10Semantic, "unknown"> {
  const value = (r + g + b) / 3;
  if (value < 0.26) return "black";
  if (b > r * 1.12 && b > g * 1.08 && b > 0.24) return "blue";
  if (r > b * 1.12 && r > g * 1.03) return "skin";
  if (b > 0.48 && r < 0.52) return "blue";
  return "silver";
}

function resolvedSemantic(
  region: V10SkinRegion,
  semantic: Exclude<V10Semantic, "unknown">,
  y: number,
  r: number,
  g: number,
  b: number,
): Exclude<V10Semantic, "unknown"> {
  if (region === "HEAD") {
    if (semantic === "silver") return "skin";
    return semantic;
  }
  if (region === "HIPS") {
    if (semantic === "skin" || semantic === "silver") return b > r * 1.03 ? "blue" : "black";
    return semantic;
  }
  if (region === "TORSO") {
    if (y < 0.748 && semantic === "silver") return "skin";
    if (semantic === "silver") return "blue";
    return semantic;
  }
  if (region.endsWith("_SHIN") || region.endsWith("_FOOT")) {
    if (semantic === "skin" || semantic === "silver") return b > r * 1.02 ? "blue" : "black";
    return semantic;
  }
  if (region.endsWith("_THIGH") && semantic === "silver") return valueBias(r, g, b) ? "blue" : "black";
  return semantic;
}

function valueBias(r: number, g: number, b: number): boolean {
  return b > r * 1.03 || b > g * 1.08;
}

function boneForRegion(region: V10SkinRegion, y: number, visual: FighterVisual): number {
  const b = visual.rig.boneIndices;
  switch (region) {
    case "HEAD": return b.head;
    case "HIPS": return b.hips;
    case "TORSO": return y < 0.745 ? b.spineLower : y < 0.815 ? b.spineUpper : b.chest;
    case "LEFT_UPPER_ARM": return b.leftUpperArm;
    case "RIGHT_UPPER_ARM": return b.rightUpperArm;
    case "LEFT_FOREARM": return b.leftForearm;
    case "RIGHT_FOREARM": return b.rightForearm;
    case "LEFT_HAND": return b.leftHand;
    case "RIGHT_HAND": return b.rightHand;
    case "LEFT_THIGH": return b.leftThigh;
    case "RIGHT_THIGH": return b.rightThigh;
    case "LEFT_SHIN": return b.leftShin;
    case "RIGHT_SHIN": return b.rightShin;
    case "LEFT_FOOT": return b.leftFoot;
    case "RIGHT_FOOT": return b.rightFoot;
  }
}

function installRigidFacetSkinning(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (visual.bodyMesh.userData.v10FacetSkinning === "RIGID_FACE_REGIONS") return;

  const source = visual.bodyMesh.geometry;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const color = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!color || position.count % 3 !== 0) return;

  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const quantizedColors: number[] = [];
  const regionCounts: Partial<Record<V10SkinRegion, number>> = {};

  for (let base = 0; base < position.count; base += 3) {
    let x = 0;
    let y = 0;
    let z = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let offset = 0; offset < 3; offset += 1) {
      const vertex = base + offset;
      x += position.getX(vertex);
      y += position.getY(vertex);
      z += position.getZ(vertex);
      r += color.getX(vertex);
      g += color.getY(vertex);
      b += color.getZ(vertex);
    }
    x /= 3;
    y /= 3;
    z /= 3;
    r /= 3;
    g /= 3;
    b /= 3;

    const sourceSemantic = semanticFromRgb(r, g, b);
    const region = classifyV10SkinRegion(x, y, z, sourceSemantic);
    const semantic = resolvedSemantic(region, sourceSemantic, y, r, g, b);
    const target = PALETTE[semantic];
    const bone = boneForRegion(region, y, visual);
    regionCounts[region] = (regionCounts[region] ?? 0) + 1;

    for (let offset = 0; offset < 3; offset += 1) {
      skinIndices.push(bone, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
      quantizedColors.push(target.r, target.g, target.b);
    }
  }

  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(quantizedColors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.v10FacetSkinning = "RIGID_FACE_REGIONS";
  geometry.userData.v10RegionCounts = regionCounts;

  visual.bodyMesh.geometry = geometry;
  visual.bodyMesh.normalizeSkinWeights();
  source.dispose();
  visual.bodyMesh.userData.v10FacetSkinning = "RIGID_FACE_REGIONS";
  visual.root.userData.skinningPresentation = "V10.2_RIGID_FACE_REGIONS";
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = position.count / 3;
  visual.stats.weightedVertexCount = position.count;
}

function installReferenceColorMaterial(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (visual.bodyMesh.userData.v10ColorMaterial === "REFERENCE_VERTEX_COLOR") return;

  const hasVertexColor = Boolean(visual.bodyMesh.geometry.getAttribute("color"));
  if (!hasVertexColor) return;

  const oldMaterial = visual.bodyMesh.material;
  visual.bodyMesh.material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
  });
  if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
  else oldMaterial.dispose();
  visual.bodyMesh.userData.v10ColorMaterial = "REFERENCE_VERTEX_COLOR";
  visual.root.userData.colorPipeline = "V10.2_QUANTIZED_REFERENCE_VERTEX_COLOR";
}

function nearNeutralArms(visual: FighterVisual): boolean {
  const bones = visual.rig.bones;
  return Math.abs(bones.leftUpperArm.rotation.x) < 0.12
    && Math.abs(bones.rightUpperArm.rotation.x) < 0.12
    && Math.abs(bones.leftForearm.rotation.x) < 0.12
    && Math.abs(bones.rightForearm.rotation.x) < 0.12
    && Math.abs(bones.leftUpperArm.rotation.z) < 0.12
    && Math.abs(bones.rightUpperArm.rotation.z) < 0.12;
}

function applyCompactIdleGuard(visual: FighterVisual): void {
  const bones = visual.rig.bones;
  bones.leftUpperArm.rotation.x = -0.32;
  bones.leftUpperArm.rotation.z = 0.10;
  bones.leftForearm.rotation.x = -0.58;
  bones.rightUpperArm.rotation.x = -0.48;
  bones.rightUpperArm.rotation.z = -0.10;
  bones.rightForearm.rotation.x = -0.70;
  bones.spineUpper.rotation.y += 0.035;
  visual.root.updateMatrixWorld(true);
  visual.rig.skeleton.update();
}

/**
 * V10.2 presentation polish. The reconstructed surface is converted to
 * independent triangular facets and each facet follows one anatomical region.
 * That intentionally trades tiny shoulder/knee seams for a far more important
 * guarantee: no triangle can be stretched between torso and limb bones.
 */
export function applyV10RuntimePolish(visual: FighterVisual): FighterVisual {
  visual.footContacts.left.homeLocal.z = -0.100;
  visual.footContacts.right.homeLocal.z = 0.110;
  visual.root.userData.authoredNeutralStance = "V10.2_RIGID_FACET_GUARD";

  const previousBeforeRender = visual.bodyMesh.onBeforeRender;
  visual.bodyMesh.onBeforeRender = function onBeforeRender(...args): void {
    installRigidFacetSkinning(visual);
    installReferenceColorMaterial(visual);
    if (visual.bodyMesh.userData.v10FacetSkinning === "RIGID_FACE_REGIONS" && nearNeutralArms(visual)) {
      applyCompactIdleGuard(visual);
    }
    previousBeforeRender?.apply(this, args);
  };

  return visual;
}
