import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FighterVisual } from "./visual";

// Separate character asset, never a procedural overlay on the old model.
// The UBC skeleton remains a hidden motion driver; this GLB owns its PBR skin,
// UVs, geometry, garments, hair, morph targets and independent artist rig.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
export const SERA_HERO_MODEL_URL = BASE_PATH + "/models/hero/sera-hero-pbr.glb";
export const SERA_HERO_V3_MODEL_URL = BASE_PATH + "/models/hero/sera-hero-v3.glb";
export const SERA_HERO_RUNTIME_VERSION = "SERA_HERO_PBR_V2";

// Source bone (UBC/UAL) -> final hero bone (Ara game/Mixamo rig).
export const SERA_HERO_BONE_MAP = {
  pelvis: "Hips", spine_01: "Spine", spine_02: "Spine1", spine_03: "Spine2",
  neck_01: "Neck", Head: "Head",
  clavicle_l: "LeftShoulder", upperarm_l: "LeftArm",
  lowerarm_l: "LeftForeArm", hand_l: "LeftHand",
  clavicle_r: "RightShoulder", upperarm_r: "RightArm",
  lowerarm_r: "RightForeArm", hand_r: "RightHand",
  thigh_l: "LeftUpLeg", calf_l: "LeftLeg", foot_l: "LeftFoot", ball_l: "LeftToeBase",
  thigh_r: "RightUpLeg", calf_r: "RightLeg", foot_r: "RightFoot", ball_r: "RightToeBase",
  thumb_01_l: "LeftHandThumb1", thumb_02_l: "LeftHandThumb2", thumb_03_l: "LeftHandThumb3",
  index_01_l: "LeftHandIndex1", index_02_l: "LeftHandIndex2", index_03_l: "LeftHandIndex3",
  middle_01_l: "LeftHandMiddle1", middle_02_l: "LeftHandMiddle2", middle_03_l: "LeftHandMiddle3",
  ring_01_l: "LeftHandRing1", ring_02_l: "LeftHandRing2", ring_03_l: "LeftHandRing3",
  pinky_01_l: "LeftHandPinky1", pinky_02_l: "LeftHandPinky2", pinky_03_l: "LeftHandPinky3",
  thumb_01_r: "RightHandThumb1", thumb_02_r: "RightHandThumb2", thumb_03_r: "RightHandThumb3",
  index_01_r: "RightHandIndex1", index_02_r: "RightHandIndex2", index_03_r: "RightHandIndex3",
  middle_01_r: "RightHandMiddle1", middle_02_r: "RightHandMiddle2", middle_03_r: "RightHandMiddle3",
  ring_01_r: "RightHandRing1", ring_02_r: "RightHandRing2", ring_03_r: "RightHandRing3",
  pinky_01_r: "RightHandPinky1", pinky_02_r: "RightHandPinky2", pinky_03_r: "RightHandPinky3",
} as const;

export const SERA_HERO_REQUIRED_BONES = [
  "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head",
  "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
  "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
  "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r",
] as const;

type BindTrack = {
  source: THREE.Bone;
  target: THREE.Bone;
  sourceRest: THREE.Quaternion;
  targetRest: THREE.Quaternion;
};

type HeroRuntime = {
  host: THREE.Group;
  model: THREE.Group;
  materials: THREE.Material[];
  faceMeshes: THREE.SkinnedMesh[];
  assetUrl: string;
  tracks: BindTrack[];
  sourceHost: THREE.Object3D | null;
  sourceMeshes: THREE.Mesh[];
  ready: boolean;
};

const runtimes = new WeakMap<THREE.Object3D, HeroRuntime>();
const tokens = new WeakMap<THREE.Object3D, object>();
const assetPromises = new Map<string, Promise<THREE.Group>>();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const qD = new THREE.Quaternion();
const qE = new THREE.Quaternion();

function loadSource(url: string): Promise<THREE.Group> {
  const existing = assetPromises.get(url);
  if (existing) return existing;
  const pending = new GLTFLoader().loadAsync(url)
    .then((gltf) => gltf.scene)
    .catch((error: unknown) => {
      assetPromises.delete(url);
      throw error;
    });
  assetPromises.set(url, pending);
  return pending;
}

function skinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const result: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) result.push(node as THREE.SkinnedMesh);
  });
  return result;
}

function bindPoseWorldRotation(mesh: THREE.SkinnedMesh, bone: THREE.Bone): THREE.Quaternion {
  const index = mesh.skeleton.bones.indexOf(bone);
  if (index < 0 || !mesh.skeleton.boneInverses[index]) {
    throw new Error("Missing GLB bind pose for " + bone.name);
  }
  const m = mesh.skeleton.boneInverses[index].clone().invert();
  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, rot, scale);
  return rot;
}

