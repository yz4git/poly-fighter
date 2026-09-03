import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-reactions-directional.py", import.meta.url), "utf8");
const integrator = await readFile(new URL("../scripts/apply-blender-motion-foundry-v2-reactions-directional.mjs", import.meta.url), "utf8");
const fighter = await readFile(new URL("../src/game/fighter.ts", import.meta.url), "utf8");
const combat = await readFile(new URL("../src/game/combat.ts", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/game/visual-quaternius-runtime.ts", import.meta.url), "utf8");
const audit = await readFile(new URL("../scripts/capture-model-view-audit.mjs", import.meta.url), "utf8");
const metrics = JSON.parse(await readFile(new URL("../public/models/quaternius/blender-reactions-core.metrics.json", import.meta.url), "utf8"));

const expected = new Set([
  "BF_HitHeavy",
  "BF_GuardBreak",
  "BF_HitLight_L",
  "BF_HitLight_R",
  "BF_HitMid_L",
  "BF_HitMid_R",
  "BF_CounterHit_L",
  "BF_CounterHit_R",
  "BF_EdgeStagger",
]);

test("directional generator extends the proven reaction rig without changing gameplay ownership", () => {
  assert.match(generator, /build-fight-motion-foundry-v2-reactions\.py/);
  assert.match(generator, /BF_HitLight_L/);
  assert.match(generator, /BF_HitLight_R/);
  assert.match(generator, /BF_HitMid_L/);
  assert.match(generator, /BF_HitMid_R/);
  assert.match(generator, /BF_CounterHit_L/);
  assert.match(generator, /BF_CounterHit_R/);
  assert.match(generator, /BF_EdgeStagger/);
  assert.match(generator, /Head rolls against the torso/);
  assert.match(generator, /V2_DIRECTIONAL_COUNTER_EDGE/);
});

test("generated directional library contains all reaction classes with planted feet and clean recovery", () => {
  assert.equal(metrics.version, "BLENDER_MOTION_FOUNDRY_V2_REACTIONS");
  assert.equal(metrics.sharedRig, "MOTION_FOUNDRY_V2_REACTION_RIG");
  assert.deepEqual(new Set(metrics.actions), expected);
  assert.equal(metrics.moves.length, expected.size);
  const byAction = new Map(metrics.moves.map((move) => [move.action, move]));

  for (const name of expected) {
    const move = byAction.get(name);
    assert.ok(move, `${name} missing`);
    assert.ok(move.durationSeconds < 0.65, `${name}: duration ${move.durationSeconds}`);
    assert.ok(move.leftFootDriftMax < 0.015, `${name}: left foot ${move.leftFootDriftMax}`);
    assert.ok(move.rightFootDriftMax < 0.015, `${name}: right foot ${move.rightFootDriftMax}`);
    assert.ok(move.leftFootAngularDriftDegrees < 1.0, `${name}: left foot angle ${move.leftFootAngularDriftDegrees}`);
    assert.ok(move.rightFootAngularDriftDegrees < 1.0, `${name}: right foot angle ${move.rightFootAngularDriftDegrees}`);
    assert.ok(move.settleTorsoResidualDegrees < 5.0, `${name}: settle ${move.settleTorsoResidualDegrees}`);
    assert.ok(move.boneCount >= 40, `${name}: bones ${move.boneCount}`);
  }

  for (const side of ["L", "R"]) {
    const light = byAction.get(`BF_HitLight_${side}`);
    const mid = byAction.get(`BF_HitMid_${side}`);
    const counter = byAction.get(`BF_CounterHit_${side}`);
    assert.ok(light.torsoExcursionDegrees > 8, `${side} light torso ${light.torsoExcursionDegrees}`);
    assert.ok(light.headExcursionDegrees > 5, `${side} light head ${light.headExcursionDegrees}`);
    assert.ok(mid.torsoExcursionDegrees > 12, `${side} mid torso ${mid.torsoExcursionDegrees}`);
    assert.ok(mid.headExcursionDegrees > 8, `${side} mid head ${mid.headExcursionDegrees}`);
    assert.ok(counter.torsoExcursionDegrees > 20, `${side} counter torso ${counter.torsoExcursionDegrees}`);
    assert.ok(counter.headExcursionDegrees > 12, `${side} counter head ${counter.headExcursionDegrees}`);
    assert.equal(light.reactionClass, "LIGHT");
    assert.equal(mid.reactionClass, "MID");
    assert.equal(counter.reactionClass, "COUNTER");
    assert.equal(light.reactionSide, side === "L" ? "LEFT" : "RIGHT");
    assert.equal(mid.reactionSide, side === "L" ? "LEFT" : "RIGHT");
    assert.equal(counter.reactionSide, side === "L" ? "LEFT" : "RIGHT");
  }

  const edge = byAction.get("BF_EdgeStagger");
  assert.equal(edge.reactionClass, "EDGE");
  assert.equal(edge.edgeSafe, true);
  assert.ok(edge.torsoExcursionDegrees > 10, edge.torsoExcursionDegrees);
});

test("combat classifies visual reactions without changing damage, stun, or knockback rules", () => {
  assert.match(fighter, /reactionKind: "LIGHT" \| "MID" \| "HEAVY" \| "COUNTER"/);
  assert.match(fighter, /reactionSide: "LEFT" \| "RIGHT"/);
  assert.match(fighter, /reactionAtEdge = false/);
  assert.match(fighter, /reactionSerial = 0/);
  assert.match(fighter, /setHitReactionVisual/);
  assert.match(combat, /VISUAL_EDGE_X = 5\.35/);
  assert.match(combat, /VISUAL_EDGE_Z = 2\.95/);
  assert.match(combat, /damage <= 7/);
  assert.match(combat, /damage <= 13/);
  assert.match(combat, /counter\s*\? "COUNTER"/);
  assert.match(combat, /setHitReactionVisual\(reactionKind, reactionSide, reactionAtEdge\)/);
  assert.match(combat, /defender\.receiveDamage\(/);
});

test("runtime routes light, mid, counter and edge reactions with safe PF fallbacks and retriggering", () => {
  for (const name of [
    "BF_HitLight_L",
    "BF_HitLight_R",
    "BF_HitMid_L",
    "BF_HitMid_R",
    "BF_CounterHit_L",
    "BF_CounterHit_R",
    "BF_EdgeStagger",
  ]) assert.match(runtime, new RegExp(name));
  assert.match(runtime, /fighter\.reactionAtEdge/);
  assert.match(runtime, /fighter\.reactionKind === "COUNTER"/);
  assert.match(runtime, /fighter\.reactionKind === "LIGHT"/);
  assert.match(runtime, /fighter\.reactionKind === "MID"/);
  assert.match(runtime, /lastReactionSerial/);
  assert.match(runtime, /restartingReaction/);
  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V2_DIRECTIONAL_REACTIONS/);
  assert.match(integrator, /PF_HitHeavy/);
});

test("WebGL audit captures both directional pairs, counter pairs, and edge stagger", () => {
  for (const file of [
    "model-view-motion-blender-hit-light-left.png",
    "model-view-motion-blender-hit-light-right.png",
    "model-view-motion-blender-hit-mid-left.png",
    "model-view-motion-blender-hit-mid-right.png",
    "model-view-motion-blender-counter-hit-left.png",
    "model-view-motion-blender-counter-hit-right.png",
    "model-view-motion-blender-edge-stagger.png",
  ]) assert.match(audit, new RegExp(file.replaceAll(".", "\\.")));
});
