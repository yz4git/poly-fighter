import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual-entry";
import { getSoleContactPoint, getVisualContactPoint } from "../src/game/visual";

test("SERA runtime uses one view-independent V8 skinned geometry", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  assert.equal(visual.visualVersion, "V8");
  assert.equal(visual.root.name.includes("v8"), true);
  assert.ok(visual.bodyMesh instanceof THREE.SkinnedMesh);
  assert.equal(visual.bodyMesh.name, "v8-sera-single-skinned-mesh");
  assert.equal(visual.bodyMesh.userData.singleCharacterGeometry, true);
  assert.equal(visual.bodyMesh.geometry.userData.singleViewIndependentMesh, true);
  assert.ok(visual.bodyMesh.geometry.getAttribute("skinIndex"));
  assert.ok(visual.bodyMesh.geometry.getAttribute("skinWeight"));
  assert.ok(visual.bodyMesh.skeleton);

  const visibleCharacterMeshes: THREE.Mesh[] = [];
  visual.root.traverse((object: THREE.Object3D) => {
    if (object instanceof THREE.Mesh && object.visible && !object.userData.excludeFromMetrics) visibleCharacterMeshes.push(object);
  });
  assert.deepEqual(visibleCharacterMeshes, [visual.bodyMesh]);
  assert.equal(visual.stats.meshCount, 1);
  disposeFighterVisual(visual);
});

test("V8 does not use Golden Master rectangles, sprites, or per-view geometry", () => {
  const source = readFileSync(new URL("../src/game/visual-v8.ts", import.meta.url), "utf8");
  assert.equal(source.includes("GOLDEN_MASTER_V7_RECTS"), false);
  assert.equal(source.includes("golden-master-v7-geometry"), false);
  assert.equal(source.includes("THREE.Sprite"), false);
  assert.equal(source.includes("VIEW_YAW"), false);
  assert.equal(source.includes("createFemaleV8Visual"), true);
});

test("the same V8 BufferGeometry remains valid through arbitrary 360-degree viewing", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  const geometry = visual.bodyMesh.geometry;
  const position = geometry.getAttribute("position");
  const sampleBefore = [position.getX(0), position.getY(0), position.getZ(0)];
  for (let degrees = 0; degrees < 360; degrees += 15) {
    visual.root.rotation.y = THREE.MathUtils.degToRad(degrees);
    visual.root.updateMatrixWorld(true);
    assert.equal(visual.bodyMesh.geometry, geometry);
    assert.ok(new THREE.Box3().setFromObject(visual.bodyMesh).isEmpty() === false);
  }
  visual.root.rotation.y = 0;
  assert.deepEqual([position.getX(0), position.getY(0), position.getZ(0)], sampleBefore);
  disposeFighterVisual(visual);
});

test("V8 is actually wired through combat animation contacts and foot plants", () => {
  const playerVisual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  const cpuVisual = createFighterVisual(FIGHTER_DEFINITIONS.red, "NORMAL");
  const player = new FighterRuntime("player", FIGHTER_DEFINITIONS.blue, false, playerVisual);
  const cpu = new FighterRuntime("cpu", FIGHTER_DEFINITIONS.red, true, cpuVisual);
  const animation = new FighterAnimationController();
  player.resetForRound(-2, 0, 1);
  cpu.resetForRound(2, 0, -1);
  animation.update(player, cpu, 0);
  assert.equal(player.visual.visualVersion, "V8");
  for (const side of ["left", "right"] as const) {
    const sole = getSoleContactPoint(player.visual, side);
    assert.ok(Number.isFinite(sole.x) && Number.isFinite(sole.y) && Number.isFinite(sole.z));
    assert.ok(Math.abs(sole.y) < 0.06);
  }
  const fist = getVisualContactPoint(player.visual, "RIGHT_FIST");
  const foot = getVisualContactPoint(player.visual, "RIGHT_FOOT");
  assert.ok(fist.toArray().every(Number.isFinite));
  assert.ok(foot.toArray().every(Number.isFinite));
  disposeFighterVisual(player.visual);
  disposeFighterVisual(cpu.visual);
});
