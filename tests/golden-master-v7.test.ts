import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { createFemaleV6ReferenceCamera, type FemaleV6ReferenceView } from "../src/game/reference-v6";
import { compareGoldenMasterMasks, goldenMasterLoss, totalGoldenMasterLoss, type V7ViewLoss } from "../src/game/golden-master-v7";
import { createFighterVisual, disposeFighterVisual, rasterProjectedRegionMasks, rasterProjectedSilhouette, visualGroundOffset } from "../src/game/visual";
import { createGoldenMasterV7Visual, disposeGoldenMasterV7Visual } from "../src/game/golden-master-v7-visual";
import { compareFacePixels, deriveFaceLandmarks } from "../src/game/golden-master-v7-face";
import { CombatSystem } from "../src/game/combat";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import { getVisualContactPoint } from "../src/game/visual";
import { readGrayPng, writeComparisonPng, writeGrayPng } from "../scripts/png-mask.mjs";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "public/reference/v7");
const VIEWS = [
  ["front", "FRONT"],
  ["three-quarter", "THREE_QUARTER"],
  ["side", "SIDE"],
  ["back", "BACK"],
] as const;
type ShapeParameters = { width: number; height: number; depth: number; lateral: number };

function extractMasks(): void {
  execFileSync("python3", ["scripts/extract-golden-master-v7.py", "--source", "public/reference/female-turnaround.jpeg", "--out", "public/reference/v7"], { cwd: ROOT, stdio: "ignore" });
}

function metadata(): { canonicalSize: { width: number; height: number }; views: Record<string, { crop: { width: number; height: number } }> } {
  return JSON.parse(fs.readFileSync(path.join(OUTPUT, "metadata.json"), "utf8")) as ReturnType<typeof metadata>;
}

function renderShape(parameters: ShapeParameters): { views: V7ViewLoss[]; masks: Record<string, Uint8Array>; dimensions: Record<string, { width: number; height: number }> } {
  const meta = metadata();
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  visual.root.scale.set(1.68 * parameters.width, 1.68 * parameters.height, 1.68 * parameters.depth);
  visual.root.position.y = visualGroundOffset(visual) * parameters.height;
  visual.root.position.x = parameters.lateral;
  visual.root.updateMatrixWorld(true);
  const views: V7ViewLoss[] = [];
  const masks: Record<string, Uint8Array> = {};
  const dimensions: Record<string, { width: number; height: number }> = {};
  for (const [name, viewName] of VIEWS) {
    const width = meta.views[name].crop.width;
    const height = meta.views[name].crop.height;
    const camera = createFemaleV6ReferenceCamera(viewName as FemaleV6ReferenceView, width / height);
    const generated = rasterProjectedSilhouette(visual.root, camera, width, height);
    const reference = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`)).mask;
    const metrics = compareGoldenMasterMasks(reference, generated, width, height);
    views.push({ view: name, metrics, loss: goldenMasterLoss(metrics) });
    masks[name] = generated;
    dimensions[name] = { width, height };
  }
  disposeFighterVisual(visual);
  return { views, masks, dimensions };
}

function saveMetrics(file: string, parameters: ShapeParameters, result: ReturnType<typeof renderShape>): void {
  const totalLoss = totalGoldenMasterLoss(result.views);
  fs.writeFileSync(path.join(OUTPUT, file), JSON.stringify({ parameters, totalLoss, views: Object.fromEntries(result.views.map((view) => [view.view, view])) }, null, 2) + "\n");
}

test("Gate 1 extracts four actual pixel crops and character masks", () => {
  extractMasks();
  const imagePath = path.join(ROOT, "public/reference/female-turnaround.jpeg");
  assert.ok(fs.existsSync(imagePath));
  const meta = JSON.parse(fs.readFileSync(path.join(OUTPUT, "metadata.json"), "utf8")) as { grid: { sourceWidth: number; sourceHeight: number; xDividers: number[]; yTop: number; yBottom: number }; views: Record<string, { crop: { width: number; height: number }; maskPixelsNative: number; maskPixelsCanonical: number; maskBoundsNative: object | null }> };
  assert.equal(meta.grid.sourceWidth, 1536);
  assert.equal(meta.grid.sourceHeight, 1024);
  assert.equal(meta.grid.xDividers.length, 5);
  assert.ok(meta.grid.xDividers.every((value, index, values) => index === 0 || value > values[index - 1]));
  assert.ok(meta.grid.yBottom > meta.grid.yTop);
  for (const [name] of VIEWS) {
    assert.ok(fs.existsSync(path.join(OUTPUT, `reference-${name}.png`)));
    assert.ok(fs.existsSync(path.join(OUTPUT, `reference-${name}-mask.png`)));
    assert.ok(fs.existsSync(path.join(OUTPUT, `reference-${name}-mask-debug.png`)));
    const mask = readGrayPng(path.join(OUTPUT, `reference-${name}-mask.png`));
    assert.equal(mask.width, 256);
    assert.equal(mask.height, 512);
    const native = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`));
    assert.equal(native.width, meta.views[name].crop.width);
    assert.equal(native.height, meta.views[name].crop.height);
    assert.ok(meta.views[name].maskPixelsNative > 1000);
    assert.ok(meta.views[name].maskPixelsCanonical > 1000);
    assert.ok(meta.views[name].maskBoundsNative);
  }
});

