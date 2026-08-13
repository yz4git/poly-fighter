import * as THREE from "three";
import type { FighterVisual } from "./visual";
import { classifyV10SkinRegion, type V10Semantic, type V10SkinRegion } from "./visual-v10";

type Influence = readonly [number, number];
type SkinModes = {
  dynamicIndex: THREE.BufferAttribute;
  dynamicWeight: THREE.BufferAttribute;
  staticIndex: THREE.BufferAttribute;
  staticWeight: THREE.BufferAttribute;
  current: "dynamic" | "static";
};

const SKIN_MODES = new WeakMap<FighterVisual, SkinModes>();
const PALETTE: Record<Exclude<V10Semantic, "unknown">, THREE.Color> = {
  skin: new THREE.Color(0xd3a184),
  blue: new THREE.Color(0x2452c5),
  black: new THREE.Color(0x0e0e16),
  silver: new THREE.Color(0xb9c3d0),
};

function smoothBlend(value: number, start: number, end: number): number {
  const t = THREE.MathUtils.clamp((value - start) / Math.max(1e-6, end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeInfluences(pairs: Influence[]): Influence[] {
  const active = pairs.filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = active.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return active.map(([bone, weight]) => [bone, weight / total] as const);
}

function semanticFromRgb(r: number, g: number, b: number): Exclude<V10Semantic, "unknown"> {
  const value = (r + g + b) / 3;
  if (value < 0.26) return "black";
  if (b > r * 1.12 && b > g * 1.08 && b > 0.24) return "blue";
  if (r > b * 1.12 && r > g * 1.03) return "skin";
  if (b > 0.48 && r < 0.52) return "blue";
  return "silver";
}

function valueBias(r: number, g: number, b: number): boolean {
  return b > r * 1.03 || b > g * 1.08;
}

function resolvedSemantic(
  region: V10SkinRegion,
  semantic: Exclude<V10Semantic, "unknown">,
  y: number,
  r: number,
  g: number,
  b: number,
): Exclude<V10Semantic, "unknown"> {
  if (region === "HEAD") return semantic === "silver" ? "skin" : semantic;
  if (region === "HIPS") {
    if (semantic === "skin" || semantic === "silver") return b > r * 1.03 ? "blue" : "black";
    return semantic;
  }
  if (region === "TORSO") {
    if (y < 0.748 && semantic === "silver") return "skin";
    if (semantic === "silver") return "blue";
    return semantic;
  }
  if (region.endsWith("_SHIN") || region.endsWith("_FOOT")) {
    if (semantic === "skin" || semantic === "silver") return b > r * 1.02 ? "blue" : "black";
    return semantic;
  }
  if (region.endsWith("_THIGH") && semantic === "silver") return valueBias(r, g, b) ? "blue" : "black";
  return semantic;
}

function influencesForFace(region: V10SkinRegion, y: number, visual: FighterVisual): Influence[] {
  const b = visual.rig.boneIndices;
  switch (region) {
    case "HEAD":
      return [[b.head, 1]];
    case "HIPS": {
      const spine = smoothBlend(y, 0.575, 0.690) * 0.38;
      return normalizeInfluences([[b.hips, 1 - spine], [b.spineLower, spine]]);
    }
    case "TORSO": {
      if (y < 0.748) {
        const upper = smoothBlend(y, 0.690, 0.748);
        return normalizeInfluences([[b.spineLower, 1 - upper * 0.78], [b.spineUpper, upper * 0.78]]);
      }
      if (y < 0.818) {
        const chest = smoothBlend(y, 0.748, 0.818);
        return normalizeInfluences([[b.spineUpper, 1 - chest * 0.82], [b.chest, chest * 0.82]]);
      }
      return normalizeInfluences([[b.chest, 0.90], [b.neck, 0.10]]);
    }
    case "LEFT_UPPER_ARM":
    case "RIGHT_UPPER_ARM": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const elbow = (1 - smoothBlend(y, 0.630, 0.690)) * 0.34;
      return normalizeInfluences([[b[`${prefix}UpperArm`], 1 - elbow], [b[`${prefix}Forearm`], elbow]]);
    }
    case "LEFT_FOREARM":
    case "RIGHT_FOREARM": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const hand = (1 - smoothBlend(y, 0.475, 0.535)) * 0.28;
      const upper = smoothBlend(y, 0.610, 0.660) * 0.18;
      return normalizeInfluences([
        [b[`${prefix}Forearm`], 1 - hand - upper],
        [b[`${prefix}Hand`], hand],
        [b[`${prefix}UpperArm`], upper],
      ]);
    }
    case "LEFT_HAND":
    case "RIGHT_HAND": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      return normalizeInfluences([[b[`${prefix}Hand`], 0.94], [b[`${prefix}Forearm`], 0.06]]);
    }
    case "LEFT_THIGH":
    case "RIGHT_THIGH": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const hips = smoothBlend(y, 0.500, 0.590) * 0.22;
      const shin = (1 - smoothBlend(y, 0.290, 0.340)) * 0.30;
      return normalizeInfluences([[b[`${prefix}Thigh`], 1 - hips - shin], [b.hips, hips], [b[`${prefix}Shin`], shin]]);
    }
    case "LEFT_SHIN":
    case "RIGHT_SHIN": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      const thigh = smoothBlend(y, 0.265, 0.315) * 0.25;
      const foot = (1 - smoothBlend(y, 0.070, 0.115)) * 0.24;
      return normalizeInfluences([[b[`${prefix}Shin`], 1 - thigh - foot], [b[`${prefix}Thigh`], thigh], [b[`${prefix}Foot`], foot]]);
    }
    case "LEFT_FOOT":
    case "RIGHT_FOOT": {
      const prefix = region.startsWith("LEFT") ? "left" : "right";
      return normalizeInfluences([[b[`${prefix}Foot`], 0.94], [b[`${prefix}Shin`], 0.06]]);
    }
  }
}

