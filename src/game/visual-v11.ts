import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { createFemaleV9Visual } from "./visual-v9";

function dominantBone(g: THREE.BufferGeometry, v: number): number {
  const indices = g.getAttribute("skinIndex");
  const weights = g.getAttribute("skinWeight");
  if (!indices || !weights) return -1;
  let bone = -1; let best = -1;
  for (let slot = 0; slot < 4; slot += 1) {
    const weight = weights.getComponent(v, slot);
    if (weight > best) { best = weight; bone = indices.getComponent(v, slot); }
  }
  return bone;
}
function silverVertices(g: THREE.BufferGeometry): Set<number> {
  const result = new Set<number>(); const index = g.index; if (!index) return result;
  for (const group of g.groups) if (group.materialIndex === 3) for (let offset = group.start; offset < group.start + group.count; offset += 1) result.add(index.getX(offset));
  return result;
}
function rootBonePoint(v: FighterVisual, name: string): THREE.Vector3 {
  v.root.updateMatrixWorld(true); return v.root.worldToLocal(v.rig.bones[name].getWorldPosition(new THREE.Vector3()));
}
function scaleCrossSection(point: THREE.Vector3, anchor: THREE.Vector3, xScale: number, zScale: number): void {
  point.x = anchor.x + (point.x - anchor.x) * xScale;
  point.z = anchor.z + (point.z - anchor.z) * zScale;
}
function refine(v: FighterVisual): void {
  const g = v.bodyMesh.geometry; const p = g.getAttribute("position") as THREE.BufferAttribute; const silver = silverVertices(g);
  const bi = v.rig.boneIndices;
  const anchors = {
    leftThigh: rootBonePoint(v, "leftThigh"), rightThigh: rootBonePoint(v, "rightThigh"),
    leftShin: rootBonePoint(v, "leftShin"), rightShin: rootBonePoint(v, "rightShin"),
    leftFoot: rootBonePoint(v, "leftFoot"), rightFoot: rootBonePoint(v, "rightFoot"),
  };
  const headCenter = new THREE.Vector3(0, v.layout.headBottom + v.layout.headHeight * 0.52, 0);
  for (let vertex = 0; vertex < p.count; vertex += 1) {
    let x = p.getX(vertex); let y = p.getY(vertex); let z = p.getZ(vertex); const bone = dominantBone(g, vertex);
    if (y >= 0.755 && y <= 0.835 && Math.abs(x) < 0.145) { x *= 1.075; z *= 1.060; }
    else if (y >= 0.665 && y <= 0.725 && Math.abs(x) < 0.135) { x *= 0.945; z *= 0.960; }
    else if (y >= 0.555 && y <= 0.650 && Math.abs(x) < 0.150) { x *= 1.045; z *= 1.035; }
    const point = new THREE.Vector3(x, y, z);
    if (bone === bi.head) {
      scaleCrossSection(point, headCenter, 1.055, 1.045);
    } else if (bone === bi.leftThigh || bone === bi.rightThigh) {
      scaleCrossSection(point, bone === bi.leftThigh ? anchors.leftThigh : anchors.rightThigh, 0.88, 0.90);
    } else if (bone === bi.leftShin || bone === bi.rightShin) {
      scaleCrossSection(point, bone === bi.leftShin ? anchors.leftShin : anchors.rightShin, 0.86, 0.88);
    } else if (bone === bi.leftFoot || bone === bi.rightFoot) {
      const anchor = bone === bi.leftFoot ? anchors.leftFoot : anchors.rightFoot;
      const toe = THREE.MathUtils.clamp((point.z - anchor.z + 0.02) / 0.20, 0, 1);
      point.x = anchor.x + (point.x - anchor.x) * THREE.MathUtils.lerp(0.86, 0.48, toe);
      point.y = anchor.y + (point.y - anchor.y) * THREE.MathUtils.lerp(0.88, 0.58, toe);
      point.z = anchor.z + (point.z - anchor.z) * 0.96;
    }
    x = point.x; y = point.y; z = point.z;
    if (silver.has(vertex) && y > 0.45) { const side = x < 0 ? -1 : 1; x = side * 0.151 + (x - side * 0.151) * 0.72; z = 0.036 + (z - 0.036) * 0.72; }
    p.setXYZ(vertex, x, y, z);
  }
  p.needsUpdate = true; g.deleteAttribute("normal"); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  const index = g.index;
  if (index) for (const group of g.groups) if (group.materialIndex === 3) {
    let sumX = 0; let sumY = 0; let count = 0;
    for (let offset = group.start; offset < group.start + group.count; offset += 1) { const vertex = index.getX(offset); sumX += p.getX(vertex); sumY += p.getY(vertex); count += 1; }
    if (count > 0 && sumY / count > 0.45 && sumX / count < 0) group.materialIndex = 1;
  }
  g.userData.v11Silhouette = "REFERENCE_HOURGLASS_SLENDER_LEGS_POINTED_BOOTS";
}
function tuneMaterials(v: FighterVisual): void {
  const materials = Array.isArray(v.bodyMesh.material) ? v.bodyMesh.material : [v.bodyMesh.material];
  const palette = [0xd8a287, 0x111218, 0x285fd5, 0xc7d0de, 0x151319, 0xf2f6fa, 0x6c3b43];
  materials.forEach((material, index) => { if (!(material instanceof THREE.MeshStandardMaterial)) return; if (palette[index] !== undefined) material.color.setHex(palette[index]); material.roughness = index === 3 ? 0.50 : 0.72; material.metalness = index === 3 ? 0.16 : 0.015; material.flatShading = true; material.toneMapped = false; material.needsUpdate = true; });
}
export function createFemaleV11Visual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  const v = createFemaleV9Visual(definition, quality); refine(v); tuneMaterials(v); v.root.name = `fighter-v11-${definition.id}`;
  v.root.userData.visualPipeline = "V11_V91_CHARACTER_V10_COMPATIBLE_RIG"; v.root.userData.visualVersion = "V11"; v.root.userData.v11CharacterSource = "V9.1_AUTHORED_CONTINUOUS_MESH"; v.root.userData.v11RigSource = "V10_CANONICAL_V4_RIG_AND_IK"; v.root.userData.v10ReferenceAsset = "/models/sera-v10.glb"; v.root.userData.v11ColorPipeline = "REFERENCE_BLUE_BLACK_SKIN_SILVER";
  v.bodyMesh.userData.v11PresentationMode = "V9.1_CONTINUOUS_SKINNED_CHARACTER"; v.visualVersion = "V11" as unknown as FighterVisual["visualVersion"]; v.stats.visualVersion = "V11" as unknown as FighterVisual["stats"]["visualVersion"]; return v;
}
