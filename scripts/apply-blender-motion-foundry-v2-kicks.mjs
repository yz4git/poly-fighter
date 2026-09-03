import { readFile, writeFile } from "node:fs/promises";

async function patch(path, mutator) {
  const before = await readFile(path, "utf8");
  const after = mutator(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Kick Foundry patch anchor missing: ${label}`);
  return source.replace(before, after);
}

await patch("src/game/visual-quaternius-runtime.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'export const QUATERNIUS_BLENDER_STRIKES_URL = `${BASE_PATH}/models/quaternius/blender-strikes-core.glb`;\n',
    'export const QUATERNIUS_BLENDER_STRIKES_URL = `${BASE_PATH}/models/quaternius/blender-strikes-core.glb`;\nexport const QUATERNIUS_BLENDER_KICKS_URL = `${BASE_PATH}/models/quaternius/blender-kicks-core.glb`;\n',
    "runtime kick URL",
  );
  source = replaceOnce(
    source,
    '  blenderStrikes: MotionClipSource | null;\n};',
    '  blenderStrikes: MotionClipSource | null;\n  blenderKicks: MotionClipSource | null;\n};',
    "runtime kick resource",
  );
  source = replaceOnce(
    source,
    '  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes]) => ({',
    '  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);\n  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n    blenderKickMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks]) => ({',
    "runtime kick loader tuple",
  );
  source = replaceOnce(
    source,
    '    blenderStrikes: blenderStrikes ? { source: blenderStrikes.scene, clips: blenderStrikes.animations } : null,\n  })).catch((error) => {',
    '    blenderStrikes: blenderStrikes ? { source: blenderStrikes.scene, clips: blenderStrikes.animations } : null,\n    blenderKicks: blenderKicks ? { source: blenderKicks.scene, clips: blenderKicks.animations } : null,\n  })).catch((error) => {',
    "runtime kick loader result",
  );
  source = replaceOnce(source, '  kick: "PF_FrontKick_R",', '  kick: "BF_FrontKick_R",', "Front Kick routing");
  source = replaceOnce(source, '  lowKick: "PF_LowKick_L",', '  lowKick: "BF_LowKick_L",', "Low Kick routing");
  source = replaceOnce(source, '  risingKick: "PF_RisingKick_R",', '  risingKick: "BF_RisingKick_R",', "Rising Kick routing");
  source = replaceOnce(
    source,
    '    const blenderStrikeClips = resources.motion.blenderStrikes\n      ? retargetMotionClips(resources.motion.blenderStrikes.source, styled.model, resources.motion.blenderStrikes.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([\n      ...baseClips,\n      ...proceduralClips,\n      ...blenderClips,\n      ...blenderCrossClips,\n      ...blenderStrikeClips,\n    ]);',
    '    const blenderStrikeClips = resources.motion.blenderStrikes\n      ? retargetMotionClips(resources.motion.blenderStrikes.source, styled.model, resources.motion.blenderStrikes.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const blenderKickClips = resources.motion.blenderKicks\n      ? retargetMotionClips(resources.motion.blenderKicks.source, styled.model, resources.motion.blenderKicks.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([\n      ...baseClips,\n      ...proceduralClips,\n      ...blenderClips,\n      ...blenderCrossClips,\n      ...blenderStrikeClips,\n      ...blenderKickClips,\n    ]);',
    "runtime kick clip merge",
  );
  source = replaceOnce(
    source,
    '    for (const [authored, procedural] of [\n      ["BF_Jab_L", "PF_Jab_L"],\n      ["BF_BodyBlow_L", "PF_BodyBlow_L"],\n      ["BF_Backfist_R", "PF_Backfist_R"],\n    ] as const) {\n      if (retargetedClips.has(authored)) continue;\n      const fallback = proceduralClips.get(procedural);\n      if (!fallback) continue;\n      const alias = fallback.clone();\n      alias.name = authored;\n      retargetedClips.set(alias.name, alias);\n    }',
    '    for (const [authored, procedural] of [\n      ["BF_Jab_L", "PF_Jab_L"],\n      ["BF_BodyBlow_L", "PF_BodyBlow_L"],\n      ["BF_Backfist_R", "PF_Backfist_R"],\n      ["BF_FrontKick_R", "PF_FrontKick_R"],\n      ["BF_LowKick_L", "PF_LowKick_L"],\n      ["BF_RisingKick_R", "PF_RisingKick_R"],\n    ] as const) {\n      if (retargetedClips.has(authored)) continue;\n      const fallback = proceduralClips.get(procedural);\n      if (!fallback) continue;\n      const alias = fallback.clone();\n      alias.name = authored;\n      retargetedClips.set(alias.name, alias);\n    }',
    "runtime kick fallbacks",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size;\n    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;\n    visual.root.userData.quaterniusBlenderStrikeClipCount = blenderStrikeClips.size;',
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size + blenderKickClips.size;\n    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;\n    visual.root.userData.quaterniusBlenderStrikeClipCount = blenderStrikeClips.size;\n    visual.root.userData.quaterniusBlenderKickClipCount = blenderKickClips.size;',
    "runtime kick telemetry count",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusBackfistMotionSource = sharedStrikeSource("BF_Backfist_R");',
    '    visual.root.userData.quaterniusBackfistMotionSource = sharedStrikeSource("BF_Backfist_R");\n    const kickSource = (name: string) => blenderKickClips.has(name)\n      ? "BLENDER_MOTION_FOUNDRY_V2_KICKS"\n      : "PROCEDURAL_FALLBACK";\n    visual.root.userData.quaterniusFrontKickMotionSource = kickSource("BF_FrontKick_R");\n    visual.root.userData.quaterniusLowKickMotionSource = kickSource("BF_LowKick_L");\n    visual.root.userData.quaterniusRisingKickMotionSource = kickSource("BF_RisingKick_R");',
    "runtime kick telemetry sources",
  );
  return source;
});

await patch("src/game/model-viewer-motion.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_BLENDER_STRIKES_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    '  QUATERNIUS_BLENDER_STRIKES_URL,\n  QUATERNIUS_BLENDER_KICKS_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    "viewer kick import",
  );
  source = replaceOnce(
    source,
    '  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes]) => {',
    '  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);\n  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n    blenderKickMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks]) => {',
    "viewer kick loader tuple",
  );
  source = replaceOnce(
    source,
    '    if (blenderStrikes) packs.push({ root: blenderStrikes.scene, clips: blenderStrikes.animations, source: "BLENDER" });\n    return packs;',
    '    if (blenderStrikes) packs.push({ root: blenderStrikes.scene, clips: blenderStrikes.animations, source: "BLENDER" });\n    if (blenderKicks) packs.push({ root: blenderKicks.scene, clips: blenderKicks.animations, source: "BLENDER" });\n    return packs;',
    "viewer kick pack",
  );
  return source;
});

await patch("scripts/capture-model-view-audit.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "        hasProceduralBackfist: options.some((option) => option.value === 'PF_Backfist_R'),\n        optionCount: options.length,",
    "        hasProceduralBackfist: options.some((option) => option.value === 'PF_Backfist_R'),\n        hasBlenderFrontKick: options.some((option) => option.value === 'BF_FrontKick_R'),\n        hasProceduralFrontKick: options.some((option) => option.value === 'PF_FrontKick_R'),\n        hasBlenderLowKick: options.some((option) => option.value === 'BF_LowKick_L'),\n        hasProceduralLowKick: options.some((option) => option.value === 'PF_LowKick_L'),\n        hasBlenderRisingKick: options.some((option) => option.value === 'BF_RisingKick_R'),\n        hasProceduralRisingKick: options.some((option) => option.value === 'PF_RisingKick_R'),\n        optionCount: options.length,",
    "audit kick readiness fields",
  );
  source = replaceOnce(
    source,
    'state?.hasBlenderBackfist && state?.hasProceduralBackfist) return state;',
    'state?.hasBlenderBackfist && state?.hasProceduralBackfist && state?.hasBlenderFrontKick && state?.hasProceduralFrontKick && state?.hasBlenderLowKick && state?.hasProceduralLowKick && state?.hasBlenderRisingKick && state?.hasProceduralRisingKick) return state;',
    "audit kick readiness condition",
  );
  source = replaceOnce(
    source,
    '  const blenderBackfist = await poseMotionViewer(sessionId, "BF_Backfist_R", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-backfist.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    '  const blenderBackfist = await poseMotionViewer(sessionId, "BF_Backfist_R", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-backfist.png`);\n\n  const proceduralFrontKick = await poseMotionViewer(sessionId, "PF_FrontKick_R", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-front-kick.png`);\n  const blenderFrontKick = await poseMotionViewer(sessionId, "BF_FrontKick_R", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-front-kick.png`);\n\n  const proceduralLowKick = await poseMotionViewer(sessionId, "PF_LowKick_L", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-low-kick.png`);\n  const blenderLowKick = await poseMotionViewer(sessionId, "BF_LowKick_L", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-low-kick.png`);\n\n  const proceduralRisingKick = await poseMotionViewer(sessionId, "PF_RisingKick_R", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-rising-kick.png`);\n  const blenderRisingKick = await poseMotionViewer(sessionId, "BF_RisingKick_R", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-rising-kick.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    "audit kick A-B captures",
  );
  source = replaceOnce(
    source,
    'proceduralBackfist, blenderBackfist, kairo, kairoMotionReady, titleState',
    'proceduralBackfist, blenderBackfist, proceduralFrontKick, blenderFrontKick, proceduralLowKick, blenderLowKick, proceduralRisingKick, blenderRisingKick, kairo, kairoMotionReady, titleState',
    "audit kick state output",
  );
  source = replaceOnce(
    source,
    'proceduralBackfist, blenderBackfist, kairo, kairoMotionReady, titleState',
    'proceduralBackfist, blenderBackfist, proceduralFrontKick, blenderFrontKick, proceduralLowKick, blenderLowKick, proceduralRisingKick, blenderRisingKick, kairo, kairoMotionReady, titleState',
    "audit kick console output",
  );
  return source;
});

console.log("Blender Motion Foundry v2 kick integration applied");
