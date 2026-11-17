import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual } from "./visual";
import { buildQuaterniusConformalGarment, QUATERNIUS_CONFORMAL_GARMENT_ID } from "./quaternius-conformal-garment";
import {
  QUATERNIUS_SKIN_CLOTH_ATTRIBUTE,
  QUATERNIUS_SKIN_CLOTH_PBR_ID,
  installQuaterniusSkinClothPbr,
  quaterniusSkinSurfaceWeight,
} from "./quaternius-skin-cloth-pbr";

/**
 * Outfit strategy for the production Quaternius UBC skin.
 *
 * The base character already owns a proven SkinnedMesh and 65-joint UAL-compatible
 * rig. Rebinding a second full costume mesh at runtime would duplicate skinning
 * work and invite rest-pose mismatch. Instead, use the existing vertex weights as
 * semantic body regions: face/neck remain skin while torso, arms and legs receive
 * garment vertex colours. The upper Head-weighted scalp is tinted with the fighter
 * hair colour so gaps between authored hair pieces never expose skin-coloured hair.
 * Authored hair/eye materials still opt out per material group, so a multi-material
 * body mesh can be dressed without repainting those authored details.
 */
export const QUATERNIUS_OUTFIT_SKIN_ID = "QUATERNIUS_OUTFIT_SKIN_V3_SCALP_HAIR_VERTEX_COLOR";

type OutfitTone = "SKIN" | "LIGHT" | "PRIMARY" | "DARK";

interface OutfitPalette {
  skin: THREE.Color;
  hair: THREE.Color;
  light: THREE.Color;
  primary: THREE.Color;
  dark: THREE.Color;
}

function normalizedBoneName(rawName: string): string {
  return rawName.trim().toLowerCase();
}

export function quaterniusOutfitToneForBoneName(
  rawName: string,
  archetype: FighterDefinition["archetype"],
): OutfitTone {
  const name = normalizedBoneName(rawName);

  if (name === "head" || name.startsWith("neck")) return "SKIN";
  if (name.startsWith("spine_03") || name.startsWith("clavicle")) return "LIGHT";

  if (archetype === "POWER") {
    if (name.startsWith("spine_02") || name.startsWith("upperarm")) return "PRIMARY";
    if (
      name.startsWith("spine_01")
      || name === "pelvis"
      || name.startsWith("lowerarm")
      || name.startsWith("hand")
      || name.startsWith("thumb")
      || name.startsWith("index")
      || name.startsWith("middle")
      || name.startsWith("ring")
      || name.startsWith("pinky")
      || name.startsWith("thigh")
      || name.startsWith("calf")
      || name.startsWith("foot")
      || name.startsWith("ball")
      || name === "root"
    ) return "DARK";
    return "PRIMARY";
  }

  if (name.startsWith("spine_02")) return "DARK";
  if (name.startsWith("spine_01") || name === "pelvis" || name.startsWith("upperarm")) return "PRIMARY";
  if (name.startsWith("lowerarm") || name.startsWith("calf")) return "LIGHT";
  if (
    name.startsWith("hand")
    || name.startsWith("thumb")
    || name.startsWith("index")
    || name.startsWith("middle")
    || name.startsWith("ring")
    || name.startsWith("pinky")
    || name.startsWith("thigh")
    || name === "root"
  ) return "DARK";
  if (name.startsWith("foot") || name.startsWith("ball")) return "PRIMARY";
  return "DARK";
}

/**
 * UBC has no separate scalp bone: the face and scalp are both weighted to Head.
 * Use the upper portion of the Head-weighted vertex range as an under-hair region.
 * POWER keeps a slightly higher hairline; SPEED gets a little more crown coverage
 * to sit cleanly under SERA's fringe and ponytail.
 */
export function quaterniusShouldTintScalp(
  headWeight: number,
  normalizedHeadHeight: number,
  archetype: FighterDefinition["archetype"],
): boolean {
  if (headWeight < 0.45) return false;
  const hairline = archetype === "POWER" ? 0.68 : 0.66;
  return normalizedHeadHeight >= hairline;
}

function outfitPalette(definition: FighterDefinition): OutfitPalette {
  const primary = new THREE.Color(definition.colors.primary);
  const secondary = new THREE.Color(definition.colors.secondary);
  if (definition.archetype === "POWER") {
    return {
      skin: new THREE.Color(definition.colors.skin),
      hair: new THREE.Color(definition.colors.hair),
      light: new THREE.Color(0xf0f1ef).lerp(primary, 0.10),
      primary: primary.clone().offsetHSL(0, 0.025, 0.01),
      dark: secondary.clone().lerp(new THREE.Color(0x20242d), 0.20),
    };
  }
  return {
    skin: new THREE.Color(definition.colors.skin),
    hair: new THREE.Color(definition.colors.hair),
    light: new THREE.Color(0xf1f7fb).lerp(primary, 0.13),
    primary: primary.clone().offsetHSL(0, 0.02, 0.015),
    dark: secondary.clone().lerp(new THREE.Color(0x1c2430), 0.22),
  };
}

