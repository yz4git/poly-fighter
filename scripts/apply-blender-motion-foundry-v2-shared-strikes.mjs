import { readFile, writeFile } from "node:fs/promises";

async function patch(path, mutator) {
  const before = await readFile(path, "utf8");
  const after = mutator(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Shared strike Foundry patch anchor missing: ${label}`);
  return source.replace(before, after);
}

function replaceEither(source, befores, after, label) {
  if (source.includes(after)) return source;
  const before = befores.find((candidate) => source.includes(candidate));
  if (!before) throw new Error(`Shared strike Foundry patch anchor missing: ${label}`);
  return source.replace(before, after);
}

await patch("src/game/visual-quaternius-runtime.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'export const QUATERNIUS_BLENDER_CROSS_URL = `${BASE_PATH}/models/quaternius/blender-cross-core.glb`;\n',
    'export const QUATERNIUS_BLENDER_CROSS_URL = `${BASE_PATH}/models/quaternius/blender-cross-core.glb`;\nexport const QUATERNIUS_BLENDER_STRIKES_URL = `${BASE_PATH}/models/quaternius/blender-strikes-core.glb`;\n',
    "runtime shared-strike URL",
  );
  source = replaceOnce(
    source,
    'type MotionResources = {\n  base: MotionClipSource;\n  procedural: MotionClipSource;\n  blender: MotionClipSource | null;\n  blenderCross: MotionClipSource | null;\n};',
    'type MotionResources = {\n  base: MotionClipSource;\n  procedural: MotionClipSource;\n  blender: MotionClipSource | null;\n  blenderCross: MotionClipSource | null;\n  blenderStrikes: MotionClipSource | null;\n};',
    "runtime shared-strike resources",
  );
  source = replaceOnce(
    source,
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n  ]).then(([base, procedural, blender, blenderCross]) => ({\n    // Each Blender Foundry slice is optional and falls back independently.\n    // This lets v2 Cross ship without destabilising the proven v1 Power asset.\n    base: { source: base.scene, clips: base.animations },\n    procedural: { source: procedural.scene, clips: procedural.animations },\n    blender: blender ? { source: blender.scene, clips: blender.animations } : null,\n    blenderCross: blenderCross ? { source: blenderCross.scene, clips: blenderCross.animations } : null,\n  })).catch((error) => {',
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);\n  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);\n  motionPromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes]) => ({\n    // Each Blender Foundry pack is optional and falls back independently.\n    // The shared strike pack carries Jab / Body Blow / Backfist in one GLB.\n    base: { source: base.scene, clips: base.animations },\n    procedural: { source: procedural.scene, clips: procedural.animations },\n    blender: blender ? { source: blender.scene, clips: blender.animations } : null,\n    blenderCross: blenderCross ? { source: blenderCross.scene, clips: blenderCross.animations } : null,\n    blenderStrikes: blenderStrikes ? { source: blenderStrikes.scene, clips: blenderStrikes.animations } : null,\n  })).catch((error) => {',
    "runtime shared-strike loader",
  );
  source = replaceOnce(source, '  jab: "PF_Jab_L",', '  jab: "BF_Jab_L",', "Jab routing");
  source = replaceOnce(source, '  backfist: "PF_Backfist_R",', '  backfist: "BF_Backfist_R",', "Backfist routing");
  source = replaceOnce(source, '  bodyBlow: "PF_BodyBlow_L",', '  bodyBlow: "BF_BodyBlow_L",', "Body Blow routing");
  source = replaceOnce(
    source,
    '    const blenderCrossClips = resources.motion.blenderCross\n      ? retargetMotionClips(resources.motion.blenderCross.source, styled.model, resources.motion.blenderCross.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([...baseClips, ...proceduralClips, ...blenderClips, ...blenderCrossClips]);',
    '    const blenderCrossClips = resources.motion.blenderCross\n      ? retargetMotionClips(resources.motion.blenderCross.source, styled.model, resources.motion.blenderCross.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const blenderStrikeClips = resources.motion.blenderStrikes\n      ? retargetMotionClips(resources.motion.blenderStrikes.source, styled.model, resources.motion.blenderStrikes.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([\n      ...baseClips,\n      ...proceduralClips,\n      ...blenderClips,\n      ...blenderCrossClips,\n      ...blenderStrikeClips,\n    ]);',
    "runtime shared-strike clip merge",
  );
  source = replaceOnce(
    source,
    '    if (!retargetedClips.has("BF_Cross_R")) {\n      const fallback = proceduralClips.get("PF_Cross_R");\n      if (fallback) {\n        const alias = fallback.clone();\n        alias.name = "BF_Cross_R";\n        retargetedClips.set(alias.name, alias);\n      }\n    }',
    '    if (!retargetedClips.has("BF_Cross_R")) {\n      const fallback = proceduralClips.get("PF_Cross_R");\n      if (fallback) {\n        const alias = fallback.clone();\n        alias.name = "BF_Cross_R";\n        retargetedClips.set(alias.name, alias);\n      }\n    }\n    for (const [authored, procedural] of [\n      ["BF_Jab_L", "PF_Jab_L"],\n      ["BF_BodyBlow_L", "PF_BodyBlow_L"],\n      ["BF_Backfist_R", "PF_Backfist_R"],\n    ] as const) {\n      if (retargetedClips.has(authored)) continue;\n      const fallback = proceduralClips.get(procedural);\n      if (!fallback) continue;\n      const alias = fallback.clone();\n      alias.name = authored;\n      retargetedClips.set(alias.name, alias);\n    }',
    "runtime shared-strike fallbacks",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size;\n    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;',
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size;\n    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;\n    visual.root.userData.quaterniusBlenderStrikeClipCount = blenderStrikeClips.size;',
    "runtime shared-strike telemetry count",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusStraightMotionSource = blenderCrossClips.has("BF_Cross_R")\n      ? "BLENDER_MOTION_FOUNDRY_V2_CROSS"\n      : "PROCEDURAL_FALLBACK";',
    '    visual.root.userData.quaterniusStraightMotionSource = blenderCrossClips.has("BF_Cross_R")\n      ? "BLENDER_MOTION_FOUNDRY_V2_CROSS"\n      : "PROCEDURAL_FALLBACK";\n    const sharedStrikeSource = (name: string) => blenderStrikeClips.has(name)\n      ? "BLENDER_MOTION_FOUNDRY_V2_SHARED_STRIKES"\n      : "PROCEDURAL_FALLBACK";\n    visual.root.userData.quaterniusJabMotionSource = sharedStrikeSource("BF_Jab_L");\n    visual.root.userData.quaterniusBodyBlowMotionSource = sharedStrikeSource("BF_BodyBlow_L");\n    visual.root.userData.quaterniusBackfistMotionSource = sharedStrikeSource("BF_Backfist_R");',
    "runtime shared-strike telemetry sources",
  );
  return source;
});

await patch("src/game/model-viewer-motion.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_BLENDER_CROSS_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    '  QUATERNIUS_BLENDER_CROSS_URL,\n  QUATERNIUS_BLENDER_STRIKES_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    "viewer shared-strike import",
  );
  source = replaceOnce(
    source,
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n  ]).then(([base, procedural, blender, blenderCross]) => {\n    const packs: MotionSourcePack[] = [\n      { root: base.scene, clips: base.animations, source: "BASE" },\n      { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" },\n    ];\n    if (blender) packs.push({ root: blender.scene, clips: blender.animations, source: "BLENDER" });\n    if (blenderCross) packs.push({ root: blenderCross.scene, clips: blenderCross.animations, source: "BLENDER" });\n    return packs;\n  }).catch((error) => {',
    '  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);\n  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);\n  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);\n  sourcePromise = Promise.all([\n    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),\n    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),\n    blenderMotion,\n    blenderCrossMotion,\n    blenderStrikeMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes]) => {\n    const packs: MotionSourcePack[] = [\n      { root: base.scene, clips: base.animations, source: "BASE" },\n      { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" },\n    ];\n    if (blender) packs.push({ root: blender.scene, clips: blender.animations, source: "BLENDER" });\n    if (blenderCross) packs.push({ root: blenderCross.scene, clips: blenderCross.animations, source: "BLENDER" });\n    if (blenderStrikes) packs.push({ root: blenderStrikes.scene, clips: blenderStrikes.animations, source: "BLENDER" });\n    return packs;\n  }).catch((error) => {',
    "viewer shared-strike loader",
  );
  return source;
});

await patch("scripts/capture-model-view-audit.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "        hasBlenderCross: options.some((option) => option.value === 'BF_Cross_R'),\n        hasProceduralCross: options.some((option) => option.value === 'PF_Cross_R'),",
    "        hasBlenderCross: options.some((option) => option.value === 'BF_Cross_R'),\n        hasProceduralCross: options.some((option) => option.value === 'PF_Cross_R'),\n        hasBlenderJab: options.some((option) => option.value === 'BF_Jab_L'),\n        hasProceduralJab: options.some((option) => option.value === 'PF_Jab_L'),\n        hasBlenderBodyBlow: options.some((option) => option.value === 'BF_BodyBlow_L'),\n        hasProceduralBodyBlow: options.some((option) => option.value === 'PF_BodyBlow_L'),\n        hasBlenderBackfist: options.some((option) => option.value === 'BF_Backfist_R'),\n        hasProceduralBackfist: options.some((option) => option.value === 'PF_Backfist_R'),",
    "audit shared-strike readiness fields",
  );
  source = replaceOnce(
    source,
    '    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasBlenderPower && state?.hasProceduralPower && state?.hasBlenderCross && state?.hasProceduralCross) return state;',
    '    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasBlenderPower && state?.hasProceduralPower && state?.hasBlenderCross && state?.hasProceduralCross && state?.hasBlenderJab && state?.hasProceduralJab && state?.hasBlenderBodyBlow && state?.hasProceduralBodyBlow && state?.hasBlenderBackfist && state?.hasProceduralBackfist) return state;',
    "audit shared-strike readiness condition",
  );
  const crossTail = '  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-cross.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");';
  const strikeCaptures = '  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-cross.png`);\n\n  const proceduralJab = await poseMotionViewer(sessionId, "PF_Jab_L", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-jab.png`);\n  const blenderJab = await poseMotionViewer(sessionId, "BF_Jab_L", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-jab.png`);\n\n  const proceduralBodyBlow = await poseMotionViewer(sessionId, "PF_BodyBlow_L", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-body-blow.png`);\n  const blenderBodyBlow = await poseMotionViewer(sessionId, "BF_BodyBlow_L", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-body-blow.png`);\n\n  const proceduralBackfist = await poseMotionViewer(sessionId, "PF_Backfist_R", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-backfist.png`);\n  const blenderBackfist = await poseMotionViewer(sessionId, "BF_Backfist_R", 0.5);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-backfist.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");';
  source = replaceOnce(source, crossTail, strikeCaptures, "audit shared-strike captures");
  source = replaceEither(
    source,
    [
      "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, kairo, kairoMotionReady, titleState }, null, 2)",
      "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, proceduralJab, blenderJab, proceduralBodyBlow, blenderBodyBlow, proceduralBackfist, blenderBackfist, kairo, kairoMotionReady, titleState }, null, 2)",
    ],
    "JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, proceduralJab, blenderJab, proceduralBodyBlow, blenderBodyBlow, proceduralBackfist, blenderBackfist, kairo, kairoMotionReady, titleState }, null, 2)",
    "audit shared-strike state output",
  );
  source = replaceEither(
    source,
    [
      "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, kairo, kairoMotionReady, titleState }));",
      "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, proceduralJab, blenderJab, proceduralBodyBlow, blenderBodyBlow, proceduralBackfist, blenderBackfist, kairo, kairoMotionReady, titleState }));",
    ],
    "console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, proceduralJab, blenderJab, proceduralBodyBlow, blenderBodyBlow, proceduralBackfist, blenderBackfist, kairo, kairoMotionReady, titleState }));",
    "audit shared-strike console output",
  );
  return source;
});

await patch("tests/quaternius-model-skin.test.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_BLENDER_CROSS_URL,\n  QUATERNIUS_UBC_FEMALE_MODEL_URL,',
    '  QUATERNIUS_BLENDER_CROSS_URL,\n  QUATERNIUS_BLENDER_STRIKES_URL,\n  QUATERNIUS_UBC_FEMALE_MODEL_URL,',
    "skin test shared-strike import",
  );
  source = replaceOnce(
    source,
    '  assert.match(QUATERNIUS_BLENDER_CROSS_URL, /blender-cross-core\\.glb$/);',
    '  assert.match(QUATERNIUS_BLENDER_CROSS_URL, /blender-cross-core\\.glb$/);\n  assert.match(QUATERNIUS_BLENDER_STRIKES_URL, /blender-strikes-core\\.glb$/);',
    "skin test shared-strike URL",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /loadAsync\\(QUATERNIUS_BLENDER_CROSS_URL\\)/);',
    '  assert.match(runtime, /loadAsync\\(QUATERNIUS_BLENDER_CROSS_URL\\)/);\n  assert.match(runtime, /loadAsync\\(QUATERNIUS_BLENDER_STRIKES_URL\\)/);',
    "skin test shared-strike loader",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /blenderCross: blenderCross \\? \\{ source: blenderCross\\.scene, clips: blenderCross\\.animations \\} : null/);',
    '  assert.match(runtime, /blenderCross: blenderCross \\? \\{ source: blenderCross\\.scene, clips: blenderCross\\.animations \\} : null/);\n  assert.match(runtime, /blenderStrikes: blenderStrikes \\? \\{ source: blenderStrikes\\.scene, clips: blenderStrikes\\.animations \\} : null/);',
    "skin test shared-strike resource",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /resources\\.motion\\.blenderCross\\.source/);',
    '  assert.match(runtime, /resources\\.motion\\.blenderCross\\.source/);\n  assert.match(runtime, /resources\\.motion\\.blenderStrikes\\.source/);',
    "skin test shared-strike retarget",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /new Map<string, THREE\\.AnimationClip>\\(\\[\\.\\.\\.baseClips, \\.\\.\\.proceduralClips, \\.\\.\\.blenderClips, \\.\\.\\.blenderCrossClips\\]\\)/);',
    '  assert.match(runtime, /\\.\\.\\.blenderStrikeClips/);',
    "skin test shared-strike clip merge",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /quaterniusBlenderClipCount = blenderClips\\.size \\+ blenderCrossClips\\.size/);',
    '  assert.match(runtime, /quaterniusBlenderClipCount = blenderClips\\.size \\+ blenderCrossClips\\.size \\+ blenderStrikeClips\\.size/);',
    "skin test shared-strike count",
  );
  source = replaceOnce(
    source,
    '  assert.match(runtime, /straight: "BF_Cross_R"/);',
    '  assert.match(runtime, /straight: "BF_Cross_R"/);\n  assert.match(runtime, /jab: "BF_Jab_L"/);\n  assert.match(runtime, /bodyBlow: "BF_BodyBlow_L"/);\n  assert.match(runtime, /backfist: "BF_Backfist_R"/);\n  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V2_SHARED_STRIKES/);',
    "skin test shared-strike routing",
  );
  return source;
});

await patch("tests/model-viewer.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  assert.match(motionViewer, /QUATERNIUS_BLENDER_CROSS_URL/);',
    '  assert.match(motionViewer, /QUATERNIUS_BLENDER_CROSS_URL/);\n  assert.match(motionViewer, /QUATERNIUS_BLENDER_STRIKES_URL/);',
    "viewer shared-strike test",
  );
  return source;
});

console.log("Blender Motion Foundry v2 shared strike integration applied.");
