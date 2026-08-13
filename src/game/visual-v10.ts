import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { createFemaleV9Visual } from "./visual-v9";

export const SERA_V10_ASSET_URL = "/models/sera-v10.glb";
type Influence = [number, number];
export type V10Semantic = "skin" | "blue" | "black" | "silver" | "unknown";
export type V10SkinRegion =
  | "HEAD"
  | "TORSO"
  | "HIPS"
  | "LEFT_UPPER_ARM"
  | "RIGHT_UPPER_ARM"
  | "LEFT_FOREARM"
  | "RIGHT_FOREARM"
  | "LEFT_HAND"
  | "RIGHT_HAND"
  | "LEFT_THIGH"
  | "RIGHT_THIGH"
  | "LEFT_SHIN"
  | "RIGHT_SHIN"
  | "LEFT_FOOT"
  | "RIGHT_FOOT";

let sourceGeometryPromise: Promise<THREE.BufferGeometry> | null = null;

function normalizedInfluences(pairs: Influence[]): Influence[] {
  const filtered = pairs.filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = filtered.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return filtered.map(([bone, weight]) => [bone, weight / total]);
}

function smoothBlend(value: number, start: number, end: number): number {
  const t = THREE.MathUtils.clamp((value - start) / Math.max(1e-6, end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function chooseReconstructionMesh(root: THREE.Object3D): THREE.Mesh {
  let selected: THREE.Mesh | null = null;
  let selectedVertices = -1;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const candidate = object as THREE.Mesh;
    if (!candidate.isMesh || !candidate.geometry) return;
    const count = candidate.geometry.getAttribute("position")?.count ?? 0;
    if (count > selectedVertices) {
      selected = candidate;
      selectedVertices = count;
    }
  });
  if (!selected) throw new Error("SERA_V10_GLB_HAS_NO_MESH");
  return selected;
}

/** Normalize the offline 1.68m reconstruction to the combat rig's 0..1 body space. */
function normalizeReconstructionGeometry(source: THREE.Mesh): THREE.BufferGeometry {
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error("SERA_V10_GLB_HAS_NO_BOUNDS");
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 1e-5) throw new Error("SERA_V10_GLB_INVALID_HEIGHT");

  const centerX = (box.min.x + box.max.x) * 0.5;
  const centerZ = (box.min.z + box.max.z) * 0.5;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    position.setXYZ(
      vertex,
      (position.getX(vertex) - centerX) / height,
      (position.getY(vertex) - box.min.y) / height,
      (position.getZ(vertex) - centerZ) / height,
    );
  }
  position.needsUpdate = true;
  geometry.deleteAttribute("normal");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.visualVersion = "V10.1";
  geometry.userData.reconstruction = "four-view-visual-hull-glb";
  geometry.userData.assetUrl = SERA_V10_ASSET_URL;
  geometry.userData.authoredHeightMeters = 1.68;
  return geometry;
}

function loadSourceGeometry(): Promise<THREE.BufferGeometry> {
  if (sourceGeometryPromise) return sourceGeometryPromise;
  const loader = new GLTFLoader();
  sourceGeometryPromise = loader.loadAsync(SERA_V10_ASSET_URL)
    .then((gltf) => normalizeReconstructionGeometry(chooseReconstructionMesh(gltf.scene)))
    .catch((error) => {
      sourceGeometryPromise = null;
      throw error;
    });
  return sourceGeometryPromise;
}

const SEMANTIC_RGB: Record<Exclude<V10Semantic, "unknown">, readonly [number, number, number]> = {
  skin: [211 / 255, 161 / 255, 132 / 255],
  blue: [36 / 255, 82 / 255, 197 / 255],
  black: [14 / 255, 14 / 255, 22 / 255],
  silver: [216 / 255, 224 / 255, 235 / 255],
};

