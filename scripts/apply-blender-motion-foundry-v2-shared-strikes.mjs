import { readFile } from "node:fs/promises";

// Shared strikes are part of the established main baseline now. This command is
// intentionally a superset-safe contract check: later Foundry packs (kicks and
// future slices) may extend the same resource/loader blocks, so replaying the
// original exact-text installer would incorrectly reject a valid newer state.
async function requireAll(path, needles) {
  const source = await readFile(path, "utf8");
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length) {
    throw new Error(`Shared strike Foundry baseline missing in ${path}: ${missing.join(", ")}`);
  }
}

await requireAll("src/game/visual-quaternius-runtime.ts", [
  "QUATERNIUS_BLENDER_STRIKES_URL",
  "blenderStrikes: MotionClipSource | null",
  "blenderStrikeClips",
  'jab: "BF_Jab_L"',
  'bodyBlow: "BF_BodyBlow_L"',
  'backfist: "BF_Backfist_R"',
  '["BF_Jab_L", "PF_Jab_L"]',
  '["BF_BodyBlow_L", "PF_BodyBlow_L"]',
  '["BF_Backfist_R", "PF_Backfist_R"]',
  "quaterniusBlenderStrikeClipCount",
]);

await requireAll("src/game/model-viewer-motion.ts", [
  "QUATERNIUS_BLENDER_STRIKES_URL",
  "blenderStrikeMotion",
  "blenderStrikes",
]);

await requireAll("scripts/capture-model-view-audit.mjs", [
  "BF_Jab_L",
  "PF_Jab_L",
  "BF_BodyBlow_L",
  "PF_BodyBlow_L",
  "BF_Backfist_R",
  "PF_Backfist_R",
  "model-view-motion-blender-jab.png",
  "model-view-motion-blender-body-blow.png",
  "model-view-motion-blender-backfist.png",
]);

console.log("Shared Blender v2 strike integration is present; preserving newer superset state.");
