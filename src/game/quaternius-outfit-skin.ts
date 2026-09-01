import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual } from "./visual";

/**
 * Outfit strategy for the production Quaternius UBC skin.
 *
 * The base character already owns a proven SkinnedMesh and 65-joint UAL-compatible
 * rig. Rebinding a second full costume mesh at runtime would duplicate skinning
 * work and invite rest-pose mismatch. Instead, use the existing vertex weights as
 * semantic body regions: head/neck remain skin while torso, arms and legs receive
 * garment vertex colours. Authored hair/eye materials opt out per material group,
 * so a multi-material body mesh can still be dressed without repainting the face.
 * Thin bind-delta panels in quaternius-graphics-polish add the visible jacket,
 * seams and guards without replacing the animated body surface.
 */
export const QUATERNIUS_OUTFIT_SKIN_ID = "QUATERNIUS_OUTFIT_SKIN_V2_MATERIAL_AWARE_VERTEX_COLOR";

type OutfitTone = "SKIN" | "LIGHT" | "PRIMARY" | "DARK";

interface OutfitPalette {
  skin: THREE.Color;
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

function outfitPalette(definition: FighterDefinition): OutfitPalette {
  const primary = new THREE.Color(definition.colors.primary);
  const secondary = new THREE.Color(definition.colors.secondary);
  if (definition.archetype === "POWER") {
    return {
      skin: new THREE.Color(definition.colors.skin),
      light: new THREE.Color(0xf0f1ef).lerp(primary, 0.10),
      primary: primary.clone().offsetHSL(0, 0.025, 0.01),
      dark: secondary.clone().lerp(new THREE.Color(0x20242d), 0.20),
    };
  }
  return {
    skin: new THREE.Color(definition.colors.skin),
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

function prepareOutfitMaterial(mesh: THREE.Mesh, material: THREE.Material): boolean {
  if (shouldKeepAuthoredMaterial(mesh, material)) return false;
  if (!(material instanceof THREE.MeshStandardMaterial)) return false;
  material.vertexColors = true;
  material.color.set(0xffffff);
  material.flatShading = true;
  material.roughness = 0.61;
  material.metalness = 0.035;
  material.envMapIntensity = 1.10;
  material.dithering = true;
  material.needsUpdate = true;
  return true;
}

function applyWeightedOutfitColors(
  mesh: THREE.SkinnedMesh,
  definition: FighterDefinition,
): { vertices: number; skinVertices: number; clothingVertices: number; outfitMaterials: number } | null {
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
  const blended = new THREE.Color();
  let skinVertices = 0;
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

    const offset = vertex * 3;
    colors[offset] = blended.r;
    colors[offset + 1] = blended.g;
    colors[offset + 2] = blended.b;
    if (skinWeightTotal >= 0.5) skinVertices += 1;
    else clothingVertices += 1;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  mesh.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  mesh.userData.quaterniusOutfitMaterialCount = outfitMaterials;
  return { vertices: position.count, skinVertices, clothingVertices, outfitMaterials };
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
  let clothingVertices = 0;
  host.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const result = applyWeightedOutfitColors(mesh, definition);
    if (!result) return;
    bodyMeshes += 1;
    outfitMaterials += result.outfitMaterials;
    recoloredVertices += result.vertices;
    skinVertices += result.skinVertices;
    clothingVertices += result.clothingVertices;
  });

  if (bodyMeshes === 0 || outfitMaterials === 0 || recoloredVertices === 0) return false;
  host.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  visual.root.userData.quaterniusOutfitSkin = QUATERNIUS_OUTFIT_SKIN_ID;
  visual.root.userData.quaterniusOutfitSkinBodyMeshes = bodyMeshes;
  visual.root.userData.quaterniusOutfitSkinMaterialCount = outfitMaterials;
  visual.root.userData.quaterniusOutfitSkinVertices = recoloredVertices;
  visual.root.userData.quaterniusOutfitSkinCoverage = {
    skinVertices,
    clothingVertices,
    clothingRatio: clothingVertices / Math.max(1, skinVertices + clothingVertices),
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
