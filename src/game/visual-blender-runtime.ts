import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FighterDefinition } from "./types";
import type { FighterVisual, FighterVisualQuality } from "./visual";
import { auditSeraSkinAttributes } from "./visual-blender-diagnostics";
import { createSeraRuntimeMetadata } from "./visual-blender-metadata";
import {
  assignSeraBlenderSkinning,
  SERA_AUTHORED_PART,
  type SeraAuthoredPartCode,
} from "./visual-blender-skinning";
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

/**
 * Map Blender-authored source names to canonical gameplay-rig part identities.
 *
 * The imported Quaternius source uses the opposite X-side convention from the
 * canonical POLY FIGHTER rig: Blender `_r` pieces are on normalized x < 0,
 * which is canonical LEFT, while `_l` pieces are on x > 0 (canonical RIGHT).
 * The explicit IDs cover rigid equipment, source-rig arm regions, the collar,
 * skirt panels and authored head pieces. Region IDs select the intended smooth
 * skinning profile without making organic cloth/body regions rigid.
 */
export function authoredPartFromName(rawName: string): SeraAuthoredPartCode {
  const name = rawName.replace(/^Runtime_/, "").replace(/\.\d+$/, "");
  if (name === "SERA_Guard_r") return SERA_AUTHORED_PART.LEFT_FOREARM_GUARD;
  if (name === "SERA_Guard_l") return SERA_AUTHORED_PART.RIGHT_FOREARM_GUARD;
  if (name === "SERA_Shin_r") return SERA_AUTHORED_PART.LEFT_SHIN_GUARD;
  if (name === "SERA_Shin_l") return SERA_AUTHORED_PART.RIGHT_SHIN_GUARD;
  if (name === "SERA_BootFoot_r") return SERA_AUTHORED_PART.LEFT_BOOT;
  if (name === "SERA_BootFoot_l") return SERA_AUTHORED_PART.RIGHT_BOOT;
  if (name === "SERA_Body_Shoulder_r") return SERA_AUTHORED_PART.LEFT_SHOULDER_REGION;
  if (name === "SERA_Body_Shoulder_l") return SERA_AUTHORED_PART.RIGHT_SHOULDER_REGION;
  if (name === "SERA_Body_UpperArm_r") return SERA_AUTHORED_PART.LEFT_UPPER_ARM_REGION;
  if (name === "SERA_Body_UpperArm_l") return SERA_AUTHORED_PART.RIGHT_UPPER_ARM_REGION;
  if (name === "SERA_Body_Forearm_r") return SERA_AUTHORED_PART.LEFT_FOREARM_REGION;
  if (name === "SERA_Body_Forearm_l") return SERA_AUTHORED_PART.RIGHT_FOREARM_REGION;
  if (name === "SERA_Body_Hand_r") return SERA_AUTHORED_PART.LEFT_HAND_REGION;
  if (name === "SERA_Body_Hand_l") return SERA_AUTHORED_PART.RIGHT_HAND_REGION;
  if (name === "SERA_Collar") return SERA_AUTHORED_PART.COLLAR_PANEL;
  if (name === "SERA_FrontSkirt") return SERA_AUTHORED_PART.FRONT_SKIRT_PANEL;
  if (name === "SERA_LeftSkirt") return SERA_AUTHORED_PART.LEFT_SKIRT_PANEL;
  if (name === "SERA_RightSkirt") return SERA_AUTHORED_PART.RIGHT_SKIRT_PANEL;
  if (
    name.startsWith("SERA_Hair")
    || name.startsWith("SERA_Fringe")
    || name.startsWith("SERA_SideHair")
    || name.startsWith("SERA_NapeHair")
    || name.startsWith("SERA_BackHair")
    || name.startsWith("SERA_Pony")
    || name.startsWith("SERA_TempleLock")
    || name.startsWith("SERA_Brow")
    || name.startsWith("SERA_Eye")
    || name === "SERA_NosePlane"
    || name === "SERA_Lip"
  ) return SERA_AUTHORED_PART.HEAD;
  return SERA_AUTHORED_PART.HEURISTIC;
}

/** Historical V9 segment centers retained for diagnostics/regression comparison. */
export function targetSeraArmBindCentroid(part: SeraAuthoredPartCode): readonly [number, number, number] | null {
  switch (part) {
    case SERA_AUTHORED_PART.LEFT_UPPER_ARM_REGION: return [-0.134, 0.738, 0.010];
    case SERA_AUTHORED_PART.RIGHT_UPPER_ARM_REGION: return [0.134, 0.738, 0.010];
    case SERA_AUTHORED_PART.LEFT_FOREARM_REGION: return [-0.147, 0.562, 0.015];
    case SERA_AUTHORED_PART.RIGHT_FOREARM_REGION: return [0.147, 0.562, 0.015];
    case SERA_AUTHORED_PART.LEFT_HAND_REGION: return [-0.155, 0.438, 0.030];
    case SERA_AUTHORED_PART.RIGHT_HAND_REGION: return [0.155, 0.438, 0.030];
    case SERA_AUTHORED_PART.LEFT_FOREARM_GUARD: return [-0.151, 0.548, 0.036];
    case SERA_AUTHORED_PART.RIGHT_FOREARM_GUARD: return [0.151, 0.548, 0.036];
    default: return null;
  }
}