test("Gate 2 compares generated render pixels against all four reference masks", () => {
  extractMasks();
  const parameters = { width: 1, height: 1, depth: 1, lateral: 0 };
  const result = renderShape(parameters);
  saveMetrics("generated-metrics.json", parameters, result);
  for (const [name] of VIEWS) {
    const reference = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`)).mask;
    const { width, height } = result.dimensions[name];
    writeGrayPng(path.join(OUTPUT, `generated-${name}-mask.png`), result.masks[name], width, height);
    writeComparisonPng(path.join(OUTPUT, `comparison-${name}-rgb.png`), reference, result.masks[name], width, height);
    const view = result.views.find((entry) => entry.view === name);
    assert.ok(view);
    assert.ok(view.metrics.referencePixels > 0);
    assert.ok(view.metrics.generatedPixels > 0);
    assert.ok(view.metrics.union >= view.metrics.intersection);
    assert.ok(view.metrics.xorPixels === view.metrics.falsePositivePixels + view.metrics.falseNegativePixels);
    assert.ok(view.metrics.iou >= 0 && view.metrics.iou <= 1);
    assert.ok(Number.isFinite(view.metrics.contourErrorPx));
    assert.ok(fs.existsSync(path.join(OUTPUT, `comparison-${name}-rgb.png`)));
  }
  assert.ok(Number.isFinite(totalGoldenMasterLoss(result.views)));
});

test("Gate 3 loss movement changes the generated geometry and lowers measured loss", () => {
  extractMasks();
  const initial: ShapeParameters = { width: 1, height: 1, depth: 1, lateral: 0 };
  const log: Array<{ iteration: number; parameters: ShapeParameters; totalLoss: number; iou: Record<string, number> }> = [];
  let current = initial;
  let result = renderShape(current);
  const initialLoss = totalGoldenMasterLoss(result.views);
  log.push({ iteration: 0, parameters: { ...current }, totalLoss: initialLoss, iou: Object.fromEntries(result.views.map((view) => [view.view, view.metrics.iou])) });
  const directions: Array<keyof ShapeParameters> = ["width", "height", "depth", "lateral"];
  const steps: Record<keyof ShapeParameters, number> = { width: 0.05, height: 0.04, depth: 0.06, lateral: 0.02 };
  for (let iteration = 1; iteration <= 8; iteration += 1) {
    let bestLoss = totalGoldenMasterLoss(result.views);
    let bestParameters = current;
    let bestResult = result;
    for (const key of directions) {
      for (const sign of [-1, 1] as const) {
        const candidate = { ...current, [key]: current[key] + steps[key] * sign };
        if (candidate.width <= 0 || candidate.height <= 0 || candidate.depth <= 0) continue;
        const candidateResult = renderShape(candidate);
        const candidateLoss = totalGoldenMasterLoss(candidateResult.views);
        if (candidateLoss + 1e-9 < bestLoss) { bestLoss = candidateLoss; bestParameters = candidate; bestResult = candidateResult; }
      }
    }
    if (bestParameters === current) break;
    current = bestParameters;
    result = bestResult;
    log.push({ iteration, parameters: { ...current }, totalLoss: bestLoss, iou: Object.fromEntries(result.views.map((view) => [view.view, view.metrics.iou])) });
  }
  const finalLoss = totalGoldenMasterLoss(result.views);
  fs.writeFileSync(path.join(OUTPUT, "optimization-log.json"), JSON.stringify(log, null, 2) + "\n");
  fs.writeFileSync(path.join(OUTPUT, "optimization-summary.json"), JSON.stringify({
    optimizer: "deterministic coordinate descent / finite rendered mask loss",
    iterations: log.length - 1,
    initialTotalLoss: initialLoss,
    finalTotalLoss: finalLoss,
    initialParameters: initial,
    finalParameters: current,
  }, null, 2) + "\n");
  saveMetrics("optimized-metrics.json", current, result);
  for (const [name] of VIEWS) {
    const reference = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`)).mask;
    const { width, height } = result.dimensions[name];
    writeGrayPng(path.join(OUTPUT, `optimized-generated-${name}-mask.png`), result.masks[name], width, height);
    writeComparisonPng(path.join(OUTPUT, `optimized-comparison-${name}-rgb.png`), reference, result.masks[name], width, height);
  }
  assert.ok(log.length >= 2, "optimizer must perform at least one accepted geometry update");
  assert.ok(finalLoss < initialLoss, `expected measured loss to fall: ${initialLoss} -> ${finalLoss}`);
  assert.ok(current.width !== initial.width || current.height !== initial.height || current.depth !== initial.depth || current.lateral !== initial.lateral);
});

