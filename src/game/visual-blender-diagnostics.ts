import * as THREE from "three";

export interface SeraWeightAudit {
  vertexCount: number;
  invalidVertices: number;
  nonUnitVertices: number;
  maxInfluenceCount: number;
  dominantBoneCounts: Record<number, number>;
}

/** Validate the final GPU skin attributes before the Blender mesh is installed. */
export function auditSeraSkinAttributes(geometry: THREE.BufferGeometry): SeraWeightAudit {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const skinIndex = geometry.getAttribute("skinIndex") as THREE.BufferAttribute | undefined;
  const skinWeight = geometry.getAttribute("skinWeight") as THREE.BufferAttribute | undefined;
  if (!position || !skinIndex || !skinWeight || skinIndex.count !== position.count || skinWeight.count !== position.count) {
    throw new Error("SERA_BLENDER_SKIN_ATTRIBUTES_INCOMPLETE");
  }

  const result: SeraWeightAudit = {
    vertexCount: position.count,
    invalidVertices: 0,
    nonUnitVertices: 0,
    maxInfluenceCount: 0,
    dominantBoneCounts: {},
  };

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const indices = [skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex)];
    const weights = [skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex)];
    let sum = 0;
    let influenceCount = 0;
    let dominantWeight = -1;
    let dominantBone = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const bone = indices[slot];
      const weight = weights[slot];
      if (!Number.isFinite(bone) || bone < 0 || !Number.isFinite(weight) || weight < -1e-6) {
        result.invalidVertices += 1;
        break;
      }
      if (weight > 1e-6) {
        influenceCount += 1;
        sum += weight;
        if (weight > dominantWeight) {
          dominantWeight = weight;
          dominantBone = Math.round(bone);
        }
      }
    }
    result.maxInfluenceCount = Math.max(result.maxInfluenceCount, influenceCount);
    if (Math.abs(sum - 1) > 1e-3) result.nonUnitVertices += 1;
    result.dominantBoneCounts[dominantBone] = (result.dominantBoneCounts[dominantBone] ?? 0) + 1;
  }

  if (result.invalidVertices > 0 || result.nonUnitVertices > 0 || result.maxInfluenceCount > 4) {
    throw new Error(`SERA_BLENDER_SKIN_AUDIT_FAILED:${JSON.stringify(result)}`);
  }
  return result;
}
