import { readFile, writeFile } from "node:fs/promises";

async function patch(path, mutator) {
  const before = await readFile(path, "utf8");
  const after = mutator(before);
  if (after !== before) await writeFile(path, after);
}

const appliedMarkers = new Map([
  ["runtime airborne URL", "QUATERNIUS_BLENDER_AIRBORNE_URL"],
  ["runtime airborne resource", "blenderAirborne: MotionClipSource | null;"],
  ["runtime airborne loader tuple", "const blenderAirborneMotion ="],
  ["runtime airborne loader result", "blenderAirborne: blenderAirborne ?"],
  ["Dash Kick routing", 'dashKick: "BF_DashKick_R"'],
  ["runtime airborne clip merge", "const blenderAirborneClips ="],
  ["runtime airborne fallback", '["BF_DashKick_R", "PF_DashKick_R"]'],
  ["runtime airborne telemetry count", "quaterniusBlenderAirborneClipCount"],
  ["runtime airborne telemetry source", "quaterniusDashKickMotionSource"],
  ["viewer airborne import", "QUATERNIUS_BLENDER_AIRBORNE_URL,"],
  ["viewer airborne loader tuple", "const blenderAirborneMotion ="],
  ["viewer airborne pack", "if (blenderAirborne) packs.push"],
  ["audit airborne readiness fields", "hasBlenderDashKick:"],
  ["audit airborne readiness condition", "state?.hasBlenderDashKick"],
  ["audit airborne A-B captures", "const proceduralDashKick ="],
]);

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const marker = appliedMarkers.get(label);
  if (marker && source.includes(marker)) return source;
  if (!source.includes(before)) throw new Error(`Airborne Foundry patch anchor missing: ${label}`);
  return source.replace(before, after);
}

await patch("src/game/visual-quaternius-runtime.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'export const QUATERNIUS_BLENDER_KICKS_URL = `${BASE_PATH}/models/quaternius/blender-kicks-core.glb`;\n',
    'export const QUATERNIUS_BLENDER_KICKS_URL = `${BASE_PATH}/models/quaternius/blender-kicks-core.glb`;\nexport const QUATERNIUS_BLENDER_AIRBORNE_URL = `${BASE_PATH}/models/quaternius/blender-airborne-core.glb`;\n',
    "runtime airborne URL",
  );
  source = replaceOnce(
    source,
    '  blenderKicks: MotionClipSource | null;\n};',
    '  blenderKicks: MotionClipSource | null;\n  blenderAirborne: MotionClipSource | null;\n};',
    "runtime airborne resource",
  );
  source = replaceOnce(
    source,
    '  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n    blenderKickMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks]) => ({',
    '  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);\n  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n    blenderKickMotion,\n    blenderAirborneMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne]) => ({',
    "runtime airborne loader tuple",
  );
  source = replaceOnce(
    source,
    '    blenderKicks: blenderKicks ? { source: blenderKicks.scene, clips: blenderKicks.animations } : null,\n  })).catch((error) => {',
    '    blenderKicks: blenderKicks ? { source: blenderKicks.scene, clips: blenderKicks.animations } : null,\n    blenderAirborne: blenderAirborne ? { source: blenderAirborne.scene, clips: blenderAirborne.animations } : null,\n  })).catch((error) => {',
    "runtime airborne loader result",
  );
  source = replaceOnce(source, '  dashKick: "PF_DashKick_R",', '  dashKick: "BF_DashKick_R",', "Dash Kick routing");
  source = replaceOnce(
    source,
    '    const blenderKickClips = resources.motion.blenderKicks\n      ? retargetMotionClips(resources.motion.blenderKicks.source, styled.model, resources.motion.blenderKicks.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([\n      ...baseClips,\n      ...proceduralClips,\n      ...blenderClips,\n      ...blenderCrossClips,\n      ...blenderStrikeClips,\n      ...blenderKickClips,\n    ]);',
    '    const blenderKickClips = resources.motion.blenderKicks\n      ? retargetMotionClips(resources.motion.blenderKicks.source, styled.model, resources.motion.blenderKicks.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const blenderAirborneClips = resources.motion.blenderAirborne\n      ? retargetMotionClips(resources.motion.blenderAirborne.source, styled.model, resources.motion.blenderAirborne.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([\n      ...baseClips,\n      ...proceduralClips,\n      ...blenderClips,\n      ...blenderCrossClips,\n      ...blenderStrikeClips,\n      ...blenderKickClips,\n      ...blenderAirborneClips,\n    ]);',
    "runtime airborne clip merge",
  );
  source = replaceOnce(
    source,
    '      ["BF_RisingKick_R", "PF_RisingKick_R"],\n    ] as const) {',
    '      ["BF_RisingKick_R", "PF_RisingKick_R"],\n      ["BF_DashKick_R", "PF_DashKick_R"],\n    ] as const) {',
    "runtime airborne fallback",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size + blenderKickClips.size;\n    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;\n    visual.root.userData.quaterniusBlenderStrikeClipCount = blenderStrikeClips.size;\n    visual.root.userData.quaterniusBlenderKickClipCount = blenderKickClips.size;',
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size + blenderKickClips.size + blenderAirborneClips.size;\n    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;\n    visual.root.userData.quaterniusBlenderStrikeClipCount = blenderStrikeClips.size;\n    visual.root.userData.quaterniusBlenderKickClipCount = blenderKickClips.size;\n    visual.root.userData.quaterniusBlenderAirborneClipCount = blenderAirborneClips.size;',
    "runtime airborne telemetry count",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusRisingKickMotionSource = kickSource("BF_RisingKick_R");',
    '    visual.root.userData.quaterniusRisingKickMotionSource = kickSource("BF_RisingKick_R");\n    visual.root.userData.quaterniusDashKickMotionSource = blenderAirborneClips.has("BF_DashKick_R")\n      ? "BLENDER_MOTION_FOUNDRY_V2_AIRBORNE"\n      : "PROCEDURAL_FALLBACK";',
    "runtime airborne telemetry source",
  );
  return source;
});

