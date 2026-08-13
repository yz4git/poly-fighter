import * as THREE from "three";
import type { FighterVisual } from "./visual";
import type { V10Semantic, V10SkinRegion } from "./visual-v10";

const PALETTE: Record<Exclude<V10Semantic, "unknown">, THREE.Color> = {
  skin: new THREE.Color(0xd7a38a),
  blue: new THREE.Color(0x387ad3),
  black: new THREE.Color(0x0d0e16),
  silver: new THREE.Color(0x9fadc2),
};

const FRAGMENTS = new WeakMap<FighterVisual, THREE.Mesh[]>();

type FragmentBucket = {
  boneIndex: number;
  region: V10SkinRegion;
  positions: number[];
  colors: number[];
};

function semanticFromRgb(r: number, g: number, b: number): Exclude<V10Semantic, "unknown"> {
  const value = (r + g + b) / 3;
  if (value < 0.26) return "black";
  if (b > r * 1.12 && b > g * 1.08 && b > 0.24) return "blue";
  if (r > b * 1.12 && r > g * 1.03) return "skin";
  if (b > 0.48 && r < 0.52) return "blue";
  return "silver";
}

function resolvedSemantic(
  region: V10SkinRegion,
  semantic: Exclude<V10Semantic, "unknown">,
  y: number,
  r: number,
  g: number,
  b: number,
): Exclude<V10Semantic, "unknown"> {
  if (region === "HEAD") return semantic === "silver" ? "skin" : semantic;
  if (region.endsWith("_HAND")) return semantic === "black" ? "black" : "skin";
  if (region.endsWith("_FOREARM")) return semantic === "silver" ? "silver" : "black";
  if (region.endsWith("_UPPER_ARM")) {
    if (semantic === "skin" && y > 0.735) return "skin";
    return semantic === "silver" ? "black" : semantic === "blue" ? "black" : semantic;
  }
  if (region === "HIPS") {
    if (semantic === "skin" || semantic === "silver") return b > r * 1.03 ? "blue" : "black";
    return semantic;
  }
  if (region === "TORSO") {
    if (y < 0.748 && semantic === "silver") return "skin";
    if (semantic === "silver") return "blue";
    return semantic;
  }
  if (region.endsWith("_SHIN") || region.endsWith("_FOOT")) {
    if (semantic === "skin" || semantic === "silver") return b > r * 1.02 ? "blue" : "black";
    return semantic;
  }
  if (region.endsWith("_THIGH") && semantic === "silver") return b > r * 1.03 ? "blue" : "black";
  return semantic;
}

export function classifyV103FaceRegion(
  x: number,
  y: number,
  z: number,
  semantic: Exclude<V10Semantic, "unknown">,
): V10SkinRegion {
  const side = x < 0 ? "LEFT" : "RIGHT";
  const absX = Math.abs(x);

  const ponytail = y > 0.665 && z < -0.080 && absX < 0.175;
  if (y >= 0.830 || ponytail) return "HEAD";

  if (y >= 0.405 && y < 0.515 && absX > 0.100) {
    const handMaterial = semantic === "skin" || semantic === "silver" || (semantic === "black" && absX > 0.165);
    if (handMaterial) return `${side}_HAND` as V10SkinRegion;
  }
  if (y >= 0.485 && y < 0.625 && absX > 0.092) {
    const lowerArmMaterial = semantic === "skin" || semantic === "silver" || (semantic === "black" && absX > 0.145);
    if (lowerArmMaterial) return `${side}_FOREARM` as V10SkinRegion;
  }
  if (y >= 0.625) {
    const threshold = y >= 0.720 ? 0.060 : 0.074;
    if (absX > threshold) {
      return y >= 0.675
        ? `${side}_UPPER_ARM` as V10SkinRegion
        : `${side}_FOREARM` as V10SkinRegion;
    }
  }

  if (y < 0.105) return `${side}_FOOT` as V10SkinRegion;
  if (y < 0.320) return `${side}_SHIN` as V10SkinRegion;
  if (y < 0.545) return `${side}_THIGH` as V10SkinRegion;

  if (y < 0.690) return "HIPS";
  return "TORSO";
}

