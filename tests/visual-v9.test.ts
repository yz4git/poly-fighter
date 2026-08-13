import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual-entry";
import { getSoleContactPoint, getVisualContactPoint } from "../src/game/visual";

test("SERA gameplay now selects the authored V9 character", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  assert.equal(String(visual.visualVersion), "V9");
  assert.match(visual.root.name, /v9/);
  assert.equal(visual.root.userData.authoredNeutralStance, "V9");
  assert.ok(visual.bodyMesh instanceof THREE.SkinnedMesh);
  assert.equal(visual.bodyMesh.geometry.userData.viewIndependent, true);
  assert.equal(visual.bodyMesh.geometry.userData.authoredSideProfile, true);
  assert.ok(visual.bodyMesh.geometry.groups.length >= 12, "large costume/body material regions should remain explicit");

  const box = visual.bodyMesh.geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(visual.bodyMesh.geometry.getAttribute("position") as THREE.BufferAttribute);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.z > 0.38, `profile depth ${size.z} is too thin to match the turnaround silhouette`);
  assert.ok(size.y > 0.95, `authored normalized height ${size.y} unexpectedly collapsed`);
  disposeFighterVisual(visual);
});

test("V9 source cannot fall back to V7 reference rectangles or camera-specific planes", () => {
  const source = readFileSync(new URL("../src/game/visual-v9.ts", import.meta.url), "utf8");
  assert.equal(source.includes("GOLDEN_MASTER_V7_RECTS"), false);
  assert.equal(source.includes("golden-master-v7-geometry"), false);
  assert.equal(source.includes("THREE.Sprite"), false);
  assert.equal(source.includes("VIEW_YAW"), false);
  assert.equal(source.includes("createFemaleV9Visual"), true);
});

test("V9 idle stance creates visible fore-aft separation instead of a profile stick figure", () => {
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
  assert.ok(Math.abs(leftSole.y) < 0.07 && Math.abs(rightSole.y) < 0.07, "V9 stance must remain grounded");
  assert.ok(Math.abs(leftSole.x - rightSole.x) > 0.20, "front/back feet still overlap in the fight camera plane");

  const leftFist = getVisualContactPoint(player.visual, "LEFT_FIST");
  const rightFist = getVisualContactPoint(player.visual, "RIGHT_FIST");
  assert.ok(leftFist.distanceTo(rightFist) > 0.28, "guard hands still collapse into one profile line");
  assert.ok(Math.abs(leftFist.x - rightFist.x) > 0.12, "guard hands need readable fight-axis separation");
  assert.ok(leftFist.toArray().every(Number.isFinite) && rightFist.toArray().every(Number.isFinite));

  disposeFighterVisual(player.visual);
  disposeFighterVisual(cpu.visual);
});

test("V9 remains compatible with existing punch and kick contact animation", () => {
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
