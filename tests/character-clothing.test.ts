import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CHARACTER_CLOTHING_ID, characterClothingDiagnostics } from "../src/game/character-clothing";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual-entry";

function clothingNames(visual: ReturnType<typeof createFighterVisual>): Set<string> {
  return new Set(
    visual.allMeshes
      .filter((mesh) => mesh.userData.characterClothing === CHARACTER_CLOTHING_ID)
      .map((mesh) => mesh.name),
  );
}

test("KAIRO receives layered jacket, sleeves, pants and boots", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.red, "LOW", "ORIGINAL");
  const diagnostics = characterClothingDiagnostics(visual);
  assert.equal(diagnostics.state, "ready");
  assert.equal(diagnostics.mode, "ORIGINAL");
  assert.equal(diagnostics.profile, "KAIRO_LAYERED_FIGHT_GEAR");
  assert.ok(Number(diagnostics.partCount) >= 13);

  const names = clothingNames(visual);
  for (const name of [
    "fighter-clothing-kairo-jacket-upper",
    "fighter-clothing-kairo-jacket-core",
    "fighter-clothing-kairo-left-sleeve",
    "fighter-clothing-kairo-right-sleeve",
    "fighter-clothing-kairo-left-pants",
    "fighter-clothing-kairo-right-pants",
    "fighter-clothing-kairo-left-boot",
    "fighter-clothing-kairo-right-boot",
  ]) {
    assert.equal(names.has(name), true, `Missing KAIRO clothing part: ${name}`);
  }
  disposeFighterVisual(visual);
});

test("SERA receives a layered jacket, bodysuit, leggings and boots", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "LOW", "ORIGINAL");
  const diagnostics = characterClothingDiagnostics(visual);
  assert.equal(diagnostics.state, "ready");
  assert.equal(diagnostics.mode, "ORIGINAL");
  assert.equal(diagnostics.profile, "SERA_LAYERED_SPEED_GEAR");
  assert.ok(Number(diagnostics.partCount) >= 13);

  const names = clothingNames(visual);
  for (const name of [
    "fighter-clothing-sera-jacket-upper",
    "fighter-clothing-sera-bodysuit-core",
    "fighter-clothing-sera-waist-shorts",
    "fighter-clothing-sera-left-legging",
    "fighter-clothing-sera-right-legging",
    "fighter-clothing-sera-left-boot",
    "fighter-clothing-sera-right-boot",
  ]) {
    assert.equal(names.has(name), true, `Missing SERA clothing part: ${name}`);
  }
  disposeFighterVisual(visual);
});

test("segmented clothing updates from joint positions instead of a static body overlay", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.red, "LOW", "ORIGINAL");
  const sleeve = visual.root.getObjectByName("fighter-clothing-kairo-right-sleeve") as THREE.Mesh | null;
  assert.ok(sleeve?.isMesh);
  visual.root.updateMatrixWorld(true);
  const before = sleeve.position.clone();

  visual.rig.bones.rightUpperArm.rotation.z += 0.55;
  visual.root.updateMatrixWorld(true);
  const fakeRenderer = { info: { render: { frame: 2 } } } as unknown as THREE.WebGLRenderer;
  sleeve.onBeforeRender(
    fakeRenderer,
    {} as THREE.Scene,
    {} as THREE.Camera,
    sleeve.geometry,
    sleeve.material,
    null,
  );
  const after = sleeve.position.clone();
  assert.ok(before.distanceTo(after) > 0.002, "Sleeve did not follow the animated arm joints");
  assert.equal(visual.root.userData.characterClothingFollowMode, "WORLD_SEGMENT_AXIS_INDEPENDENT");
  disposeFighterVisual(visual);
});
