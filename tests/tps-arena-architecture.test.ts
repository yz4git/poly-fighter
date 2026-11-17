import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { TPS_ARENA_RADIUS } from "../src/game/tps-arena-factory";
import {
  TPS_ARCHITECTURE_PROFILE,
  createTpsArenaArchitecture,
  tpsArchitectureBay,
  tpsArchitectureIsOutsideFight,
} from "../src/game/tps-arena-architecture";

test("vault structure has stable authored bay positions safely beyond the fight ring", () => {
  const p = TPS_ARCHITECTURE_PROFILE;
  assert.equal(p.bays, 24);
  assert.ok(p.bayRadius > TPS_ARENA_RADIUS + 4);
  assert.ok(p.crownHeight > 5);
  assert.ok(p.drawGroups <= 7, "limit new mobile GPU draw calls");
  const points = Array.from({ length: p.bays }, (_, i) => tpsArchitectureBay(i));
  assert.ok(points.every(({ x, z, angle }) =>
    [x, z, angle].every(Number.isFinite)
    && tpsArchitectureIsOutsideFight(x, z)
    && Math.abs(Math.hypot(x, z) - p.bayRadius) < 1e-6));
  assert.ok(points.every((point, i) =>
    i === 0 || Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z) > 2.8));
  assert.equal(tpsArchitectureIsOutsideFight(TPS_ARENA_RADIUS, 0), false);
});

test("stadium architecture shares meshes, materials and bounds; does not occlude playfield", () => {
  const result = createTpsArenaArchitecture();
  try {
    const { group, geometries, materials } = result;
    assert.equal(group.userData.tpsArchitectureVersion, TPS_ARCHITECTURE_PROFILE.version);
    assert.equal(group.userData.tpsArchitectureBays, 24);
    assert.equal(group.userData.tpsArchitectureDrawGroups, 7);
    assert.equal(geometries.length, 7);
    assert.equal(materials.length, 7);
    assert.equal(group.children.length, 7);
    const names = group.children.map(c => c.name);
    assert.equal(new Set(names).size, 7);
    const sphere = new THREE.Sphere();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const item of group.children) {
      if (item instanceof THREE.InstancedMesh) {
        assert.ok(item.count <= 48);
        assert.ok(item.geometry.boundingSphere, item.name + " needs a culling bound");
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < item.count; i++) {
          item.getMatrixAt(i, matrix);
          matrix.decompose(position, rotation, scale);
          assert.ok([position.x, position.y, position.z, scale.x, scale.y, scale.z]
            .every(Number.isFinite), item.name + " invalid instance");
          if (item.name === "tps-vault-floor-facets") {
            assert.ok(position.y < .02 && Math.hypot(position.x, position.z) > 4.8);
          } else {
            assert.ok(Math.hypot(position.x, position.z) > TPS_ARENA_RADIUS + 3,
              item.name + " must remain behind fighters");
          }
        }
      } else {
        assert.ok(item instanceof THREE.Mesh);
        assert.ok(item.position.y >= 5, item.name + " overhead roof must not block play");
      }
    }
    // The instance groups are static; a renderer can draw all bays with 1 call
    // per material rather than adding dozens of per-frame draw submissions.
    assert.equal(group.userData.tpsArchitectureDeckCount, 40);
  } finally {
    result.geometries.forEach(x => x.dispose());
    result.materials.forEach(x => x.dispose());
    result.group.clear();
  }
});
