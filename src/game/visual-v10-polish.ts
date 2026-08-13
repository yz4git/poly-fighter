import * as THREE from "three";
import type { FighterVisual } from "./visual";
import type { V10Semantic, V10SkinRegion } from "./visual-v10";

const PALETTE: Record<Exclude<V10Semantic, "unknown">, THREE.Color> = {
  skin: new THREE.Color(0xd3a184),
  blue: new THREE.Color(0x2452c5),
  black: new THREE.Color(0x0e0e16),
  silver: new THREE.Color(0xb9c3d0),
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

/**
 * V10.3 anatomical partition for the turnaround-derived visual hull.
 *
 * The source asset is intentionally one persistent four-view reconstruction.
 * It is not topologically separated at elbows/knees, so conventional smooth
 * skin weights keep too much of the shell visually frozen. We therefore split
 * non-indexed triangles into stable anatomical fragments and parent each
 * fragment directly to its owning bind bone. The bind-space conversion keeps
 * the neutral shell coherent, while a moving hand/foot bone now necessarily
 * moves the visible polygons assigned to that part.
 */
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

  // Detect the lateral arm chain before the coarse lower-body height bands.
  // Hands in the turnaround sit near thigh height, so classifying every face
  // below y=.545 as a leg made hand polygons follow the thigh and disappear
  // from punch/guard articulation. Material and lateral gates keep skirt faces
  // on the hips while recovering true hand/forearm ownership.
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

  // The legs overlap in several reference views, so a centre split is the
  // most deterministic way to guarantee that either leg can articulate.
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
  const factor = THREE.MathUtils.clamp(0.76 + sourceValue * 0.48, 0.76, 1.12);
  return base.clone().multiplyScalar(factor);
}

function bucketKey(region: V10SkinRegion, boneIndex: number): string {
  return `${region}:${boneIndex}`;
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
  const material = new THREE.MeshBasicMaterial({ color: 0x090b13, toneMapped: false });

  addUnderbodySegment(b.leftUpperArm, b.leftForearm, 0.030, 0.024, material, meshes);
  addUnderbodySegment(b.rightUpperArm, b.rightForearm, 0.030, 0.024, material, meshes);
  addUnderbodySegment(b.leftForearm, b.leftHand, 0.024, 0.020, material, meshes);
  addUnderbodySegment(b.rightForearm, b.rightHand, 0.024, 0.020, material, meshes);
  addUnderbodySegment(b.leftThigh, b.leftShin, 0.043, 0.034, material, meshes);
  addUnderbodySegment(b.rightThigh, b.rightShin, 0.043, 0.034, material, meshes);
  addUnderbodySegment(b.leftShin, b.leftFoot, 0.034, 0.026, material, meshes);
  addUnderbodySegment(b.rightShin, b.rightFoot, 0.034, 0.026, material, meshes);

  addUnderbodyJoint(b.leftUpperArm, 0.034, material, meshes);
  addUnderbodyJoint(b.rightUpperArm, 0.034, material, meshes);
  addUnderbodyJoint(b.leftForearm, 0.028, material, meshes);
  addUnderbodyJoint(b.rightForearm, 0.028, material, meshes);
  addUnderbodyJoint(b.leftHand, 0.023, material, meshes);
  addUnderbodyJoint(b.rightHand, 0.023, material, meshes);
  addUnderbodyJoint(b.leftThigh, 0.048, material, meshes);
  addUnderbodyJoint(b.rightThigh, 0.048, material, meshes);
  addUnderbodyJoint(b.leftShin, 0.038, material, meshes);
  addUnderbodyJoint(b.rightShin, 0.038, material, meshes);
  addUnderbodyJoint(b.leftFoot, 0.030, material, meshes);
  addUnderbodyJoint(b.rightFoot, 0.030, material, meshes);
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
    mesh.name = `v10-3-fragment-${key.replace(/:/g, "-")}`;
    mesh.frustumCulled = false;
    mesh.userData.v10FragmentRegion = bucket.region;
    mesh.userData.v10FragmentBoneIndex = bucket.boneIndex;
    bone.add(mesh);
    fragments.push(mesh);
  }

  installArticulationUnderbody(visual, fragments);
  source.dispose();
  visual.bodyMesh.visible = false;
  visual.bodyMesh.userData.v10PresentationMode = "BONE_PARENTED_FRAGMENT_SOURCE_HIDDEN";
  visual.root.userData.skinningPresentation = "V10.3_BONE_PARENTED_FRAGMENTS_WITH_UNDERBODY";
  visual.root.userData.colorPipeline = "V10.3_SHADED_REFERENCE_VERTEX_COLOR";
  visual.root.userData.v10FragmentCount = fragments.length;
  visual.root.userData.v10RegionCounts = regionCounts;
  visual.stats.meshCount = fragments.length;
  visual.stats.materialCount = fragments.length;
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = position.count / 3;
  visual.stats.weightedVertexCount = 0;
  FRAGMENTS.set(visual, fragments);
}

/**
 * V10.3 presentation repair. The GLB remains the single source geometry, but
 * its triangles are rendered as bind-correct bone children after load. A thin
 * faceted underbody sits behind the reference fragments so fast guard/punch/
 * kick poses remain visually continuous instead of opening empty joint gaps.
 */
export function applyV10RuntimePolish(visual: FighterVisual): FighterVisual {
  visual.footContacts.left.homeLocal.z = -0.100;
  visual.footContacts.right.homeLocal.z = 0.110;
  visual.root.userData.authoredNeutralStance = "V10.3_BONE_PARENTED_FRAGMENTS";

  const previousBeforeRender = visual.bodyMesh.onBeforeRender;
  visual.bodyMesh.onBeforeRender = function onBeforeRender(...args): void {
    installBoneParentedFragments(visual);
    previousBeforeRender?.apply(this, args);
  };
  return visual;
}
