import * as THREE from "three";
import type { FighterDefinition } from "./types";
import type { FighterVisual } from "./visual";

export const CHARACTER_CLOTHING_ID = "CHARACTER_CLOTHING_V2";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const FRONT_AXIS = new THREE.Vector3(0, 0, 1);
const BODY_POLL_LIMIT = 240;

type ClothingTone = "LIGHT" | "PRIMARY" | "DARK" | "ACCENT";
type ClothingShape = "TAPER_TOP" | "TAPER_BOTTOM" | "CYLINDER" | "BOX";

type ClothingBoneSet = {
  pelvis: THREE.Object3D;
  spineLower: THREE.Object3D;
  spineUpper: THREE.Object3D;
  chest: THREE.Object3D;
  neck: THREE.Object3D;
  leftShoulder: THREE.Object3D;
  rightShoulder: THREE.Object3D;
  leftUpperArm: THREE.Object3D;
  rightUpperArm: THREE.Object3D;
  leftForearm: THREE.Object3D;
  rightForearm: THREE.Object3D;
  leftHand: THREE.Object3D;
  rightHand: THREE.Object3D;
  leftThigh: THREE.Object3D;
  rightThigh: THREE.Object3D;
  leftShin: THREE.Object3D;
  rightShin: THREE.Object3D;
  leftFoot: THREE.Object3D;
  rightFoot: THREE.Object3D;
  leftToe?: THREE.Object3D;
  rightToe?: THREE.Object3D;
};

type SegmentSpec = {
  name: string;
  start: keyof ClothingBoneSet;
  end: keyof ClothingBoneSet;
  tone: ClothingTone;
  shape: ClothingShape;
  width: number;
  depth: number;
  lengthScale?: number;
  centerBias?: number;
  offset?: readonly [number, number, number];
};

type SegmentFollower = {
  mesh: THREE.Mesh;
  start: THREE.Object3D;
  end: THREE.Object3D;
  width: number;
  depth: number;
  lengthScale: number;
  centerBias: number;
  offset: THREE.Vector3;
};

type ClothingRuntime = {
  visual: FighterVisual;
  definition: FighterDefinition;
  followers: SegmentFollower[];
  materials: THREE.MeshStandardMaterial[];
  lastRenderFrame: number;
};

const runtimes = new WeakMap<THREE.Group, ClothingRuntime>();

const GEOMETRIES: Record<ClothingShape, THREE.BufferGeometry> = {
  TAPER_TOP: new THREE.CylinderGeometry(1.0, 0.78, 1, 8, 2, false),
  TAPER_BOTTOM: new THREE.CylinderGeometry(0.80, 1.0, 1, 8, 2, false),
  CYLINDER: new THREE.CylinderGeometry(1, 1, 1, 8, 2, false),
  BOX: new THREE.BoxGeometry(1, 1, 1, 1, 2, 1),
};

function clothMaterial(color: THREE.Color, roughness: number, metalness = 0.02): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness,
    metalness,
    dithering: true,
  });
}

function createClothingMaterials(definition: FighterDefinition): Record<ClothingTone, THREE.MeshStandardMaterial> {
  const primary = new THREE.Color(definition.colors.primary);
  const secondary = new THREE.Color(definition.colors.secondary);
  const accent = new THREE.Color(definition.colors.accent);
  const light = new THREE.Color(0xf4f6f8).lerp(primary, definition.archetype === "POWER" ? 0.12 : 0.18);
  return {
    LIGHT: clothMaterial(light, 0.61, 0.025),
    PRIMARY: clothMaterial(primary.clone().offsetHSL(0, 0.02, 0.015), 0.54, 0.055),
    DARK: clothMaterial(secondary.clone().lerp(new THREE.Color(0x171b24), 0.22), 0.68, 0.045),
    ACCENT: clothMaterial(accent.clone().offsetHSL(0, 0.035, 0.035), 0.46, 0.10),
  };
}

