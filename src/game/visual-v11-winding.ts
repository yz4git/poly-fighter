import * as THREE from "three";

export type WindingRepairStats = {
  checkedGroups: number;
  reversedGroups: number;
  reversedTriangles: number;
};

function groupOrientationScore(
  geometry: THREE.BufferGeometry,
  group: THREE.Group,
): number {
  const index = geometry.index;
  const position = geometry.getAttribute("position");
  if (!index || !position || group.count < 3) return 0;

  const centroid = new THREE.Vector3();
  let samples = 0;
  for (let offset = group.start; offset < group.start + group.count; offset += 1) {
    const vertex = index.getX(offset);
    centroid.x += position.getX(vertex);
    centroid.y += position.getY(vertex);
    centroid.z += position.getZ(vertex);
    samples += 1;
  }
  if (samples === 0) return 0;
  centroid.multiplyScalar(1 / samples);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const faceCenter = new THREE.Vector3();
  const outward = new THREE.Vector3();
  let score = 0;

  for (let offset = group.start; offset < group.start + group.count; offset += 3) {
    const ia = index.getX(offset);
    const ib = index.getX(offset + 1);
    const ic = index.getX(offset + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    edgeAB.subVectors(b, a);
    edgeAC.subVectors(c, a);
    normal.crossVectors(edgeAB, edgeAC);
    faceCenter.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    outward.subVectors(faceCenter, centroid);
    score += normal.dot(outward);
  }
  return score;
}

/**
 * V9's closed loft/prism primitives were authored with inward triangle winding.
 * Each Builder operation is already isolated in its own geometry group, so we
 * can repair only groups whose aggregate face orientation points inward. This
 * leaves correctly wound groups (notably the open ponytail tube) untouched.
 */
export function repairV11GroupWinding(geometry: THREE.BufferGeometry): WindingRepairStats {
  const index = geometry.index;
  if (!index) return { checkedGroups: 0, reversedGroups: 0, reversedTriangles: 0 };

  let reversedGroups = 0;
  let reversedTriangles = 0;
  for (const group of geometry.groups) {
    const score = groupOrientationScore(geometry, group);
    if (score >= -1e-10) continue;
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const b = index.getX(offset + 1);
      const c = index.getX(offset + 2);
      index.setX(offset + 1, c);
      index.setX(offset + 2, b);
      reversedTriangles += 1;
    }
    reversedGroups += 1;
  }

  index.needsUpdate = true;
  geometry.deleteAttribute("normal");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const stats = { checkedGroups: geometry.groups.length, reversedGroups, reversedTriangles };
  geometry.userData.v11WindingRepair = stats;
  return stats;
}
