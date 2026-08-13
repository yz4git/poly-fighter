import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { createFemaleV9Visual } from "./visual-v9";

export const SERA_V10_ASSET_URL = "/models/sera-v10.glb";
type Influence = [number, number];

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

/**
 * Convert the generated GLB into the normalized model space used by the proven
 * V4/V9 rig. The reconstruction itself remains one persistent 3D surface for
 * every camera direction; this step only removes exporter transforms and scales
 * the authored 1.68 m turnaround to the runtime's normalized one-unit height.
 */
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
  geometry.userData.visualVersion = "V10";
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

/**
 * Transfer the reconstructed static surface onto the existing combat skeleton.
 * These weights do not generate or alter the body shape; they only let the
 * already reconstructed mesh follow the proven V4 fighter rig.
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
  visual.bodyMesh.name = "v10-sera-turnaround-reconstructed-skinned-mesh";
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
}

export function createFemaleV10Visual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  // V9 is retained only as a proven skeleton/contact/foot-plant scaffold. Its
  // visible body geometry is replaced by the generated V10 GLB in the browser.
  const visual = createFemaleV9Visual(definition, quality);
  visual.root.name = `fighter-v10-${definition.id}`;
  visual.root.userData.visualPipeline = "V10_GLB_TURNAROUND_RECONSTRUCTION";
  visual.root.userData.visualVersion = "V10";
  visual.root.userData.reconstructionAsset = SERA_V10_ASSET_URL;
  visual.root.userData.reconstructionAssetState = "pending";
  visual.bodyMesh.userData.reconstruction = "v10-glb-pending";
  visual.visualVersion = "V10" as unknown as FighterVisual["visualVersion"];
  visual.stats.visualVersion = "V10" as unknown as FighterVisual["stats"]["visualVersion"];

  // Node-based rule tests intentionally do not perform network I/O. In the
  // browser the GLB is loaded once, cached as normalized source geometry, then
  // cloned per fighter so disposal cannot invalidate another fighter instance.
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