function colorForTone(palette: OutfitPalette, tone: OutfitTone): THREE.Color {
  switch (tone) {
    case "SKIN": return palette.skin;
    case "LIGHT": return palette.light;
    case "PRIMARY": return palette.primary;
    case "DARK": return palette.dark;
  }
}

function skinIndexAt(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, slot: number): number {
  if (slot === 0) return Math.round(attribute.getX(vertex));
  if (slot === 1) return Math.round(attribute.getY(vertex));
  if (slot === 2) return Math.round(attribute.getZ(vertex));
  return Math.round(attribute.getW(vertex));
}

function skinWeightAt(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, slot: number): number {
  if (slot === 0) return attribute.getX(vertex);
  if (slot === 1) return attribute.getY(vertex);
  if (slot === 2) return attribute.getZ(vertex);
  return attribute.getW(vertex);
}

function headWeightAt(
  mesh: THREE.SkinnedMesh,
  skinIndex: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  skinWeight: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertex: number,
): number {
  let total = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    const weight = Math.max(0, skinWeightAt(skinWeight, vertex, slot));
    if (weight <= 1e-5) continue;
    const boneIndex = skinIndexAt(skinIndex, vertex, slot);
    const boneName = normalizedBoneName(mesh.skeleton.bones[boneIndex]?.name ?? "");
    if (boneName === "head" || boneName.startsWith("head_")) total += weight;
  }
  return total;
}

function authoredMaterialTag(mesh: THREE.Mesh, material: THREE.Material): string {
  return `${mesh.name} ${material.name}`.toLowerCase();
}

function shouldKeepAuthoredMaterial(mesh: THREE.Mesh, material: THREE.Material): boolean {
  const tag = authoredMaterialTag(mesh, material);
  return tag.includes("hair")
    || tag.includes("eye")
    || tag.includes("iris")
    || tag.includes("brow")
    || tag.includes("lash")
    || tag.includes("teeth")
    || tag.includes("mouth");
}

/** Smooth base-anatomy normals instead of forcing flat faceting onto a
 * skinned face. Keep intentional hard-surface outfit trim hard, and leave
 * authored facial detail/hair entirely untouched. No new meshes or passes. */
export const QUATERNIUS_OUTFIT_SURFACE_ID = "UBC_SEMANTIC_SURFACE_V1";
export type QuaterniusSurfaceRole = "AUTHORED" | "SKIN" | "FABRIC" | "HARDWARE";
export type QuaterniusSurfaceFinish = Readonly<{
  role: QuaterniusSurfaceRole;
  roughness: number;
  metalness: number;
  flatShading: boolean;
  envMapIntensity: number;
}>;

const SURFACE_FINISH: Readonly<Record<QuaterniusSurfaceRole, QuaterniusSurfaceFinish>> = {
  AUTHORED: { role: "AUTHORED", roughness: 0, metalness: 0, flatShading: false, envMapIntensity: 0 },
  SKIN: { role: "SKIN", roughness: 0.74, metalness: 0.0, flatShading: false, envMapIntensity: 1.0 },
  FABRIC: { role: "FABRIC", roughness: 0.78, metalness: 0.012, flatShading: false, envMapIntensity: 0.96 },
  HARDWARE: { role: "HARDWARE", roughness: 0.40, metalness: 0.38, flatShading: true, envMapIntensity: 1.18 },
};

export function quaterniusSurfaceFinishForTag(tag: string): QuaterniusSurfaceFinish {
  const normalized = tag.toLowerCase();
  if (["hair", "eye", "iris", "brow", "lash", "teeth", "mouth"].some(word => normalized.includes(word))) {
    return SURFACE_FINISH.AUTHORED;
  }
  if (["metal", "armor", "armour", "plating", "plate", "visor"].some(word => normalized.includes(word))) {
    return SURFACE_FINISH.HARDWARE;
  }
  if (["skin", "face", "body", "head", "neck"].some(word => normalized.includes(word))) {
    return SURFACE_FINISH.SKIN;
  }
  return SURFACE_FINISH.FABRIC;
}