function semanticAt(color: THREE.BufferAttribute | null, vertex: number): V10Semantic {
  if (!color) return "unknown";
  const r = color.getX(vertex);
  const g = color.getY(vertex);
  const b = color.getZ(vertex);
  let best: V10Semantic = "unknown";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, rgb] of Object.entries(SEMANTIC_RGB) as Array<[Exclude<V10Semantic, "unknown">, readonly [number, number, number]]>) {
    const distance = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

/**
 * V10.1 region classifier.
 *
 * V10's first runtime pass classified anything outside |x| > 0.108 as an arm.
 * That included waist panels, skirt volume and torso facets; when the guard
 * pose moved an arm bone those unrelated triangles were stretched across the
 * screen. V10.1 makes the semantic/color and anatomical gates explicit:
 * blue/black waist volume stays on hips, silver forearm guards stay on arms,
 * the ponytail stays on the head, and the lower body is never allowed to pick
 * an arm bone merely because a costume silhouette is wide.
 */
export function classifyV10SkinRegion(x: number, y: number, z: number, semantic: V10Semantic): V10SkinRegion {
  const side = x < 0 ? "LEFT" : "RIGHT";
  const absX = Math.abs(x);

  const ponytail = y > 0.665 && z < -0.080 && absX < 0.155;
  if (y >= 0.835 || ponytail) return "HEAD";

  const armThreshold = y > 0.720 ? 0.108 : y > 0.620 ? 0.128 : 0.145;
  const armSemantic = semantic === "silver"
    || semantic === "skin"
    || (semantic === "black" && absX > 0.170)
    || (semantic === "blue" && y > 0.675);
  if (y > 0.420 && y < 0.835 && absX > armThreshold && armSemantic) {
    if (y > 0.655) return `${side}_UPPER_ARM` as V10SkinRegion;
    if (y > 0.495) return `${side}_FOREARM` as V10SkinRegion;
    return `${side}_HAND` as V10SkinRegion;
  }

  if (y < 0.430) {
    if (y < 0.080) return `${side}_FOOT` as V10SkinRegion;
    if (y < 0.300) return `${side}_SHIN` as V10SkinRegion;
    return `${side}_THIGH` as V10SkinRegion;
  }

  if (y < 0.605) {
    const narrowLeg = absX > 0.018 && absX < 0.118;
    const darkLeg = narrowLeg && semantic === "black" && (y < 0.545 || absX < 0.085);
    if ((semantic === "skin" && absX < 0.135) || darkLeg || (y < 0.495 && narrowLeg && semantic === "blue")) {
      return `${side}_THIGH` as V10SkinRegion;
    }
    return "HIPS";
  }

  if (y < 0.690) return "HIPS";
  return "TORSO";
}

function influencesForRegion(region: V10SkinRegion, y: number, b: Record<string, number>): Influence[] {
  switch (region) {
    case "HEAD":
      return [[b.head, 1]];
    case "HIPS": {
      const t = smoothBlend(y, 0.590, 0.690);
      return [[b.hips, 1 - t * 0.58], [b.spineLower, t * 0.58]];
    }
    case "TORSO": {
      if (y < 0.745) {
        const t = smoothBlend(y, 0.690, 0.745);
        return [[b.spineLower, 1 - t], [b.spineUpper, t]];
      }
      if (y < 0.815) {
        const t = smoothBlend(y, 0.745, 0.815);
        return [[b.spineUpper, 1 - t * 0.82], [b.chest, t * 0.82]];
      }
      return [[b.chest, 0.88], [b.neck, 0.12]];
    }
    case "LEFT_UPPER_ARM":
    case "RIGHT_UPPER_ARM": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const elbowBlend = 1 - smoothBlend(y, 0.635, 0.685);
      return [[b[`${prefix}UpperArm`], 1 - elbowBlend * 0.42], [b[`${prefix}Forearm`], elbowBlend * 0.42]];
    }
    case "LEFT_FOREARM":
    case "RIGHT_FOREARM": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const handBlend = 1 - smoothBlend(y, 0.480, 0.525);
      const upperBlend = smoothBlend(y, 0.615, 0.660) * 0.18;
      return [[b[`${prefix}Forearm`], 1 - handBlend * 0.34 - upperBlend], [b[`${prefix}Hand`], handBlend * 0.34], [b[`${prefix}UpperArm`], upperBlend]];
    }
    case "LEFT_HAND":
    case "RIGHT_HAND": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      return [[b[`${prefix}Hand`], 1]];
    }
    case "LEFT_THIGH":
    case "RIGHT_THIGH": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const hipBlend = smoothBlend(y, 0.500, 0.590) * 0.28;
      const shinBlend = (1 - smoothBlend(y, 0.285, 0.330)) * 0.40;
      return [[b[`${prefix}Thigh`], 1 - hipBlend - shinBlend], [b.hips, hipBlend], [b[`${prefix}Shin`], shinBlend]];
    }
    case "LEFT_SHIN":
    case "RIGHT_SHIN": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const thighBlend = smoothBlend(y, 0.275, 0.315) * 0.34;
      const footBlend = (1 - smoothBlend(y, 0.070, 0.105)) * 0.30;
      return [[b[`${prefix}Shin`], 1 - thighBlend - footBlend], [b[`${prefix}Thigh`], thighBlend], [b[`${prefix}Foot`], footBlend]];
    }
    case "LEFT_FOOT":
    case "RIGHT_FOOT": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      return [[b[`${prefix}Foot`], 0.94], [b[`${prefix}Shin`], 0.06]];
    }
  }
}