/**
 * The current Blender runtime already freezes a coherent arms-down anatomical
 * bind. Any per-region translation breaks the shared source boundaries. Keep
 * the V9 target table above only as diagnostics; V18 intentionally retains the
 * Blender source placement for every organic arm/equipment region.
 */
export function seraArmBindRetargetStrength(part: SeraAuthoredPartCode): number {
  switch (part) {
    case SERA_AUTHORED_PART.LEFT_UPPER_ARM_REGION:
    case SERA_AUTHORED_PART.RIGHT_UPPER_ARM_REGION:
    case SERA_AUTHORED_PART.LEFT_FOREARM_REGION:
    case SERA_AUTHORED_PART.RIGHT_FOREARM_REGION:
    case SERA_AUTHORED_PART.LEFT_HAND_REGION:
    case SERA_AUTHORED_PART.RIGHT_HAND_REGION:
    case SERA_AUTHORED_PART.LEFT_FOREARM_GUARD:
    case SERA_AUTHORED_PART.RIGHT_FOREARM_GUARD:
      return 0;
    default:
      return 0;
  }
}

/**
 * Preserve Blender-authored arm continuity. The centroid audit remains here so
 * future runtime sources can opt into a correction without reintroducing the
 * V7/V17 shoulder, elbow and wrist gaps.
 */
function retargetSeraArmBindCentroids(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const part = geometry.getAttribute("seraPart") as THREE.BufferAttribute | undefined;
  if (!position || !part || position.count !== part.count) return;

  const sums = new Map<number, { x: number; y: number; z: number; count: number }>();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const code = Math.round(part.getX(vertex)) as SeraAuthoredPartCode;
    if (!targetSeraArmBindCentroid(code) || seraArmBindRetargetStrength(code) <= 0) continue;
    const entry = sums.get(code) ?? { x: 0, y: 0, z: 0, count: 0 };
    entry.x += position.getX(vertex);
    entry.y += position.getY(vertex);
    entry.z += position.getZ(vertex);
    entry.count += 1;
    sums.set(code, entry);
  }

  const offsets = new Map<number, THREE.Vector3>();
  for (const [code, sum] of sums) {
    if (sum.count <= 0) continue;
    const typedCode = code as SeraAuthoredPartCode;
    const target = targetSeraArmBindCentroid(typedCode);
    if (!target) continue;
    const strength = seraArmBindRetargetStrength(typedCode);
    const current = new THREE.Vector3(sum.x / sum.count, sum.y / sum.count, sum.z / sum.count);
    const fullOffset = new THREE.Vector3(target[0], target[1], target[2]).sub(current);
    if (fullOffset.length() > 0.12) throw new Error(`SERA_ARM_BIND_RETARGET_OUT_OF_RANGE_${code}`);
    const offset = fullOffset.multiplyScalar(strength);
    if (offset.length() > 0.045) throw new Error(`SERA_ARM_BIND_CONTINUITY_OFFSET_OUT_OF_RANGE_${code}`);
    offsets.set(code, offset);
  }

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const code = Math.round(part.getX(vertex));
    const offset = offsets.get(code);
    if (!offset) continue;
    position.setXYZ(
      vertex,
      position.getX(vertex) + offset.x,
      position.getY(vertex) + offset.y,
      position.getZ(vertex) + offset.z,
    );
  }
  position.needsUpdate = true;
  geometry.userData.armBindRetarget = "BLENDER_SOURCE_NATIVE_V18";
  geometry.userData.armBindRetargetOffsets = Object.fromEntries(
    [...offsets.entries()].map(([code, offset]) => [String(code), offset.toArray()]),
  );
}

/**
 * Align manually-authored panels into the canonical bind frame before they use
 * their explicit collar/skirt region IDs. The Blender overlays are authored in
 * world-space around the normalized source body, so retaining this small bind
 * correction keeps their visual placement matching the reference asset while
 * the explicit IDs remove any dependency on position/color classification.
 */
function alignAuthoredPanelRestPose(sourceName: string, geometry: THREE.BufferGeometry): void {
  const name = sourceName.replace(/^Runtime_/, "").replace(/\.\d+$/, "");
  let offsetY = 0;
  let verticalScale = 1;
  if (name === "SERA_Collar") {
    offsetY = 0.10;
  } else if (name === "SERA_FrontSkirt" || name === "SERA_LeftSkirt" || name === "SERA_RightSkirt") {
    offsetY = 0.24;
    verticalScale = 0.82;
  } else {
    return;
  }

  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position || position.count === 0) return;
  let centerY = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) centerY += position.getY(vertex);
  centerY /= position.count;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const y = centerY + (position.getY(vertex) - centerY) * verticalScale + offsetY;
    position.setY(vertex, y);
  }
  position.needsUpdate = true;
}

