import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual-entry";
import { getSoleContactPoint, getVisualContactPoint } from "../src/game/visual";

test("SERA gameplay selects the Blender conformal character on the canonical combat rig", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  assert.equal(String(visual.visualVersion), "V11");
  assert.match(visual.root.name, /blender-runtime/);
  assert.ok(visual.bodyMesh instanceof THREE.SkinnedMesh);
  assert.equal(visual.root.userData.visualPipeline, "BLENDER_CONFORMAL_GLB_CANONICAL_RIG");
  assert.equal(visual.root.userData.blenderRuntimeAsset, "/models/sera-blender-runtime.glb");
  assert.equal(visual.root.userData.blenderRuntimeAssetState, "pending");
  assert.equal(visual.bodyMesh.userData.reconstruction, "blender-runtime-glb-pending");
  disposeFighterVisual(visual);
});

test("V16 reference pose is idempotent when a static Model View frame is rendered repeatedly", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  const anchor = visual.root.getObjectByName("v11-reference-pose-anchor");
  assert.ok(anchor);
  const applyReferencePose = anchor.onBeforeRender as unknown as () => void;
  const before = visual.hips.position.y;
  applyReferencePose();
  const afterFirstFrame = visual.hips.position.y;
  applyReferencePose();
  const afterSecondFrame = visual.hips.position.y;
  assert.notEqual(afterFirstFrame, before, "first presentation pose application should still adjust the hips");
  assert.equal(afterSecondFrame, afterFirstFrame, "unchanged static frames must not keep sinking the hips");
  assert.equal(visual.root.userData.v11PoseStabilityGuard, "SKIP_UNCHANGED_BONE_STATE_V1");
  disposeFighterVisual(visual);
});


test("V11 keeps grounded fighting-stance separation", () => {
  const playerVisual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  const cpuVisual = createFighterVisual(FIGHTER_DEFINITIONS.red, "NORMAL");
  const player = new FighterRuntime("player", FIGHTER_DEFINITIONS.blue, false, playerVisual);
  const cpu = new FighterRuntime("cpu", FIGHTER_DEFINITIONS.red, true, cpuVisual);
  const animation = new FighterAnimationController();
  player.resetForRound(-2, 0, 1);
  cpu.resetForRound(2, 0, -1);
  animation.update(player, cpu, 0.4);

  const leftSole = getSoleContactPoint(player.visual, "left");
  const rightSole = getSoleContactPoint(player.visual, "right");
  assert.ok(Math.abs(leftSole.y) < 0.08 && Math.abs(rightSole.y) < 0.08);
  assert.ok(leftSole.distanceTo(rightSole) > 0.20);

  const leftFist = getVisualContactPoint(player.visual, "LEFT_FIST");
  const rightFist = getVisualContactPoint(player.visual, "RIGHT_FIST");
  assert.ok(leftFist.distanceTo(rightFist) > 0.20);

  disposeFighterVisual(player.visual);
  disposeFighterVisual(cpu.visual);
});

test("V11 remains compatible with existing punch and kick contact animation", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  const opponentVisual = createFighterVisual(FIGHTER_DEFINITIONS.red, "NORMAL");
  const fighter = new FighterRuntime("player", FIGHTER_DEFINITIONS.blue, false, visual);
  const opponent = new FighterRuntime("cpu", FIGHTER_DEFINITIONS.red, true, opponentVisual);
  const animation = new FighterAnimationController();
  fighter.resetForRound(-2, 0, 1);
  opponent.resetForRound(2, 0, -1);

  for (const moveId of ["jab", "kick"] as const) {
    fighter.state = "IDLE";
    fighter.currentMove = null;
    assert.equal(fighter.beginMove(moveId), true);
    const move = fighter.currentMove;
    assert.ok(move);
    fighter.moveTick = move.startup + 1;
    animation.update(fighter, opponent, 0.8);
    const contact = getVisualContactPoint(fighter.visual, move.visualContact);
    assert.ok(contact.toArray().every(Number.isFinite));
  }

  disposeFighterVisual(fighter.visual);
  disposeFighterVisual(opponent.visual);
});
