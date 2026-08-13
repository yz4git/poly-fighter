import * as THREE from "three";
import type { FighterVisual } from "./visual";

/**
 * Small bind-space corrections derived from the first deployed V9 screenshot.
 * V9 finally had the right character concept, but the hands/forearm guards
 * dominated the silhouette and the head read too small at gameplay scale.
 *
 * This pass edits only the persistent authored geometry. It does not create
 * camera-facing planes, sprites, per-view meshes, or reference-image decals.
 */
export function polishV91Geometry(visual: FighterVisual): FighterVisual {
  const geometry = visual.bodyMesh.geometry;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();
  if (!position || !index) return visual;

  const transformGroup = (
    materialIndex: number,
    predicate: (x: number, y: number, z: number) => boolean,
    transform: (point: THREE.Vector3) => void,
  ): void => {
    const vertices = new Set<number>();
    for (const group of geometry.groups) {
      if (group.materialIndex !== materialIndex) continue;
      const end = Math.min(index.count, group.start + group.count);
      for (let offset = group.start; offset < end; offset += 1) {
        const vertex = index.getX(offset);
        const x = position.getX(vertex);
        const y = position.getY(vertex);
        const z = position.getZ(vertex);
        if (predicate(x, y, z)) vertices.add(vertex);
      }
    }
    const point = new THREE.Vector3();
    for (const vertex of vertices) {
      point.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      transform(point);
      position.setXYZ(vertex, point.x, point.y, point.z);
    }
  };

  // The V9 silver forearm blocks were visually larger than SERA's arms in the
  // deployed fight camera. Preserve the blade-like accent, but make it a trim
  // guard rather than a rectangular shield across the torso.
  transformGroup(
    3,
    (x, y) => y > 0.46 && y < 0.63 && Math.abs(x) > 0.105,
    (point) => {
      const side = Math.sign(point.x) || 1;
      const cx = side * 0.151;
      point.x = cx + (point.x - cx) * 0.70;
      point.y = 0.548 + (point.y - 0.548) * 0.78;
      point.z = 0.026 + (point.z - 0.036) * 0.62;
    },
  );

  // The black hand blocks also read as oversized cubes. Keep enough volume for
  // clear punches, but reduce their cross-section so the waist and chest remain
  // visible in neutral/guard poses.
  transformGroup(
    1,
    (x, y) => y > 0.385 && y < 0.490 && Math.abs(x) > 0.115,
    (point) => {
      const side = Math.sign(point.x) || 1;
      const cx = side * 0.155;
      point.x = cx + (point.x - cx) * 0.74;
      point.y = 0.438 + (point.y - 0.438) * 0.84;
      point.z = 0.026 + (point.z - 0.030) * 0.70;
    },
  );

  // Slightly enlarge the face/crown mass. The turnaround has a strong angular
  // head silhouette, while deployed V9 looked pin-headed beside the torso.
  const headBone = visual.rig.boneIndices.head;
  const skinIndex = geometry.getAttribute("skinIndex") as THREE.BufferAttribute | undefined;
  const skinWeight = geometry.getAttribute("skinWeight") as THREE.BufferAttribute | undefined;
  if (skinIndex && skinWeight) {
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      let headInfluence = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        if (skinIndex.getComponent(vertex, slot) === headBone) headInfluence += skinWeight.getComponent(vertex, slot);
      }
      const y = position.getY(vertex);
      if (headInfluence < 0.72 || y < 0.855) continue;
      const x = position.getX(vertex);
      const z = position.getZ(vertex);
      // Do not inflate the hanging ponytail; only crown/face vertices reach
      // this high-Y range. The extra front projection helps the nose/chin read.
      position.setX(vertex, x * 1.065);
      position.setZ(vertex, 0.004 + (z - 0.004) * 1.045 + (z > 0.055 ? 0.006 : 0));
    }
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.screenMatchPolish = "V9.1";
  visual.root.userData.screenMatchPolish = "V9.1";
  return visual;
}
