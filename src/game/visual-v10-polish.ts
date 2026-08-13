import * as THREE from "three";
import type { FighterVisual } from "./visual";
import type { V10Semantic } from "./visual-v10";

type ComponentName = "BODY" | "LEFT_ARM" | "RIGHT_ARM" | "LEFT_LEG" | "RIGHT_LEG";
type PartitionState = {
  neutralGeometry: THREE.BufferGeometry;
  bodyGeometry: THREE.BufferGeometry;
  limbMeshes: THREE.SkinnedMesh[];
  mode: "neutral" | "dynamic";
};
type FaceSample = {
  x: number;
  y: number;
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  spanX: number;
  semantic: Exclude<V10Semantic, "unknown">;
  sourceValue: number;
};

const PARTITIONS = new WeakMap<FighterVisual, PartitionState>();
const PALETTE: Record<Exclude<V10Semantic, "unknown">, THREE.Color> = {
  skin: new THREE.Color(0xd3a184),
  blue: new THREE.Color(0x2452c5),
  black: new THREE.Color(0x0e0e16),
  silver: new THREE.Color(0xb9c3d0),
};

function semanticFromRgb(r: number, g: number, b: number): Exclude<V10Semantic, "unknown"> {
  const value = (r + g + b) / 3;
  if (value < 0.26) return "black";
  if (b > r * 1.12 && b > g * 1.08 && b > 0.24) return "blue";
  if (r > b * 1.12 && r > g * 1.03) return "skin";
  if (b > 0.48 && r < 0.52) return "blue";
  return "silver";
}

function resolvedSemantic(sample: FaceSample): Exclude<V10Semantic, "unknown"> {
  const { semantic, x, y } = sample;
  const absX = Math.abs(x);
  if (y > 0.835 && semantic === "silver") return "skin";
  if (semantic !== "silver") return semantic;

  // Silver is intentional on SERA's forearm guards. Bright pixels elsewhere
  // in the reconstructed hull are mostly antialiased skin/blue edges and must
  // not turn the abdomen, skirt or boots into white plates.
  if (y > 0.47 && y < 0.66 && absX > 0.115) return "silver";
  if (y > 0.62 && y < 0.76 && absX < 0.13) return "skin";
  if (y < 0.46) return "blue";
  return "blue";
}

function shadedColor(semantic: Exclude<V10Semantic, "unknown">, sourceValue: number): THREE.Color {
  const factor = THREE.MathUtils.clamp(0.78 + sourceValue * 0.42, 0.78, 1.10);
  return PALETTE[semantic].clone().multiplyScalar(factor);
}

function sampleFace(position: THREE.BufferAttribute, color: THREE.BufferAttribute, base: number): FaceSample {
  let x = 0;
  let y = 0;
  let z = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset < 3; offset += 1) {
    const vertex = base + offset;
    const px = position.getX(vertex);
    const py = position.getY(vertex);
    x += px;
    y += py;
    z += position.getZ(vertex);
    r += color.getX(vertex);
    g += color.getY(vertex);
    b += color.getZ(vertex);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  x /= 3;
  y /= 3;
  z /= 3;
  r /= 3;
  g /= 3;
  b /= 3;
  return {
    x,
    y,
    z,
    minX,
    maxX,
    minY,
    maxY,
    spanX: maxX - minX,
    semantic: semanticFromRgb(r, g, b),
    sourceValue: (r + g + b) / 3,
  };
}

function componentForFace(sample: FaceSample): ComponentName {
  const { x, y, minX, maxX, minY, maxY, spanX, semantic } = sample;

  // Only faces whose complete triangle sits outside the torso core are allowed
  // to follow an arm. This deliberately leaves a small static shoulder overlap
  // so the visual-hull's fused shoulder topology cannot become a screen-sized
  // fan when combat IK rotates an upper arm.
  const rightArm = minX > 0.108 && maxY < 0.835 && minY > 0.420 && spanX < 0.115;
  const leftArm = maxX < -0.108 && maxY < 0.835 && minY > 0.420 && spanX < 0.115;
  const armSemantic = semantic === "skin" || semantic === "silver" || semantic === "black" || (semantic === "blue" && y > 0.655);
  if (armSemantic && leftArm) return "LEFT_ARM";
  if (armSemantic && rightArm) return "RIGHT_ARM";

  // Lower legs/boots are cleanly separated in the turnaround. Thighs sit under
  // skirt panels, so the upper leg gate is stricter and excludes broad blue
  // costume panels from the articulated component.
  if (maxY < 0.435) {
    if (maxX < -0.012 && spanX < 0.115) return "LEFT_LEG";
    if (minX > 0.012 && spanX < 0.115) return "RIGHT_LEG";
  } else if (maxY < 0.595 && minY > 0.405 && semantic !== "blue") {
    if (maxX < -0.020 && spanX < 0.090) return "LEFT_LEG";
    if (minX > 0.020 && spanX < 0.090) return "RIGHT_LEG";
  }

  return "BODY";
}

