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

  // The legs overlap in several reference views, so a centre split is the
  // most deterministic way to guarantee that either leg can articulate.
  if (y < 0.105) return `${side}_FOOT` as V10SkinRegion;
  if (y < 0.320) return `${side}_SHIN` as V10SkinRegion;
  if (y < 0.545) return `${side}_THIGH` as V10SkinRegion;

  // Arm ownership is deliberately generous above the waist. The lower gates
  // retain semantic checks so blue/black skirt panels stay on the hips.
  if (y >= 0.625) {
    const threshold = y >= 0.720 ? 0.060 : 0.074;
    if (absX > threshold) {
      return y >= 0.675
        ? `${side}_UPPER_ARM` as V10SkinRegion
        : `${side}_FOREARM` as V10SkinRegion;
    }
  }
  if (y >= 0.485 && y < 0.625 && absX > 0.092) {
    const lowerArmMaterial = semantic === "skin" || semantic === "silver" || (semantic === "black" && absX > 0.128);
    if (lowerArmMaterial) return `${side}_FOREARM` as V10SkinRegion;
  }
  if (y >= 0.405 && y < 0.515 && absX > 0.100) {
    const handMaterial = semantic === "skin" || semantic === "silver" || semantic === "black";
    if (handMaterial) return `${side}_HAND` as V10SkinRegion;
  }

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

    // Convert original mesh-bind coordinates into the owning bone's bind-local
    // coordinates: boneInverse * meshBind * vertex. Parenting the resulting
    // mesh to that bone then reproduces the neutral shell exactly and follows
    // all runtime IK/animation without relying on ambiguous smooth weights.
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

  source.dispose();
  visual.bodyMesh.visible = false;
  visual.bodyMesh.userData.v10PresentationMode = "BONE_PARENTED_FRAGMENT_SOURCE_HIDDEN";
  visual.root.userData.skinningPresentation = "V10.3_BONE_PARENTED_ANATOMICAL_FRAGMENTS";
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
 * its triangles are rendered as bind-correct bone children after load. This is
 * a deliberate intermediate topology strategy until offline reconstruction can
 * emit independently watertight anatomical parts.
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
