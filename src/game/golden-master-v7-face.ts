import type { MaskMetrics } from "./golden-master-v7";
import { compareGoldenMasterMasks } from "./golden-master-v7";

export interface PixelPoint { x: number; y: number; }
export interface FaceLandmarksPixels {
  headTop: PixelPoint;
  leftEye: PixelPoint;
  rightEye: PixelPoint;
  noseTip: PixelPoint;
  mouthCenter: PixelPoint;
  chin: PixelPoint;
  faceMask: Uint8Array;
}

export interface FacePixelMetrics {
  headContourErrorPx: number;
  eyeCenterErrorPx: number;
  noseTipErrorPx: number;
  mouthErrorPx: number;
  chinErrorPx: number;
  faceMask: MaskMetrics;
}

function pointDistance(a: PixelPoint, b: PixelPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function bounds(mask: Uint8Array, width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (mask[y * width + x]) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function average(points: PixelPoint[], fallback: PixelPoint): PixelPoint {
  if (!points.length) return fallback;
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}

function selectPoints(mask: Uint8Array, width: number, height: number, box: { minX: number; minY: number; maxX: number; maxY: number }, predicate: (x: number, y: number) => boolean): PixelPoint[] {
  const result: PixelPoint[] = [];
  for (let y = box.minY; y <= box.maxY; y += 1) for (let x = box.minX; x <= box.maxX; x += 1) if (mask[y * width + x] && predicate(x, y)) result.push({ x, y });
  return result;
}

/** Derive face landmarks from generated/reference pixels, never hand-entered coordinates. */
export function deriveFaceLandmarks(mask: Uint8Array, skin: Uint8Array, dark: Uint8Array, width: number, height: number, view: "front" | "three-quarter" | "side" | "back"): FaceLandmarksPixels {
  const full = bounds(mask, width, height) ?? { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  const faceBottom = Math.min(full.maxY, full.minY + Math.round((full.maxY - full.minY) * 0.30));
  const faceBox = { minX: Math.max(0, Math.round(width * 0.12)), minY: full.minY, maxX: Math.min(width - 1, Math.round(width * 0.88)), maxY: faceBottom };
  const faceMask = new Uint8Array(width * height);
  for (let y = faceBox.minY; y <= faceBox.maxY; y += 1) for (let x = faceBox.minX; x <= faceBox.maxX; x += 1) if (mask[y * width + x]) faceMask[y * width + x] = 1;
  const faceHeight = Math.max(1, faceBox.maxY - faceBox.minY);
  const centerX = (faceBox.minX + faceBox.maxX) * 0.5;
  const headTop = average(selectPoints(mask, width, height, faceBox, (x, y) => y <= faceBox.minY + 3 && Math.abs(x - centerX) < width * 0.16), { x: centerX, y: faceBox.minY });
  const eyeBand = { minY: Math.round(faceBox.minY + faceHeight * 0.28), maxY: Math.round(faceBox.minY + faceHeight * 0.57) };
  const darkEyes = selectPoints(dark, width, height, { ...faceBox, ...eyeBand }, () => true);
  const leftEye = average(darkEyes.filter((point) => point.x <= centerX), { x: centerX - faceHeight * 0.15, y: eyeBand.minY + faceHeight * 0.08 });
  const rightEye = average(darkEyes.filter((point) => point.x > centerX), { x: centerX + faceHeight * 0.15, y: eyeBand.minY + faceHeight * 0.08 });
  const noseBand = { minY: Math.round(faceBox.minY + faceHeight * 0.40), maxY: Math.round(faceBox.minY + faceHeight * 0.67) };
  const nosePixels = selectPoints(skin, width, height, { ...faceBox, ...noseBand }, () => true);
  const noseTip = view === "side"
    ? average(nosePixels.sort((a, b) => b.x - a.x).slice(0, Math.max(1, Math.ceil(nosePixels.length * 0.03))), { x: faceBox.maxX, y: noseBand.minY + faceHeight * 0.12 })
    : average(nosePixels.filter((point) => Math.abs(point.x - centerX) < faceHeight * 0.22), { x: centerX, y: noseBand.minY + faceHeight * 0.13 });
  const mouthBand = { minY: Math.round(faceBox.minY + faceHeight * 0.62), maxY: Math.round(faceBox.minY + faceHeight * 0.82) };
  const mouthPixels = selectPoints(dark, width, height, { ...faceBox, ...mouthBand }, (x) => Math.abs(x - centerX) < faceHeight * 0.28);
  const mouthCenter = average(mouthPixels, { x: centerX, y: mouthBand.minY + faceHeight * 0.08 });
  const chinPixels = selectPoints(skin, width, height, { ...faceBox, minY: Math.round(faceBox.minY + faceHeight * 0.72) }, () => true);
  const chin = average(chinPixels.sort((a, b) => b.y - a.y).slice(0, Math.max(1, Math.ceil(chinPixels.length * 0.05))), { x: centerX, y: faceBox.maxY });
  return { headTop, leftEye, rightEye, noseTip, mouthCenter, chin, faceMask };
}

export function compareFacePixels(reference: FaceLandmarksPixels, generated: FaceLandmarksPixels, width: number, height: number): FacePixelMetrics {
  const eyeCenterErrorPx = (pointDistance(reference.leftEye, generated.leftEye) + pointDistance(reference.rightEye, generated.rightEye)) * 0.5;
  return {
    headContourErrorPx: compareGoldenMasterMasks(reference.faceMask, generated.faceMask, width, height).contourErrorPx,
    eyeCenterErrorPx,
    noseTipErrorPx: pointDistance(reference.noseTip, generated.noseTip),
    mouthErrorPx: pointDistance(reference.mouthCenter, generated.mouthCenter),
    chinErrorPx: pointDistance(reference.chin, generated.chin),
    faceMask: compareGoldenMasterMasks(reference.faceMask, generated.faceMask, width, height),
  };
}