function limbBone(component: Exclude<ComponentName, "BODY">, y: number, visual: FighterVisual): number {
  const b = visual.rig.boneIndices;
  if (component === "LEFT_ARM" || component === "RIGHT_ARM") {
    const prefix = component === "LEFT_ARM" ? "left" : "right";
    if (y > 0.655) return b[`${prefix}UpperArm`];
    if (y > 0.490) return b[`${prefix}Forearm`];
    return b[`${prefix}Hand`];
  }
  const prefix = component === "LEFT_LEG" ? "left" : "right";
  if (y < 0.082) return b[`${prefix}Foot`];
  if (y < 0.300) return b[`${prefix}Shin`];
  return b[`${prefix}Thigh`];
}

function appendFace(
  targetPositions: number[],
  targetColors: number[],
  targetSkinIndices: number[],
  targetSkinWeights: number[],
  position: THREE.BufferAttribute,
  color: THREE.BufferAttribute,
  base: number,
  outputColor: THREE.Color,
  bone: number,
): void {
  for (let offset = 0; offset < 3; offset += 1) {
    const vertex = base + offset;
    targetPositions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    targetColors.push(outputColor.r, outputColor.g, outputColor.b);
    targetSkinIndices.push(bone, 0, 0, 0);
    targetSkinWeights.push(1, 0, 0, 0);
  }
}

function buildGeometry(
  positions: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  label: string,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.v10Component = label;
  return geometry;
}

