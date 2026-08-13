import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { createFemaleV8Visual } from "../src/game/visual-v8";
import { disposeFighterVisual } from "../src/game/visual";

test("historical V8 remains one view-independent skinned geometry", () => {
  const visual = createFemaleV8Visual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  assert.equal(visual.visualVersion, "V8");
  assert.equal(visual.root.name.includes("v8"), true);
  assert.ok(visual.bodyMesh instanceof THREE.SkinnedMesh);
  assert.equal(visual.bodyMesh.name, "v8-sera-single-skinned-mesh");
  assert.equal(visual.bodyMesh.userData.singleCharacterGeometry, true);
  assert.equal(visual.bodyMesh.geometry.userData.singleViewIndependentMesh, true);
  assert.ok(visual.bodyMesh.geometry.getAttribute("skinIndex"));
  assert.ok(visual.bodyMesh.geometry.getAttribute("skinWeight"));
  assert.ok(visual.bodyMesh.skeleton);
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
  const visual = createFemaleV8Visual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  const geometry = visual.bodyMesh.geometry;
  const position = geometry.getAttribute("position");
  const sampleBefore = [position.getX(0), position.getY(0), position.getZ(0)];
  for (let degrees = 0; degrees < 360; degrees += 15) {
    visual.root.rotation.y = THREE.MathUtils.degToRad(degrees);
    visual.root.updateMatrixWorld(true);
    assert.equal(visual.bodyMesh.geometry, geometry);
    assert.equal(new THREE.Box3().setFromObject(visual.bodyMesh).isEmpty(), false);
  }
  visual.root.rotation.y = 0;
  assert.deepEqual([position.getX(0), position.getY(0), position.getZ(0)], sampleBefore);
  disposeFighterVisual(visual);
});