function writeFaceInfluences(indices: number[], weights: number[], pairs: Influence[]): void {
  const normalized = normalizeInfluences(pairs);
  for (let vertex = 0; vertex < 3; vertex += 1) {
    for (let slot = 0; slot < 4; slot += 1) {
      indices.push(normalized[slot]?.[0] ?? 0);
      weights.push(normalized[slot]?.[1] ?? 0);
    }
  }
}

function shadedFacetColor(base: THREE.Color, sourceValue: number): THREE.Color {
  const factor = THREE.MathUtils.clamp(0.76 + sourceValue * 0.48, 0.76, 1.12);
  return base.clone().multiplyScalar(factor);
}

function installFaceUniformSkinning(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (visual.bodyMesh.userData.v10FacetSkinning === "FACE_UNIFORM_REGIONS") return;

  const source = visual.bodyMesh.geometry;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const color = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!color || position.count % 3 !== 0) return;

  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const staticIndices: number[] = [];
  const staticWeights: number[] = [];
  const quantizedColors: number[] = [];
  const regionCounts: Partial<Record<V10SkinRegion, number>> = {};

  for (let base = 0; base < position.count; base += 3) {
    let x = 0;
    let y = 0;
    let z = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let offset = 0; offset < 3; offset += 1) {
      const vertex = base + offset;
      x += position.getX(vertex);
      y += position.getY(vertex);
      z += position.getZ(vertex);
      r += color.getX(vertex);
      g += color.getY(vertex);
      b += color.getZ(vertex);
    }
    x /= 3;
    y /= 3;
    z /= 3;
    r /= 3;
    g /= 3;
    b /= 3;

    const sourceSemantic = semanticFromRgb(r, g, b);
    const region = classifyV10SkinRegion(x, y, z, sourceSemantic);
    const semantic = resolvedSemantic(region, sourceSemantic, y, r, g, b);
    const target = shadedFacetColor(PALETTE[semantic], (r + g + b) / 3);
    regionCounts[region] = (regionCounts[region] ?? 0) + 1;

    writeFaceInfluences(skinIndices, skinWeights, influencesForFace(region, y, visual));
    for (let offset = 0; offset < 3; offset += 1) {
      staticIndices.push(visual.rig.boneIndices.root, 0, 0, 0);
      staticWeights.push(1, 0, 0, 0);
      quantizedColors.push(target.r, target.g, target.b);
    }
  }

  const dynamicIndex = new THREE.Uint16BufferAttribute(skinIndices, 4);
  const dynamicWeight = new THREE.Float32BufferAttribute(skinWeights, 4);
  const staticIndex = new THREE.Uint16BufferAttribute(staticIndices, 4);
  const staticWeight = new THREE.Float32BufferAttribute(staticWeights, 4);
  geometry.setAttribute("skinIndex", dynamicIndex);
  geometry.setAttribute("skinWeight", dynamicWeight);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(quantizedColors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.v10FacetSkinning = "FACE_UNIFORM_REGIONS";
  geometry.userData.v10RegionCounts = regionCounts;

  visual.bodyMesh.geometry = geometry;
  visual.bodyMesh.normalizeSkinWeights();
  source.dispose();
  SKIN_MODES.set(visual, { dynamicIndex, dynamicWeight, staticIndex, staticWeight, current: "dynamic" });
  visual.bodyMesh.userData.v10FacetSkinning = "FACE_UNIFORM_REGIONS";
  visual.root.userData.skinningPresentation = "V10.2_FACE_UNIFORM_REGIONS";
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = position.count / 3;
  visual.stats.weightedVertexCount = position.count;
}

