import * as THREE from "three";
import { semanticFromColorAttribute, type SeraRuntimeSemantic } from "./visual-blender-semantics";

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
  return sorted.map(([bone, weight]) => [bone, weight / total] as const);
}

function sideOf(x: number): "LEFT" | "RIGHT" {
  return x < 0 ? "LEFT" : "RIGHT";
}

function limbRegion(side: "LEFT" | "RIGHT", part: "SHOULDER" | "UPPER_ARM" | "FOREARM" | "HAND" | "THIGH" | "SHIN" | "FOOT"): SeraRuntimeRegion {
  return `${side}_${part}` as SeraRuntimeRegion;
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

  // Authored hair/face planes belong to the head even when a ponytail segment
  // extends below the anatomical skull height.
  if (semantic === "hair" || semantic === "eye" || semantic === "brow" || semantic === "lip" || semantic === "skinShadow") return "HEAD";
  if (y >= 0.835) return "HEAD";

  // The raised blue collar sits tightly around the neck and must not be picked
  // up by shoulder heuristics.
  if ((semantic === "blue" || semantic === "blueHi") && y >= 0.795 && y < 0.855 && absX < 0.100 && absZ < 0.095) return "COLLAR";

  // Silver geometry is authored only for the forearm guards in SERA V11.
  if (semantic === "silver" && y >= 0.455 && y < 0.700) return limbRegion(side, "FOREARM");

  // Hands are low enough that a pure height classifier is reliable once skirt
  // and torso semantics are excluded.
  if (y >= 0.405 && y < 0.515 && absX > 0.135 && (semantic === "skin" || semantic === "black")) return limbRegion(side, "HAND");

  // Shoulder seam gets a dedicated region so chest and upper-arm rotation blend
  // without pulling torso polygons across the body.
  if (y >= 0.680 && y < 0.825 && absX >= 0.105 && absX < 0.205 && semantic !== "black") return limbRegion(side, "SHOULDER");

  if (y >= 0.610 && y < 0.825 && absX >= 0.155 && (semantic === "skin" || semantic === "blue" || semantic === "blueHi" || semantic === "black")) return limbRegion(side, "UPPER_ARM");
  if (y >= 0.490 && y < 0.675 && absX >= 0.145 && (semantic === "skin" || semantic === "black" || semantic === "blue" || semantic === "blueHi")) return limbRegion(side, "FOREARM");

  // Authored skirt panels occupy the waist-to-thigh gap and are deliberately
  // separated from the body legs so they can remain hip-led.
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
): SeraInfluence[] {
  const side = region.startsWith("LEFT") ? "LEFT" : region.startsWith("RIGHT") ? "RIGHT" : null;
  switch (region) {
    case "HEAD": return normalizeSeraInfluences([[boneIndices.head, 1]]);
    case "COLLAR": return normalizeSeraInfluences([[boneIndices.neck, 0.58], [boneIndices.chest, 0.42]]);
    case "TORSO": {
      const upper = smoothBlend(y, 0.690, 0.810);
      const neck = smoothBlend(y, 0.795, 0.840) * 0.10;
      return normalizeSeraInfluences([[boneIndices.spineLower, 1 - upper], [boneIndices.spineUpper, upper * 0.54], [boneIndices.chest, upper * 0.46 - neck], [boneIndices.neck, neck]]);
    }
    case "HIPS": {
      const spine = smoothBlend(y, 0.590, 0.675) * 0.46;
      return normalizeSeraInfluences([[boneIndices.hips, 1 - spine], [boneIndices.spineLower, spine]]);
    }
    case "FRONT_SKIRT": {
      const thigh = (1 - smoothBlend(y, 0.430, 0.565)) * 0.16;
      return normalizeSeraInfluences([[boneIndices.hips, 1 - thigh], [boneIndices.leftThigh, thigh * 0.5], [boneIndices.rightThigh, thigh * 0.5]]);
    }
    case "LEFT_SKIRT":
    case "RIGHT_SKIRT": {
      const localSide = region.startsWith("LEFT") ? "LEFT" : "RIGHT";
      const thigh = (1 - smoothBlend(y, 0.425, 0.575)) * 0.24;
      return normalizeSeraInfluences([[boneIndices.hips, 1 - thigh], [boneForSide(boneIndices, localSide, "Thigh"), thigh]]);
    }
    case "LEFT_SHOULDER":
    case "RIGHT_SHOULDER": {
      const arm = boneForSide(boneIndices, side!, "UpperArm");
      const armWeight = 0.38 + (1 - smoothBlend(y, 0.700, 0.810)) * 0.12;
      return normalizeSeraInfluences([[boneIndices.chest, 1 - armWeight], [arm, armWeight]]);
    }
    case "LEFT_UPPER_ARM":
    case "RIGHT_UPPER_ARM": {
      const upper = boneForSide(boneIndices, side!, "UpperArm");
      const fore = boneForSide(boneIndices, side!, "Forearm");
      const elbow = (1 - smoothBlend(y, 0.620, 0.690)) * 0.34;
      return normalizeSeraInfluences([[upper, 1 - elbow], [fore, elbow]]);
    }
    case "LEFT_FOREARM":
    case "RIGHT_FOREARM": {
      const fore = boneForSide(boneIndices, side!, "Forearm");
      const hand = boneForSide(boneIndices, side!, "Hand");
      const handBlend = (1 - smoothBlend(y, 0.475, 0.530)) * 0.24;
      return normalizeSeraInfluences([[fore, 1 - handBlend], [hand, handBlend]]);
    }
    case "LEFT_HAND":
    case "RIGHT_HAND": {
      const hand = boneForSide(boneIndices, side!, "Hand");
      const fore = boneForSide(boneIndices, side!, "Forearm");
      return normalizeSeraInfluences([[hand, 0.94], [fore, 0.06]]);
    }
    case "LEFT_THIGH":
    case "RIGHT_THIGH": {
      const thigh = boneForSide(boneIndices, side!, "Thigh");
      const shin = boneForSide(boneIndices, side!, "Shin");
      const hipBlend = smoothBlend(y, 0.500, 0.590) * 0.22;
      const kneeBlend = (1 - smoothBlend(y, 0.285, 0.340)) * 0.34;
      return normalizeSeraInfluences([[thigh, 1 - hipBlend - kneeBlend], [boneIndices.hips, hipBlend], [shin, kneeBlend]]);
    }
    case "LEFT_SHIN":
    case "RIGHT_SHIN": {
      const shin = boneForSide(boneIndices, side!, "Shin");
      const thigh = boneForSide(boneIndices, side!, "Thigh");
      const foot = boneForSide(boneIndices, side!, "Foot");
      const kneeBlend = smoothBlend(y, 0.270, 0.315) * 0.24;
      const ankleBlend = (1 - smoothBlend(y, 0.075, 0.115)) * 0.24;
      return normalizeSeraInfluences([[shin, 1 - kneeBlend - ankleBlend], [thigh, kneeBlend], [foot, ankleBlend]]);
    }
    case "LEFT_FOOT":
    case "RIGHT_FOOT": {
      const foot = boneForSide(boneIndices, side!, "Foot");
      const shin = boneForSide(boneIndices, side!, "Shin");
      return normalizeSeraInfluences([[foot, 0.96], [shin, 0.04]]);
    }
  }
}

