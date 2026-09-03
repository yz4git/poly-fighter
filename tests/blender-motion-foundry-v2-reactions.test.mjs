import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-reactions.py", import.meta.url), "utf8");
const integrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2-reactions.mjs", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../src/game/model-viewer-motion.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/blender-motion-foundry-v2-reactions.yml", import.meta.url), "utf8");
const metrics = JSON.parse(await readFile(new URL("../public/models/quaternius/blender-reactions-core.metrics.json", import.meta.url), "utf8"));

test("reaction Foundry authors HitHeavy and GuardBreak with grounded full-body constraints", () => {
  assert.match(generator, /action_name="BF_HitHeavy"/);
  assert.match(generator, /action_name="BF_GuardBreak"/);
  assert.match(generator, /source_action_hint="Hit_Chest"/);
  assert.match(generator, /dual_foot_locks/);
  assert.match(generator, /FootPositionLockIK/);
  assert.match(generator, /FootOrientationLock/);
  assert.match(generator, /guard_break_hands/);
  assert.match(generator, /GuardBreakHandIK/);
  assert.match(generator, /authored pelvis\/spine\/head recoil chain/);
  assert.match(generator, /blender-reactions-core\.glb/);
});

test("generated reaction pack has distinct readable reactions with planted feet", () => {
  assert.equal(metrics.version, "BLENDER_MOTION_FOUNDRY_V2_REACTIONS");
  assert.equal(metrics.sharedRig, "MOTION_FOUNDRY_V2_REACTION_RIG");
  assert.deepEqual(new Set(metrics.actions), new Set(["BF_HitHeavy", "BF_GuardBreak"]));
  assert.equal(metrics.moves.length, 2);
  const byAction = new Map(metrics.moves.map((move) => [move.action, move]));
  const hit = byAction.get("BF_HitHeavy");
  const guard = byAction.get("BF_GuardBreak");
  assert.ok(hit && guard);
  for (const move of [hit, guard]) {
    assert.ok(move.durationSeconds < 0.65, `${move.action}: duration ${move.durationSeconds}`);
    assert.ok(move.torsoExcursionDegrees > 10, `${move.action}: torso ${move.torsoExcursionDegrees}`);
    assert.ok(move.headExcursionDegrees > 7, `${move.action}: head ${move.headExcursionDegrees}`);
    assert.ok(move.leftFootDriftMax < 0.015, `${move.action}: left foot ${move.leftFootDriftMax}`);
    assert.ok(move.rightFootDriftMax < 0.015, `${move.action}: right foot ${move.rightFootDriftMax}`);
    assert.ok(move.settleTorsoResidualDegrees < 20, `${move.action}: settle ${move.settleTorsoResidualDegrees}`);
    assert.ok(move.boneCount >= 40, `${move.action}: bones ${move.boneCount}`);
  }
  assert.ok(hit.torsoExcursionDegrees > 20, hit.torsoExcursionDegrees);
  assert.ok(hit.headExcursionDegrees > 12, hit.headExcursionDegrees);
  assert.ok(guard.handSeparationIncrease > 0.10, guard.handSeparationIncrease);
});

test("runtime prioritizes Blender reactions, freezes mixer on hitstop, and keeps PF fallbacks", () => {
  assert.match(runtime, /QUATERNIUS_BLENDER_REACTIONS_URL/);
  assert.match(runtime, /blenderReactions: MotionClipSource \| null/);
  assert.match(runtime, /blenderReactionClips/);
  assert.match(runtime, /case "HIT": return \{ name: "BF_HitHeavy"/);
  assert.match(runtime, /case "BLOCK_STUN": return \{ name: "BF_GuardBreak"/);
  assert.match(runtime, /\["BF_HitHeavy", "PF_HitHeavy"\]/);
  assert.match(runtime, /\["BF_GuardBreak", "PF_GuardBreak"\]/);
  assert.match(runtime, /function transitionFadeSeconds/);
  assert.match(runtime, /reactionClips\.has\(next\).*0\.025/);
  assert.match(runtime, /reactionClips\.has\(previous\).*0\.12/);
  assert.match(runtime, /function advance\(runtime: QuaterniusRuntime, timeSeconds: number, frozen = false\)/);
  assert.match(runtime, /if \(!frozen\) runtime\.mixer\.update\(delta\)/);
  assert.match(runtime, /advance\(runtime, timeSeconds, fighter\.hitStop > 0\)/);
  assert.match(runtime, /quaterniusHitReactionMotionSource/);
  assert.match(runtime, /quaterniusGuardBreakMotionSource/);
  assert.match(integrator, /BF_HitHeavy/);
  assert.match(integrator, /BF_GuardBreak/);
});

test("Model Viewer and WebGL audit expose PF/BF reaction A-B pairs", () => {
  assert.match(viewer, /QUATERNIUS_BLENDER_REACTIONS_URL/);
  for (const [procedural, blender, slug] of [
    ["PF_HitHeavy", "BF_HitHeavy", "hit-heavy"],
    ["PF_GuardBreak", "BF_GuardBreak", "guard-break"],
  ]) {
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${procedural}"`));
    assert.match(audit, new RegExp(`poseMotionViewer\\(sessionId, "${blender}"`));
    assert.match(audit, new RegExp(`model-view-motion-procedural-${slug}\\.png`));
    assert.match(audit, new RegExp(`model-view-motion-blender-${slug}\\.png`));
  }
});

test("reaction CI pins the authoring source and validates real GLB actions before publish", () => {
  assert.match(workflow, /aa02a4e6d8337a0604d2da131bcbbeb1f01badf0/);
  assert.match(workflow, /4c748767741a3e495d89667b9a218b690ba9810b9517a12e960780e3ca72c4e9/);
  assert.match(workflow, /build-fight-motion-foundry-v2-reactions\.py/);
  assert.match(workflow, /BF_HitHeavy/);
  assert.match(workflow, /BF_GuardBreak/);
  assert.match(workflow, /animations/);
  assert.match(workflow, /apply-blender-motion-foundry-v2-reactions\.mjs/);
});