function prepareOutfitMaterial(mesh: THREE.Mesh, material: THREE.Material): boolean {
  if (shouldKeepAuthoredMaterial(mesh, material)) return false;
  if (!(material instanceof THREE.MeshStandardMaterial)) return false;
  const finish = quaterniusSurfaceFinishForTag(authoredMaterialTag(mesh, material));
  if (finish.role === "AUTHORED") return false;

  // Retain the original skinned mesh, existing per-vertex costume palette and
  // bone weights. The former universal flatShading=true made cheeks polygonal
  // and cloth shine like hard plastic under the cinematic side lights.
  material.vertexColors = true;
  material.color.set(0xffffff);
  material.flatShading = finish.flatShading;
  material.roughness = finish.roughness;
  material.metalness = finish.metalness;
  material.envMapIntensity = finish.envMapIntensity;
  material.dithering = true;
  material.userData.tpsOutfitSurface = QUATERNIUS_OUTFIT_SURFACE_ID;
  material.userData.tpsOutfitSurfaceRole = finish.role;
  material.needsUpdate = true;
  return true;
}

function applyWeightedOutfitColors(
  mesh: THREE.SkinnedMesh,
  definition: FighterDefinition,
): { vertices: number; skinVertices: number; hairVertices: number; clothingVertices: number; outfitMaterials: number } | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (!position || !skinIndex || !skinWeight || position.count === 0) return null;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const outfitMaterials = materials.reduce(
    (count, material) => count + (prepareOutfitMaterial(mesh, material) ? 1 : 0),
    0,
  );
  if (outfitMaterials === 0) return null;

  const palette = outfitPalette(definition);
  const colors = new Float32Array(position.count * 3);
  const headWeights = new Float32Array(position.count);
  const surfaceWeights = new Float32Array(position.count);
  const blended = new THREE.Color();
  let headMinY = Number.POSITIVE_INFINITY;
  let headMaxY = Number.NEGATIVE_INFINITY;

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const weight = headWeightAt(mesh, skinIndex, skinWeight, vertex);
    headWeights[vertex] = weight;
    if (weight < 0.35) continue;
    const y = position.getY(vertex);
    headMinY = Math.min(headMinY, y);
    headMaxY = Math.max(headMaxY, y);
  }
  const headRange = Number.isFinite(headMinY) && Number.isFinite(headMaxY)
    ? Math.max(1e-5, headMaxY - headMinY)
    : 0;

  let skinVertices = 0;
  let hairVertices = 0;
  let clothingVertices = 0;

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    blended.setRGB(0, 0, 0);
    let totalWeight = 0;
    let skinWeightTotal = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = Math.max(0, skinWeightAt(skinWeight, vertex, slot));
      if (weight <= 1e-5) continue;
      const boneIndex = skinIndexAt(skinIndex, vertex, slot);
      const boneName = mesh.skeleton.bones[boneIndex]?.name ?? "root";
      const tone = quaterniusOutfitToneForBoneName(boneName, definition.archetype);
      const toneColor = colorForTone(palette, tone);
      blended.r += toneColor.r * weight;
      blended.g += toneColor.g * weight;
      blended.b += toneColor.b * weight;
      totalWeight += weight;
      if (tone === "SKIN") skinWeightTotal += weight;
    }
    if (totalWeight > 1e-5) {
      blended.r /= totalWeight;
      blended.g /= totalWeight;
      blended.b /= totalWeight;
    } else {
      blended.copy(palette.dark);
    }

    const normalizedHeadHeight = headRange > 0
      ? THREE.MathUtils.clamp((position.getY(vertex) - headMinY) / headRange, 0, 1)
      : 0;
    const scalpHair = quaterniusShouldTintScalp(
      headWeights[vertex],
      normalizedHeadHeight,
      definition.archetype,
    );
    if (scalpHair) blended.copy(palette.hair);
    surfaceWeights[vertex] = quaterniusSkinSurfaceWeight(skinWeightTotal, scalpHair);

    const offset = vertex * 3;
    colors[offset] = blended.r;
    colors[offset + 1] = blended.g;
    colors[offset + 2] = blended.b;
    if (scalpHair) hairVertices += 1;
    else if (skinWeightTotal >= 0.5) skinVertices += 1;
    else clothingVertices += 1;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute(QUATERNIUS_SKIN_CLOTH_ATTRIBUTE,
    new THREE.BufferAttribute(surfaceWeights, 1));
  // Skin/cloth interpolation stays inside the same material/SkinnedMesh draw.
  // Hardware retains its authored hard-surface roughness, while eyes/hair are
  // exempt from prepareOutfitMaterial and retain their original shaders.
  for (const material of materials) {
    if (material instanceof THREE.MeshStandardMaterial
        && material.userData.tpsOutfitSurface === QUATERNIUS_OUTFIT_SURFACE_ID
        && material.userData.tpsOutfitSurfaceRole !== "HARDWARE") {
      installQuaterniusSkinClothPbr(material);
    }
  }
  mesh.userData.quaterniusSkinClothPbr = QUATERNIUS_SKIN_CLOTH_PBR_ID;
  geometry.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  mesh.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  mesh.userData.quaterniusOutfitMaterialCount = outfitMaterials;
  return { vertices: position.count, skinVertices, hairVertices, clothingVertices, outfitMaterials };
}

