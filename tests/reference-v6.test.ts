import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  createFighterVisual,
  disposeFighterVisual,
  measureProjectedSilhouette,
  projectGeneratedLandmarks,
  visualGroundOffset,
} from "../src/game/visual";
import {
  createFemaleV6ReferenceCamera,
  envelopeError,
  FEMALE_V6_CONTROL_CAGE,
  FEMALE_V6_REFERENCE,
  FEMALE_V6_REFERENCE_ENVELOPES,
  FEMALE_V6_REFERENCE_LANDMARKS,
  FEMALE_V6_VIEW_ORDER,
  landmarkRms,
} from "../src/game/reference-v6";

test("V6 golden master asset and fixed four-view camera metadata are present", () => {
  const path = new URL("../public/reference/female-turnaround.jpeg", import.meta.url);
  assert.equal(existsSync(path), true);
  assert.ok(statSync(path).size > 100_000);
  assert.equal(FEMALE_V6_REFERENCE.sourceWidth, 1536);
  assert.equal(FEMALE_V6_REFERENCE.sourceHeight, 1024);
  assert.equal(FEMALE_V6_REFERENCE.characterHeightMeters, 1.68);
  assert.deepEqual(FEMALE_V6_VIEW_ORDER, ["FRONT", "THREE_QUARTER", "SIDE", "BACK"]);
  for (const view of FEMALE_V6_VIEW_ORDER) {
    const camera = createFemaleV6ReferenceCamera(view, FEMALE_V6_REFERENCE.views[view].width / FEMALE_V6_REFERENCE.views[view].height);
    assert.equal(camera.fov, FEMALE_V6_REFERENCE.cameraFov);
    assert.ok(camera.position.toArray().every(Number.isFinite));
    assert.ok(camera.matrixWorld.elements.every(Number.isFinite));
  }
});

test("V6 control cage is normalized, explicit, and finite", () => {
  const points = Object.values(FEMALE_V6_CONTROL_CAGE);
  assert.equal(points.length >= 19, true);
  for (const point of points) assert.equal(point.toArray().every(Number.isFinite), true);
  assert.equal(FEMALE_V6_CONTROL_CAGE.headTop.y, 1);
  assert.equal(FEMALE_V6_CONTROL_CAGE.leftAnkle.y, 0.02);
  assert.ok(FEMALE_V6_CONTROL_CAGE.leftShoulder.x < FEMALE_V6_CONTROL_CAGE.rightShoulder.x);
  assert.ok(FEMALE_V6_CONTROL_CAGE.leftToe.z > FEMALE_V6_CONTROL_CAGE.leftAnkle.z);
});

test("SERA uses the dedicated V6 skinned reference mesh", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
  assert.equal(visual.visualVersion, "V6");
  assert.match(visual.root.name, /v6/);
  assert.ok(visual.bodyMesh instanceof THREE.SkinnedMesh);
  assert.ok(visual.bodyMesh.geometry.getAttribute("skinIndex"));
  assert.ok(visual.bodyMesh.geometry.getAttribute("skinWeight"));
  assert.ok(visual.bodyMesh.skeleton);
  assert.ok(visual.stats.triangleCount >= 8_000 && visual.stats.triangleCount <= 18_000);
  assert.ok(visual.stats.meshCount <= 52);
  assert.ok(visual.stats.materialCount <= 8);
  assert.equal(visual.hairMasses.filter((mesh) => mesh.userData.ponytail).length, 5);
  assert.equal(visual.clothingAttachments.some((item) => item.name === "v6-front-waist-panel"), true);
  disposeFighterVisual(visual);
});

test("V6 projected silhouette and landmarks are measured separately for all four views", () => {
  for (const view of FEMALE_V6_VIEW_ORDER) {
    const visual = createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL");
    visual.root.scale.setScalar(FEMALE_V6_REFERENCE.characterHeightMeters);
    visual.root.position.y = visualGroundOffset(visual);
    visual.root.updateMatrixWorld(true);
    const crop = FEMALE_V6_REFERENCE.views[view];
    const camera = createFemaleV6ReferenceCamera(view, crop.width / crop.height);
    const silhouette = measureProjectedSilhouette(visual.root, camera, 96);
    const projected = projectGeneratedLandmarks(visual, camera);
    const target = FEMALE_V6_REFERENCE_ENVELOPES[view];
    const envelope = envelopeError(silhouette.bounds, target);
    const rms = landmarkRms(projected, FEMALE_V6_REFERENCE_LANDMARKS[view]);
    assert.ok(silhouette.occupiedPixels > 0, `${view} has no rendered silhouette`);
    assert.ok(Number.isFinite(envelope) && envelope < 0.15, `${view} envelope measurement is outside the reconstruction viewport`);
    assert.ok(Number.isFinite(rms) && rms < 0.20, `${view} landmarks did not project into the reference panel`);
    assert.notEqual(visual.stats.scores.silhouette, envelope, "silhouette must come from the generated render, not a fixed style score");
    disposeFighterVisual(visual);
  }
});