function mapBones(model: THREE.Group): Map<string, THREE.Bone> {
  const result = new Map<string, THREE.Bone>();
  model.traverse((node) => {
    if ((node as THREE.Bone).isBone) result.set(node.name, node as THREE.Bone);
  });
  return result;
}

function buildTracks(
  sourceHost: THREE.Object3D,
  heroModel: THREE.Group,
): BindTrack[] {
  const sourceMesh = skinnedMeshes(sourceHost)[0];
  const heroMesh = skinnedMeshes(heroModel)[0];
  if (!sourceMesh || !heroMesh) throw new Error("Both motion driver and hero need skinned meshes");
  const source = mapBones(sourceHost);
  const target = mapBones(heroModel);
  for (const sourceName of SERA_HERO_REQUIRED_BONES) {
    const targetName = SERA_HERO_BONE_MAP[sourceName];
    if (!source.has(sourceName) || !target.has(targetName)) {
      throw new Error("Hero rig incompatible: missing " + sourceName + " / " + targetName);
    }
  }
  const tracks: BindTrack[] = [];
  for (const [sourceName, targetName] of Object.entries(SERA_HERO_BONE_MAP)) {
    const a = source.get(sourceName);
    const b = target.get(targetName);
    if (!a || !b) continue;
    // Extra finger chains may be absent. Keep the mandatory body complete.
    if (!sourceMesh.skeleton.bones.includes(a) || !heroMesh.skeleton.bones.includes(b)) continue;
    tracks.push({
      source: a,
      target: b,
      sourceRest: bindPoseWorldRotation(sourceMesh, a),
      targetRest: bindPoseWorldRotation(heroMesh, b),
    });
  }
  if (tracks.length < SERA_HERO_REQUIRED_BONES.length) throw new Error("Incomplete hero retarget mapping");
  // The target parent must be updated first: local rotations are solved from
  // desired bind-relative WORLD rotations, not copied across incompatible axes.
  const targetOrder = new Map<THREE.Object3D, number>();
  let index = 0;
  heroModel.traverse((node) => targetOrder.set(node, index++));
  tracks.sort((a, b) => (targetOrder.get(a.target) ?? 0) - (targetOrder.get(b.target) ?? 0));
  return tracks;
}

function prepareModel(source: THREE.Group, visual: FighterVisual, assetUrl: string): HeroRuntime {
  const model = cloneSkeleton(source) as THREE.Group;
  const skinned = skinnedMeshes(model);
  if (!skinned.length) throw new Error("Hero asset must have a skinned mesh");
  const materials: THREE.Material[] = [];
  let textured = 0;
  let faces = 0;
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const clones = original.map((material) => {
      const copy = material.clone();
      if (copy instanceof THREE.MeshStandardMaterial) {
        // No flat-shading override or texture destruction.
        if (copy.map) textured++;
        copy.envMapIntensity = 1.1;
      }
      materials.push(copy);
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? clones : clones[0];
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const g = mesh.geometry;
    faces += g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
  });
  if (!textured || faces < 8000) {
    for (const material of materials) material.dispose();
    throw new Error("Hero requires textured PBR and substantial authored geometry");
  }
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (size.y <= 0) throw new Error("Hero model has no height");
  const center = bounds.getCenter(new THREE.Vector3());
  const host = new THREE.Group();
  host.name = assetUrl === SERA_HERO_V3_MODEL_URL ? "sera-hero-v3-runtime" : "sera-hero-pbr-runtime";
  host.scale.setScalar(1 / size.y);
  model.position.set(-center.x, -bounds.min.y, -center.z);
  host.add(model);
  host.visible = false; // Never show two bodies simultaneously during async loading.
  visual.root.add(host);
  visual.root.userData.heroPbrTriangleCount = Math.round(faces);
  visual.root.userData.heroPbrTextureMaterials = textured;
  visual.root.userData.heroPbrVersion = assetUrl === SERA_HERO_V3_MODEL_URL ? "SERA_HERO_V3_INTEGRATED" : SERA_HERO_RUNTIME_VERSION;
  const faceMeshes = skinned.filter((mesh) =>
    Boolean(mesh.morphTargetDictionary?.eyeBlinkLeft) ||
    mesh.morphTargetDictionary?.eyeBlinkLeft === 0,
  );
  return { host, model, materials, faceMeshes, assetUrl, tracks: [], sourceHost: null, sourceMeshes: [], ready: false };
}

