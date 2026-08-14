import * as THREE from "three";

export type SeraRuntimeSemantic =
  | "skin"
  | "skinShadow"
  | "blue"
  | "blueHi"
  | "black"
  | "silver"
  | "hair"
  | "eye"
  | "brow"
  | "lip"
  | "unknown";

type PaletteEntry = readonly [semantic: Exclude<SeraRuntimeSemantic, "unknown">, rgb: readonly [number, number, number]];

const rgb = (hex: number): readonly [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

/** Exact flat-color palette authored by the Blender SERA builder. */
export const SERA_RUNTIME_PALETTE: readonly PaletteEntry[] = [
  ["skin", rgb(0xD7A38A)],
  ["skinShadow", rgb(0xB97967)],
  ["blue", rgb(0x2059C1)],
  ["blueHi", rgb(0x387AD3)],
  ["black", rgb(0x0D0E16)],
  ["silver", rgb(0x9FADC2)],
  ["hair", rgb(0x17151A)],
  ["eye", rgb(0x211A18)],
  ["brow", rgb(0x17151A)],
  ["lip", rgb(0x8A4D55)],
] as const;

function distanceSquared(r: number, g: number, b: number, target: readonly [number, number, number]): number {
  return (r - target[0]) ** 2 + (g - target[1]) ** 2 + (b - target[2]) ** 2;
}

/**
 * Decode a vertex/material color back to the authored Blender semantic.
 * sRGB conversion and GLTF material processing can introduce small deltas, so
 * nearest-palette matching is used instead of brittle exact float equality.
 */
export function classifySeraRuntimeColor(r: number, g: number, b: number): SeraRuntimeSemantic {
  if (![r, g, b].every(Number.isFinite)) return "unknown";
  let best: SeraRuntimeSemantic = "unknown";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [semantic, target] of SERA_RUNTIME_PALETTE) {
    const distance = distanceSquared(r, g, b, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = semantic;
    }
  }
  // A deliberately generous bound catches normal color-management drift while
  // keeping unrelated/debug colors out of anatomical decisions.
  return bestDistance <= 0.035 ? best : "unknown";
}

export function semanticFromColorAttribute(color: THREE.BufferAttribute | null, vertex: number): SeraRuntimeSemantic {
  if (!color || vertex < 0 || vertex >= color.count) return "unknown";
  return classifySeraRuntimeColor(color.getX(vertex), color.getY(vertex), color.getZ(vertex));
}
