import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { createFemaleV9Visual } from "./visual-v9";

function dominantBone(geometry: THREE.BufferGeometry, vertex: number): number {
  const indices = geometry.getAttribute("skinIndex");
  const weights = geometry.getAttribute("skinWeight");
  if (!indices || !weights) return -1;
  let bestIndex = -1;
  let bestWeight = -1;
  for (let slot = 0; slot < 4; slot += 1) {
    const weight = weights.getComponent(vertex, slot);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestIndex = indices.getComponent(vertex, slot);
    }
  }
  return bestIndex;
}

function boneAnchorInRoot(visual: FighterVisual, name: string): THREE.Vector3 {
  visual.root.updateMatrixWorld(true);
  return visual.root.worldToLocal(visual.rig.bones[name].getWorldPosition(new THREE.Vector3()));
}

function refineV11Silhouette(visual: FighterVisual): void {
  const geometry = visual.bodyMesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const headIndex = visual.rig.boneIndices.head;
  const leftFootIndex = visual.rig.boneIndices.leftFoot;
  const rightFootIndex = visual.rig.boneIndices.rightFoot;
  const leftFoot = boneAnchorInRoot(visual, "leftFoot");
  const rightFoot = boneAnchorInRoot(visual, "rightFoot");
  const headCenter = new THREE.Vector3(0, visual.layout.headBottom + visual.layout.headHeight * 0.52, 0);

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    let x = position.getX(vertex);
    const y = position.getY(vertex);
    let z = position.getZ(vertex);
    const bone = dominantBone(geometry, vertex);
    if (y >= 0.755 && y <= 0.835 && Math.abs(x) < 0.145) {
      x *= 1.055;
      z *= 1.045;
    } else if (y >= 0.665 && y <= 0.725 && Math.abs(x) < 0.135) {
      x *= 0.955;
      z *= 0.970;
    } else if (y >= 0.555 && y <= 0.650 && Math.abs(x) < 0.150) {
      x *= 1.025;
      z *= 1.020;
    }
    if (bone === headIndex) {
      x = headCenter.x + (x - headCenter.x) * 1.045;
      z = headCenter.z + (z - headCenter.z) * 1.035;
    } else if (bone === leftFootIndex || bone === rightFootIndex) {
      const anchor = bone === leftFootIndex ? leftFoot : rightFoot;
      x = anchor.x + (x - anchor.x) * 0.90;
      z = anchor.z + (z - anchor.z) * 0.82;
    }
    position.setXYZ(vertex, x, y, z);
  }
  position.needsUpdate = true;
  geometry.deleteAttribute("normal");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.v11Silhouette = "REFERENCE_HOURGLASS_COMPACT_BOOTS";
}

function tuneV11Materials(visual: FighterVisual): void {
  const materials = Array.isArray(visual.bodyMesh.material) ? visual.bodyMesh.material : [visual.bodyMesh.material];
  const palette = [0xd8a287, 0x111218, 0x285fd5, 0xc7d0de, 0x151319, 0xf2f6fa, 0x6c3b43];
  for (let index = 0; index < materials.length; index += 1) {
    const material = materials[index];
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    if (palette[index] !== undefined) material.color.setHex(palette[index]);
    material.roughness = index === 3 ? 0.50 : 0.72;
    material.metalness = index === 3 ? 0.16 : 0.015;
    material.flatShading = true;
    material.toneMapped = false;
    material.needsUpdate = true;
  }
  visual.root.userData.v11ColorPipeline = "REFERENCE_BLUE_BLACK_SKIN_SILVER";
}

export function createFemaleV11Visual(definition: FighterDefinition, quality: FighterVisualQuality = "NORMAL"): FighterVisual {
  const visual = createFemaleV9Visual(definition, quality);
  refineV11Silhouette(visual);
  tuneV11Materials(visual);
  visual.root.name = `fighter-v11-${definition.id}`;
  visual.root.userData.visualPipeline = "V11_V91_CHARACTER_V10_COMPATIBLE_RIG";
  visual.root.userData.visualVersion = "V11";
  visual.root.userData.v11CharacterSource = "V9.1_AUTHORED_CONTINUOUS_MESH";
  visual.root.userData.v11RigSource = "V10_CANONICAL_V4_RIG_AND_IK";
  visual.root.userData.v10ReferenceAsset = "/models/sera-v10.glb";
  visual.bodyMesh.userData.v11PresentationMode = "V9.1_CONTINUOUS_SKINNED_CHARACTER";
  visual.visualVersion = "V11" as unknown as FighterVisual["visualVersion"];
  visual.stats.visualVersion = "V11" as unknown as FighterVisual["stats"]["visualVersion"];
  return visual;
}
