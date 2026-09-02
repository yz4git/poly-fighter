import { readFile, writeFile } from "node:fs/promises";

async function patch(path, mutator) {
  const before = await readFile(path, "utf8");
  const after = mutator(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Motion Foundry patch anchor missing: ${label}`);
  return source.replace(before, after);
}

function replaceEither(source, befores, after, label) {
  if (source.includes(after)) return source;
  const before = befores.find((candidate) => source.includes(candidate));
  if (!before) throw new Error(`Motion Foundry patch anchor missing: ${label}`);
  return source.replace(before, after);
}

await patch("src/game/visual-quaternius-runtime.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'export const QUATERNIUS_PROCEDURAL_CORE_URL = `${BASE_PATH}/models/quaternius/procedural-fight-core.glb`;\n',
    'export const QUATERNIUS_PROCEDURAL_CORE_URL = `${BASE_PATH}/models/quaternius/procedural-fight-core.glb`;\nexport const QUATERNIUS_BLENDER_CORE_URL = `${BASE_PATH}/models/quaternius/blender-fight-core.glb`;\n',
    "runtime blender URL",
  );
  source = replaceOnce(
    source,
    'type MotionResources = {\n  base: MotionClipSource;\n  procedural: MotionClipSource;\n};',
    'type MotionResources = {\n  base: MotionClipSource;\n  procedural: MotionClipSource;\n  blender: MotionClipSource | null;\n};',
    "runtime MotionResources",
  );
  source = replaceOnce(
    source,
    '  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n  ]).then(([base, procedural]) => ({\n    // Retarget each pack against the hierarchy it was authored from. PF v2 is\n    // generated from UAL, but keeping its own loaded scene here avoids losing\n    // animation bindings when the two GLBs differ in node identity/layout.\n    base: { source: base.scene, clips: base.animations },\n    procedural: { source: procedural.scene, clips: procedural.animations },\n  })).catch((error) => {',
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n  ]).then(([base, procedural, blender]) => ({\n    // Retarget each pack against the hierarchy it was authored from. Blender\n    // Foundry is an optional authored override; a missing asset keeps the old\n    // procedural pack playable during staged deployments.\n    base: { source: base.scene, clips: base.animations },\n    procedural: { source: procedural.scene, clips: procedural.animations },\n    blender: blender ? { source: blender.scene, clips: blender.animations } : null,\n  })).catch((error) => {',
    "runtime motion loader",
  );
  source = replaceOnce(source, '  power: "PF_Power_R",', '  power: "BF_Power_R",', "power motion routing");
  source = replaceOnce(
    source,
    '    const retargetedClips = new Map<string, THREE.AnimationClip>([...baseClips, ...proceduralClips]);',
    '    const blenderClips = resources.motion.blender\n      ? retargetMotionClips(resources.motion.blender.source, styled.model, resources.motion.blender.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([...baseClips, ...proceduralClips, ...blenderClips]);\n    if (!retargetedClips.has("BF_Power_R")) {\n      const fallback = proceduralClips.get("PF_Power_R");\n      if (fallback) {\n        const alias = fallback.clone();\n        alias.name = "BF_Power_R";\n        retargetedClips.set(alias.name, alias);\n      }\n    }',
    "runtime blender clip merge",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusProceduralClipCount = proceduralClips.size;',
    '    visual.root.userData.quaterniusProceduralClipCount = proceduralClips.size;\n    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size;\n    visual.root.userData.quaterniusPowerMotionSource = blenderClips.has("BF_Power_R")\n      ? "BLENDER_MOTION_FOUNDRY_V1"\n      : "PROCEDURAL_FALLBACK";',
    "runtime foundry telemetry",
  );
  return source;
});

await patch("src/game/model-viewer-motion.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_PROCEDURAL_CORE_URL,\n  QUATERNIUS_UAL_CORE_URL,',
    '  QUATERNIUS_BLENDER_CORE_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,\n  QUATERNIUS_UAL_CORE_URL,',
    "viewer blender import",
  );
  source = replaceOnce(
    source,
    'export type ModelViewerMotionSource = "PROCEDURAL" | "BASE";',
    'export type ModelViewerMotionSource = "BLENDER" | "PROCEDURAL" | "BASE";',
    "viewer source type",
  );
  source = replaceOnce(
    source,
    '  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n  ]).then(([base, procedural]) => [\n    { root: base.scene, clips: base.animations, source: "BASE" as const },\n    { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" as const },\n  ]).catch((error) => {',
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n  ]).then(([base, procedural, blender]) => {\n    const packs: MotionSourcePack[] = [\n      { root: base.scene, clips: base.animations, source: "BASE" },\n      { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" },\n    ];\n    if (blender) packs.push({ root: blender.scene, clips: blender.animations, source: "BLENDER" });\n    return packs;\n  }).catch((error) => {',
    "viewer motion loader",
  );
  source = replaceOnce(
    source,
    '  if (a.source !== b.source) return a.source === "PROCEDURAL" ? -1 : 1;',
    '  if (a.source !== b.source) {\n    const priority: Record<ModelViewerMotionSource, number> = { BLENDER: 0, PROCEDURAL: 1, BASE: 2 };\n    return priority[a.source] - priority[b.source];\n  }',
    "viewer clip ordering",
  );
  return source;
});

await patch("scripts/capture-model-view-audit.mjs", (input) => {
  let source = input;
  source = replaceEither(
    source,
    [
      "        hasPower: options.some((option) => option.value === 'PF_Power_R'),",
      "        hasPower: options.some((option) => option.value === 'BF_Power_R'),",
    ],
    "        hasBlenderPower: options.some((option) => option.value === 'BF_Power_R'),\n        hasProceduralPower: options.some((option) => option.value === 'PF_Power_R'),",
    "audit A-B power readiness fields",
  );
  source = replaceEither(
    source,
    [
      "    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasPower) return state;",
      "    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasBlenderPower && state?.hasProceduralPower) return state;",
    ],
    "    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasBlenderPower && state?.hasProceduralPower) return state;",
    "audit A-B power readiness condition",
  );

  const proceduralSingle = '  const motionPower = await poseMotionViewer(sessionId, "PF_Power_R", 0.5);\n  if (motionPower.clip !== "PF_Power_R" || Math.abs(motionPower.timeline - 500) > 2 || !motionPower.paused) {\n    throw new Error(`Motion Viewer did not hold PF_Power_R at 50%: ${JSON.stringify(motionPower)}`);\n  }\n  await screenshot(sessionId, `${outputDir}/model-view-motion-power.png`);';
  const blenderSingle = '  const motionPower = await poseMotionViewer(sessionId, "BF_Power_R", 0.5);\n  if (motionPower.clip !== "BF_Power_R" || Math.abs(motionPower.timeline - 500) > 2 || !motionPower.paused) {\n    throw new Error(`Motion Viewer did not hold BF_Power_R at 50%: ${JSON.stringify(motionPower)}`);\n  }\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-power.png`);';
  const abBlock = '  const proceduralPower = await poseMotionViewer(sessionId, "PF_Power_R", 0.5);\n  if (proceduralPower.clip !== "PF_Power_R" || Math.abs(proceduralPower.timeline - 500) > 2 || !proceduralPower.paused) {\n    throw new Error(`Motion Viewer did not hold PF_Power_R at 50%: ${JSON.stringify(proceduralPower)}`);\n  }\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-power.png`);\n\n  const blenderPower = await poseMotionViewer(sessionId, "BF_Power_R", 0.5);\n  if (blenderPower.clip !== "BF_Power_R" || Math.abs(blenderPower.timeline - 500) > 2 || !blenderPower.paused) {\n    throw new Error(`Motion Viewer did not hold BF_Power_R at 50%: ${JSON.stringify(blenderPower)}`);\n  }\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-power.png`);';
  source = replaceEither(source, [proceduralSingle, blenderSingle], abBlock, "audit Power A-B capture");
  source = replaceEither(
    source,
    [
      "JSON.stringify({ sera, seraAfterLoad, motionReady, motionPower, kairo, kairoMotionReady, titleState }, null, 2)",
      "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, kairo, kairoMotionReady, titleState }, null, 2)",
    ],
    "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, kairo, kairoMotionReady, titleState }, null, 2)",
    "audit A-B state output",
  );
  source = replaceEither(
    source,
    [
      "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, motionPower, kairo, kairoMotionReady, titleState }));",
      "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, kairo, kairoMotionReady, titleState }));",
    ],
    "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, kairo, kairoMotionReady, titleState }));",
    "audit A-B console output",
  );
  return source;
});

await patch("package.json", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'tests/motion-expansion.test.ts tests/cpu-director.test.ts",',
    'tests/motion-expansion.test.ts tests/cpu-director.test.ts tests/blender-motion-foundry.test.mjs",',
    "static foundry test registration",
  );
  return source;
});

console.log("Blender Motion Foundry v1 runtime integration applied.");