function powerProfile(): SegmentSpec[] {
  return [
    { name: "kairo-jacket-upper", start: "spineUpper", end: "neck", tone: "LIGHT", shape: "TAPER_TOP", width: 0.166, depth: 0.112, lengthScale: 0.92 },
    { name: "kairo-jacket-core", start: "pelvis", end: "spineUpper", tone: "PRIMARY", shape: "TAPER_TOP", width: 0.142, depth: 0.096, lengthScale: 0.90, centerBias: 0.58 },
    { name: "kairo-waist", start: "pelvis", end: "spineLower", tone: "DARK", shape: "CYLINDER", width: 0.128, depth: 0.090, lengthScale: 0.58, centerBias: 0.36 },
    { name: "kairo-left-shoulder", start: "leftShoulder", end: "leftUpperArm", tone: "LIGHT", shape: "CYLINDER", width: 0.072, depth: 0.066, lengthScale: 0.78 },
    { name: "kairo-right-shoulder", start: "rightShoulder", end: "rightUpperArm", tone: "LIGHT", shape: "CYLINDER", width: 0.072, depth: 0.066, lengthScale: 0.78 },
    { name: "kairo-left-sleeve", start: "leftUpperArm", end: "leftForearm", tone: "PRIMARY", shape: "TAPER_BOTTOM", width: 0.065, depth: 0.058, lengthScale: 0.92 },
    { name: "kairo-right-sleeve", start: "rightUpperArm", end: "rightForearm", tone: "PRIMARY", shape: "TAPER_BOTTOM", width: 0.065, depth: 0.058, lengthScale: 0.92 },
    { name: "kairo-left-gauntlet", start: "leftForearm", end: "leftHand", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.057, depth: 0.052, lengthScale: 0.86, centerBias: 0.46 },
    { name: "kairo-right-gauntlet", start: "rightForearm", end: "rightHand", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.057, depth: 0.052, lengthScale: 0.86, centerBias: 0.46 },
    { name: "kairo-left-pants", start: "leftThigh", end: "leftShin", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.091, depth: 0.078, lengthScale: 0.96 },
    { name: "kairo-right-pants", start: "rightThigh", end: "rightShin", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.091, depth: 0.078, lengthScale: 0.96 },
    { name: "kairo-left-boot", start: "leftShin", end: "leftFoot", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.076, depth: 0.069, lengthScale: 0.93 },
    { name: "kairo-right-boot", start: "rightShin", end: "rightFoot", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.076, depth: 0.069, lengthScale: 0.93 },
    { name: "kairo-left-shoe", start: "leftFoot", end: "leftToe", tone: "PRIMARY", shape: "BOX", width: 0.075, depth: 0.055, lengthScale: 1.32, centerBias: 0.58 },
    { name: "kairo-right-shoe", start: "rightFoot", end: "rightToe", tone: "PRIMARY", shape: "BOX", width: 0.075, depth: 0.055, lengthScale: 1.32, centerBias: 0.58 },
  ];
}

