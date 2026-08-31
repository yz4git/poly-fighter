import * as THREE from "three";
import type { FighterDefinition } from "./types";
import { createKairoReconstructedVisual } from "./visual-kairo-v1";
import { createFemaleBlenderRuntimeVisual } from "./visual-blender-runtime";
import { applyV11ReferencePose } from "./visual-v11-pose";
import {
  disposeFighterVisual as disposeBaseFighterVisual,
  getSoleContactPoint,
  getVisualContactPoint,
  getWalkFootTarget,
  releaseFootPlants,
  updateFootPlants,
  visualGroundOffset,
} from "./visual";
import type { FighterVisual, FighterVisualQuality, FootPlantMode } from "./visual";
import type { FighterModelId } from "./model-skins";
import { disposeQuaterniusModelSkin, installQuaterniusModelSkin } from "./visual-quaternius-runtime";

function repairSeraWinding(visual: FighterVisual): void {
  const geometry = visual.bodyMesh.geometry;
  const index = geometry.index;
  const position = geometry.getAttribute("position");
  if (!index || !position) return;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const ab = new THREE.Vector3(); const ac = new THREE.Vector3(); const normal = new THREE.Vector3();
  const center = new THREE.Vector3(); const centroid = new THREE.Vector3(); const outward = new THREE.Vector3();
  let reversedGroups = 0; let reversedTriangles = 0;
  for (const group of geometry.groups) {
    centroid.set(0, 0, 0); let samples = 0;
    for (let offset = group.start; offset < group.start + group.count; offset += 1) {
      const vertex = index.getX(offset);
      centroid.x += position.getX(vertex); centroid.y += position.getY(vertex); centroid.z += position.getZ(vertex); samples += 1;
    }
    if (!samples) continue;
    centroid.multiplyScalar(1 / samples); let score = 0;
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      a.fromBufferAttribute(position, index.getX(offset)); b.fromBufferAttribute(position, index.getX(offset + 1)); c.fromBufferAttribute(position, index.getX(offset + 2));
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      center.copy(a).add(b).add(c).multiplyScalar(1 / 3); outward.subVectors(center, centroid); score += normal.dot(outward);
    }
    if (score >= -1e-10) continue;
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const second = index.getX(offset + 1); const third = index.getX(offset + 2);
      index.setX(offset + 1, third); index.setX(offset + 2, second); reversedTriangles += 1;
    }
    reversedGroups += 1;
  }
  index.needsUpdate = true; geometry.deleteAttribute("normal"); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  visual.root.userData.v11WindingRepair = { checkedGroups: geometry.groups.length, reversedGroups, reversedTriangles };
}

function createOriginalFighterVisual(definition: FighterDefinition, quality: FighterVisualQuality): FighterVisual {
  if (definition.archetype === "SPEED") {
    const visual = createFemaleBlenderRuntimeVisual(definition, quality);
    repairSeraWinding(visual);
    return applyV11ReferencePose(visual);
  }
  return createKairoReconstructedVisual(definition, quality);
}

export function createFighterVisual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
  modelId: FighterModelId = "ORIGINAL",
): FighterVisual {
  const visual = createOriginalFighterVisual(definition, quality);
  visual.root.userData.modelSkin = modelId;
  if (modelId === "QUATERNIUS_UBC") installQuaterniusModelSkin(visual, definition.colors.primary);
  return visual;
}

export function disposeFighterVisual(visual: FighterVisual): void {
  disposeQuaterniusModelSkin(visual);
  disposeBaseFighterVisual(visual);
}

export { getSoleContactPoint, getVisualContactPoint, getWalkFootTarget, releaseFootPlants, updateFootPlants, visualGroundOffset };
export type { FighterVisual, FighterVisualQuality, FootPlantMode };
