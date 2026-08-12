import fs from "node:fs";
import path from "node:path";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { createFemaleV6ReferenceCamera, type FemaleV6ReferenceView } from "../src/game/reference-v6";
import { compareGoldenMasterMasks, goldenMasterLoss, type V7ViewLoss } from "../src/game/golden-master-v7";
import { createFighterVisual, disposeFighterVisual, rasterProjectedSilhouette, visualGroundOffset } from "../src/game/visual";
import { readGrayPng, writeComparisonPng, writeGrayPng } from "./png-mask.mjs";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "public/reference/v7");
const VIEW_NAMES = [
  ["front", "FRONT"],
  ["three-quarter", "THREE_QUARTER"],
  ["side", "SIDE"],
  ["back", "BACK"],
] as const;

type ShapeParameters = { width: number; height: number; depth: number; lateral: number };

function readMetadata() {
  return JSON.parse(fs.readFileSync(path.join(OUTPUT, "metadata.json"), "utf8")) as { canonicalSize: { width: number; height: number }; views: Record<string, { crop: { width: number; height: number } }> };
}

function render(parameters: ShapeParameters): { views: V7ViewLoss[]; generated: Record<string, Uint8Array> } {
  const metadata = readMetadata();
  const definition = FIGHTER_DEFINITIONS.blue;
  const visual = createFighterVisual(definition, "NORMAL");
  // This is a real model-space shape transform.  The optimizer changes these
  // parameters, rebuilds the render mask from triangles, and re-measures the
  // Golden Master loss; it never modifies a target metric or bounding box.
  visual.root.scale.set(1.68 * parameters.width, 1.68 * parameters.height, 1.68 * parameters.depth);
  visual.root.position.y = visualGroundOffset(visual) * parameters.height;
  visual.root.position.x = parameters.lateral;
  visual.root.updateMatrixWorld(true);
  const views: V7ViewLoss[] = [];
  const generated: Record<string, Uint8Array> = {};
  for (const [name, viewName] of VIEW_NAMES) {
    const viewMetadata = metadata.views[name];
    const width = viewMetadata.crop.width;
    const height = viewMetadata.crop.height;
    const aspect = viewMetadata.crop.width / viewMetadata.crop.height;
    const camera = createFemaleV6ReferenceCamera(viewName as FemaleV6ReferenceView, aspect);
    const mask = rasterProjectedSilhouette(visual.root, camera, width, height);
    const reference = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`)).mask;
    const metrics = compareGoldenMasterMasks(reference, mask, width, height);
    views.push({ view: name, metrics, loss: goldenMasterLoss(metrics) });
    generated[name] = mask;
  }
  disposeFighterVisual(visual);
  return { views, generated };
}

const baseline = render({ width: 1, height: 1, depth: 1, lateral: 0 });
for (const [name] of VIEW_NAMES) {
  const width = readMetadata().views[name].crop.width;
  const height = readMetadata().views[name].crop.height;
  writeGrayPng(path.join(OUTPUT, `generated-${name}-mask.png`), baseline.generated[name], width, height);
  const reference = readGrayPng(path.join(OUTPUT, `reference-${name}-mask-native.png`)).mask;
  writeComparisonPng(path.join(OUTPUT, `comparison-${name}-rgb.png`), reference, baseline.generated[name], width, height);
}
const payload = {
  parameters: { width: 1, height: 1, depth: 1, lateral: 0 },
  totalLoss: baseline.views.reduce((sum, value) => sum + value.loss, 0) / baseline.views.length,
  views: Object.fromEntries(baseline.views.map((value) => [value.view, value])),
};
fs.writeFileSync(path.join(OUTPUT, "generated-metrics.json"), JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload, null, 2));
