import { readFile, writeFile } from "node:fs/promises";

async function patch(path, mutator) {
  const before = await readFile(path, "utf8");
  const after = mutator(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Reaction Foundry patch anchor missing: ${label}`);
  return source.replace(before, after);
}

await patch("src/game/visual-quaternius-runtime.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'export const QUATERNIUS_BLENDER_AIRBORNE_URL = `${BASE_PATH}/models/quaternius/blender-airborne-core.glb`;\n',
    'export const QUATERNIUS_BLENDER_AIRBORNE_URL = `${BASE_PATH}/models/quaternius/blender-airborne-core.glb`;\nexport const QUATERNIUS_BLENDER_REACTIONS_URL = `${BASE_PATH}/models/quaternius/blender-reactions-core.glb`;\n',
    "runtime reaction URL",
  );
  source = replaceOnce(
    source,
    '  blenderAirborne: MotionClipSource | null;\n};',
    '  blenderAirborne: MotionClipSource | null;\n  blenderReactions: MotionClipSource | null;\n};',
    "runtime reaction resource",
  );
  source = replaceOnce(
    source,
    '  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);\n  motionPromise = Promise.all([',
    '  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);\n  const blenderReactionMotion = loader.loadAsync(QUATERNIUS_BLENDER_REACTIONS_URL).catch(() => null);\n  motionPromise = Promise.all([',
    "runtime reaction loader",
  );
  source = replaceOnce(
    source,
    '    blenderKickMotion,\n    blenderAirborneMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne]) => ({',
    '    blenderKickMotion,\n    blenderAirborneMotion,\n    blenderReactionMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne, blenderReactions]) => ({',
    "runtime reaction promise tuple",
  );
  source = replaceOnce(
    source,
    '    blenderAirborne: blenderAirborne ? { source: blenderAirborne.scene, clips: blenderAirborne.animations } : null,\n  })).catch((error) => {',
    '    blenderAirborne: blenderAirborne ? { source: blenderAirborne.scene, clips: blenderAirborne.animations } : null,\n    blenderReactions: blenderReactions ? { source: blenderReactions.scene, clips: blenderReactions.animations } : null,\n  })).catch((error) => {',
    "runtime reaction loader result",
  );
  source = replaceOnce(
    source,
    '    case "BLOCK_STUN": return { name: "PF_GuardBreak", loop: false, speed: 1.35 };',
    '    case "BLOCK_STUN": return { name: "BF_GuardBreak", loop: false, speed: 1.35 };',
    "GuardBreak routing",
  );
  source = replaceOnce(
    source,
    '    case "HIT": return { name: "PF_HitHeavy", loop: false, speed: 1.35 };',
    '    case "HIT": return { name: "BF_HitHeavy", loop: false, speed: 1.35 };',
    "HitHeavy routing",
  );
  source = replaceOnce(
    source,
    'function playClip(runtime: QuaterniusRuntime, name: string, loop: boolean, speed: number, restart = false): void {\n  if (runtime.currentClip === name && !restart) return;\n  const clip = runtime.clips.get(name) ?? runtime.clips.get("Idle_Loop");\n  if (!clip) return;\n  runtime.currentAction?.fadeOut(0.06);\n  const action = runtime.mixer.clipAction(clip, runtime.model);\n  action.reset();\n  action.enabled = true;\n  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);\n  action.clampWhenFinished = !loop;\n  action.timeScale = loop ? speed : Math.max(0.25, clip.duration * speed);\n  action.fadeIn(0.06).play();',
    'function transitionFadeSeconds(previous: string, next: string): number {\n  const reactionClips = new Set(["BF_HitHeavy", "BF_GuardBreak", "PF_HitHeavy", "PF_GuardBreak"]);\n  if (reactionClips.has(next)) return 0.025;\n  if (reactionClips.has(previous)) return 0.12;\n  if (previous.startsWith("BF_") && (next === "Idle_Loop" || next === "Walk_Loop")) return 0.09;\n  return 0.06;\n}\n\nfunction playClip(runtime: QuaterniusRuntime, name: string, loop: boolean, speed: number, restart = false): void {\n  if (runtime.currentClip === name && !restart) return;\n  const clip = runtime.clips.get(name) ?? runtime.clips.get("Idle_Loop");\n  if (!clip) return;\n  const fade = transitionFadeSeconds(runtime.currentClip, name);\n  runtime.currentAction?.fadeOut(fade);\n  const action = runtime.mixer.clipAction(clip, runtime.model);\n  action.reset();\n  action.enabled = true;\n  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);\n  action.clampWhenFinished = !loop;\n  action.timeScale = loop ? speed : Math.max(0.25, clip.duration * speed);\n  action.fadeIn(fade).play();',
    "state-aware transition fade",
  );
  source = replaceOnce(
    source,
    'function advance(runtime: QuaterniusRuntime, timeSeconds: number): void {\n  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, 0.05) : 0;\n  runtime.lastTime = timeSeconds;\n  runtime.mixer.update(delta);\n  runtime.model.updateMatrixWorld(true);\n}',
    'function advance(runtime: QuaterniusRuntime, timeSeconds: number, frozen = false): void {\n  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, 0.05) : 0;\n  // Always advance the wall-clock cursor so releasing hitstop cannot accumulate\n  // a large mixer delta. Only the animation pose itself freezes on impact.\n  runtime.lastTime = timeSeconds;\n  if (!frozen) runtime.mixer.update(delta);\n  runtime.model.updateMatrixWorld(true);\n}',
    "hitstop animation freeze",
  );
  source = replaceOnce(
    source,
    '    const blenderAirborneClips = resources.motion.blenderAirborne\n      ? retargetMotionClips(resources.motion.blenderAirborne.source, styled.model, resources.motion.blenderAirborne.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([',
    '    const blenderAirborneClips = resources.motion.blenderAirborne\n      ? retargetMotionClips(resources.motion.blenderAirborne.source, styled.model, resources.motion.blenderAirborne.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const blenderReactionClips = resources.motion.blenderReactions\n      ? retargetMotionClips(resources.motion.blenderReactions.source, styled.model, resources.motion.blenderReactions.clips)\n      : new Map<string, THREE.AnimationClip>();\n    const retargetedClips = new Map<string, THREE.AnimationClip>([',
    "runtime reaction retarget",
  );
  source = replaceOnce(
    source,
    '      ...blenderKickClips,\n      ...blenderAirborneClips,\n    ]);',
    '      ...blenderKickClips,\n      ...blenderAirborneClips,\n      ...blenderReactionClips,\n    ]);',
    "runtime reaction merge",
  );
  source = replaceOnce(
    source,
    '      ["BF_DashKick_R", "PF_DashKick_R"],\n    ] as const) {',
    '      ["BF_DashKick_R", "PF_DashKick_R"],\n      ["BF_HitHeavy", "PF_HitHeavy"],\n      ["BF_GuardBreak", "PF_GuardBreak"],\n    ] as const) {',
    "runtime reaction fallbacks",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size + blenderKickClips.size + blenderAirborneClips.size;\n',
    '    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size + blenderKickClips.size + blenderAirborneClips.size + blenderReactionClips.size;\n',
    "runtime reaction telemetry total",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusBlenderAirborneClipCount = blenderAirborneClips.size;\n',
    '    visual.root.userData.quaterniusBlenderAirborneClipCount = blenderAirborneClips.size;\n    visual.root.userData.quaterniusBlenderReactionClipCount = blenderReactionClips.size;\n',
    "runtime reaction telemetry count",
  );
  source = replaceOnce(
    source,
    '    visual.root.userData.quaterniusDashKickMotionSource = blenderAirborneClips.has("BF_DashKick_R")\n      ? "BLENDER_MOTION_FOUNDRY_V2_AIRBORNE"\n      : "PROCEDURAL_FALLBACK";\n',
    '    visual.root.userData.quaterniusDashKickMotionSource = blenderAirborneClips.has("BF_DashKick_R")\n      ? "BLENDER_MOTION_FOUNDRY_V2_AIRBORNE"\n      : "PROCEDURAL_FALLBACK";\n    const reactionSource = (name: string) => blenderReactionClips.has(name)\n      ? "BLENDER_MOTION_FOUNDRY_V2_REACTIONS"\n      : "PROCEDURAL_FALLBACK";\n    visual.root.userData.quaterniusHitReactionMotionSource = reactionSource("BF_HitHeavy");\n    visual.root.userData.quaterniusGuardBreakMotionSource = reactionSource("BF_GuardBreak");\n',
    "runtime reaction telemetry sources",
  );
  source = replaceOnce(
    source,
    '  advance(runtime, timeSeconds);\n  neutralPoseCorrection(runtime, fighter);',
    '  advance(runtime, timeSeconds, fighter.hitStop > 0);\n  neutralPoseCorrection(runtime, fighter);',
    "runtime hitstop freeze call",
  );
  return source;
});

await patch("src/game/model-viewer-motion.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  QUATERNIUS_BLENDER_AIRBORNE_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    '  QUATERNIUS_BLENDER_AIRBORNE_URL,\n  QUATERNIUS_BLENDER_REACTIONS_URL,\n  QUATERNIUS_PROCEDURAL_CORE_URL,',
    "viewer reaction import",
  );
  source = replaceOnce(
    source,
    '  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);\n  sourcePromise = Promise.all([',
    '  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);\n  const blenderReactionMotion = loader.loadAsync(QUATERNIUS_BLENDER_REACTIONS_URL).catch(() => null);\n  sourcePromise = Promise.all([',
    "viewer reaction loader",
  );
  source = replaceOnce(
    source,
    '    blenderKickMotion,\n    blenderAirborneMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne]) => {',
    '    blenderKickMotion,\n    blenderAirborneMotion,\n    blenderReactionMotion,\n  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne, blenderReactions]) => {',
    "viewer reaction tuple",
  );
  source = replaceOnce(
    source,
    '    if (blenderAirborne) packs.push({ root: blenderAirborne.scene, clips: blenderAirborne.animations, source: "BLENDER" });\n    return packs;',
    '    if (blenderAirborne) packs.push({ root: blenderAirborne.scene, clips: blenderAirborne.animations, source: "BLENDER" });\n    if (blenderReactions) packs.push({ root: blenderReactions.scene, clips: blenderReactions.animations, source: "BLENDER" });\n    return packs;',
    "viewer reaction pack",
  );
  return source;
});

await patch("scripts/capture-model-view-audit.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "        hasProceduralDashKick: options.some((option) => option.value === 'PF_DashKick_R'),\n        optionCount: options.length,",
    "        hasProceduralDashKick: options.some((option) => option.value === 'PF_DashKick_R'),\n        hasBlenderHitHeavy: options.some((option) => option.value === 'BF_HitHeavy'),\n        hasProceduralHitHeavy: options.some((option) => option.value === 'PF_HitHeavy'),\n        hasBlenderGuardBreak: options.some((option) => option.value === 'BF_GuardBreak'),\n        hasProceduralGuardBreak: options.some((option) => option.value === 'PF_GuardBreak'),\n        optionCount: options.length,",
    "audit reaction readiness fields",
  );
  source = replaceOnce(
    source,
    'state?.hasBlenderDashKick && state?.hasProceduralDashKick) return state;',
    'state?.hasBlenderDashKick && state?.hasProceduralDashKick && state?.hasBlenderHitHeavy && state?.hasProceduralHitHeavy && state?.hasBlenderGuardBreak && state?.hasProceduralGuardBreak) return state;',
    "audit reaction readiness condition",
  );
  source = replaceOnce(
    source,
    '  const blenderDashKick = await poseMotionViewer(sessionId, "BF_DashKick_R", 0.52);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-dash-kick.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    '  const blenderDashKick = await poseMotionViewer(sessionId, "BF_DashKick_R", 0.52);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-dash-kick.png`);\n\n  const proceduralHitHeavy = await poseMotionViewer(sessionId, "PF_HitHeavy", 0.34);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-hit-heavy.png`);\n  const blenderHitHeavy = await poseMotionViewer(sessionId, "BF_HitHeavy", 0.34);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-heavy.png`);\n\n  const proceduralGuardBreak = await poseMotionViewer(sessionId, "PF_GuardBreak", 0.34);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-guard-break.png`);\n  const blenderGuardBreak = await poseMotionViewer(sessionId, "BF_GuardBreak", 0.34);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-guard-break.png`);\n\n  const kairoClick = await clickButton(sessionId, "KAIRO");',
    "audit reaction A-B captures",
  );
  source = replaceOnce(
    source,
    'proceduralDashKick, blenderDashKick, kairo, kairoMotionReady, titleState }, null, 2));',
    'proceduralDashKick, blenderDashKick, proceduralHitHeavy, blenderHitHeavy, proceduralGuardBreak, blenderGuardBreak, kairo, kairoMotionReady, titleState }, null, 2));',
    "audit reaction state output",
  );
  source = replaceOnce(
    source,
    'proceduralBackfist, blenderBackfist, kairo, kairoMotionReady, titleState }));',
    'proceduralBackfist, blenderBackfist, proceduralHitHeavy, blenderHitHeavy, proceduralGuardBreak, blenderGuardBreak, kairo, kairoMotionReady, titleState }));',
    "audit reaction console output",
  );
  return source;
});

console.log("Blender Motion Foundry v2 reaction integration applied");