function installReferenceColorMaterial(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (visual.bodyMesh.userData.v10ColorMaterial === "REFERENCE_VERTEX_COLOR") return;
  if (!visual.bodyMesh.geometry.getAttribute("color")) return;

  const oldMaterial = visual.bodyMesh.material;
  visual.bodyMesh.material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
  });
  if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
  else oldMaterial.dispose();
  visual.bodyMesh.userData.v10ColorMaterial = "REFERENCE_VERTEX_COLOR";
  visual.root.userData.colorPipeline = "V10.2_SHADED_REFERENCE_VERTEX_COLOR";
}

function neutralUpperBody(visual: FighterVisual): boolean {
  const bones = visual.rig.bones;
  const rotations = [
    bones.spineLower.rotation,
    bones.spineUpper.rotation,
    bones.chest.rotation,
    bones.leftUpperArm.rotation,
    bones.rightUpperArm.rotation,
    bones.leftForearm.rotation,
    bones.rightForearm.rotation,
  ];
  return rotations.every((rotation) =>
    Math.abs(rotation.x) < 0.075
    && Math.abs(rotation.y) < 0.075
    && Math.abs(rotation.z) < 0.075,
  );
}

function selectPresentationSkin(visual: FighterVisual): void {
  const modes = SKIN_MODES.get(visual);
  if (!modes) return;
  const neutral = neutralUpperBody(visual);
  const desired = neutral ? "static" : "dynamic";
  if (modes.current !== desired) {
    visual.bodyMesh.geometry.setAttribute("skinIndex", desired === "static" ? modes.staticIndex : modes.dynamicIndex);
    visual.bodyMesh.geometry.setAttribute("skinWeight", desired === "static" ? modes.staticWeight : modes.dynamicWeight);
    modes.current = desired;
  }

  // A small neutral-only yaw prevents the side-on game camera from collapsing
  // the turnaround into a paper-thin profile. Dynamic combat returns to exact
  // rig alignment so hit animations and visual contacts stay trustworthy.
  visual.bodyMesh.rotation.y = neutral ? 0.16 : 0;
  visual.bodyMesh.userData.v10PresentationMode = neutral ? "COHERENT_NEUTRAL_SHELL" : "ARTICULATED_FACETS";
}

/**
 * V10.2 presentation polish. Neutral frames use the coherent reconstructed
 * shell exactly as authored, while combat frames switch to face-uniform
 * anatomical skinning. This keeps the first-read silhouette clean without
 * sacrificing visible articulation during attacks, guard, hit and knockdown.
 */
export function applyV10RuntimePolish(visual: FighterVisual): FighterVisual {
  visual.footContacts.left.homeLocal.z = -0.100;
  visual.footContacts.right.homeLocal.z = 0.110;
  visual.root.userData.authoredNeutralStance = "V10.2_COHERENT_NEUTRAL_SHELL";

  const previousBeforeRender = visual.bodyMesh.onBeforeRender;
  visual.bodyMesh.onBeforeRender = function onBeforeRender(...args): void {
    installFaceUniformSkinning(visual);
    installReferenceColorMaterial(visual);
    selectPresentationSkin(visual);
    previousBeforeRender?.apply(this, args);
  };

  return visual;
}
