import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import {
  createFighterVisual,
  disposeFighterVisual,
  getVertexBoneWeight,
  getSoleContactPoint,
  measureClothingWorld,
  measureHairBounds,
} from "../src/game/visual";

function nearestVertex(visual: ReturnType<typeof createFighterVisual>, x: number, y: number): number {
  const position = visual.bodyMesh.geometry.getAttribute("position");
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const dx = position.getX(vertex) - x;
    const dy = position.getY(vertex) - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best;
}

function jointBlendSample(
  visual: ReturnType<typeof createFighterVisual>,
  x: number,
  y: number,
  first: string,
  second: string,
): { first: number; second: number } {
  const position = visual.bodyMesh.geometry.getAttribute("position");
  const firstIndex = visual.rig.boneIndices[first];
  const secondIndex = visual.rig.boneIndices[second];
  let best = { distance: Number.POSITIVE_INFINITY, first: 0, second: 0 };
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const dx = position.getX(vertex) - x;
    const dy = position.getY(vertex) - y;
    const distance = dx * dx + dy * dy;
    if (distance < best.distance) best = { distance, first: getVertexBoneWeight(visual.bodyMesh, vertex, firstIndex), second: getVertexBoneWeight(visual.bodyMesh, vertex, secondIndex) };
  }
  return best;
}

test("V5 clothing stays in the parent bone's intended world height", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const visual = createFighterVisual(definition, "NORMAL");
    visual.root.updateMatrixWorld(true);
    const chestY = visual.rig.bones.chest.getWorldPosition(new THREE.Vector3()).y;
    const hipY = visual.rig.bones.hips.getWorldPosition(new THREE.Vector3()).y;
    const metrics = measureClothingWorld(visual);
    assert.ok(metrics.length >= 6);
    for (const metric of metrics) {
      const parentY = metric.mesh?.parent?.getWorldPosition?.(new THREE.Vector3()).y ?? undefined;
      const referenceY = metric.category === "CHEST" || metric.category === "SHOULDER" ? chestY : metric.category === "WAIST" || metric.category === "HIP" ? hipY : parentY ?? hipY;
      assert.ok(Math.abs(metric.center.y - referenceY) < 0.62, `${metric.name} detached from ${metric.category}`);
      if (metric.category !== "LEG") assert.ok(metric.minY > 0.35, `${metric.name} unexpectedly accumulated at the feet`);
      assert.equal(metric.parentBone.startsWith("v4-"), true);
      assert.equal(metric.center.toArray().every(Number.isFinite), true);
    }
    disposeFighterVisual(visual);
  }
});

test("V5 limb midpoints are bone-owned and joints alone blend", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const visual = createFighterVisual(definition, "NORMAL");
    const layout = visual.layout;
    const armX = layout.shoulderWidth * 0.5 + 0.014;
    const legX = layout.pelvisWidth * 0.29;
    const upperArm = nearestVertex(visual, armX, (layout.shoulderY + 0.008 + layout.elbowY) * 0.5);
    const forearm = nearestVertex(visual, armX + 0.016, (layout.elbowY + layout.wristY) * 0.5);
    const thigh = nearestVertex(visual, legX, (layout.hipsY + 0.018 + layout.kneeY + 0.026) * 0.5);
    const shin = nearestVertex(visual, legX + 0.01, (layout.kneeY + 0.020 + layout.ankleY) * 0.5);
    assert.ok(getVertexBoneWeight(visual.bodyMesh, upperArm, visual.rig.boneIndices.rightUpperArm) >= 0.90);
    assert.ok(getVertexBoneWeight(visual.bodyMesh, forearm, visual.rig.boneIndices.rightForearm) >= 0.90);
    assert.ok(getVertexBoneWeight(visual.bodyMesh, thigh, visual.rig.boneIndices.rightThigh) >= 0.90);
    assert.ok(getVertexBoneWeight(visual.bodyMesh, shin, visual.rig.boneIndices.rightShin) >= 0.90);
    const elbow = jointBlendSample(visual, armX, layout.elbowY, "rightUpperArm", "rightForearm");
    const knee = jointBlendSample(visual, legX, layout.kneeY + 0.023, "rightThigh", "rightShin");
    assert.ok(elbow.first >= 0.20 && elbow.second >= 0.20 && elbow.first + elbow.second >= 0.95);
    assert.ok(knee.first >= 0.20 && knee.second >= 0.20 && knee.first + knee.second >= 0.95);
    disposeFighterVisual(visual);
  }
});

test("V5 world-space foot plants survive crouch and guard without sliding", () => {
  const animation = new FighterAnimationController();
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const fighter = new FighterRuntime("player", definition);
    const opponent = new FighterRuntime("cpu", FIGHTER_DEFINITIONS.blue, true);
    fighter.resetForRound(-2, 0, 1);
    opponent.resetForRound(2, 0, -1);
    animation.update(fighter, opponent, 0);
    const neutral = {
      left: getSoleContactPoint(fighter.visual, "left"),
      right: getSoleContactPoint(fighter.visual, "right"),
    };
    for (const state of ["CROUCH", "GUARD"] as const) {
      fighter.state = state;
      animation.update(fighter, opponent, state === "CROUCH" ? 0.2 : 0.4);
      for (const side of ["left", "right"] as const) {
        const sole = getSoleContactPoint(fighter.visual, side);
        assert.ok(Math.abs(sole.y) < 0.05, `${definition.name} ${state} foot penetrates the ground`);
        assert.ok(sole.clone().setY(0).distanceTo(neutral[side].clone().setY(0)) < 0.08, `${definition.name} ${state} foot slid`);
      }
    }
    disposeFighterVisual(fighter.visual);
    disposeFighterVisual(opponent.visual);
  }
});

test("V5 hair uses authored masses and bounded head-relative placement", () => {
  const red = createFighterVisual(FIGHTER_DEFINITIONS.red, "NORMAL");
  const blue = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  const redHair = measureHairBounds(red);
  const blueHair = measureHairBounds(blue);
  assert.equal(redHair.massCount, 7);
  assert.equal(redHair.ponytailSections, 0);
  assert.equal(blueHair.massCount, 11);
  assert.equal(blueHair.ponytailSections, 5);
  assert.ok(redHair.maxNonPonytailDistance < redHair.headRadius * 1.55);
  assert.ok(blueHair.maxNonPonytailDistance < blueHair.headRadius * 1.55);
  assert.ok(blueHair.maxPonytailDistance > blueHair.headRadius * 0.75);
  disposeFighterVisual(red);
  disposeFighterVisual(blue);
});
