import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { assignV10Skinning } from "./visual-v10";
import { createFemaleV9Visual } from "./visual-v9";

export const SERA_BLENDER_RUNTIME_ASSET_URL = "/models/sera-blender-runtime.glb";

let sourceGeometryPromise: Promise<THREE.BufferGeometry> | null = null;

function materialColor(material: THREE.Material | undefined): THREE.Color {
  if (material && "color" in material) {
    const value = (material as THREE.Material & { color?: THREE.Color }).color;
    if (value?.isColor) return value.clone();
  }
  return new THREE.Color(0xffffff);
}

function chooseRuntimeMesh(root: THREE.Object3D): THREE.Mesh {
  root.updateMatrixWorld(true);
  let selected: THREE.Mesh | null = null;
  let selectedVertices = -1;
  root.traverse((object) => {
    const candidate = object as THREE.Mesh;
    if (!candidate.isMesh || !candidate.geometry || candidate.name === "Ground") return;
    const count = candidate.geometry.getAttribute("position")?.count ?? 0;
    const preferred = candidate.name === "SERA_RuntimeMesh" ? 1_000_000 : 0;
    if (count + preferred > selectedVertices) {
      selected = candidate;
      selectedVertices = count + preferred;
    }
  });
  if (!selected) throw new Error("SERA_BLENDER_RUNTIME_GLB_HAS_NO_MESH");
  return selected;
}

function bakeMaterialColors(source: THREE.Mesh): THREE.BufferGeometry {
  const transformed = source.geometry.clone();
  transformed.applyMatrix4(source.matrixWorld);
  const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) throw new Error("SERA_BLENDER_RUNTIME_GLB_HAS_NO_POSITION");

  const materials = Array.isArray(source.material) ? source.material : [source.material];
  const colors = new Float32Array(position.count * 3);
  const fallback = materialColor(materials[0]);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    colors[vertex * 3] = fallback.r;
    colors[vertex * 3 + 1] = fallback.g;
    colors[vertex * 3 + 2] = fallback.b;
  }

  for (const group of geometry.groups) {
    const color = materialColor(materials[group.materialIndex ?? 0]);
    const end = Math.min(position.count, group.start + group.count);
    for (let vertex = Math.max(0, group.start); vertex < end; vertex += 1) {
      colors[vertex * 3] = color.r;
      colors[vertex * 3 + 1] = color.g;
      colors[vertex * 3 + 2] = color.b;
    }
  }

  geometry.clearGroups();
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute("skinIndex");
  geometry.deleteAttribute("skinWeight");
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("uv1");
  geometry.deleteAttribute("tangent");
  if (geometry !== transformed) transformed.dispose();
  return geometry;
}

function normalizeRuntimeGeometry(source: THREE.Mesh): THREE.BufferGeometry {
  const geometry = bakeMaterialColors(source);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error("SERA_BLENDER_RUNTIME_GLB_HAS_NO_BOUNDS");
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 1e-5) throw new Error("SERA_BLENDER_RUNTIME_GLB_INVALID_HEIGHT");

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
  geometry.userData.visualVersion = "BLENDER_RUNTIME_V1";
  geometry.userData.assetUrl = SERA_BLENDER_RUNTIME_ASSET_URL;
  geometry.userData.authoredHeightMeters = 1.68;
  return geometry;
}

function loadSourceGeometry(): Promise<THREE.BufferGeometry> {
  if (sourceGeometryPromise) return sourceGeometryPromise;
  const loader = new GLTFLoader();
  sourceGeometryPromise = loader.loadAsync(SERA_BLENDER_RUNTIME_ASSET_URL)
    .then((gltf) => normalizeRuntimeGeometry(chooseRuntimeMesh(gltf.scene)))
    .catch((error) => {
      sourceGeometryPromise = null;
      throw error;
    });
  return sourceGeometryPromise;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
}

function installRuntimeGeometry(visual: FighterVisual, source: THREE.BufferGeometry): void {
  const geometry = source.clone();
  assignV10Skinning(geometry, visual.rig.boneIndices);

  const oldGeometry = visual.bodyMesh.geometry;
  const oldMaterial = visual.bodyMesh.material;
  visual.bodyMesh.geometry = geometry;
  visual.bodyMesh.material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    roughness: 0.72,
    metalness: 0.015,
  });
  visual.bodyMesh.bind(visual.rig.skeleton, visual.bodyMesh.bindMatrix);
  visual.bodyMesh.normalizeSkinWeights();
  visual.bodyMesh.name = "sera-blender-runtime-skinned-mesh";
  visual.bodyMesh.userData.reconstruction = "blender-conformal-runtime-glb";
  oldGeometry.dispose();
  disposeMaterial(oldMaterial);

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = Math.floor(position.count / 3);
  visual.stats.meshCount = 1;
  visual.stats.materialCount = 1;
  visual.stats.weightedVertexCount = position.count;
  visual.root.userData.blenderRuntimeAssetState = "ready";
  visual.root.userData.skinningVersion = "V10.1_SEMANTIC_REGIONS";
}

export function createFemaleBlenderRuntimeVisual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  const visual = createFemaleV9Visual(definition, quality);
  visual.root.name = `fighter-blender-runtime-${definition.id}`;
  visual.root.userData.visualPipeline = "BLENDER_CONFORMAL_GLB_CANONICAL_RIG";
  visual.root.userData.visualVersion = "BLENDER_RUNTIME_V1";
  visual.root.userData.blenderRuntimeAsset = SERA_BLENDER_RUNTIME_ASSET_URL;
  visual.root.userData.blenderRuntimeAssetState = "pending";
  visual.bodyMesh.userData.reconstruction = "blender-runtime-glb-pending";
  visual.visualVersion = "V11" as unknown as FighterVisual["visualVersion"];
  visual.stats.visualVersion = "V11" as unknown as FighterVisual["stats"]["visualVersion"];

  if (typeof window !== "undefined" && typeof fetch === "function") {
    visual.root.userData.blenderRuntimeAssetState = "loading";
    void loadSourceGeometry()
      .then((source) => installRuntimeGeometry(visual, source))
      .catch((error: unknown) => {
        visual.root.userData.blenderRuntimeAssetState = "failed";
        console.error("[POLY FIGHTER] SERA Blender runtime GLB load failed", error);
      });
  }

  return visual;
}