function installPartitionedCharacter(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (PARTITIONS.has(visual)) return;

  const source = visual.bodyMesh.geometry;
  const flat = source.index ? source.toNonIndexed() : source.clone();
  const position = flat.getAttribute("position") as THREE.BufferAttribute;
  const color = flat.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!color || position.count % 3 !== 0) {
    flat.dispose();
    return;
  }

  const components: Record<ComponentName, { p: number[]; c: number[]; i: number[]; w: number[]; faces: number }> = {
    BODY: { p: [], c: [], i: [], w: [], faces: 0 },
    LEFT_ARM: { p: [], c: [], i: [], w: [], faces: 0 },
    RIGHT_ARM: { p: [], c: [], i: [], w: [], faces: 0 },
    LEFT_LEG: { p: [], c: [], i: [], w: [], faces: 0 },
    RIGHT_LEG: { p: [], c: [], i: [], w: [], faces: 0 },
  };
  const neutral = { p: [] as number[], c: [] as number[], i: [] as number[], w: [] as number[] };
  const rootBone = visual.rig.boneIndices.root;

  for (let base = 0; base < position.count; base += 3) {
    const sample = sampleFace(position, color, base);
    const semantic = resolvedSemantic(sample);
    const outputColor = shadedColor(semantic, sample.sourceValue);
    const component = componentForFace(sample);
    const bucket = components[component];
    const bone = component === "BODY" ? rootBone : limbBone(component, sample.y, visual);
    appendFace(bucket.p, bucket.c, bucket.i, bucket.w, position, color, base, outputColor, bone);
    bucket.faces += 1;
    appendFace(neutral.p, neutral.c, neutral.i, neutral.w, position, color, base, outputColor, rootBone);
  }

  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  const neutralGeometry = buildGeometry(neutral.p, neutral.c, neutral.i, neutral.w, "NEUTRAL_FULL_SHELL");
  const bodyGeometry = buildGeometry(components.BODY.p, components.BODY.c, components.BODY.i, components.BODY.w, "BODY_CORE");
  const oldMaterial = visual.bodyMesh.material;
  visual.bodyMesh.geometry = neutralGeometry;
  visual.bodyMesh.material = material;
  visual.bodyMesh.normalizeSkinWeights();
  if (Array.isArray(oldMaterial)) oldMaterial.forEach((entry) => entry.dispose());
  else oldMaterial.dispose();

  const limbMeshes: THREE.SkinnedMesh[] = [];
  for (const component of ["LEFT_ARM", "RIGHT_ARM", "LEFT_LEG", "RIGHT_LEG"] as const) {
    const bucket = components[component];
    const geometry = buildGeometry(bucket.p, bucket.c, bucket.i, bucket.w, component);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `v10-2-${component.toLowerCase().replaceAll("_", "-")}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.userData.v10ArticulatedComponent = component;
    visual.root.add(mesh);
    visual.root.updateMatrixWorld(true);
    mesh.bind(visual.rig.skeleton, visual.bodyMesh.bindMatrix.clone());
    mesh.normalizeSkinWeights();
    limbMeshes.push(mesh);
    visual.allMeshes.push(mesh);
  }

  source.dispose();
  flat.dispose();
  PARTITIONS.set(visual, { neutralGeometry, bodyGeometry, limbMeshes, mode: "neutral" });
  visual.root.userData.skinningPresentation = "V10.2_PARTITIONED_COMPONENT_RIG";
  visual.root.userData.colorPipeline = "V10.2_SHADED_REFERENCE_VERTEX_COLOR";
  visual.root.userData.componentFaceCounts = Object.fromEntries(Object.entries(components).map(([name, value]) => [name, value.faces]));
  visual.stats.vertexCount = position.count;
  visual.stats.triangleCount = position.count / 3;
  visual.stats.meshCount = 1 + limbMeshes.length;
  visual.stats.weightedVertexCount = position.count;
}

function neutralUpperBody(visual: FighterVisual): boolean {
  const bones = visual.rig.bones;
  const quaternions = [
    bones.spineLower.quaternion,
    bones.spineUpper.quaternion,
    bones.chest.quaternion,
    bones.leftUpperArm.quaternion,
    bones.rightUpperArm.quaternion,
    bones.leftForearm.quaternion,
    bones.rightForearm.quaternion,
  ];
  return quaternions.every((quaternion) => {
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(quaternion.w), 0, 1));
    return angle < 0.035;
  });
}

function selectPresentationMode(visual: FighterVisual): void {
  const partition = PARTITIONS.get(visual);
  if (!partition) return;
  const neutral = neutralUpperBody(visual);
  const desired = neutral ? "neutral" : "dynamic";
  if (partition.mode !== desired) {
    visual.bodyMesh.geometry = neutral ? partition.neutralGeometry : partition.bodyGeometry;
    partition.limbMeshes.forEach((mesh) => { mesh.visible = !neutral; });
    partition.mode = desired;
  }
  visual.bodyMesh.rotation.y = neutral ? 0.14 : 0;
  visual.bodyMesh.userData.v10PresentationMode = neutral ? "COHERENT_NEUTRAL_SHELL" : "PARTITIONED_ARTICULATION";
}

/**
 * V10.2 final presentation layer.
 *
 * The source visual hull remains one honest four-view reconstruction in neutral
 * frames. During articulation, only high-confidence limb triangles are moved;
 * the torso/shoulder/skirt core stays on the fighter root. This prevents the
 * fused visual-hull topology from ever pulling a torso or skirt polygon across
 * the arena while still allowing guard, punch and kick silhouettes to animate.
 */
export function applyV10RuntimePolish(visual: FighterVisual): FighterVisual {
  visual.footContacts.left.homeLocal.z = -0.095;
  visual.footContacts.right.homeLocal.z = 0.105;
  visual.root.userData.authoredNeutralStance = "V10.2_PARTITIONED_COMPONENT_RIG";

  const previousBeforeRender = visual.bodyMesh.onBeforeRender;
  visual.bodyMesh.onBeforeRender = function onBeforeRender(...args): void {
    installPartitionedCharacter(visual);
    selectPresentationMode(visual);
    previousBeforeRender?.apply(this, args);
  };

  return visual;
}
