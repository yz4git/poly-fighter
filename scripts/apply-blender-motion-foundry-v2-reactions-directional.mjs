import { readFile, writeFile } from "node:fs/promises";

// Keep the proven base reaction integration idempotent, then layer the
// directional/counter/edge visual metadata and routing on top.
await import("./apply-blender-motion-foundry-v2-reactions.mjs");

async function patch(path, mutator) {
  const before = await readFile(path, "utf8");
  const after = mutator(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Directional Reaction patch anchor missing: ${label}`);
  return source.replace(before, after);
}

await patch("src/game/fighter.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "  invariantError: string | null = null;\n\n  constructor(",
    "  invariantError: string | null = null;\n  reactionKind: \"LIGHT\" | \"MID\" | \"HEAVY\" | \"COUNTER\" = \"HEAVY\";\n  reactionSide: \"LEFT\" | \"RIGHT\" = \"RIGHT\";\n  reactionAtEdge = false;\n  reactionSerial = 0;\n\n  constructor(",
    "fighter reaction metadata fields",
  );
  source = replaceOnce(
    source,
    "  justPressed(action: keyof InputFrame): boolean {\n    return this.input[action] && !this.previousInput[action];\n  }\n\n  canAct(): boolean {",
    "  justPressed(action: keyof InputFrame): boolean {\n    return this.input[action] && !this.previousInput[action];\n  }\n\n  setHitReactionVisual(\n    kind: \"LIGHT\" | \"MID\" | \"HEAVY\" | \"COUNTER\",\n    side: \"LEFT\" | \"RIGHT\",\n    atEdge: boolean,\n  ): void {\n    this.reactionKind = kind;\n    this.reactionSide = side;\n    this.reactionAtEdge = atEdge;\n    this.reactionSerial += 1;\n  }\n\n  canAct(): boolean {",
    "fighter reaction metadata setter",
  );
  return source;
});

await patch("src/game/combat.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "import { attackHitboxCenter } from \"./rig\";\n\nexport interface Hitbox {",
    "import { attackHitboxCenter } from \"./rig\";\n\n// Visual-only edge thresholds sit safely inside the actual 6.25 x 3.55 ring.\n// They select a compact stagger pose but never change hit logic or knockback.\nconst VISUAL_EDGE_X = 5.35;\nconst VISUAL_EDGE_Z = 2.95;\n\nexport interface Hitbox {",
    "visual edge thresholds",
  );
  source = replaceOnce(
    source,
    "    if (blocked) {\n      defender.receiveBlock(move.guardDamage, move.blockStun, Math.max(2, move.hitStop - 1));\n    } else {\n      defender.receiveDamage(",
    "    if (blocked) {\n      defender.receiveBlock(move.guardDamage, move.blockStun, Math.max(2, move.hitStop - 1));\n    } else {\n      const reactionSide = move.visualContact.startsWith(\"LEFT_\") ? \"LEFT\" : \"RIGHT\";\n      const reactionKind = counter\n        ? \"COUNTER\"\n        : damage <= 7\n          ? \"LIGHT\"\n          : damage <= 13\n            ? \"MID\"\n            : \"HEAVY\";\n      const reactionAtEdge = Math.abs(defender.position.x) >= VISUAL_EDGE_X || Math.abs(defender.position.z) >= VISUAL_EDGE_Z;\n      defender.setHitReactionVisual(reactionKind, reactionSide, reactionAtEdge);\n      defender.receiveDamage(",
    "combat reaction visual classification",
  );
  return source;
});

await patch("src/game/visual-quaternius-runtime.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "  lastMoveTick: number;\n  ownedMaterials: THREE.Material[];",
    "  lastMoveTick: number;\n  lastReactionSerial: number;\n  ownedMaterials: THREE.Material[];",
    "runtime reaction serial field",
  );
  source = replaceOnce(
    source,
    "    case \"HIT\": return { name: \"BF_HitHeavy\", loop: false, speed: 1.35 };",
    "    case \"HIT\": {\n      const side = fighter.reactionSide === \"LEFT\" ? \"L\" : \"R\";\n      if (fighter.reactionAtEdge) return { name: \"BF_EdgeStagger\", loop: false, speed: 1.35 };\n      if (fighter.reactionKind === \"COUNTER\") return { name: `BF_CounterHit_${side}`, loop: false, speed: 1.34 };\n      if (fighter.reactionKind === \"LIGHT\") return { name: `BF_HitLight_${side}`, loop: false, speed: 1.48 };\n      if (fighter.reactionKind === \"MID\") return { name: `BF_HitMid_${side}`, loop: false, speed: 1.40 };\n      return { name: \"BF_HitHeavy\", loop: false, speed: 1.35 };\n    }",
    "directional hit reaction routing",
  );
  source = replaceOnce(
    source,
    "function transitionFadeSeconds(previous: string, next: string): number {\n  const reactionClips = new Set([\"BF_HitHeavy\", \"BF_GuardBreak\", \"PF_HitHeavy\", \"PF_GuardBreak\"]);\n  if (reactionClips.has(next)) return 0.025;\n  if (reactionClips.has(previous)) return 0.12;",
    "function transitionFadeSeconds(previous: string, next: string): number {\n  const isReactionClip = (name: string) =>\n    name === \"BF_GuardBreak\" ||\n    name === \"BF_EdgeStagger\" ||\n    name === \"PF_HitHeavy\" ||\n    name === \"PF_GuardBreak\" ||\n    name.startsWith(\"BF_Hit\") ||\n    name.startsWith(\"BF_CounterHit\");\n  if (next.startsWith(\"BF_CounterHit\")) return 0.018;\n  if (isReactionClip(next)) return 0.025;\n  if (isReactionClip(previous)) return 0.11;",
    "directional reaction fades",
  );
  source = replaceOnce(
    source,
    "      [\"BF_HitHeavy\", \"PF_HitHeavy\"],\n      [\"BF_GuardBreak\", \"PF_GuardBreak\"],",
    "      [\"BF_HitHeavy\", \"PF_HitHeavy\"],\n      [\"BF_HitLight_L\", \"PF_HitHeavy\"],\n      [\"BF_HitLight_R\", \"PF_HitHeavy\"],\n      [\"BF_HitMid_L\", \"PF_HitHeavy\"],\n      [\"BF_HitMid_R\", \"PF_HitHeavy\"],\n      [\"BF_CounterHit_L\", \"PF_HitHeavy\"],\n      [\"BF_CounterHit_R\", \"PF_HitHeavy\"],\n      [\"BF_EdgeStagger\", \"PF_HitHeavy\"],\n      [\"BF_GuardBreak\", \"PF_GuardBreak\"],",
    "directional reaction fallbacks",
  );
  source = replaceOnce(
    source,
    "      lastMoveTick: -1,\n      bodyType: resources.bodyType,",
    "      lastMoveTick: -1,\n      lastReactionSerial: -1,\n      bodyType: resources.bodyType,",
    "runtime reaction serial initialization",
  );
  source = replaceOnce(
    source,
    "    visual.root.userData.quaterniusHitReactionMotionSource = reactionSource(\"BF_HitHeavy\");\n    visual.root.userData.quaterniusGuardBreakMotionSource = reactionSource(\"BF_GuardBreak\");",
    "    visual.root.userData.quaterniusHitReactionMotionSource = reactionSource(\"BF_HitHeavy\");\n    const directionalReactions = [\"BF_HitLight_L\", \"BF_HitLight_R\", \"BF_HitMid_L\", \"BF_HitMid_R\", \"BF_CounterHit_L\", \"BF_CounterHit_R\", \"BF_EdgeStagger\"];\n    visual.root.userData.quaterniusDirectionalReactionMotionSource = directionalReactions.every((name) => blenderReactionClips.has(name))\n      ? \"BLENDER_MOTION_FOUNDRY_V2_DIRECTIONAL_REACTIONS\"\n      : \"PROCEDURAL_FALLBACK\";\n    visual.root.userData.quaterniusGuardBreakMotionSource = reactionSource(\"BF_GuardBreak\");",
    "directional reaction telemetry",
  );
  source = replaceOnce(
    source,
    "  const restartingAttack = fighter.state === \"ATTACK\" && fighter.moveTick < runtime.lastMoveTick;\n  runtime.lastMoveTick = fighter.moveTick;\n  playClip(runtime, desired.name, desired.loop, desired.speed, restartingAttack);",
    "  const restartingAttack = fighter.state === \"ATTACK\" && fighter.moveTick < runtime.lastMoveTick;\n  const restartingReaction = fighter.state === \"HIT\" && fighter.reactionSerial !== runtime.lastReactionSerial;\n  runtime.lastMoveTick = fighter.moveTick;\n  runtime.lastReactionSerial = fighter.reactionSerial;\n  playClip(runtime, desired.name, desired.loop, desired.speed, restartingAttack || restartingReaction);",
    "reaction retrigger on consecutive hits",
  );
  return source;
});

await patch("scripts/capture-model-view-audit.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "        hasBlenderGuardBreak: options.some((option) => option.value === 'BF_GuardBreak'),\n        hasProceduralGuardBreak: options.some((option) => option.value === 'PF_GuardBreak'),\n        optionCount: options.length,",
    "        hasBlenderGuardBreak: options.some((option) => option.value === 'BF_GuardBreak'),\n        hasProceduralGuardBreak: options.some((option) => option.value === 'PF_GuardBreak'),\n        hasBlenderHitLightL: options.some((option) => option.value === 'BF_HitLight_L'),\n        hasBlenderHitLightR: options.some((option) => option.value === 'BF_HitLight_R'),\n        hasBlenderHitMidL: options.some((option) => option.value === 'BF_HitMid_L'),\n        hasBlenderHitMidR: options.some((option) => option.value === 'BF_HitMid_R'),\n        hasBlenderCounterHitL: options.some((option) => option.value === 'BF_CounterHit_L'),\n        hasBlenderCounterHitR: options.some((option) => option.value === 'BF_CounterHit_R'),\n        hasBlenderEdgeStagger: options.some((option) => option.value === 'BF_EdgeStagger'),\n        optionCount: options.length,",
    "audit directional reaction readiness fields",
  );
  source = replaceOnce(
    source,
    "&& state?.hasBlenderGuardBreak && state?.hasProceduralGuardBreak) return state;",
    "&& state?.hasBlenderGuardBreak && state?.hasProceduralGuardBreak && state?.hasBlenderHitLightL && state?.hasBlenderHitLightR && state?.hasBlenderHitMidL && state?.hasBlenderHitMidR && state?.hasBlenderCounterHitL && state?.hasBlenderCounterHitR && state?.hasBlenderEdgeStagger) return state;",
    "audit directional reaction readiness condition",
  );
  source = replaceOnce(
    source,
    "  const blenderGuardBreak = await poseMotionViewer(sessionId, \"BF_GuardBreak\", 0.34);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-guard-break.png`);\n\n  const kairoClick = await clickButton(sessionId, \"KAIRO\");",
    "  const blenderGuardBreak = await poseMotionViewer(sessionId, \"BF_GuardBreak\", 0.34);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-guard-break.png`);\n\n  await poseMotionViewer(sessionId, \"BF_HitLight_L\", 0.30);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-light-left.png`);\n  await poseMotionViewer(sessionId, \"BF_HitLight_R\", 0.30);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-light-right.png`);\n  await poseMotionViewer(sessionId, \"BF_HitMid_L\", 0.30);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-mid-left.png`);\n  await poseMotionViewer(sessionId, \"BF_HitMid_R\", 0.30);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-mid-right.png`);\n  await poseMotionViewer(sessionId, \"BF_CounterHit_L\", 0.24);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-counter-hit-left.png`);\n  await poseMotionViewer(sessionId, \"BF_CounterHit_R\", 0.24);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-counter-hit-right.png`);\n  await poseMotionViewer(sessionId, \"BF_EdgeStagger\", 0.30);\n  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-edge-stagger.png`);\n\n  const kairoClick = await clickButton(sessionId, \"KAIRO\");",
    "audit directional reaction captures",
  );
  return source;
});

await patch("package.json", (input) => replaceOnce(
  input,
  "tests/blender-motion-foundry-v2-reactions.test.mjs\",",
  "tests/blender-motion-foundry-v2-reactions.test.mjs tests/blender-motion-foundry-v2-reactions-directional.test.mjs\",",
  "directional reaction test registration",
));

console.log("Blender Motion Foundry v2 directional/counter reaction integration applied");