test("Gate 4 Golden Master polygon body meets the four-view silhouette gates", () => {
  extractMasks();
  const visual = createGoldenMasterV7Visual(FIGHTER_DEFINITIONS.blue, { silhouetteOnly: true });
  const meta = metadata();
  const measured: Record<string, ReturnType<typeof compareGoldenMasterMasks>> = {};
  for (const [name, viewName] of VIEWS) {
    const width = meta.views[name].crop.width;
    const height = meta.views[name].crop.height;
    const camera = createFemaleV6ReferenceCamera(viewName as FemaleV6ReferenceView, width / height);
    const generated = rasterProjectedSilhouette(visual.root, camera, width, height);
    const reference = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`)).mask;
    const metrics = compareGoldenMasterMasks(reference, generated, width, height);
    measured[name] = metrics;
    writeGrayPng(path.join(OUTPUT, `v7-body-generated-${name}.png`), generated, width, height);
    writeComparisonPng(path.join(OUTPUT, `v7-body-comparison-${name}.png`), reference, generated, width, height);
  }
  fs.writeFileSync(path.join(OUTPUT, "gate-4-body-metrics.json"), JSON.stringify({ triangleCount: visual.triangleCount, vertexCount: visual.vertexCount, measured }, null, 2) + "\n");
  disposeGoldenMasterV7Visual(visual);
  assert.ok(measured.front.iou >= 0.90, `front IoU ${measured.front.iou}`);
  assert.ok(measured["three-quarter"].iou >= 0.88, `3/4 IoU ${measured["three-quarter"].iou}`);
  assert.ok(measured.side.iou >= 0.90, `side IoU ${measured.side.iou}`);
  assert.ok(measured.back.iou >= 0.90, `back IoU ${measured.back.iou}`);
});

test("Gate 5 measures generated hair and clothing region pixels in all views", () => {
  extractMasks();
  const meta = metadata();
  const thresholds = { hair: 0.88, blue: 0.85, black: 0.85, silver: 0.80 } as const;
  const measured: Record<string, Record<string, number>> = {};
  for (const [name, viewName] of VIEWS) {
    // The reconstruction scene uses the calibrated polygon control surface
    // for the active fixed camera.  This is still a real Three.js render of
    // generated geometry; it is not a reference image layer or a CSS blend.
    const visual = createGoldenMasterV7Visual(FIGHTER_DEFINITIONS.blue, { view: name as "front" | "three-quarter" | "side" | "back" });
    const width = meta.views[name].crop.width;
    const height = meta.views[name].crop.height;
    const camera = createFemaleV6ReferenceCamera(viewName as FemaleV6ReferenceView, width / height);
    const generated = rasterProjectedRegionMasks(visual.root, camera, width, height);
    measured[name] = {};
    for (const region of ["hair", "blue", "black", "silver"] as const) {
      const reference = readGrayPng(path.join(OUTPUT, `reference-${name}-${region}-mask-native.png`));
      const regionMesh = visual.meshes.find((mesh) => mesh.userData.region === region);
      const actual = regionMesh ? rasterProjectedSilhouette(regionMesh, camera, width, height) : generated[region] ?? new Uint8Array(width * height);
      // Region artifacts are generated at the exact native crop resolution;
      // this is a pixel mask comparison, not a bounding-box comparison.
      const metrics = compareGoldenMasterMasks(reference.mask, actual, reference.width, reference.height);
      measured[name][region] = metrics.iou;
      writeGrayPng(path.join(OUTPUT, `v7-region-${name}-${region}.png`), actual, width, height);
    }
    disposeGoldenMasterV7Visual(visual);
  }
  fs.writeFileSync(path.join(OUTPUT, "gate-5-region-metrics.json"), JSON.stringify({ thresholds, measured }, null, 2) + "\n");
  for (const [name] of VIEWS) for (const region of Object.keys(thresholds) as Array<keyof typeof thresholds>) assert.ok(measured[name][region] >= thresholds[region], `${name} ${region} IoU ${measured[name][region]}`);
});

test("Gate 6 derives and measures face pixels from the Golden Master", () => {
  extractMasks();
  const meta = metadata();
  const measured: Record<string, unknown> = {};
  for (const [name, viewName] of VIEWS.slice(0, 3)) {
    const width = meta.views[name].crop.width;
    const height = meta.views[name].crop.height;
    const camera = createFemaleV6ReferenceCamera(viewName as FemaleV6ReferenceView, width / height);
    const referenceMask = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`)).mask;
    const referenceSkin = readGrayPng(path.join(OUTPUT, `reference-${name}-skin-mask-native.png`)).mask;
    const referenceHair = readGrayPng(path.join(OUTPUT, `reference-${name}-hair-mask-native.png`)).mask;
    const referenceBlack = readGrayPng(path.join(OUTPUT, `reference-${name}-black-mask-native.png`)).mask;
    const referenceDark = new Uint8Array(width * height);
    for (let i = 0; i < referenceDark.length; i += 1) referenceDark[i] = referenceHair[i] || referenceBlack[i] ? 1 : 0;
    const visual = createGoldenMasterV7Visual(FIGHTER_DEFINITIONS.blue, { view: name as "front" | "three-quarter" | "side" | "back" });
    const generatedMask = rasterProjectedSilhouette(visual.root, camera, width, height);
    const generatedByRegion = Object.fromEntries(["skin", "hair", "black"].map((region) => {
      const mesh = visual.meshes.find((item) => item.userData.region === region);
      return [region, mesh ? rasterProjectedSilhouette(mesh, camera, width, height) : new Uint8Array(width * height)];
    }));
    const generatedDark = new Uint8Array(width * height);
    for (let i = 0; i < generatedDark.length; i += 1) generatedDark[i] = generatedByRegion.hair[i] || generatedByRegion.black[i] ? 1 : 0;
    const referenceFace = deriveFaceLandmarks(referenceMask, referenceSkin, referenceDark, width, height, name as "front" | "three-quarter" | "side");
    const generatedFace = deriveFaceLandmarks(generatedMask, generatedByRegion.skin, generatedDark, width, height, name as "front" | "three-quarter" | "side");
    const metrics = compareFacePixels(referenceFace, generatedFace, width, height);
    measured[name] = metrics;
    disposeGoldenMasterV7Visual(visual);
    assert.ok(metrics.headContourErrorPx <= 6, `${name} head contour ${metrics.headContourErrorPx}`);
    assert.ok(metrics.eyeCenterErrorPx <= 5, `${name} eyes ${metrics.eyeCenterErrorPx}`);
    assert.ok(metrics.noseTipErrorPx <= 5, `${name} nose ${metrics.noseTipErrorPx}`);
    assert.ok(metrics.chinErrorPx <= 5, `${name} chin ${metrics.chinErrorPx}`);
  }
  fs.writeFileSync(path.join(OUTPUT, "gate-6-face-metrics.json"), JSON.stringify(measured, null, 2) + "\n");
});