function bakeMaterialColors(source: THREE.Mesh): THREE.BufferGeometry {
  const transformed = source.geometry.clone();
  transformed.applyMatrix4(source.matrixWorld);
  const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) throw new Error("SERA_BLENDER_RUNTIME_GLB_HAS_NO_POSITION");
  alignAuthoredPanelRestPose(source.name, geometry);

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

  const partCode = authoredPartFromName(source.name);
  const authoredParts = new Float32Array(position.count);
  if (partCode !== SERA_AUTHORED_PART.HEURISTIC) authoredParts.fill(partCode);

  geometry.clearGroups();
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("seraPart", new THREE.BufferAttribute(authoredParts, 1));
  geometry.deleteAttribute("skinIndex");
  geometry.deleteAttribute("skinWeight");
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("uv1");
  geometry.deleteAttribute("tangent");
  geometry.userData.seraRuntimeSourceName = source.name;
  geometry.userData.seraAuthoredPart = partCode;
  if (geometry !== transformed) transformed.dispose();
  return geometry;
}

function collectRuntimePieces(root: THREE.Object3D): THREE.BufferGeometry[] {
  root.updateMatrixWorld(true);
  const pieces: THREE.BufferGeometry[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || mesh.name === "Ground") return;
    pieces.push(bakeMaterialColors(mesh));
  });
  if (pieces.length === 0) throw new Error("SERA_BLENDER_RUNTIME_GLB_HAS_NO_MESH");
  return pieces;
}

export function normalizeSeraRuntimeGeometry(root: THREE.Object3D): THREE.BufferGeometry {
  const pieces = collectRuntimePieces(root);
  const primitiveCount = pieces.length;
  const geometry = mergeGeometries(pieces, false);
  pieces.forEach((piece) => piece.dispose());
  if (!geometry) throw new Error("SERA_BLENDER_RUNTIME_GLB_MERGE_FAILED");

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
  retargetSeraArmBindCentroids(geometry);
  geometry.deleteAttribute("normal");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.visualVersion = "BLENDER_RUNTIME_V9_SOURCE_NATIVE";
  geometry.userData.assetUrl = SERA_BLENDER_RUNTIME_ASSET_URL;
  geometry.userData.authoredHeightMeters = 1.68;
  geometry.userData.sourcePrimitiveCount = primitiveCount;
  geometry.userData.authoredPieceCount = primitiveCount;
  geometry.userData.runtimeBindPose = "CANONICAL_ARMS_DOWN_V1";
  return geometry;
}

function loadSourceGeometry(): Promise<THREE.BufferGeometry> {
  if (sourceGeometryPromise) return sourceGeometryPromise;
  const loader = new GLTFLoader();
  sourceGeometryPromise = loader.loadAsync(SERA_BLENDER_RUNTIME_ASSET_URL)
    .then((gltf) => normalizeSeraRuntimeGeometry(gltf.scene))
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
  const skinningDiagnostics = assignSeraBlenderSkinning(geometry, visual.rig.boneIndices);
  const weightAudit = auditSeraSkinAttributes(geometry);
  const runtimeMetadata = createSeraRuntimeMetadata(skinningDiagnostics, weightAudit);

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
  visual.bodyMesh.userData.reconstruction = "blender-conformal-runtime-glb-part-aware";
  oldGeometry.dispose();
  disposeMaterial(oldMaterial);

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = Math.floor(position.count / 3);
  visual.stats.meshCount = 1;
  visual.stats.materialCount = 1;
  visual.stats.weightedVertexCount = position.count;
  visual.root.userData.blenderRuntimeAssetState = "ready";
  visual.root.userData.skinningVersion = runtimeMetadata.skinningVersion;
  visual.root.userData.blenderRuntimePrimitiveMerge = source.userData.sourcePrimitiveCount ?? null;
  visual.root.userData.blenderRuntimeAuthoredPieces = source.userData.authoredPieceCount ?? null;
  visual.root.userData.blenderRuntimeBindPose = source.userData.runtimeBindPose ?? null;
  visual.root.userData.blenderRuntimeBindRetarget = source.userData.armBindRetarget ?? null;
  visual.root.userData.blenderRuntimeBindRetargetOffsets = source.userData.armBindRetargetOffsets ?? null;
  visual.root.userData.blenderSkinningDiagnostics = skinningDiagnostics;
  visual.root.userData.blenderSkinningSeamContinuity = geometry.userData.skinningSeamContinuity;
  visual.root.userData.blenderWeightAudit = weightAudit;
  visual.root.userData.blenderRuntimeMetadata = runtimeMetadata;
  visual.bodyMesh.userData.skinningVersion = runtimeMetadata.skinningVersion;
}

export function createFemaleBlenderRuntimeVisual(
  definition: FighterDefinition,
  quality: FighterVisualQuality = "NORMAL",
): FighterVisual {
  const visual = createFemaleV9Visual(definition, quality);
  visual.root.name = `fighter-blender-runtime-${definition.id}`;
  visual.root.userData.visualPipeline = "BLENDER_CONFORMAL_GLB_CANONICAL_RIG";
  visual.root.userData.visualVersion = "BLENDER_RUNTIME_V9_SOURCE_NATIVE";
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
