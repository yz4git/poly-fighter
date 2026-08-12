import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  REFERENCE_POSE_BOUNDS,
  REFERENCE_STYLE,
  createFighterVisual,
  disposeFighterVisual,
  landmarkLoss,
  proportionPenalty,
} from "../src/game/visual";

function assertFiniteAttribute(geometry: THREE.BufferGeometry, name: string, label: string): void {
  const attribute = geometry.getAttribute(name);
  assert.ok(attribute, `${label} is missing ${name}`);
  for (let index = 0; index < attribute.count * attribute.itemSize; index += 1) {
    assert.equal(Number.isFinite(attribute.array[index]), true, `${label} ${name} contains a non-finite value`);
  }
}

test("Fighter Visual V3 follows reference proportions and real skinning", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const visual = createFighterVisual(definition, "NORMAL");
    const target = definition.archetype === "POWER" ? REFERENCE_STYLE.KAIRO : REFERENCE_STYLE.SERA;
    const body = visual.bodyMesh;

    assert.ok(visual.stats.triangleCount >= 12_000, `${definition.name} V3 is below the efficient density budget`);
    assert.ok(visual.stats.triangleCount <= 30_000, `${definition.name} V3 exceeds the mobile density budget`);
    assert.ok(visual.stats.meshCount <= 40);
    assert.ok(visual.stats.materialCount <= 8);
    assert.equal(Object.keys(visual.rig.bones).length, 21);
    assert.equal(visual.stats.skinnedMesh, true);
    assert.equal(visual.stats.weightedVertexCount > 0, true);
    assert.equal(body instanceof THREE.SkinnedMesh, true);
    assert.ok(body.skeleton);
    assertFiniteAttribute(body.geometry, "position", `${definition.name} body`);
    assertFiniteAttribute(body.geometry, "normal", `${definition.name} body`);
    assertFiniteAttribute(body.geometry, "skinIndex", `${definition.name} body`);
    assertFiniteAttribute(body.geometry, "skinWeight", `${definition.name} body`);

    const skinWeights = body.geometry.getAttribute("skinWeight");
    for (let vertex = 0; vertex < skinWeights.count; vertex += 1) {
      const sum = skinWeights.getX(vertex) + skinWeights.getY(vertex) + skinWeights.getZ(vertex) + skinWeights.getW(vertex);
      assert.ok(Math.abs(sum - 1) < 0.0001, `${definition.name} skin weights must be normalized`);
    }
    assert.equal(proportionPenalty(visual.layout, target), 0);
    assert.ok(visual.stats.proportions.headCount >= 6.7 && visual.stats.proportions.headCount <= 7.4);
    assert.ok(visual.stats.proportions.shoulderHeadRatio >= (target.shoulderWidth / target.headWidth) * 0.96);
    assert.ok(visual.stats.proportions.shoulderHeadRatio <= (target.shoulderWidth / target.headWidth) * 1.04);
    assert.ok(visual.stats.proportions.thighShinRatio >= 1.02 && visual.stats.proportions.thighShinRatio <= 1.09);
    assert.ok(visual.stats.facetDistribution.large >= 0.45 && visual.stats.facetDistribution.large <= 0.55);
    assert.ok(visual.stats.facetDistribution.medium >= 0.30 && visual.stats.facetDistribution.medium <= 0.40);
    assert.ok(visual.stats.facetDistribution.small >= 0.10 && visual.stats.facetDistribution.small <= 0.18);
    assert.ok(visual.stats.scores.silhouette >= 80);
    assert.ok(visual.stats.scores.proportion >= 90);
    assert.ok(visual.stats.scores.facet >= 80);
    assert.ok(visual.stats.scores.style >= 85);

    // Confirm a real bone deformation changes a weighted body vertex.
    const targetBone = visual.rig.boneIndices.rightUpperArm;
    const skinIndex = body.geometry.getAttribute("skinIndex");
    const position = body.geometry.getAttribute("position");
    let sample = -1;
    for (let vertex = 0; vertex < position.count && sample < 0; vertex += 1) {
      for (let slot = 0; slot < 4; slot += 1) {
        if (skinIndex.getComponent(vertex, slot) === targetBone && skinWeights.getComponent(vertex, slot) > 0.2) {
          sample = vertex;
          break;
        }
      }
    }
    assert.ok(sample >= 0, `${definition.name} has no weighted upper-arm sample`);
    visual.rig.root.updateMatrixWorld(true);
    body.skeleton.update();
    const bind = body.applyBoneTransform(sample, new THREE.Vector3().fromBufferAttribute(position, sample));
    visual.rig.bones.rightUpperArm.rotation.z = 0.5;
    visual.rig.root.updateMatrixWorld(true);
    body.skeleton.update();
    const deformed = body.applyBoneTransform(sample, new THREE.Vector3().fromBufferAttribute(position, sample));
    assert.ok(bind.distanceTo(deformed) > 0.0001, `${definition.name} body vertices did not deform with the skeleton`);

    const poseKey = definition.archetype === "POWER" ? "KAIRO" : "SERA";
    assert.equal(landmarkLoss(poseKey, {
      headTop: REFERENCE_POSE_BOUNDS[poseKey].headTop,
      chin: REFERENCE_POSE_BOUNDS[poseKey].chin,
    }), 0);
    disposeFighterVisual(visual);
  }
});

test("Fighter Visual V3 quality tiers keep the same design with ordered budgets", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const low = createFighterVisual(definition, "LOW");
    const normal = createFighterVisual(definition, "NORMAL");
    const high = createFighterVisual(definition, "HIGH");
    assert.ok(high.stats.triangleCount >= normal.stats.triangleCount);
    assert.ok(normal.stats.triangleCount >= low.stats.triangleCount);
    assert.ok(high.stats.vertexCount >= normal.stats.vertexCount);
    assert.ok(normal.stats.vertexCount >= low.stats.vertexCount);
    assert.equal(normal.stats.materialCount, low.stats.materialCount);
    assert.equal(normal.stats.materialCount, high.stats.materialCount);
    assert.ok(high.stats.meshCount <= 40);
    disposeFighterVisual(low);
    disposeFighterVisual(normal);
    disposeFighterVisual(high);
  }
});