function speedProfile(): SegmentSpec[] {
  return [
    { name: "sera-jacket-upper", start: "spineUpper", end: "neck", tone: "LIGHT", shape: "TAPER_TOP", width: 0.138, depth: 0.096, lengthScale: 0.76, centerBias: 0.60 },
    { name: "sera-bodysuit-core", start: "pelvis", end: "spineUpper", tone: "DARK", shape: "TAPER_TOP", width: 0.120, depth: 0.081, lengthScale: 0.92, centerBias: 0.53 },
    { name: "sera-waist-shorts", start: "pelvis", end: "spineLower", tone: "PRIMARY", shape: "CYLINDER", width: 0.126, depth: 0.084, lengthScale: 0.66, centerBias: 0.32 },
    { name: "sera-left-shoulder", start: "leftShoulder", end: "leftUpperArm", tone: "PRIMARY", shape: "CYLINDER", width: 0.058, depth: 0.052, lengthScale: 0.72 },
    { name: "sera-right-shoulder", start: "rightShoulder", end: "rightUpperArm", tone: "PRIMARY", shape: "CYLINDER", width: 0.058, depth: 0.052, lengthScale: 0.72 },
    { name: "sera-left-sleeve", start: "leftUpperArm", end: "leftForearm", tone: "LIGHT", shape: "TAPER_BOTTOM", width: 0.052, depth: 0.047, lengthScale: 0.80, centerBias: 0.42 },
    { name: "sera-right-sleeve", start: "rightUpperArm", end: "rightForearm", tone: "LIGHT", shape: "TAPER_BOTTOM", width: 0.052, depth: 0.047, lengthScale: 0.80, centerBias: 0.42 },
    { name: "sera-left-bracer", start: "leftForearm", end: "leftHand", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.048, depth: 0.044, lengthScale: 0.78, centerBias: 0.42 },
    { name: "sera-right-bracer", start: "rightForearm", end: "rightHand", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.048, depth: 0.044, lengthScale: 0.78, centerBias: 0.42 },
    { name: "sera-left-legging", start: "leftThigh", end: "leftShin", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.078, depth: 0.067, lengthScale: 0.95 },
    { name: "sera-right-legging", start: "rightThigh", end: "rightShin", tone: "DARK", shape: "TAPER_BOTTOM", width: 0.078, depth: 0.067, lengthScale: 0.95 },
    { name: "sera-left-boot", start: "leftShin", end: "leftFoot", tone: "LIGHT", shape: "TAPER_BOTTOM", width: 0.066, depth: 0.060, lengthScale: 0.92 },
    { name: "sera-right-boot", start: "rightShin", end: "rightFoot", tone: "LIGHT", shape: "TAPER_BOTTOM", width: 0.066, depth: 0.060, lengthScale: 0.92 },
    { name: "sera-left-shoe", start: "leftFoot", end: "leftToe", tone: "PRIMARY", shape: "BOX", width: 0.069, depth: 0.050, lengthScale: 1.28, centerBias: 0.58 },
    { name: "sera-right-shoe", start: "rightFoot", end: "rightToe", tone: "PRIMARY", shape: "BOX", width: 0.069, depth: 0.050, lengthScale: 1.28, centerBias: 0.58 },
  ];
}

function originalBones(visual: FighterVisual): ClothingBoneSet | null {
  const bones = visual.rig.bones;
  const required = [
    "hips", "spineLower", "spineUpper", "chest", "neck",
    "leftShoulder", "rightShoulder", "leftUpperArm", "rightUpperArm",
    "leftForearm", "rightForearm", "leftHand", "rightHand",
    "leftThigh", "rightThigh", "leftShin", "rightShin", "leftFoot", "rightFoot",
  ] as const;
  if (required.some((name) => !bones[name])) return null;
  return {
    pelvis: bones.hips,
    spineLower: bones.spineLower,
    spineUpper: bones.spineUpper,
    chest: bones.chest,
    neck: bones.neck,
    leftShoulder: bones.leftShoulder,
    rightShoulder: bones.rightShoulder,
    leftUpperArm: bones.leftUpperArm,
    rightUpperArm: bones.rightUpperArm,
    leftForearm: bones.leftForearm,
    rightForearm: bones.rightForearm,
    leftHand: bones.leftHand,
    rightHand: bones.rightHand,
    leftThigh: bones.leftThigh,
    rightThigh: bones.rightThigh,
    leftShin: bones.leftShin,
    rightShin: bones.rightShin,
    leftFoot: bones.leftFoot,
    rightFoot: bones.rightFoot,
  };
}

function importedBones(visual: FighterVisual): ClothingBoneSet | null {
  const get = (name: string): THREE.Object3D | undefined => visual.root.getObjectByName(name) ?? undefined;
  const values = {
    pelvis: get("pelvis"),
    spineLower: get("spine_01"),
    spineUpper: get("spine_02"),
    chest: get("spine_03"),
    neck: get("neck_01"),
    leftShoulder: get("clavicle_l"),
    rightShoulder: get("clavicle_r"),
    leftUpperArm: get("upperarm_l"),
    rightUpperArm: get("upperarm_r"),
    leftForearm: get("lowerarm_l"),
    rightForearm: get("lowerarm_r"),
    leftHand: get("hand_l"),
    rightHand: get("hand_r"),
    leftThigh: get("thigh_l"),
    rightThigh: get("thigh_r"),
    leftShin: get("calf_l"),
    rightShin: get("calf_r"),
    leftFoot: get("foot_l"),
    rightFoot: get("foot_r"),
    leftToe: get("ball_l"),
    rightToe: get("ball_r"),
  };
  const required = Object.entries(values).filter(([name]) => name !== "leftToe" && name !== "rightToe");
  if (required.some(([, value]) => !value)) return null;
  return values as ClothingBoneSet;
}