function ownerBoneIndex(region: V10SkinRegion, y: number, visual: FighterVisual): number {
  const b = visual.rig.boneIndices;
  switch (region) {
    case "HEAD": return b.head;
    case "HIPS": return b.hips;
    case "TORSO": return y < 0.748 ? b.spineLower : y < 0.815 ? b.spineUpper : b.chest;
    case "LEFT_UPPER_ARM": return b.leftUpperArm;
    case "RIGHT_UPPER_ARM": return b.rightUpperArm;
    case "LEFT_FOREARM": return b.leftForearm;
    case "RIGHT_FOREARM": return b.rightForearm;
    case "LEFT_HAND": return b.leftHand;
    case "RIGHT_HAND": return b.rightHand;
    case "LEFT_THIGH": return b.leftThigh;
    case "RIGHT_THIGH": return b.rightThigh;
    case "LEFT_SHIN": return b.leftShin;
    case "RIGHT_SHIN": return b.rightShin;
    case "LEFT_FOOT": return b.leftFoot;
    case "RIGHT_FOOT": return b.rightFoot;
  }
}

function shadedFacetColor(base: THREE.Color, sourceValue: number): THREE.Color {
  const factor = THREE.MathUtils.clamp(0.72 + sourceValue * 0.46, 0.72, 1.08);
  return base.clone().multiplyScalar(factor);
}

function bucketKey(region: V10SkinRegion, boneIndex: number): string {
  return `${region}:${boneIndex}`;
}

function transformNormalizedGeometryToBoneLocal(
  geometry: THREE.BufferGeometry,
  visual: FighterVisual,
  boneIndex: number,
): THREE.BufferGeometry {
  const boneInverse = visual.rig.skeleton.boneInverses[boneIndex];
  if (!boneInverse) return geometry;
  geometry.applyMatrix4(boneInverse.clone().multiply(visual.bodyMesh.bindMatrix));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addHeadMesh(
  visual: FighterVisual,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  meshes: THREE.Mesh[],
): THREE.Mesh {
  const headIndex = visual.rig.boneIndices.head;
  transformNormalizedGeometryToBoneLocal(geometry, visual, headIndex);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.userData.v10ReferenceHead = true;
  visual.rig.bones.head.add(mesh);
  meshes.push(mesh);
  return mesh;
}

function createReferenceFaceGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const y0 = position.getY(i);
    const lower = THREE.MathUtils.clamp((-y0 + 0.05) / 1.05, 0, 1);
    const upper = THREE.MathUtils.clamp((y0 + 0.15) / 1.15, 0, 1);
    const xScale = 0.067 * (1 - lower * 0.24 + upper * 0.04);
    const y = 0.922 + y0 * 0.084;
    const z = 0.016 + position.getZ(i) * 0.061 + lower * 0.006;
    position.setXYZ(i, position.getX(i) * xScale, y, z);
  }
  position.needsUpdate = true;
  geometry.deleteAttribute("normal");
  geometry.computeVertexNormals();
  return geometry;
}

