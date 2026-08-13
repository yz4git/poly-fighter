import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { createFemaleV9Visual } from "./visual-v9";
import { SERA_V10_RECONSTRUCTION } from "./sera-v10-data";

const SOURCE_HEIGHT_METERS = 1.68;
type Influence = [number, number];

function normalizedInfluences(pairs: Influence[]): Influence[] {
  const filtered = pairs.filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = filtered.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return filtered.map(([bone, weight]) => [bone, weight / total]);
}

function smoothBlend(value: number, start: number, end: number): number {
  const t = THREE.MathUtils.clamp((value - start) / Math.max(1e-6, end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob !== "function") throw new Error("SERA_V10_BASE64_UNAVAILABLE");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Decode the static output of the offline four-view visual-hull reconstruction. */
export function decodeSeraV10Geometry(): THREE.BufferGeometry {
  const meta = SERA_V10_RECONSTRUCTION;
  const bytes = decodeBase64(meta.dataBase64);
  const vertexBytes = meta.vertexCount * 3 * 2;
  const faceIndexBytes = meta.faceCount * 3 * 2;
  const expected = vertexBytes + faceIndexBytes + meta.faceCount * 3;
  if (bytes.byteLength !== expected) throw new Error(`SERA_V10_DATA_SIZE ${bytes.byteLength} != ${expected}`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = meta.boundsMin;
  const max = meta.boundsMax;
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const;
  const positions = new Float32Array(meta.faceCount * 9);
  const colors = new Float32Array(meta.faceCount * 9);

  const qpos = (vertex: number, axis: number): number => {
    const q = view.getUint16((vertex * 3 + axis) * 2, true);
    return (min[axis] + (q / 65535) * span[axis]) / SOURCE_HEIGHT_METERS;
  };

  const indexOffset = vertexBytes;
  const colorOffset = vertexBytes + faceIndexBytes;
  for (let face = 0; face < meta.faceCount; face += 1) {
    const r = bytes[colorOffset + face * 3] / 255;
    const g = bytes[colorOffset + face * 3 + 1] / 255;
    const b = bytes[colorOffset + face * 3 + 2] / 255;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = view.getUint16(indexOffset + (face * 3 + corner) * 2, true);
      const out = face * 9 + corner * 3;
      positions[out] = qpos(vertex, 0);
      positions[out + 1] = qpos(vertex, 1);
      positions[out + 2] = qpos(vertex, 2);
      colors[out] = r;
      colors[out + 1] = g;
      colors[out + 2] = b;
    }
  }

  // Put the reconstructed feet on normalized Y=0 and center the authored X/Z
  // coordinate system before skinning. Geometry remains the same persistent 3D
  // surface for every camera angle.
  let minY = Number.POSITIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= centerX;
    positions[i + 1] -= minY;
    positions[i + 2] -= centerZ;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.visualVersion = "V10";
  geometry.userData.reconstruction = "four-view-visual-hull";
  geometry.userData.sourceHeightMeters = SOURCE_HEIGHT_METERS;
  geometry.userData.referenceSilhouetteIoU = meta.silhouetteIoU;
  return geometry;
}

/**
 * Transfer the offline static mesh onto the proven V4 rig. This does not create
 * the body shape; it only assigns short-range joint weights to already-authored
 * reconstruction vertices.
 */
export function assignV10Skinning(geometry: THREE.BufferGeometry, boneIndices: Record<string, number>): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const indices: number[] = [];
  const weights: number[] = [];
  const write = (pairs: Influence[]) => {
    const normalized = normalizedInfluences(pairs);
    for (let slot = 0; slot < 4; slot += 1) {
      indices.push(normalized[slot]?.[0] ?? 0);
      weights.push(normalized[slot]?.[1] ?? 0);
    }
  };

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    const side = x < 0 ? "left" : "right";
    const absX = Math.abs(x);

    if (y >= 0.842 || (z < -0.060 && y > 0.675)) {
      write([[boneIndices.head, 1]]);
      continue;
    }
    if (absX > 0.108 && y > 0.365 && y < 0.842) {
      const upper = boneIndices[`${side}UpperArm`];
      const fore = boneIndices[`${side}Forearm`];
      const hand = boneIndices[`${side}Hand`];
      if (y > 0.640) {
        const t = smoothBlend(y, 0.625, 0.675);
        write([[upper, 0.72 + 0.28 * t], [fore, 0.28 * (1 - t)]]);
      } else if (y > 0.475) {
        const t = smoothBlend(y, 0.455, 0.500);
        write([[fore, 0.78 + 0.20 * t], [hand, 0.22 * (1 - t)]]);
      } else {
        write([[hand, 1]]);
      }
      continue;
    }
    if (y < 0.610 && !(y > 0.445 && absX < 0.120)) {
      const thigh = boneIndices[`${side}Thigh`];
      const shin = boneIndices[`${side}Shin`];
      const foot = boneIndices[`${side}Foot`];
      if (y > 0.315) {
        write([[thigh, 1]]);
      } else if (y > 0.270) {
        const t = smoothBlend(y, 0.270, 0.315);
        write([[thigh, t], [shin, 1 - t]]);
      } else if (y > 0.075) {
        write([[shin, 1]]);
      } else {
        const t = smoothBlend(y, 0.050, 0.085);
        write([[foot, 0.82 + 0.18 * (1 - t)], [shin, 0.18 * t]]);
      }
      continue;
    }
    if (y < 0.625) write([[boneIndices.hips, 0.88], [boneIndices.spineLower, 0.12]]);
    else if (y < 0.705) {
      const t = smoothBlend(y, 0.625, 0.705);
      write([[boneIndices.hips, 1 - t], [boneIndices.spineLower, t]]);
    } else if (y < 0.785) {
      const t = smoothBlend(y, 0.705, 0.785);
      write([[boneIndices.spineLower, 1 - t], [boneIndices.spineUpper, t]]);
    } else if (y < 0.842) {
      const t = smoothBlend(y, 0.785, 0.842);
      write([[boneIndices.spineUpper, 1 - t], [boneIndices.chest, t]]);
    } else write([[boneIndices.head, 1]]);
  }

  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
}

export function createFemaleV10Visual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  const visual = createFemaleV9Visual(definition, quality);
  const geometry = decodeSeraV10Geometry();
  assignV10Skinning(geometry, visual.rig.boneIndices);

  const oldGeometry = visual.bodyMesh.geometry;
  const oldMaterial = visual.bodyMesh.material;
  oldGeometry.dispose();
  if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
  else oldMaterial.dispose();

  visual.bodyMesh.geometry = geometry;
  visual.bodyMesh.material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    roughness: 0.68,
    metalness: 0.015,
  });
  visual.bodyMesh.bind(visual.rig.skeleton, visual.bodyMesh.bindMatrix);
  visual.bodyMesh.normalizeSkinWeights();
  visual.bodyMesh.name = "v10-sera-turnaround-reconstructed-skinned-mesh";
  visual.bodyMesh.userData.reconstruction = "four-view-visual-hull";
  visual.root.name = `fighter-v10-${definition.id}`;
  visual.root.userData.visualPipeline = "V10_OFFLINE_TURNAROUND_RECONSTRUCTION";
  visual.root.userData.visualVersion = "V10";

  const vertexCount = geometry.getAttribute("position")?.count ?? 0;
  visual.stats.vertexCount = vertexCount;
  visual.stats.triangleCount = Math.floor(vertexCount / 3);
  visual.stats.meshCount = 1;
  visual.stats.materialCount = 1;
  visual.stats.weightedVertexCount = vertexCount;
  return visual;
}
