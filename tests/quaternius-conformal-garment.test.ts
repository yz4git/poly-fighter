import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  QUATERNIUS_CONFORMAL_GARMENT_ID,
  QUATERNIUS_GARMENT_MAX_TRIANGLES,
  buildQuaterniusConformalGarment,
  disposeQuaterniusConformalGarments,
} from "../src/game/quaternius-conformal-garment";

function fixture(): { root: THREE.Group; body: THREE.SkinnedMesh } {
  const geometry = new THREE.CylinderGeometry(.40, .34, 1.2, 24, 12);
  const position = geometry.getAttribute("position");
  const indices: number[] = [];
  const weights: number[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    // Torso around the upper-middle of a humanoid; the legs and head are not
    // part of this jacket even though everything shares a source SkinnedMesh.
    const torso = position.getY(vertex) > -.12 && position.getY(vertex) < .50;
    indices.push(torso ? 0 : 1, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const spine = new THREE.Bone();
  spine.name = "spine_02";
  const thigh = new THREE.Bone();
  thigh.name = "thigh_l";
  const skeleton = new THREE.Skeleton([spine, thigh]);
  const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  const root = new THREE.Group();
  root.add(body, spine, thigh);
  body.bind(skeleton);
  root.updateMatrixWorld(true);
  return { root, body };
}

test("surface-conformal mesh reuses the exact source skeleton and original skin weights", () => {
  const { root, body } = fixture();
  const garment = buildQuaterniusConformalGarment(body, FIGHTER_DEFINITIONS.red);
  assert.ok(garment, "torso triangles should produce a real shell");
  if (!garment) return;
  root.add(garment);
  try {
    assert.equal(garment.userData.quaterniusConformalGarment, QUATERNIUS_CONFORMAL_GARMENT_ID);
    assert.equal(garment.isSkinnedMesh, true);
    assert.equal(garment.skeleton, body.skeleton);
    assert.ok(garment.geometry.getAttribute("skinIndex"));
    assert.ok(garment.geometry.getAttribute("skinWeight"));
    assert.ok(garment.geometry.getAttribute("normal"));
    assert.equal(garment.geometry.getAttribute("color").count,
      garment.geometry.getAttribute("position").count);
    assert.ok(garment.userData.quaterniusConformalMetrics.triangles >= 42);
    assert.ok(garment.userData.quaterniusConformalMetrics.triangles <= QUATERNIUS_GARMENT_MAX_TRIANGLES);
    assert.ok(garment.userData.quaterniusConformalMetrics.coverage < .5);
    assert.ok(garment.userData.quaterniusConformalMetrics.offset > 0);
    assert.equal(buildQuaterniusConformalGarment(body, FIGHTER_DEFINITIONS.red), null,
      "never create a second garment on the same body");
  } finally {
    disposeQuaterniusConformalGarments(root);
    body.geometry.dispose();
    (body.material as THREE.Material).dispose();
  }
});

test("unskinned meshes fail closed rather than introduce floating stand-in panels", () => {
  const { root, body } = fixture();
  body.geometry.deleteAttribute("skinWeight");
  try {
    assert.equal(buildQuaterniusConformalGarment(body, FIGHTER_DEFINITIONS.blue), null);
  } finally {
    body.geometry.dispose();
    (body.material as THREE.Material).dispose();
    root.clear();
  }
});
