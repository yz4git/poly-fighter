import { readFile, writeFile } from "node:fs/promises";

async function patch(path, mutator) {
  const before = await readFile(path, "utf8");
  const after = mutator(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Motion Foundry v2 patch anchor missing: ${label}`);
  return source.replace(before, after);
}

function replaceEither(source, befores, after, label) {
  if (source.includes(after)) return source;
  const before = befores.find((candidate) => source.includes(candidate));
  if (!before) throw new Error(`Motion Foundry v2 patch anchor missing: ${label}`);
  return source.replace(before, after);
}

await patch("src/game/visual-quaternius-runtime.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'export const QUATERNIUS_BLENDER_CORE_URL = `${BASE_PATH}/models/quaternius/blender-fight-core.glb`;\n',
    'export const QUATERNIUS_BLENDER_CORE_URL = `${BASE_PATH}/models/quaternius/blender-fight-core.glb`;\nexport const QUATERNIUS_BLENDER_CROSS_URL = `${BASE_PATH}/models/quaternius/blender-cross-core.glb`;\n',
    "runtime v2 Cross URL",
  );
  source = replaceOnce(
    source,
    'type MotionResources = {\n  base: MotionClipSource;\n  procedural: MotionClipSource;\n  blender: MotionClipSource | null;\n};',
    'type MotionResources = {\n  base: MotionClipSource;\n  procedural: MotionClipSource;\n  blender: MotionClipSource | null;\n  blenderCross: MotionClipSource | null;\n};',
    "runtime v2 MotionResources",
  );
  source = replaceOnce(
    source,
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n  ]).then(([base, procedural, blender]) => ({\n    // Retarget each pack against the hierarchy it was authored from. Blender\n    // Foundry is an optional authored override; a missing asset keeps the old\n    // procedural pack playable during staged deployments.\n    base: { source: base.scene, clips: base.animations },\n    procedural: { source: procedural.scene, clips: procedural.animations },\n    blender: blender ? { source: blender.scene, clips: blender.animations } : null,\n  })).catch((error) => {',
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n  ]).then(([base, procedural, blender, blenderCross]) => ({\n    // Each Blender Foundry slice is optional and falls back independently.\n    // This lets v2 Cross ship without destabilising the proven v1 Power asset.\n    base: { source: base.scene, clips: base.animations },\n    procedural: { source: procedural.scene, clips: procedural.animations },\n    blender: blender ? { source: blender.scene, clips: blender.animations } : null,\n    blenderCross: blenderCross ? { source: blenderCross.scene, clips: blenderCross.animations } : null,\n  })).catch((error) => {',
    "runtime v2 motion loader",
  );
  source = replaceOnce(source, '  straight: "PF_Cross_R",', '  straight: "BF_Cross_R",', "Straight routing to Blender v2");
  source = replaceOnce(
    source,
    '    const blenderClips = resources.motion.blender\n      ? retargetMotionClips(resources.motion.blender.source, styled.model, resources.motion.blender.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([...baseClips, ...proceduralClips, ...blenderClips]);',
    '    const blenderClips = resources.motion.blender\n      ? retargetMotionClips(resources.motion.blender.source, styled.model, resources.motion.blender.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const blenderCrossClips = resources.motion.blenderCross\n      ? retargetMotionClips(resources.motion.blenderCross.source, styled.model, resources.motion.blenderCross.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([...baseClips, ...proceduralClips, ...blenderClips, ...blenderCrossClips]);',
    "runtime v2 clip merge",
  );
  source = replaceOnce(
    source,
    '    if (!retargetedClips.has("BF_Power_R")) {\n      const fallback = proceduralClips.get("PF_Power_R");\n      if (fallback) {\n        const alias = fallback.clone();\n        alias.name = "BF_Power_R";\n        retargetedClips.set(alias.name, alias);\n      }\n    }',
    '    if (!retargetedClips.has("BF_Power_R")) {\n      const fallback = proceduralClips.get("PF_Power_R");\n      if (fallback) {\n        const alias = fallback.clone();\n        alias.name = "BF_Power_R";\n        retargetedClips.set(alias.name, alias);\n      }\n    }\n    if (!retargetedClips.has("BF_Cross_R")) {\n      const fallback = proceduralClips.get("PF_Cross_R");\n      if (fallback) {\n        const alias = fallback.clone();\n        alias.name = "BF_Cross_R";\n        retargetedClips.set(alias.name, alias);\n      }\n    }',
    "runtime v2 Cross fallback",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size;\n    visual.root.userData.quaterniusPowerMotionSource = blenderClips.has("BF_Power_R")\n      ? "BLENDER_MOTION_FOUNDRY_V1"\n      : "PROCEDURAL_FALLBACK";',
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size;\n    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;\n    visual.root.userData.quaterniusPowerMotionSource = blenderClips.has("BF_Power_R")\n      ? "BLENDER_MOTION_FOUNDRY_V1"\n      : "PROCEDURAL_FALLBACK";\n    visual.root.userData.quaterniusStraightMotionSource = blenderCrossClips.has("BF_Cross_R")\n      ? "BLENDER_MOTION_FOUNDRY_V2_CROSS"\n      : "PROCEDURAL_FALLBACK";',
    "runtime v2 telemetry",
  );
  return source;
});

await patch("src/game/model-viewer-motion.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_BLENDER_CORE_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    '  QUATERNIUS_BLENDER_CORE_URL,\n  QUATERNIUS_BLENDER_CROSS_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    "viewer v2 Cross import",
  );
  source = replaceOnce(
    source,
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n  ]).then(([base, procedural, blender]) => {\n    const packs: MotionSourcePack[] = [\n      { root: base.scene, clips: base.animations, source: "BASE" },\n      { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" },\n    ];\n    if (blender) packs.push({ root: blender.scene, clips: blender.animations, source: "BLENDER" });\n    return packs;\n  }).catch((error) => {',
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n  ]).then(([base, procedural, blender, blenderCross]) => {\n    const packs: MotionSourcePack[] = [\n      { root: base.scene, clips: base.animations, source: "BASE" },\n      { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" },\n    ];\n    if (blender) packs.push({ root: blender.scene, clips: blender.animations, source: "BLENDER" });\n    if (blenderCross) packs.push({ root: blenderCross.scene, clips: blenderCross.animations, source: "BLENDER" });\n    return packs;\n  }).catch((error) => {',
    "viewer v2 motion loader",
  );
  return source;
});

await patch("scripts/capture-model-view-audit.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "        hasBlenderPower: options.some((option) => option.value === 'BF_Power_R'),\n        hasProceduralPower: options.some((option) => option.value === 'PF_Power_R'),",
    "        hasBlenderPower: options.some((option) => option.value === 'BF_Power_R'),\n        hasProceduralPower: options.some((option) => option.value === 'PF_Power_R'),\n        hasBlenderCross: options.some((option) => option.value === 'BF_Cross_R'),\n        hasProceduralCross: options.some((option) => option.value === 'PF_Cross_R'),",
    "audit v2 Cross readiness fields",
  );
  source = replaceOnce(
    source,
    '    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasBlenderPower && state?.hasProceduralPower) return state;',
    '    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasBlenderPower && state?.hasProceduralPower && state?.hasBlenderCross && state?.hasProceduralCross) return state;',
    "audit v2 Cross readiness condition",
  );
  source = replaceOnce(
    source,
    '  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-power.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    '  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-power.png`);\n\n  const proceduralCross = await poseMotionViewer(sessionId, "PF_Cross_R", 0.5);\n  if (proceduralCross.clip !== "PF_Cross_R" || Math.abs(proceduralCross.timeline - 500) > 2 || !proceduralCross.paused) {\n    throw new Error(`Motion Viewer did not hold PF_Cross_R at 50%: ${JSON.stringify(proceduralCross)}`);\n  }\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-cross.png`);\n\n  const blenderCross = await poseMotionViewer(sessionId, "BF_Cross_R", 0.5);\n  if (blenderCross.clip !== "BF_Cross_R" || Math.abs(blenderCross.timeline - 500) > 2 || !blenderCross.paused) {\n    throw new Error(`Motion Viewer did not hold BF_Cross_R at 50%: ${JSON.stringify(blenderCross)}`);\n  }\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-cross.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    "audit v2 Cross A-B capture",
  );
  source = replaceEither(
    source,
    [
      "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, kairo, kairoMotionReady, titleState }, null, 2)",
      "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, kairo, kairoMotionReady, titleState }, null, 2)",
    ],
    "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, kairo, kairoMotionReady, titleState }, null, 2)",
    "audit v2 state output",
  );
  source = replaceEither(
    source,
    [
      "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, kairo, kairoMotionReady, titleState }));",
      "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, kairo, kairoMotionReady, titleState }));",
    ],
    "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, kairo, kairoMotionReady, titleState }));",
    "audit v2 console output",
  );
  return source;
});

await patch("tests/quaternius-model-skin.test.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_BLENDER_CORE_URL,\n  QUATERNIUS_UBC_FEMALE_MODEL_URL,',
    '  QUATERNIUS_BLENDER_CORE_URL,\n  QUATERNIUS_BLENDER_CROSS_URL,\n  QUATERNIUS_UBC_FEMALE_MODEL_URL,',
    "skin test v2 import",
  );
  source = replaceOnce(
    source,
    '  assert.match(QUATERNIUS_BLENDER_CORE_URL, /blender-fight-core\\.glb$/);',
    '  assert.match(QUATERNIUS_BLENDER_CORE_URL, /blender-fight-core\\.glb$/);\n  assert.match(QUATERNIUS_BLENDER_CROSS_URL, /blender-cross-core\\.glb$/);',
    "skin test v2 URL",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /loadAsync\\(QUATERNIUS_BLENDER_CORE_URL\\)/);',
    '  assert.match(runtime, /loadAsync\\(QUATERNIUS_BLENDER_CORE_URL\\)/);\n  assert.match(runtime, /loadAsync\\(QUATERNIUS_BLENDER_CROSS_URL\\)/);',
    "skin test v2 loader",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /blender: blender \\? \\{ source: blender\\.scene, clips: blender\\.animations \\} : null/);',
    '  assert.match(runtime, /blender: blender \\? \\{ source: blender\\.scene, clips: blender\\.animations \\} : null/);\n  assert.match(runtime, /blenderCross: blenderCross \\? \\{ source: blenderCross\\.scene, clips: blenderCross\\.animations \\} : null/);',
    "skin test v2 resource",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /resources\\.motion\\.blender\\.source/);',
    '  assert.match(runtime, /resources\\.motion\\.blender\\.source/);\n  assert.match(runtime, /resources\\.motion\\.blenderCross\\.source/);',
    "skin test v2 retarget",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /new Map<string, THREE\\.AnimationClip>\\(\\[\\.\\.\\.baseClips, \\.\\.\\.proceduralClips, \\.\\.\\.blenderClips\\]\\)/);',
    '  assert.match(runtime, /new Map<string, THREE\\.AnimationClip>\\(\\[\\.\\.\\.baseClips, \\.\\.\\.proceduralClips, \\.\\.\\.blenderClips, \\.\\.\\.blenderCrossClips\\]\\)/);',
    "skin test v2 clip merge",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /quaterniusBlenderClipCount = blenderClips\\.size/);',
    '  assert.match(runtime, /quaterniusBlenderClipCount = blenderClips\\.size \\+ blenderCrossClips\\.size/);\n  assert.match(runtime, /quaterniusBlenderCrossClipCount = blenderCrossClips\\.size/);',
    "skin test v2 telemetry",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /BF_Power_R/);',
    '  assert.match(runtime, /BF_Power_R/);\n  assert.match(runtime, /BF_Cross_R/);\n  assert.match(runtime, /straight: "BF_Cross_R"/);',
    "skin test v2 Cross routing",
  );
  return source;
});

await patch("tests/model-viewer.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  assert.match(motionViewer, /QUATERNIUS_PROCEDURAL_CORE_URL/);',
    '  assert.match(motionViewer, /QUATERNIUS_PROCEDURAL_CORE_URL/);\n  assert.match(motionViewer, /QUATERNIUS_BLENDER_CORE_URL/);\n  assert.match(motionViewer, /QUATERNIUS_BLENDER_CROSS_URL/);',
    "viewer test v2 sources",
  );
  source = replaceOnce(
    source,
    '  assert.match(motionViewer, /source: "BASE"/);',
    '  assert.match(motionViewer, /source: "BASE"/);\n  assert.match(motionViewer, /source: "BLENDER"/);',
    "viewer test Blender source",
  );
  return source;
});

await patch("package.json", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'tests/cpu-director.test.ts tests/blender-motion-foundry.test.mjs",',
    'tests/cpu-director.test.ts tests/blender-motion-foundry.test.mjs tests/blender-motion-foundry-v2.test.mjs",',
    "register v2 Foundry contract",
  );
  return source;
});

console.log("Blender Motion Foundry v2 Cross runtime integration applied.");