function createTrianglePatch(points: Array<readonly [number, number, number]>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addReferenceHead(visual: FighterVisual, meshes: THREE.Mesh[]): void {
  const skinMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.skin, toneMapped: false, side: THREE.DoubleSide });
  const hairMaterial = new THREE.MeshBasicMaterial({ color: 0x14131a, toneMapped: false, side: THREE.DoubleSide });
  const darkHairMaterial = new THREE.MeshBasicMaterial({ color: 0x090a0f, toneMapped: false, side: THREE.DoubleSide });
  const blueMaterial = new THREE.MeshBasicMaterial({ color: 0x294fc7, toneMapped: false, side: THREE.DoubleSide });
  const featureMaterial = new THREE.MeshBasicMaterial({ color: 0x161015, toneMapped: false, side: THREE.DoubleSide });
  const lipMaterial = new THREE.MeshBasicMaterial({ color: 0x6c3635, toneMapped: false, side: THREE.DoubleSide });

  addHeadMesh(visual, createReferenceFaceGeometry(), skinMaterial, "v10-4-reference-face", meshes);

  const hairCap = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.68);
  hairCap.scale(0.074, 0.078, 0.068);
  hairCap.translate(0, 0.962, 0.001);
  addHeadMesh(visual, hairCap, hairMaterial, "v10-4-reference-hair-cap", meshes);

  const nose = createTrianglePatch([
    [-0.012, 0.927, 0.070],
    [0.012, 0.927, 0.070],
    [0.000, 0.905, 0.088],
    [-0.012, 0.927, 0.070],
    [0.000, 0.950, 0.066],
    [0.000, 0.905, 0.088],
    [0.012, 0.927, 0.070],
    [0.000, 0.905, 0.088],
    [0.000, 0.950, 0.066],
  ]);
  addHeadMesh(visual, nose, skinMaterial, "v10-4-reference-nose", meshes);

  const leftEye = createTrianglePatch([
    [-0.047, 0.940, 0.072], [-0.014, 0.940, 0.075], [-0.030, 0.928, 0.077],
    [-0.047, 0.940, 0.072], [-0.029, 0.948, 0.075], [-0.014, 0.940, 0.075],
  ]);
  const rightEye = createTrianglePatch([
    [0.014, 0.940, 0.075], [0.047, 0.940, 0.072], [0.030, 0.928, 0.077],
    [0.014, 0.940, 0.075], [0.029, 0.948, 0.075], [0.047, 0.940, 0.072],
  ]);
  addHeadMesh(visual, leftEye, featureMaterial, "v10-4-reference-left-eye", meshes);
  addHeadMesh(visual, rightEye, featureMaterial, "v10-4-reference-right-eye", meshes);

  const brows = createTrianglePatch([
    [-0.050, 0.958, 0.070], [-0.015, 0.954, 0.074], [-0.016, 0.960, 0.073],
    [0.015, 0.954, 0.074], [0.050, 0.958, 0.070], [0.016, 0.960, 0.073],
  ]);
  addHeadMesh(visual, brows, featureMaterial, "v10-4-reference-brows", meshes);

  const lips = createTrianglePatch([
    [-0.018, 0.892, 0.072], [0.018, 0.892, 0.072], [0.000, 0.886, 0.078],
    [-0.018, 0.892, 0.072], [0.000, 0.898, 0.077], [0.018, 0.892, 0.072],
  ]);
  addHeadMesh(visual, lips, lipMaterial, "v10-4-reference-lips", meshes);

  const fringePatches = [
    [[-0.061, 0.982, 0.050], [-0.015, 1.004, 0.053], [-0.030, 0.944, 0.078]],
    [[-0.015, 1.004, 0.053], [0.028, 1.000, 0.054], [0.006, 0.943, 0.079]],
    [[0.028, 1.000, 0.054], [0.061, 0.980, 0.050], [0.036, 0.947, 0.076]],
  ] as const;
  for (const [index, patch] of fringePatches.entries()) {
    addHeadMesh(visual, createTrianglePatch([...patch]), darkHairMaterial, `v10-4-reference-fringe-${index}`, meshes);
  }

  const sideLocks = [
    createTrianglePatch([[-0.062, 0.979, 0.032], [-0.067, 0.902, 0.055], [-0.045, 0.936, 0.074]]),
    createTrianglePatch([[0.062, 0.979, 0.032], [0.067, 0.902, 0.055], [0.045, 0.936, 0.074]]),
  ];
  addHeadMesh(visual, sideLocks[0], darkHairMaterial, "v10-4-reference-left-lock", meshes);
  addHeadMesh(visual, sideLocks[1], darkHairMaterial, "v10-4-reference-right-lock", meshes);

  const tie = new THREE.CylinderGeometry(0.024, 0.024, 0.020, 8, 1, false);
  tie.rotateX(Math.PI / 2);
  tie.translate(0, 1.006, -0.058);
  addHeadMesh(visual, tie, blueMaterial, "v10-4-reference-ponytail-tie", meshes);

  const ponytailPoints = [
    new THREE.Vector3(0, 1.008, -0.070),
    new THREE.Vector3(0.008, 0.955, -0.126),
    new THREE.Vector3(0.012, 0.875, -0.155),
    new THREE.Vector3(0.008, 0.790, -0.165),
    new THREE.Vector3(0.002, 0.715, -0.148),
  ];
  const radii = [0.045, 0.050, 0.045, 0.034];
  for (let i = 0; i < ponytailPoints.length - 1; i += 1) {
    const start = ponytailPoints[i];
    const end = ponytailPoints[i + 1];
    const direction = end.clone().sub(start);
    const length = direction.length();
    const geometry = new THREE.CylinderGeometry(radii[i] * 0.72, radii[i], length, 6, 1, false);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
    geometry.translate((start.x + end.x) * 0.5, (start.y + end.y) * 0.5, (start.z + end.z) * 0.5);
    addHeadMesh(visual, geometry, i > 1 ? darkHairMaterial : hairMaterial, `v10-4-reference-ponytail-${i}`, meshes);
  }

  visual.root.userData.v10HeadReference = "V10.4_FRONT_3Q_SIDE_HAIR";
}