await patch("src/game/model-viewer-motion.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_BLENDER_KICKS_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    '  QUATERNIUS_BLENDER_KICKS_URL,\n  QUATERNIUS_BLENDER_AIRBORNE_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    "viewer airborne import",
  );
  source = replaceOnce(
    source,
    '  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n    blenderKickMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks]) => {',
    '  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);\n  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n    blenderKickMotion,\n    blenderAirborneMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne]) => {',
    "viewer airborne loader tuple",
  );
  source = replaceOnce(
    source,
    '    if (blenderKicks) packs.push({ root: blenderKicks.scene, clips: blenderKicks.animations, source: "BLENDER" });\n    return packs;',
    '    if (blenderKicks) packs.push({ root: blenderKicks.scene, clips: blenderKicks.animations, source: "BLENDER" });\n    if (blenderAirborne) packs.push({ root: blenderAirborne.scene, clips: blenderAirborne.animations, source: "BLENDER" });\n    return packs;',
    "viewer airborne pack",
  );
  return source;
});

await patch("scripts/capture-model-view-audit.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "        hasProceduralRisingKick: options.some((option) => option.value === 'PF_RisingKick_R'),\n        optionCount: options.length,",
    "        hasProceduralRisingKick: options.some((option) => option.value === 'PF_RisingKick_R'),\n        hasBlenderDashKick: options.some((option) => option.value === 'BF_DashKick_R'),\n        hasProceduralDashKick: options.some((option) => option.value === 'PF_DashKick_R'),\n        optionCount: options.length,",
    "audit airborne readiness fields",
  );
  source = replaceOnce(
    source,
    'state?.hasBlenderRisingKick && state?.hasProceduralRisingKick) return state;',
    'state?.hasBlenderRisingKick && state?.hasProceduralRisingKick && state?.hasBlenderDashKick && state?.hasProceduralDashKick) return state;',
    "audit airborne readiness condition",
  );
  source = replaceOnce(
    source,
    '  const blenderRisingKick = await poseMotionViewer(sessionId, "BF_RisingKick_R", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-rising-kick.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    '  const blenderRisingKick = await poseMotionViewer(sessionId, "BF_RisingKick_R", 0.55);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-rising-kick.png`);\n\n  const proceduralDashKick = await poseMotionViewer(sessionId, "PF_DashKick_R", 0.52);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-dash-kick.png`);\n  const blenderDashKick = await poseMotionViewer(sessionId, "BF_DashKick_R", 0.52);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-dash-kick.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    "audit airborne A-B captures",
  );
  source = source.replaceAll(
    'proceduralRisingKick, blenderRisingKick, kairo',
    'proceduralRisingKick, blenderRisingKick, proceduralDashKick, blenderDashKick, kairo',
  );
  return source;
});

console.log("Blender Motion Foundry v2 airborne integration applied");