function installOnPolishedHost(visual: FighterVisual, definition: FighterDefinition): boolean {
  let host: THREE.Object3D | null = null;
  visual.root.traverse((object) => {
    if (!host && object.name.startsWith("quaternius-ubc-") && object.name.endsWith("-runtime")) host = object;
  });
  if (!host) return false;
  if (!host.userData.characterGraphicsPolish) return false;
  if (host.userData.quaterniusOutfitSkin === QUATERNIUS_OUTFIT_SKIN_ID) return true;

  let bodyMeshes = 0;
  let outfitMaterials = 0;
  let recoloredVertices = 0;
  let skinVertices = 0;
  let hairVertices = 0;
  let clothingVertices = 0;
  let skinClothPbrMeshes = 0;
  const processedBodies: THREE.SkinnedMesh[] = [];
  host.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const result = applyWeightedOutfitColors(mesh, definition);
    if (!result) return;
    processedBodies.push(mesh);
    bodyMeshes += 1;
    if (mesh.userData.quaterniusSkinClothPbr === QUATERNIUS_SKIN_CLOTH_PBR_ID) skinClothPbrMeshes += 1;
    outfitMaterials += result.outfitMaterials;
    recoloredVertices += result.vertices;
    skinVertices += result.skinVertices;
    hairVertices += result.hairVertices;
    clothingVertices += result.clothingVertices;
  });

  if (bodyMeshes === 0 || outfitMaterials === 0 || recoloredVertices === 0) return false;
  // Attach the sculpt-ready shell to the original GLB skinned mesh parent,
  // not to the gameplay hitbox or procedural animation substitutes.
  let garmentMeshes = 0;
  let garmentTriangles = 0;
  for (const body of processedBodies) {
    const vest = buildQuaterniusConformalGarment(body, definition);
    if (!vest || !body.parent) {
      if (vest) {
        vest.geometry.dispose();
        (vest.material as THREE.Material).dispose();
      }
      continue;
    }
    body.parent.add(vest);
    garmentMeshes += 1;
    garmentTriangles += (vest.userData.quaterniusConformalMetrics?.triangles ?? 0) as number;
  }
  host.userData.quaterniusConformalGarment = garmentMeshes > 0 ? QUATERNIUS_CONFORMAL_GARMENT_ID : null;
  visual.root.userData.quaterniusConformalGarmentVersion = host.userData.quaterniusConformalGarment;
  visual.root.userData.quaterniusConformalGarmentMeshes = garmentMeshes;
  visual.root.userData.quaterniusConformalGarmentTriangles = garmentTriangles;

  host.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  visual.root.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  visual.root.userData.quaterniusOutfitSkinBodyMeshes = bodyMeshes;
  visual.root.userData.quaterniusSkinClothPbrVersion = QUATERNIUS_SKIN_CLOTH_PBR_ID;
  visual.root.userData.quaterniusSkinClothPbrMeshes = skinClothPbrMeshes;
  visual.root.userData.quaterniusOutfitSkinMaterialCount = outfitMaterials;
  visual.root.userData.quaterniusOutfitSkinVertices = recoloredVertices;
  visual.root.userData.quaterniusOutfitSkinCoverage = {
    skinVertices,
    hairVertices,
    clothingVertices,
    clothingRatio: clothingVertices / Math.max(1, skinVertices + hairVertices + clothingVertices),
    scalpHairRatio: hairVertices / Math.max(1, skinVertices + hairVertices),
  };
  return true;
}

export function scheduleQuaterniusOutfitSkin(visual: FighterVisual, definition: FighterDefinition): void {
  if (typeof window === "undefined") return;
  if (visual.root.userData.quaterniusOutfitSkinScheduled) return;
  visual.root.userData.quaterniusOutfitSkinScheduled = true;

  if (installOnPolishedHost(visual, definition)) return;
  let attempts = 0;
  const interval = window.setInterval(() => {
    attempts += 1;
    if (installOnPolishedHost(visual, definition) || attempts >= 180) {
      window.clearInterval(interval);
      visual.root.userData.quaterniusOutfitSkinAttempts = attempts;
    }
  }, 50);
}