function addUnderbodySegment(
  parent: THREE.Bone,
  child: THREE.Bone,
  parentRadius: number,
  childRadius: number,
  material: THREE.Material,
  meshes: THREE.Mesh[],
): void {
  const direction = child.position.clone();
  const length = direction.length();
  if (!Number.isFinite(length) || length < 1e-4) return;
  const geometry = new THREE.CylinderGeometry(parentRadius, childRadius, length, 6, 1, false);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  geometry.applyQuaternion(rotation);
  geometry.translate(direction.x * 0.5, direction.y * 0.5, direction.z * 0.5);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `v10-3-underbody-${parent.name}-${child.name}`;
  mesh.frustumCulled = false;
  mesh.userData.v10Underbody = true;
  parent.add(mesh);
  meshes.push(mesh);
}

function addUnderbodyJoint(
  bone: THREE.Bone,
  radius: number,
  material: THREE.Material,
  meshes: THREE.Mesh[],
): void {
  const geometry = new THREE.SphereGeometry(radius, 6, 4);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `v10-3-underbody-joint-${bone.name}`;
  mesh.frustumCulled = false;
  mesh.userData.v10Underbody = true;
  bone.add(mesh);
  meshes.push(mesh);
}

function installArticulationUnderbody(visual: FighterVisual, meshes: THREE.Mesh[]): void {
  const b = visual.rig.bones;
  const material = new THREE.MeshBasicMaterial({ color: 0x0b0c15, toneMapped: false });

  addUnderbodySegment(b.chest, b.leftShoulder, 0.038, 0.038, material, meshes);
  addUnderbodySegment(b.chest, b.rightShoulder, 0.038, 0.038, material, meshes);
  addUnderbodySegment(b.leftShoulder, b.leftUpperArm, 0.040, 0.038, material, meshes);
  addUnderbodySegment(b.rightShoulder, b.rightUpperArm, 0.040, 0.038, material, meshes);
  addUnderbodySegment(b.leftUpperArm, b.leftForearm, 0.038, 0.032, material, meshes);
  addUnderbodySegment(b.rightUpperArm, b.rightForearm, 0.038, 0.032, material, meshes);
  addUnderbodySegment(b.leftForearm, b.leftHand, 0.032, 0.026, material, meshes);
  addUnderbodySegment(b.rightForearm, b.rightHand, 0.032, 0.026, material, meshes);

  addUnderbodySegment(b.hips, b.leftThigh, 0.055, 0.052, material, meshes);
  addUnderbodySegment(b.hips, b.rightThigh, 0.055, 0.052, material, meshes);
  addUnderbodySegment(b.leftThigh, b.leftShin, 0.052, 0.043, material, meshes);
  addUnderbodySegment(b.rightThigh, b.rightShin, 0.052, 0.043, material, meshes);
  addUnderbodySegment(b.leftShin, b.leftFoot, 0.043, 0.034, material, meshes);
  addUnderbodySegment(b.rightShin, b.rightFoot, 0.043, 0.034, material, meshes);

  addUnderbodyJoint(b.leftShoulder, 0.043, material, meshes);
  addUnderbodyJoint(b.rightShoulder, 0.043, material, meshes);
  addUnderbodyJoint(b.leftUpperArm, 0.042, material, meshes);
  addUnderbodyJoint(b.rightUpperArm, 0.042, material, meshes);
  addUnderbodyJoint(b.leftForearm, 0.035, material, meshes);
  addUnderbodyJoint(b.rightForearm, 0.035, material, meshes);
  addUnderbodyJoint(b.leftHand, 0.027, material, meshes);
  addUnderbodyJoint(b.rightHand, 0.027, material, meshes);
  addUnderbodyJoint(b.leftThigh, 0.058, material, meshes);
  addUnderbodyJoint(b.rightThigh, 0.058, material, meshes);
  addUnderbodyJoint(b.leftShin, 0.047, material, meshes);
  addUnderbodyJoint(b.rightShin, 0.047, material, meshes);
  addUnderbodyJoint(b.leftFoot, 0.036, material, meshes);
  addUnderbodyJoint(b.rightFoot, 0.036, material, meshes);
}

