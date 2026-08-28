import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual-entry";
import { KAIRO_RECONSTRUCTION_ID, createKairoReconstructedVisual } from "../src/game/visual-kairo-v1";

function assertFiniteAttribute(geometry: THREE.BufferGeometry, name: string): void {
  const attribute = geometry.getAttribute(name);
  assert.ok(attribute, "KAIRO geometry is missing " + name);
  for (let index = 0; index < attribute.count * attribute.itemSize; index += 1) {
    assert.equal(Number.isFinite(attribute.array[index]), true, name + " contains a non-finite value");
  }
}

test("KAIRO runtime uses the from-scratch Forge reconstruction", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.red, "NORMAL");
  assert.equal(visual.root.userData.visualPipeline, KAIRO_RECONSTRUCTION_ID);
  assert.equal(visual.root.userData.characterSource, "FROM_SCRATCH_AUTHORED_RUNTIME");
  assert.equal(visual.root.userData.legacyKairoGenerator, false);
  assert.equal(visual.root.userData.rigCompatibility, "V4_CANONICAL_21_BONE_IK");
  assert.equal(String(visual.visualVersion), "KAIRO_V1");
  assert.equal(visual.root.name, "fighter-kairo-v1-red");
  assert.equal(visual.bodyMesh.name, "kairo-v1-continuous-skinned-body");
  assert.equal(visual.bodyMesh.userData.reconstruction, "kairo-from-scratch-continuous-skinned-mesh");
  assert.equal(Object.keys(visual.rig.bones).length, 21);
  assert.equal(visual.bodyMesh instanceof THREE.SkinnedMesh, true);
  assert.ok(visual.bodyMesh.skeleton);
  assertFiniteAttribute(visual.bodyMesh.geometry, "position");
  assertFiniteAttribute(visual.bodyMesh.geometry, "normal");
  assertFiniteAttribute(visual.bodyMesh.geometry, "skinIndex");
  assertFiniteAttribute(visual.bodyMesh.geometry, "skinWeight");

  const weights = visual.bodyMesh.geometry.getAttribute("skinWeight");
  for (let vertex = 0; vertex < weights.count; vertex += 1) {
    const sum = weights.getX(vertex) + weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex);
    assert.ok(Math.abs(sum - 1) < 0.0001, "KAIRO skin weights must be normalized");
  }
  assert.ok(visual.stats.triangleCount >= 5_000, "KAIRO NORMAL is below the authored topology budget");
  assert.ok(visual.stats.triangleCount <= 18_000, "KAIRO NORMAL exceeds the iPhone topology budget");
  assert.ok(visual.stats.meshCount <= 58, "KAIRO exceeds the bounded draw-call budget");
  assert.ok(visual.stats.weightedVertexCount > 0);
  disposeFighterVisual(visual);
});

test("KAIRO face, hair, armor, coat and contact silhouettes are explicitly authored", () => {
  const visual = createKairoReconstructedVisual(FIGHTER_DEFINITIONS.red, "NORMAL");
  const names = new Set(visual.allMeshes.map((value) => value.name));
  for (const required of [
    "kairo-v1-left-eye",
    "kairo-v1-right-eye",
    "kairo-v1-nose-bridge",
    "kairo-v1-mouth",
    "kairo-v1-hair-crown",
    "kairo-v1-forge-chest",
    "kairo-v1-left-shoulder-armor",
    "kairo-v1-left-forge-gauntlet",
    "kairo-v1-left-coat-tail",
    "kairo-v1-right-coat-tail",
    "kairo-v1-left-shin-armor",
    "kairo-v1-right-boot",
  ]) {
    assert.equal(names.has(required), true, "Missing authored KAIRO part: " + required);
  }
  assert.ok(visual.hairMasses.length >= 8);
  assert.equal(visual.ponytailMasses.length, 0);
  assert.ok(visual.clothingAttachments.length >= 20);
  assert.ok(visual.clothingAttachments.every((value) => value.parentBone.startsWith("v4-")));
  assert.ok(visual.footContacts.left.soleLocal.y < visual.footContacts.left.endLocal.y);
  assert.ok(visual.footContacts.right.soleLocal.y < visual.footContacts.right.endLocal.y);
  disposeFighterVisual(visual);
});

test("KAIRO reconstruction preserves animation deformation and ordered quality tiers", () => {
  const low = createKairoReconstructedVisual(FIGHTER_DEFINITIONS.red, "LOW");
  const normal = createKairoReconstructedVisual(FIGHTER_DEFINITIONS.red, "NORMAL");
  const high = createKairoReconstructedVisual(FIGHTER_DEFINITIONS.red, "HIGH");
  assert.ok(high.stats.triangleCount > normal.stats.triangleCount);
  assert.ok(normal.stats.triangleCount > low.stats.triangleCount);
  assert.ok(high.stats.vertexCount > normal.stats.vertexCount);
  assert.ok(normal.stats.vertexCount > low.stats.vertexCount);

  const body = normal.bodyMesh;
  const position = body.geometry.getAttribute("position");
  const skinIndex = body.geometry.getAttribute("skinIndex");
  const skinWeight = body.geometry.getAttribute("skinWeight");
  const targetBone = normal.rig.boneIndices.rightUpperArm;
  let sample = -1;
  for (let vertex = 0; vertex < position.count && sample < 0; vertex += 1) {
    for (let slot = 0; slot < 4; slot += 1) {
      if (skinIndex.getComponent(vertex, slot) === targetBone && skinWeight.getComponent(vertex, slot) > 0.5) {
        sample = vertex;
        break;
      }
    }
  }
  assert.ok(sample >= 0, "KAIRO has no upper-arm weighted sample");
  normal.root.updateMatrixWorld(true);
  body.skeleton.update();
  const bind = body.applyBoneTransform(sample, new THREE.Vector3().fromBufferAttribute(position, sample));
  normal.rig.bones.rightUpperArm.rotation.z = 0.55;
  normal.root.updateMatrixWorld(true);
  body.skeleton.update();
  const deformed = body.applyBoneTransform(sample, new THREE.Vector3().fromBufferAttribute(position, sample));
  assert.ok(bind.distanceTo(deformed) > 0.001, "KAIRO body did not deform with the combat rig");

  disposeFighterVisual(low);
  disposeFighterVisual(normal);
  disposeFighterVisual(high);
});
