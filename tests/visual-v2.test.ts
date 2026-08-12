import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual";

test("Fighter Visual V2 has finite faceted geometry and bounded shared materials", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const visual = createFighterVisual(definition, "NORMAL");
    assert.ok(visual.stats.triangleCount >= 20_000, `${definition.name} V2 is below density target`);
    assert.ok(visual.stats.triangleCount <= 40_000, `${definition.name} V2 exceeds mobile density target`);
    assert.ok(visual.stats.meshCount <= 64);
    assert.ok(visual.stats.materialCount <= 8);
    assert.equal(Object.keys(visual.rig.bones).length, 21);
    for (const mesh of visual.allMeshes) {
      const positions = mesh.geometry.getAttribute("position");
      const normals = mesh.geometry.getAttribute("normal");
      for (let index = 0; index < positions.count * positions.itemSize; index += 1) {
        assert.equal(Number.isFinite(positions.array[index]), true, `${definition.name} position contains NaN`);
      }
      for (let index = 0; index < (normals?.count ?? 0) * (normals?.itemSize ?? 0); index += 1) {
        assert.equal(Number.isFinite(normals?.array[index]), true, `${definition.name} normal contains NaN`);
      }
    }
    disposeFighterVisual(visual);
  }
});

test("Fighter Visual V2 quality tiers are ordered for KAIRO and SERA", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const low = createFighterVisual(definition, "LOW");
    const normal = createFighterVisual(definition, "NORMAL");
    const high = createFighterVisual(definition, "HIGH");
    assert.ok(high.stats.triangleCount >= normal.stats.triangleCount);
    assert.ok(normal.stats.triangleCount >= low.stats.triangleCount);
    assert.ok(high.stats.meshCount >= low.stats.meshCount);
    assert.equal(normal.stats.materialCount, low.stats.materialCount);
    assert.equal(normal.stats.materialCount, high.stats.materialCount);
    disposeFighterVisual(low);
    disposeFighterVisual(normal);
    disposeFighterVisual(high);
  }
});
