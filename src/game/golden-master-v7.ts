/**
 * Pixel-level comparison primitives for the V7 Golden Master pipeline.
 *
 * These functions operate on binary pixels only.  They intentionally do not
 * know about the reference character's hand-authored proportions, bounding
 * boxes, or landmark guesses.  A view is scored from the decoded Golden
 * Master mask and the mask rasterized from generated Three.js triangles.
 */

export const GOLDEN_MASTER_V7_SIZE = { width: 256, height: 512 } as const;

export interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MaskMetrics {
  width: number;
  height: number;
  referencePixels: number;
  generatedPixels: number;
  intersection: number;
  union: number;
  iou: number;
  falsePositivePixels: number;
  falseNegativePixels: number;
  xorPixels: number;
  referenceBounds: PixelBounds | null;
  generatedBounds: PixelBounds | null;
  contourErrorPx: number;
}

export type V7RegionName = "skin" | "hair" | "blue" | "black" | "silver";

function isSet(mask: Uint8Array, index: number): boolean {
  return mask[index] !== 0;
}

function bounds(mask: Uint8Array, width: number, height: number): PixelBounds | null {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!isSet(mask, y * width + x)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function boundary(mask: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (!isSet(mask, index)) continue;
    const left = x > 0 && isSet(mask, index - 1);
    const right = x + 1 < width && isSet(mask, index + 1);
    const up = y > 0 && isSet(mask, index - width);
    const down = y + 1 < height && isSet(mask, index + width);
    if (!(left && right && up && down)) result[index] = 1;
  }
  return result;
}

/** Two-pass chamfer distance to a binary target set. */
function distanceTo(target: Uint8Array, width: number, height: number): Float32Array {
  const diagonal = Math.SQRT2;
  const distance = new Float32Array(target.length);
  distance.fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < target.length; i += 1) if (target[i]) distance[i] = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    let value = distance[index];
    if (x > 0) value = Math.min(value, distance[index - 1] + 1);
    if (y > 0) value = Math.min(value, distance[index - width] + 1);
    if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + diagonal);
    if (x + 1 < width && y > 0) value = Math.min(value, distance[index - width + 1] + diagonal);
    distance[index] = value;
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const index = y * width + x;
    let value = distance[index];
    if (x + 1 < width) value = Math.min(value, distance[index + 1] + 1);
    if (y + 1 < height) value = Math.min(value, distance[index + width] + 1);
    if (x + 1 < width && y + 1 < height) value = Math.min(value, distance[index + width + 1] + diagonal);
    if (x > 0 && y + 1 < height) value = Math.min(value, distance[index + width - 1] + diagonal);
    distance[index] = value;
  }
  return distance;
}

function symmetricContourError(reference: Uint8Array, generated: Uint8Array, width: number, height: number): number {
  const referenceEdge = boundary(reference, width, height);
  const generatedEdge = boundary(generated, width, height);
  let referenceCount = 0; let generatedCount = 0; let referenceSum = 0; let generatedSum = 0;
  for (const value of referenceEdge) referenceCount += value;
  for (const value of generatedEdge) generatedCount += value;
  if (!referenceCount && !generatedCount) return 0;
  if (!referenceCount || !generatedCount) return Math.hypot(width, height);
  const toReference = distanceTo(referenceEdge, width, height);
  const toGenerated = distanceTo(generatedEdge, width, height);
  for (let i = 0; i < reference.length; i += 1) {
    if (referenceEdge[i]) referenceSum += toGenerated[i];
    if (generatedEdge[i]) generatedSum += toReference[i];
  }
  return (referenceSum / generatedCount + generatedSum / referenceCount) * 0.5;
}

/** Compare two actual binary image masks at the same pixel resolution. */
export function compareGoldenMasterMasks(reference: Uint8Array, generated: Uint8Array, width: number, height: number): MaskMetrics {
  if (reference.length !== width * height || generated.length !== width * height) throw new Error("Golden Master masks have inconsistent dimensions");
  let referencePixels = 0; let generatedPixels = 0; let intersection = 0; let union = 0; let falsePositivePixels = 0; let falseNegativePixels = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const expected = reference[i] !== 0; const actual = generated[i] !== 0;
    referencePixels += expected ? 1 : 0;
    generatedPixels += actual ? 1 : 0;
    intersection += expected && actual ? 1 : 0;
    union += expected || actual ? 1 : 0;
    falsePositivePixels += !expected && actual ? 1 : 0;
    falseNegativePixels += expected && !actual ? 1 : 0;
  }
  return {
    width,
    height,
    referencePixels,
    generatedPixels,
    intersection,
    union,
    iou: union ? intersection / union : referencePixels === generatedPixels ? 1 : 0,
    falsePositivePixels,
    falseNegativePixels,
    xorPixels: falsePositivePixels + falseNegativePixels,
    referenceBounds: bounds(reference, width, height),
    generatedBounds: bounds(generated, width, height),
    contourErrorPx: symmetricContourError(reference, generated, width, height),
  };
}

/** Loss used by the deterministic Gate 3 optimizer. */
export function goldenMasterLoss(metrics: MaskMetrics, contourWeight = 0.035): number {
  return (1 - metrics.iou) + (metrics.contourErrorPx / Math.hypot(metrics.width, metrics.height)) * contourWeight;
}

export interface V7ViewLoss {
  view: string;
  metrics: MaskMetrics;
  loss: number;
}

export function totalGoldenMasterLoss(views: V7ViewLoss[]): number {
  if (!views.length) return Number.POSITIVE_INFINITY;
  return views.reduce((sum, value) => sum + value.loss, 0) / views.length;
}