function installBoneParentedFragments(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (FRAGMENTS.has(visual)) return;

  const source = visual.bodyMesh.geometry.index
    ? visual.bodyMesh.geometry.toNonIndexed()
    : visual.bodyMesh.geometry.clone();
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const color = source.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!color || position.count % 3 !== 0) {
    source.dispose();
    return;
  }

  const buckets = new Map<string, FragmentBucket>();
  const regionCounts: Partial<Record<V10SkinRegion, number>> = {};

  for (let base = 0; base < position.count; base += 3) {
    let x = 0;
    let y = 0;
    let z = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let offset = 0; offset < 3; offset += 1) {
      const vertex = base + offset;
      x += position.getX(vertex);
      y += position.getY(vertex);
      z += position.getZ(vertex);
      r += color.getX(vertex);
      g += color.getY(vertex);
      b += color.getZ(vertex);
    }
    x /= 3;
    y /= 3;
    z /= 3;
    r /= 3;
    g /= 3;
    b /= 3;

    const sourceSemantic = semanticFromRgb(r, g, b);
    const region = classifyV103FaceRegion(x, y, z, sourceSemantic);
    if (region === "HEAD") continue;
    const boneIndex = ownerBoneIndex(region, y, visual);
    const key = bucketKey(region, boneIndex);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { boneIndex, region, positions: [], colors: [] };
      buckets.set(key, bucket);
    }
    regionCounts[region] = (regionCounts[region] ?? 0) + 1;

    const semantic = resolvedSemantic(region, sourceSemantic, y, r, g, b);
    const target = shadedFacetColor(PALETTE[semantic], (r + g + b) / 3);
    for (let offset = 0; offset < 3; offset += 1) {
      const vertex = base + offset;
      bucket.positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      bucket.colors.push(target.r, target.g, target.b);
    }
  }

  const fragments: THREE.Mesh[] = [];
  const skeleton = visual.rig.skeleton;
  const bindMatrix = visual.bodyMesh.bindMatrix;

  for (const [key, bucket] of buckets) {
    const bone = skeleton.bones[bucket.boneIndex];
    const boneInverse = skeleton.boneInverses[bucket.boneIndex];
    if (!bone || !boneInverse || bucket.positions.length === 0) continue;

    const toBoneLocal = boneInverse.clone().multiply(bindMatrix);
    const transformed = new Float32Array(bucket.positions.length);
    const point = new THREE.Vector3();
    for (let i = 0; i < bucket.positions.length; i += 3) {
      point.set(bucket.positions[i], bucket.positions[i + 1], bucket.positions[i + 2]).applyMatrix4(toBoneLocal);
      transformed[i] = point.x;
      transformed[i + 1] = point.y;
      transformed[i + 2] = point.z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(transformed, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.v10FragmentRegion = bucket.region;
    geometry.userData.v10FragmentBoneIndex = bucket.boneIndex;

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `v10-4-fragment-${key.replace(/:/g, "-")}`;
    mesh.frustumCulled = false;
    mesh.userData.v10FragmentRegion = bucket.region;
    mesh.userData.v10FragmentBoneIndex = bucket.boneIndex;
    bone.add(mesh);
    fragments.push(mesh);
  }

  addReferenceHead(visual, fragments);
  installArticulationUnderbody(visual, fragments);
  source.dispose();
  visual.bodyMesh.visible = false;
  visual.bodyMesh.userData.v10PresentationMode = "BONE_PARENTED_FRAGMENT_SOURCE_HIDDEN";
  visual.root.userData.skinningPresentation = "V10.4_BONE_PARENTED_FRAGMENTS_WITH_REFERENCE_HEAD";
  visual.root.userData.colorPipeline = "V10.4_ANATOMY_AWARE_REFERENCE_COLORS";
  visual.root.userData.v10FragmentCount = fragments.length;
  visual.root.userData.v10RegionCounts = regionCounts;
  visual.root.userData.v10ArticulationAudit = "PIXEL_GATED_READY";
  visual.root.userData.v10PresentationRelease = "V10.4";
  visual.stats.meshCount = fragments.length;
  visual.stats.materialCount = fragments.length;
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = position.count / 3;
  visual.stats.weightedVertexCount = 0;
  FRAGMENTS.set(visual, fragments);
}

export function applyV10RuntimePolish(visual: FighterVisual): FighterVisual {
  visual.footContacts.left.homeLocal.z = -0.100;
  visual.footContacts.right.homeLocal.z = 0.110;
  visual.root.userData.authoredNeutralStance = "V10.4_REFERENCE_MATCH";

  const previousBeforeRender = visual.bodyMesh.onBeforeRender;
  visual.bodyMesh.onBeforeRender = function onBeforeRender(...args): void {
    installBoneParentedFragments(visual);
    previousBeforeRender?.apply(this, args);
  };
  return visual;
}