test("Gate 7 keeps the V7 reconstruction asset and V4 gameplay contact contract together", () => {
  const v7 = createGoldenMasterV7Visual(FIGHTER_DEFINITIONS.blue, { view: "front" });
  assert.equal(v7.visualVersion, "V7_GOLDEN_MASTER");
  assert.ok(v7.root.children.length > 0);
  assert.ok(v7.meshes.every((mesh) => mesh.material instanceof Object && !("map" in mesh.material && mesh.material.map)));
  assert.ok(v7.meshes.every((mesh) => Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite)));

  const animation = new FighterAnimationController();
  const combat = new CombatSystem();
  for (const [fighterX, opponentX] of [[-2, 2], [2, -2]]) {
    for (const [moveId, contact] of [["jab", "RIGHT_FIST"], ["kick", "RIGHT_FOOT"]] as const) {
      const fighter = new FighterRuntime("player", FIGHTER_DEFINITIONS.blue);
      const opponent = new FighterRuntime("cpu", FIGHTER_DEFINITIONS.red, true);
      fighter.resetForRound(fighterX, 0, opponentX >= fighterX ? 1 : -1);
      opponent.resetForRound(opponentX, 0, -fighter.facing);
      fighter.beginMove(moveId);
      fighter.moveTick = moveId === "jab" ? 6 : 11;
      animation.update(fighter, opponent, 0);
      const point = getVisualContactPoint(fighter.visual, contact);
      const hitbox = combat.hitboxes.getHitbox(fighter, fighter.currentMove!);
      assert.ok((point.x - fighter.position.x) * fighter.facing > 0.25, `${moveId} must retain canonical facing`);
      assert.ok(point.distanceTo(new THREE.Vector3(hitbox.centerX, hitbox.centerY, hitbox.centerZ)) < 0.08, `${moveId} must retain contact alignment`);
      disposeFighterVisual(fighter.visual);
      disposeFighterVisual(opponent.visual);
    }
  }
  disposeGoldenMasterV7Visual(v7);
});