export function installSeraHeroModel(visual: FighterVisual, modelVersion: "V2" | "V3" = "V2"): void {
  const root = visual.root;
  if (typeof window === "undefined" || runtimes.has(root)) return;
  const token = {};
  tokens.set(root, token);
  root.userData.heroModelState = "loading";
  const assetUrl = modelVersion === "V3" ? SERA_HERO_V3_MODEL_URL : SERA_HERO_MODEL_URL;
  void loadSource(assetUrl).then((source) => {
    if (tokens.get(root) !== token) return;
    const runtime = prepareModel(source, visual, assetUrl);
    if (tokens.get(root) !== token) {
      runtime.host.removeFromParent();
      for (const material of runtime.materials) material.dispose();
      return;
    }
    runtimes.set(root, runtime);
    updateSeraHeroPose(visual);
  }).catch((error: unknown) => {
    if (tokens.get(root) !== token) return;
    root.userData.heroModelState = "failed";
    root.userData.heroModelError = error instanceof Error ? error.message : String(error);
    console.error("[POLY FIGHTER] SERA Hero PBR unavailable. Keeping UBC fallback.", error);
  });
}

export function updateSeraHeroPose(visual: FighterVisual): void {
  const root = visual.root;
  const runtime = runtimes.get(root);
  if (!runtime) return;
  if (!runtime.ready) {
    if (root.userData.quaterniusModelState !== "ready") return;
    const sourceHost = root.children.find((node) =>
      node.name.startsWith("quaternius-ubc-") && node.name.endsWith("-runtime"));
    if (!sourceHost) return;
    try {
      runtime.tracks = buildTracks(sourceHost, runtime.model);
      runtime.sourceHost = sourceHost;
      runtime.sourceMeshes = [];
      sourceHost.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) runtime.sourceMeshes.push(node as THREE.Mesh);
      });
      runtime.ready = true;
    } catch (error) {
      root.userData.heroModelState = "failed";
      root.userData.heroModelError = error instanceof Error ? error.message : String(error);
      runtime.host.removeFromParent();
      runtimes.delete(root);
      for (const material of runtime.materials) material.dispose();
      return;
    }
  }
  if (!runtime.sourceHost) return;
  runtime.sourceHost.updateMatrixWorld(true);
  runtime.host.updateMatrixWorld(true);
  const sourceHostQ = runtime.sourceHost.getWorldQuaternion(qA).clone().invert();
  const targetHostQ = runtime.host.getWorldQuaternion(qB).clone().invert();
  for (const track of runtime.tracks) {
    // Delta from source rest is a WORLD-space (host-relative) rotation. Applying
    // it to target rest preserves differently oriented A/T-pose bone axes.
    const pose = track.source.getWorldQuaternion(qC);
    const delta = qD.copy(sourceHostQ).multiply(pose).multiply(qE.copy(track.sourceRest).invert());
    const worldTarget = delta.multiply(track.targetRest);
    const parent = track.target.parent;
    const parentQ = parent ? parent.getWorldQuaternion(qE) : runtime.host.getWorldQuaternion(qE);
    const parentRelative = qB.copy(targetHostQ).multiply(parentQ).invert();
    track.target.quaternion.copy(parentRelative.multiply(worldTarget)).normalize();
    track.target.updateMatrixWorld(true);
  }
  // The UBC rig continues to drive exact contact timing, but only the new
  // textured mesh is visible. Root transform/hitboxes remain gameplay-owned.
  for (const mesh of runtime.sourceMeshes) mesh.visible = false;
  runtime.host.visible = true;
  // Preserve the glTF facial blend shapes for more than just static neutral.
  // A narrow blink impulse and low resting focus are safe even during hitstop.
  const seconds = performance.now() * 0.001;
  const blink = Math.pow(Math.max(0, Math.cos(seconds * Math.PI / 1.65)), 40);
  const clip = String(root.userData.combatMotionCurrentClip ?? "");
  const attackFocus = /Power|Kick|Counter|Blow|Jab|Cross/.test(clip);
  for (const mesh of runtime.faceMeshes) {
    const dictionary = mesh.morphTargetDictionary;
    const weights = mesh.morphTargetInfluences;
    if (!dictionary || !weights) continue;
    const write = (name: string, amount: number) => {
      const index = dictionary[name];
      if (index !== undefined) weights[index] = amount;
    };
    write("eyeBlinkLeft", blink * 0.95);
    write("eyeBlinkRight", blink * 0.95);
    write("browDownLeft", attackFocus ? 0.20 : 0.08);
    write("browDownRight", attackFocus ? 0.20 : 0.08);
    write("mouthPress", attackFocus ? 0.13 : 0.035);
  }
  root.userData.heroFacialMorphsActive = runtime.faceMeshes.length > 0;
  root.userData.heroModelState = "ready";
  root.userData.heroModelMappedBones = runtime.tracks.length;
  root.userData.heroModelAsset = runtime.assetUrl;
}

export function disposeSeraHeroModel(visual: FighterVisual): void {
  const root = visual.root;
  tokens.delete(root);
  const runtime = runtimes.get(root);
  if (!runtime) return;
  runtime.host.removeFromParent();
  for (const material of runtime.materials) material.dispose();
  runtimes.delete(root);
}