function partFollower(
  visual: FighterVisual,
  bones: ClothingBoneSet,
  spec: SegmentSpec,
  material: THREE.Material,
): SegmentFollower | null {
  const start = bones[spec.start];
  const end = bones[spec.end];
  if (!start || !end) return null;
  const mesh = new THREE.Mesh(GEOMETRIES[spec.shape], material);
  mesh.name = `fighter-clothing-${spec.name}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.userData.characterClothing = CHARACTER_CLOTHING_ID;
  mesh.userData.characterClothingPart = spec.name;
  visual.root.add(mesh);
  return {
    mesh,
    start,
    end,
    width: spec.width,
    depth: spec.depth,
    lengthScale: spec.lengthScale ?? 1,
    centerBias: spec.centerBias ?? 0.5,
    offset: new THREE.Vector3(...(spec.offset ?? [0, 0, 0])),
  };
}

const TMP_START_WORLD = new THREE.Vector3();
const TMP_END_WORLD = new THREE.Vector3();
const TMP_START_LOCAL = new THREE.Vector3();
const TMP_END_LOCAL = new THREE.Vector3();
const TMP_DIRECTION = new THREE.Vector3();
const TMP_CENTER = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();

function updateFollower(visual: FighterVisual, follower: SegmentFollower): void {
  follower.start.getWorldPosition(TMP_START_WORLD);
  follower.end.getWorldPosition(TMP_END_WORLD);
  TMP_START_LOCAL.copy(TMP_START_WORLD);
  TMP_END_LOCAL.copy(TMP_END_WORLD);
  visual.root.worldToLocal(TMP_START_LOCAL);
  visual.root.worldToLocal(TMP_END_LOCAL);
  TMP_DIRECTION.subVectors(TMP_END_LOCAL, TMP_START_LOCAL);
  const length = TMP_DIRECTION.length();
  if (length < 1e-5) return;
  TMP_DIRECTION.multiplyScalar(1 / length);
  TMP_CENTER.copy(TMP_START_LOCAL).lerp(TMP_END_LOCAL, follower.centerBias).add(follower.offset);
  TMP_QUATERNION.setFromUnitVectors(Y_AXIS, TMP_DIRECTION);
  follower.mesh.position.copy(TMP_CENTER);
  follower.mesh.quaternion.copy(TMP_QUATERNION);
  follower.mesh.scale.set(follower.width, length * follower.lengthScale, follower.depth);
}

function updateRuntime(runtime: ClothingRuntime): void {
  runtime.visual.root.updateMatrixWorld(true);
  for (const follower of runtime.followers) updateFollower(runtime.visual, follower);
}

function registerDriver(runtime: ClothingRuntime): void {
  for (const follower of runtime.followers) {
    follower.mesh.onBeforeRender = (renderer: THREE.WebGLRenderer) => {
      const frame = renderer.info.render.frame;
      if (runtime.lastRenderFrame === frame) return;
      runtime.lastRenderFrame = frame;
      updateRuntime(runtime);
    };
  }
}

function installWithBones(visual: FighterVisual, definition: FighterDefinition, bones: ClothingBoneSet, mode: "ORIGINAL" | "QUATERNIUS_UBC"): void {
  if (runtimes.has(visual.root)) return;
  const materialsByTone = createClothingMaterials(definition);
  const profile = definition.archetype === "POWER" ? powerProfile() : speedProfile();
  const followers = profile
    .map((spec) => partFollower(visual, bones, spec, materialsByTone[spec.tone]))
    .filter((value): value is SegmentFollower => value !== null);
  if (!followers.length) {
    Object.values(materialsByTone).forEach((material) => material.dispose());
    visual.root.userData.characterClothingState = "failed-empty";
    return;
  }
  const runtime: ClothingRuntime = {
    visual,
    definition,
    followers,
    materials: Object.values(materialsByTone),
    lastRenderFrame: -1,
  };
  runtimes.set(visual.root, runtime);
  visual.allMeshes.push(...followers.map((entry) => entry.mesh));
  visual.stats.meshCount += followers.length;
  visual.stats.vertexCount += followers.reduce((total, entry) => total + (entry.mesh.geometry.getAttribute("position")?.count ?? 0), 0);
  visual.stats.triangleCount += Math.round(followers.reduce((total, entry) => {
    const geometry = entry.mesh.geometry;
    const position = geometry.getAttribute("position");
    return total + (geometry.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3);
  }, 0));
  visual.stats.materialCount += runtime.materials.length;
  visual.root.userData.characterClothing = CHARACTER_CLOTHING_ID;
  visual.root.userData.characterClothingState = "ready";
  visual.root.userData.characterClothingMode = mode;
  visual.root.userData.characterClothingPartCount = followers.length;
  visual.root.userData.characterClothingProfile = definition.archetype === "POWER" ? "KAIRO_LAYERED_FIGHT_GEAR" : "SERA_LAYERED_SPEED_GEAR";
  visual.root.userData.characterClothingFollowMode = "WORLD_SEGMENT_AXIS_INDEPENDENT";
  updateRuntime(runtime);
  registerDriver(runtime);
}

function scheduleImportedClothing(visual: FighterVisual, definition: FighterDefinition): void {
  if (typeof window === "undefined") return;
  let attempts = 0;
  const poll = (): void => {
    if (runtimes.has(visual.root)) return;
    const state = String(visual.root.userData.quaterniusModelState ?? "loading");
    if (state === "failed") {
      visual.root.userData.characterClothingState = "failed-model";
      return;
    }
    if (state === "ready") {
      const bones = importedBones(visual);
      if (bones) {
        installWithBones(visual, definition, bones, "QUATERNIUS_UBC");
        return;
      }
    }
    attempts += 1;
    if (attempts >= BODY_POLL_LIMIT) {
      visual.root.userData.characterClothingState = "failed-timeout";
      return;
    }
    window.requestAnimationFrame(poll);
  };
  window.requestAnimationFrame(poll);
}

export function installCharacterClothing(visual: FighterVisual, definition: FighterDefinition): void {
  if (visual.root.userData.characterClothingState) return;
  visual.root.userData.characterClothingState = "installing";
  if (visual.root.userData.modelSkin === "QUATERNIUS_UBC") {
    scheduleImportedClothing(visual, definition);
    return;
  }
  const bones = originalBones(visual);
  if (!bones) {
    visual.root.userData.characterClothingState = "failed-bones";
    return;
  }
  installWithBones(visual, definition, bones, "ORIGINAL");
}

export function disposeCharacterClothing(visual: FighterVisual): void {
  const runtime = runtimes.get(visual.root);
  if (!runtime) return;
  for (const follower of runtime.followers) {
    follower.mesh.onBeforeRender = () => undefined;
    follower.mesh.removeFromParent();
  }
  runtime.materials.forEach((material) => material.dispose());
  runtimes.delete(visual.root);
}

export function characterClothingDiagnostics(visual: FighterVisual): Record<string, unknown> {
  const runtime = runtimes.get(visual.root);
  return {
    id: visual.root.userData.characterClothing ?? CHARACTER_CLOTHING_ID,
    state: visual.root.userData.characterClothingState ?? "uninstalled",
    mode: visual.root.userData.characterClothingMode ?? null,
    profile: visual.root.userData.characterClothingProfile ?? null,
    followMode: visual.root.userData.characterClothingFollowMode ?? null,
    partCount: runtime?.followers.length ?? Number(visual.root.userData.characterClothingPartCount ?? 0),
    frontAxis: FRONT_AXIS.toArray(),
  };
}