export function assignSeraBlenderSkinning(geometry: THREE.BufferGeometry, boneIndices: Record<string, number>): SeraSkinningDiagnostics {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) throw new Error("SERA_BLENDER_SKINNING_REQUIRES_POSITION");
  const color = (geometry.getAttribute("color") as THREE.BufferAttribute | undefined) ?? null;
  const indices: number[] = [];
  const weights: number[] = [];
  const diagnostics: SeraSkinningDiagnostics = { regionCounts: {}, semanticCounts: {}, invalidWeightVertices: 0, maxInfluenceCount: 0 };

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const semantic = semanticFromColorAttribute(color, vertex);
    const region = classifySeraRuntimeRegion(position.getX(vertex), position.getY(vertex), position.getZ(vertex), semantic);
    const influences = solveSeraRuntimeInfluences(region, position.getY(vertex), boneIndices);
    diagnostics.semanticCounts[semantic] = (diagnostics.semanticCounts[semantic] ?? 0) + 1;
    diagnostics.regionCounts[region] = (diagnostics.regionCounts[region] ?? 0) + 1;
    diagnostics.maxInfluenceCount = Math.max(diagnostics.maxInfluenceCount, influences.length);
    const sum = influences.reduce((total, [, weight]) => total + weight, 0);
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-4) diagnostics.invalidWeightVertices += 1;
    for (let slot = 0; slot < 4; slot += 1) {
      indices.push(influences[slot]?.[0] ?? 0);
      weights.push(influences[slot]?.[1] ?? 0);
    }
  }

  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.userData.skinningVersion = "SERA_BLENDER_SKIN_V1";
  geometry.userData.skinningDiagnostics = diagnostics;
  return diagnostics;
}