export function assignV10Skinning(geometry: THREE.BufferGeometry, boneIndices: Record<string, number>): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const color = (geometry.getAttribute("color") as THREE.BufferAttribute | undefined) ?? null;
  const indices: number[] = [];
  const weights: number[] = [];
  const regionCounts: Partial<Record<V10SkinRegion, number>> = {};

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
    const region = classifyV10SkinRegion(x, y, z, semanticAt(color, vertex));
    regionCounts[region] = (regionCounts[region] ?? 0) + 1;
    write(influencesForRegion(region, y, boneIndices));
  }

  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.userData.skinningVersion = "V10.1_SEMANTIC_REGIONS";
  geometry.userData.skinningRegionCounts = regionCounts;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
}

function installReconstructedGeometry(visual: FighterVisual, source: THREE.BufferGeometry): void {
  const geometry = source.clone();
  assignV10Skinning(geometry, visual.rig.boneIndices);

  const oldGeometry = visual.bodyMesh.geometry;
  const oldMaterial = visual.bodyMesh.material;
  visual.bodyMesh.geometry = geometry;
  visual.bodyMesh.material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: Boolean(geometry.getAttribute("color")),
    flatShading: true,
    roughness: 0.68,
    metalness: 0.015,
  });
  visual.bodyMesh.bind(visual.rig.skeleton, visual.bodyMesh.bindMatrix);
  visual.bodyMesh.normalizeSkinWeights();
  visual.bodyMesh.name = "v10-1-sera-turnaround-reconstructed-skinned-mesh";
  visual.bodyMesh.userData.reconstruction = "four-view-visual-hull-glb";
  oldGeometry.dispose();
  disposeMaterial(oldMaterial);

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const triangleCount = geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(position.count / 3);
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = triangleCount;
  visual.stats.meshCount = 1;
  visual.stats.materialCount = 1;
  visual.stats.weightedVertexCount = position.count;
  visual.root.userData.reconstructionAssetState = "ready";
  visual.root.userData.skinningVersion = "V10.1_SEMANTIC_REGIONS";
}

export function createFemaleV10Visual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  const visual = createFemaleV9Visual(definition, quality);
  visual.root.name = `fighter-v10-1-${definition.id}`;
  visual.root.userData.visualPipeline = "V10_GLB_TURNAROUND_RECONSTRUCTION";
  visual.root.userData.visualVersion = "V10.1";
  visual.root.userData.reconstructionAsset = SERA_V10_ASSET_URL;
  visual.root.userData.reconstructionAssetState = "pending";
  visual.bodyMesh.userData.reconstruction = "v10-glb-pending";
  visual.visualVersion = "V10" as unknown as FighterVisual["visualVersion"];
  visual.stats.visualVersion = "V10" as unknown as FighterVisual["stats"]["visualVersion"];

  if (typeof window !== "undefined" && typeof fetch === "function") {
    visual.root.userData.reconstructionAssetState = "loading";
    void loadSourceGeometry()
      .then((source) => installReconstructedGeometry(visual, source))
      .catch((error: unknown) => {
        visual.root.userData.reconstructionAssetState = "failed";
        console.error("[POLY FIGHTER] SERA V10 GLB load failed", error);
      });
  }

  return visual;
}
