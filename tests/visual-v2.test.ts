import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  REFERENCE_STYLE,
  createFighterVisual,
  disposeFighterVisual,
  generatedLandmarks,
  landmarkLoss,
  measureProjectedSilhouette,
  projectGeneratedLandmarks,
  proportionPenalty,
} from "../src/game/visual";

function assertFiniteAttribute(geometry: THREE.BufferGeometry, name: string, label: string): void {
  const attribute = geometry.getAttribute(name);
  assert.ok(attribute, `${label} is missing ${name}`);
  for (let index = 0; index < attribute.count * attribute.itemSize; index += 1) {
    assert.equal(Number.isFinite(attribute.array[index]), true, `${label} ${name} contains a non-finite value`);
  }
}

test("Fighter Visual V5 follows reference proportions and real skinning", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const visual = createFighterVisual(definition, "NORMAL");
    const target = definition.archetype === "POWER" ? REFERENCE_STYLE.KAIRO : REFERENCE_STYLE.SERA;
    const body = visual.bodyMesh;

    assert.ok(visual.stats.triangleCount >= 7_000, `${definition.name} V4 is below the efficient density budget`);
    assert.ok(visual.stats.triangleCount <= 30_000, `${definition.name} V4 exceeds the mobile density budget`);
    // V5 adds explicit deltoid, patella, elbow, hip, face and hair masses,
    // while keeping a bounded draw-call budget.
    assert.ok(visual.stats.meshCount <= 52);
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
    const facetTotal = visual.stats.facetDistribution.large + visual.stats.facetDistribution.medium + visual.stats.facetDistribution.small;
    assert.ok(Math.abs(facetTotal - 1) < 0.0001);
    assert.ok(Math.max(visual.stats.facetDistribution.large, visual.stats.facetDistribution.medium, visual.stats.facetDistribution.small) - Math.min(visual.stats.facetDistribution.large, visual.stats.facetDistribution.medium, visual.stats.facetDistribution.small) > 0.05);
    assert.equal(visual.stats.scores.silhouette, null, "silhouette is NOT_MEASURED until projected geometry is supplied");
    assert.equal(visual.stats.scores.landmark, null, "landmark is NOT_MEASURED until a camera pose is supplied");
    assert.ok(visual.stats.scores.proportion >= 90);
    assert.ok(Number.isFinite(visual.stats.scores.facet));
    assert.equal(visual.stats.scores.style === null || Number.isFinite(visual.stats.scores.style), true);
    assert.ok(Number.isFinite(visual.stats.scores.colorMaterial ?? NaN));

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
    const camera = new THREE.OrthographicCamera(-2.2, 2.2, 2.2, -2.2, 0.1, 20);
    camera.position.set(2.8, 1.6, 5.4);
    camera.lookAt(0, 1.4, 0);
    const generated = generatedLandmarks(visual);
    assert.ok(Object.values(generated).every((value) => value.toArray().every(Number.isFinite)));
    const projected = projectGeneratedLandmarks(visual, camera);
    const measuredLoss = landmarkLoss(poseKey, projected);
    assert.ok(Number.isFinite(measuredLoss) && measuredLoss >= 0);
    const silhouette = measureProjectedSilhouette(visual.root, camera, 64);
    assert.ok(silhouette.occupiedPixels > 0);
    assert.ok(silhouette.areaRatio > 0 && silhouette.areaRatio < 1);
    disposeFighterVisual(visual);
  }
});

test("Fighter Visual V5 quality tiers keep the same design with ordered budgets", () => {
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
    assert.ok(high.stats.meshCount <= 52);
    disposeFighterVisual(low);
    disposeFighterVisual(normal);
    disposeFighterVisual(high);
  }
});
