import * as THREE from "three";
import { isSeraHeadLockedSemantic, semanticFromColorAttribute, type SeraRuntimeSemantic } from "./visual-blender-semantics";
import { SERA_SKIN_PROFILE } from "./visual-blender-skinning-profile";

export type SeraRuntimeRegion =
  | "HEAD"
  | "COLLAR"
  | "TORSO"
  | "HIPS"
  | "FRONT_SKIRT"
  | "LEFT_SKIRT"
  | "RIGHT_SKIRT"
  | "LEFT_SHOULDER"
  | "RIGHT_SHOULDER"
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

export type SeraInfluence = readonly [bone: number, weight: number];

export interface SeraSkinningDiagnostics {
  regionCounts: Partial<Record<SeraRuntimeRegion, number>>;
  semanticCounts: Partial<Record<SeraRuntimeSemantic, number>>;
  headLockedVertices: number;
  invalidWeightVertices: number;
  maxInfluenceCount: number;
}

function smoothBlend(value: number, start: number, end: number): number {
  const t = THREE.MathUtils.clamp((value - start) / Math.max(1e-6, end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

export function normalizeSeraInfluences(pairs: readonly SeraInfluence[]): SeraInfluence[] {
  const merged = new Map<number, number>();
  for (const [bone, weight] of pairs) {
    if (!Number.isInteger(bone) || bone < 0 || !Number.isFinite(weight) || weight <= 0) continue;
    merged.set(bone, (merged.get(bone) ?? 0) + weight);
  }
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(total > 0)) return [[0, 1]];
  const normalized = sorted.map(([bone, weight]) => [bone, weight / total] as const);
  const normalizedTotal = normalized.reduce((sum, [, weight]) => sum + weight, 0);
  if (!Number.isFinite(normalizedTotal) || Math.abs(normalizedTotal - 1) > 1e-5 || normalized.length > 4) return [[0, 1]];
  return normalized;
}

function sideOf(x: number): "LEFT" | "RIGHT" {
  return x < 0 ? "LEFT" : "RIGHT";
}

function limbRegion(side: "LEFT" | "RIGHT", part: "SHOULDER" | "UPPER_ARM" | "FOREARM" | "HAND" | "THIGH" | "SHIN" | "FOOT"): SeraRuntimeRegion {
  return `${side}_${part}` as SeraRuntimeRegion;
}

function classifyUnknownFallback(x: number, y: number): SeraRuntimeRegion {
  const side = sideOf(x);
  if (y >= SERA_SKIN_PROFILE.fallback.headCutoffY) return "HEAD";
  if (y >= SERA_SKIN_PROFILE.fallback.hipsCutoffY) return "TORSO";
  if (y >= SERA_SKIN_PROFILE.fallback.lowerBodyCutoffY) return "HIPS";
  if (y < 0.100) return limbRegion(side, "FOOT");
  if (y < 0.305) return limbRegion(side, "SHIN");
  return limbRegion(side, "THIGH");
}

/** Classifier tuned to the normalized Blender SERA runtime asset (height 0..1). */
export function classifySeraRuntimeRegion(
  x: number,
  y: number,
  z: number,
  semantic: SeraRuntimeSemantic,
): SeraRuntimeRegion {
  const side = sideOf(x);
  const absX = Math.abs(x);
  const absZ = Math.abs(z);

  if (isSeraHeadLockedSemantic(semantic)) return "HEAD";
  if (semantic === "unknown") return classifyUnknownFallback(x, y);
  if (y >= SERA_SKIN_PROFILE.fallback.headCutoffY) return "HEAD";

  if ((semantic === "blue" || semantic === "blueHi") && y >= 0.795 && y < 0.855 && absX < 0.100 && absZ < 0.095) return "COLLAR";
  if (semantic === "silver" && y >= 0.455 && y < 0.700) return limbRegion(side, "FOREARM");
  if (y >= 0.405 && y < 0.515 && absX > 0.135 && (semantic === "skin" || semantic === "black")) return limbRegion(side, "HAND");
  if (y >= 0.680 && y < 0.825 && absX >= 0.105 && absX < 0.205 && semantic !== "black") return limbRegion(side, "SHOULDER");
  if (y >= 0.610 && y < 0.825 && absX >= 0.155 && (semantic === "skin" || semantic === "blue" || semantic === "blueHi" || semantic === "black")) return limbRegion(side, "UPPER_ARM");
  if (y >= 0.490 && y < 0.675 && absX >= 0.145 && (semantic === "skin" || semantic === "black" || semantic === "blue" || semantic === "blueHi")) return limbRegion(side, "FOREARM");

  if (y >= 0.345 && y < 0.585 && (semantic === "blue" || semantic === "blueHi" || semantic === "black")) {
    if (semantic === "blueHi" && absX < 0.085) return "FRONT_SKIRT";
    if (absX >= 0.050 && absX < 0.180) return side === "LEFT" ? "LEFT_SKIRT" : "RIGHT_SKIRT";
  }

  if (y < 0.100) return limbRegion(side, "FOOT");
  if (y < 0.305) return limbRegion(side, "SHIN");
  if (y < 0.590 && absX < 0.145) return limbRegion(side, "THIGH");
  if (y < 0.660) return "HIPS";
  return "TORSO";
}

function boneForSide(bones: Record<string, number>, side: "LEFT" | "RIGHT", suffix: string): number {
  const prefix = side === "LEFT" ? "left" : "right";
  return bones[`${prefix}${suffix}`];
}

export function solveSeraRuntimeInfluences(
  region: SeraRuntimeRegion,
  y: number,
  boneIndices: Record<string, number>,
  semantic: SeraRuntimeSemantic = "unknown",
): SeraInfluence[] {
  const side = region.startsWith("LEFT") ? "LEFT" : region.startsWith("RIGHT") ? "RIGHT" : null;
  switch (region) {
    case "HEAD": return normalizeSeraInfluences([[boneIndices.head, 1]]);
    case "COLLAR": return normalizeSeraInfluences([[boneIndices.neck, SERA_SKIN_PROFILE.collar.neck], [boneIndices.chest, SERA_SKIN_PROFILE.collar.chest]]);
    case "TORSO": {
      const upper = smoothBlend(y, 0.690, 0.810);
      const neck = smoothBlend(y, 0.795, 0.840) * 0.08;
      return normalizeSeraInfluences([[boneIndices.spineLower, 1 - upper], [boneIndices.spineUpper, upper * 0.56], [boneIndices.chest, upper * 0.44 - neck], [boneIndices.neck, neck]]);
    }
    case "HIPS": {
      const p = SERA_SKIN_PROFILE.hips;
      const spine = smoothBlend(y, p.spineStartY, p.spineEndY) * p.spineMax;
      return normalizeSeraInfluences([[boneIndices.hips, 1 - spine], [boneIndices.spineLower, spine]]);
    }
    case "FRONT_SKIRT": {
      const p = SERA_SKIN_PROFILE.frontSkirt;
      const thigh = (1 - smoothBlend(y, p.thighStartY, p.thighEndY)) * p.thighMax;
      return normalizeSeraInfluences([[boneIndices.hips, 1 - thigh], [boneIndices.leftThigh, thigh * 0.5], [boneIndices.rightThigh, thigh * 0.5]]);
    }
    case "LEFT_SKIRT":
    case "RIGHT_SKIRT": {
      const p = SERA_SKIN_PROFILE.sideSkirt;
      const localSide = region.startsWith("LEFT") ? "LEFT" : "RIGHT";
      const thigh = (1 - smoothBlend(y, p.thighStartY, p.thighEndY)) * p.thighMax;
      return normalizeSeraInfluences([[boneIndices.hips, 1 - thigh], [boneForSide(boneIndices, localSide, "Thigh"), thigh]]);
    }
    case "LEFT_SHOULDER":
    case "RIGHT_SHOULDER": {
      const p = SERA_SKIN_PROFILE.shoulder;
      const arm = boneForSide(boneIndices, side!, "UpperArm");
      const armWeight = p.armBase + (1 - smoothBlend(y, p.blendStartY, p.blendEndY)) * p.armLowerBonus;
      return normalizeSeraInfluences([[boneIndices.chest, 1 - armWeight], [arm, armWeight]]);
    }
    case "LEFT_UPPER_ARM":
    case "RIGHT_UPPER_ARM": {
      const p = SERA_SKIN_PROFILE.upperArm;
      const upper = boneForSide(boneIndices, side!, "UpperArm");
      const fore = boneForSide(boneIndices, side!, "Forearm");
      const elbow = (1 - smoothBlend(y, p.elbowStartY, p.elbowEndY)) * p.elbowMax;
      return normalizeSeraInfluences([[upper, 1 - elbow], [fore, elbow]]);
    }
    case "LEFT_FOREARM":
    case "RIGHT_FOREARM": {
      const p = SERA_SKIN_PROFILE.forearm;
      const fore = boneForSide(boneIndices, side!, "Forearm");
      const hand = boneForSide(boneIndices, side!, "Hand");
      if (semantic === "silver") return normalizeSeraInfluences([[fore, p.guardRigidForearm], [hand, p.guardHand]]);
      const handBlend = (1 - smoothBlend(y, p.handStartY, p.handEndY)) * p.handMax;
      return normalizeSeraInfluences([[fore, 1 - handBlend], [hand, handBlend]]);
    }
    case "LEFT_HAND":
    case "RIGHT_HAND": {
      const p = SERA_SKIN_PROFILE.hand;
      const hand = boneForSide(boneIndices, side!, "Hand");
      const fore = boneForSide(boneIndices, side!, "Forearm");
      return normalizeSeraInfluences([[hand, p.hand], [fore, p.forearm]]);
    }
    case "LEFT_THIGH":
    case "RIGHT_THIGH": {
      const p = SERA_SKIN_PROFILE.thigh;
      const thigh = boneForSide(boneIndices, side!, "Thigh");
      const shin = boneForSide(boneIndices, side!, "Shin");
      const hipBlend = smoothBlend(y, p.hipStartY, p.hipEndY) * p.hipMax;
      const kneeBlend = (1 - smoothBlend(y, p.kneeStartY, p.kneeEndY)) * p.kneeMax;
      return normalizeSeraInfluences([[thigh, 1 - hipBlend - kneeBlend], [boneIndices.hips, hipBlend], [shin, kneeBlend]]);
    }
    case "LEFT_SHIN":
    case "RIGHT_SHIN": {
      const p = SERA_SKIN_PROFILE.shin;
      const shin = boneForSide(boneIndices, side!, "Shin");
      const thigh = boneForSide(boneIndices, side!, "Thigh");
      const foot = boneForSide(boneIndices, side!, "Foot");
      if (semantic === "blueHi") return normalizeSeraInfluences([[shin, p.guardRigidShin], [foot, p.guardFoot]]);
      const kneeBlend = smoothBlend(y, p.kneeStartY, p.kneeEndY) * p.kneeMax;
      const ankleBlend = (1 - smoothBlend(y, p.ankleStartY, p.ankleEndY)) * p.ankleMax;
      return normalizeSeraInfluences([[shin, 1 - kneeBlend - ankleBlend], [thigh, kneeBlend], [foot, ankleBlend]]);
    }
    case "LEFT_FOOT":
    case "RIGHT_FOOT": {
      const p = SERA_SKIN_PROFILE.foot;
      const foot = boneForSide(boneIndices, side!, "Foot");
      const shin = boneForSide(boneIndices, side!, "Shin");
      return normalizeSeraInfluences([[foot, p.foot], [shin, p.shin]]);
    }
  }
}

export function assignSeraBlenderSkinning(geometry: THREE.BufferGeometry, boneIndices: Record<string, number>): SeraSkinningDiagnostics {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) throw new Error("SERA_BLENDER_SKINNING_REQUIRES_POSITION");
  const color = (geometry.getAttribute("color") as THREE.BufferAttribute | undefined) ?? null;
  const indices: number[] = [];
  const weights: number[] = [];
  const diagnostics: SeraSkinningDiagnostics = { regionCounts: {}, semanticCounts: {}, headLockedVertices: 0, invalidWeightVertices: 0, maxInfluenceCount: 0 };

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const semantic = semanticFromColorAttribute(color, vertex);
    const region = classifySeraRuntimeRegion(position.getX(vertex), position.getY(vertex), position.getZ(vertex), semantic);
    const influences = solveSeraRuntimeInfluences(region, position.getY(vertex), boneIndices, semantic);
    diagnostics.semanticCounts[semantic] = (diagnostics.semanticCounts[semantic] ?? 0) + 1;
    diagnostics.regionCounts[region] = (diagnostics.regionCounts[region] ?? 0) + 1;
    if (isSeraHeadLockedSemantic(semantic)) diagnostics.headLockedVertices += 1;
    diagnostics.maxInfluenceCount = Math.max(diagnostics.maxInfluenceCount, influences.length);
    const sum = influences.reduce((total, [, weight]) => total + weight, 0);
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-4 || influences.length > 4) diagnostics.invalidWeightVertices += 1;
    for (let slot = 0; slot < 4; slot += 1) {
      indices.push(influences[slot]?.[0] ?? 0);
      weights.push(influences[slot]?.[1] ?? 0);
    }
  }

  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.userData.skinningVersion = "SERA_BLENDER_SKIN_V2";
  geometry.userData.skinningDiagnostics = diagnostics;
  return diagnostics;
}
