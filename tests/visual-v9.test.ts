import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual-entry";
import { classifyV10SkinRegion } from "../src/game/visual-v10";
import { getSoleContactPoint, getVisualContactPoint } from "../src/game/visual";

test("SERA gameplay selects the V10 reconstruction pipeline", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  assert.equal(String(visual.visualVersion), "V10");
  assert.match(visual.root.name, /v10/);
  assert.ok(visual.bodyMesh instanceof THREE.SkinnedMesh);
  assert.equal(visual.root.userData.reconstructionAsset, "/models/sera-v10.glb");
  assert.equal(visual.root.userData.authoredNeutralStance, "V10.1_BIND_SAFE");
  disposeFighterVisual(visual);
});

test("V10 is asset-driven and cannot regress to per-view rectangles or procedural body primitives", () => {
  const source = readFileSync(new URL("../src/game/visual-v10.ts", import.meta.url), "utf8");
  assert.match(source, /GLTFLoader/);
  assert.match(source, /models\/sera-v10\.glb/);
  assert.equal(source.includes("GOLDEN_MASTER_V7_RECTS"), false);
  assert.equal(source.includes("THREE.Sprite"), false);
  assert.equal(source.includes("builder.loft"), false);
  assert.equal(source.includes("builder.prism"), false);
  assert.equal(source.includes("builder.tube"), false);
});

test("V10 repository contains one generated GLB from one shared four-view volume", () => {
  const glb = new URL("../public/models/sera-v10.glb", import.meta.url);
  assert.ok(statSync(glb).size > 10_000, "reconstructed GLB is missing or suspiciously small");
  const metrics = JSON.parse(readFileSync(new URL("../public/models/sera-v10.metrics.json", import.meta.url), "utf8"));
  assert.equal(metrics.singleVolume, true);
  assert.equal(metrics.mesh.normalizedHeight, 1);
  assert.ok(metrics.mesh.vertices > 500);
  assert.ok(metrics.mesh.triangles > 500);
  for (const view of ["front", "three-quarter", "side", "back"]) {
    assert.ok(Number.isFinite(metrics.views[view].iou));
    assert.ok(metrics.views[view].iou > 0.80, `${view} single-volume IoU is too low: ${metrics.views[view].iou}`);
  }
});

test("V10.1 never assigns broad torso or skirt samples to arm regions", () => {
  assert.equal(classifyV10SkinRegion(0.10, 0.60, 0.02, "black"), "HIPS");
  assert.equal(classifyV10SkinRegion(0.16, 0.55, 0.05, "blue"), "HIPS");
  assert.equal(classifyV10SkinRegion(-0.15, 0.58, -0.02, "blue"), "HIPS");
  assert.equal(classifyV10SkinRegion(0.04, 0.73, -0.16, "black"), "HEAD");
  assert.equal(classifyV10SkinRegion(0.16, 0.56, 0.03, "silver"), "RIGHT_FOREARM");
  assert.equal(classifyV10SkinRegion(-0.16, 0.72, 0.02, "skin"), "LEFT_UPPER_ARM");
});

test("V10.1 lower-body samples stay on the correct articulated chain", () => {
  assert.equal(classifyV10SkinRegion(-0.06, 0.48, 0.01, "skin"), "LEFT_THIGH");
  assert.equal(classifyV10SkinRegion(0.06, 0.36, 0.01, "black"), "RIGHT_THIGH");
  assert.equal(classifyV10SkinRegion(-0.06, 0.22, 0.01, "black"), "LEFT_SHIN");
  assert.equal(classifyV10SkinRegion(0.07, 0.04, 0.06, "blue"), "RIGHT_FOOT");
});

test("V10 idle scaffold preserves grounded fighting-stance separation before/after asset load", () => {
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

test("V10 remains compatible with existing punch and kick contact animation", () => {
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
