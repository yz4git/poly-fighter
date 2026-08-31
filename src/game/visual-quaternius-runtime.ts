import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FighterRuntime } from "./fighter";
import { getVisualContactPoint, type FighterVisual } from "./visual";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const QUATERNIUS_UBC_MODEL_URL = `${BASE_PATH}/models/quaternius/ubc-superhero-male.glb`;
export const QUATERNIUS_UAL_CORE_URL = `${BASE_PATH}/models/quaternius/ual-fight-core.glb`;
export const QUATERNIUS_UAL2_CORE_URL = `${BASE_PATH}/models/quaternius/ual2-fight-core.glb`;

type RuntimeResources = {
  model: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
};

type QuaterniusRuntime = {
  host: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  bones: Map<string, THREE.Object3D>;
  currentClip: string;
  currentAction: THREE.AnimationAction | null;
  lastTime: number;
  lastMoveTick: number;
  ownedMaterials: THREE.Material[];
};

const runtimes = new WeakMap<THREE.Group, QuaterniusRuntime>();
const installTokens = new WeakMap<THREE.Group, object>();
let resourcesPromise: Promise<RuntimeResources> | null = null;

function loadResources(): Promise<RuntimeResources> {
  if (resourcesPromise) return resourcesPromise;
  const loader = new GLTFLoader();
  resourcesPromise = Promise.all([
    loader.loadAsync(QUATERNIUS_UBC_MODEL_URL),
    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),
    loader.loadAsync(QUATERNIUS_UAL2_CORE_URL),
  ]).then(([model, ual1, ual2]) => ({
    model: model.scene,
    clips: new Map([...ual1.animations, ...ual2.animations].map((clip) => [clip.name, clip])),
  })).catch((error) => {
    resourcesPromise = null;
    throw error;
  });
  return resourcesPromise;
}

function cloneAndStyleModel(source: THREE.Group, visual: FighterVisual, primary: number): Pick<QuaterniusRuntime, "host" | "model" | "bones" | "ownedMaterials"> {
  const model = cloneSkeleton(source) as THREE.Group;
  const ownedMaterials: THREE.Material[] = [];
  const tint = new THREE.Color(primary);
  model.updateMatrixWorld(true);
  const sourceBounds = new THREE.Box3().setFromObject(model);
  const size = sourceBounds.getSize(new THREE.Vector3());
  const height = Math.max(1e-5, size.y);
  const center = sourceBounds.getCenter(new THREE.Vector3());

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map((material) => {
      const next = material.clone();
      ownedMaterials.push(next);
      if (next instanceof THREE.MeshStandardMaterial) {
        next.flatShading = true;
        next.roughness = Math.max(0.62, next.roughness);
        next.metalness = Math.min(0.16, next.metalness);
        next.color.lerp(tint, 0.12);
        next.needsUpdate = true;
      }
      return next;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });

  const host = new THREE.Group();
  host.name = "quaternius-ubc-runtime";
  host.scale.setScalar(1 / height);
  // Existing POLY FIGHTER visuals use normalized 0..1 body height inside a
  // root that applies the final world scale. Keep the imported model in that
  // same space so gameplay position/facing remains owned by the canonical root.
  model.position.set(-center.x, -sourceBounds.min.y, -center.z);
  host.add(model);
  visual.root.add(host);

  const bones = new Map<string, THREE.Object3D>();
  model.traverse((object) => {
    if (object.name) bones.set(object.name, object);
  });
  return { host, model, bones, ownedMaterials };
}

function setWorldQuaternion(object: THREE.Object3D, desiredWorld: THREE.Quaternion): void {
  const parentWorld = new THREE.Quaternion();
  object.parent?.getWorldQuaternion(parentWorld);
  object.quaternion.copy(object.parent ? parentWorld.invert().multiply(desiredWorld) : desiredWorld);
}

/** Axis-agnostic two-bone correction used only around an active hit frame. */
function solveImportedLimb(root: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  root.updateWorldMatrix(true, true);
  const rootPos = root.getWorldPosition(new THREE.Vector3());
  const midPos = mid.getWorldPosition(new THREE.Vector3());
  const endPos = end.getWorldPosition(new THREE.Vector3());
  const a = Math.max(1e-4, rootPos.distanceTo(midPos));
  const b = Math.max(1e-4, midPos.distanceTo(endPos));
  const toTarget = target.clone().sub(rootPos);
  const rawDistance = Math.max(1e-4, toTarget.length());
  const distance = THREE.MathUtils.clamp(rawDistance, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const direction = toTarget.normalize();
  const poleDirection = pole.clone().sub(rootPos).addScaledVector(direction, -pole.clone().sub(rootPos).dot(direction));
  if (poleDirection.lengthSq() < 1e-8) poleDirection.set(0, 1, 0);
  poleDirection.normalize();
  const cosRoot = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
  const along = a * cosRoot;
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const joint = rootPos.clone().addScaledVector(direction, along).addScaledVector(poleDirection, height);

  const currentRootDirection = midPos.clone().sub(rootPos).normalize();
  const desiredRootDirection = joint.clone().sub(rootPos).normalize();
  const rootDelta = new THREE.Quaternion().setFromUnitVectors(currentRootDirection, desiredRootDirection);
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
  setWorldQuaternion(root, rootDelta.multiply(rootWorld));
  root.updateWorldMatrix(true, true);

  const solvedMidPos = mid.getWorldPosition(new THREE.Vector3());
  const solvedEndPos = end.getWorldPosition(new THREE.Vector3());
  const currentMidDirection = solvedEndPos.clone().sub(solvedMidPos).normalize();
  const desiredMidDirection = target.clone().sub(solvedMidPos).normalize();
  const midDelta = new THREE.Quaternion().setFromUnitVectors(currentMidDirection, desiredMidDirection);
  const midWorld = mid.getWorldQuaternion(new THREE.Quaternion());
  setWorldQuaternion(mid, midDelta.multiply(midWorld));
  mid.updateWorldMatrix(true, true);
}

function attackContactCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move || !fighter.isActive()) return;
  if (!move.visualContact || move.visualContact === "BODY") return;
  const target = getVisualContactPoint(fighter.visual, move.visualContact);
  const isFoot = move.visualContact.endsWith("FOOT");
  const suffixes = isFoot ? ["l", "r"] as const : ["l", "r"] as const;
  const candidates = suffixes.map((suffix) => {
    const root = runtime.bones.get(isFoot ? `thigh_${suffix}` : `upperarm_${suffix}`);
    const mid = runtime.bones.get(isFoot ? `calf_${suffix}` : `lowerarm_${suffix}`);
    const end = runtime.bones.get(isFoot ? `foot_${suffix}` : `hand_${suffix}`);
    return root && mid && end ? { root, mid, end, distance: end.getWorldPosition(new THREE.Vector3()).distanceTo(target), suffix } : null;
  }).filter((value): value is NonNullable<typeof value> => Boolean(value));
  candidates.sort((a, b) => a.distance - b.distance);
  const chain = candidates[0];
  if (!chain) return;
  const side = chain.suffix === "l" ? 1 : -1;
  const pole = fighter.visual.root.localToWorld(new THREE.Vector3(side * 0.48, isFoot ? 0.42 : 0.72, 0.24));
  solveImportedLimb(chain.root, chain.mid, chain.end, target, pole);
}

function desiredClip(fighter: FighterRuntime): { name: string; loop: boolean; speed: number } {
  const move = fighter.currentMove;
  if (fighter.state === "ATTACK" && move) {
    const seconds = Math.max(1 / 60, (move.startup + move.active + move.recovery) / 60);
    if (move.animation === "punch") {
      return { name: move.id === "jab" ? "Punch_Jab" : "Punch_Cross", loop: false, speed: 1 / seconds };
    }
    if (move.animation === "kick") {
      if (move.id === "dashKick") return { name: "Slide_Start", loop: false, speed: 1 / seconds };
      return { name: "NinjaJump_Start", loop: false, speed: 1 / seconds };
    }
    if (move.animation === "throw") return { name: "OverhandThrow", loop: false, speed: 1 / seconds };
    return { name: "Melee_Hook", loop: false, speed: 1 / seconds };
  }
  switch (fighter.state) {
    case "WALK": return { name: "Walk_Loop", loop: true, speed: 1 };
    case "CROUCH": return { name: "Crouch_Idle_Loop", loop: true, speed: 1 };
    case "GUARD": return { name: "Idle_Shield_Loop", loop: true, speed: 1 };
    case "BLOCK_STUN": return { name: "Hit_Knockback", loop: false, speed: 1.35 };
    case "SIDESTEP": return { name: "Slide_Loop", loop: true, speed: 1.2 };
    case "JUMP": return { name: "Jump_Loop", loop: true, speed: 1 };
    case "HIT": return { name: "Hit_Chest", loop: false, speed: 1.35 };
    case "KNOCKDOWN":
    case "KO":
    case "RING_OUT": return { name: "Death01", loop: false, speed: 1 };
    case "THROW": return { name: "OverhandThrow", loop: false, speed: 1 };
    case "WAKEUP": return { name: "NinjaJump_Land", loop: false, speed: 1.2 };
    default: return { name: "Idle_Loop", loop: true, speed: 1 };
  }
}

function play(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  const desired = desiredClip(fighter);
  const restartingAttack = fighter.state === "ATTACK" && fighter.moveTick < runtime.lastMoveTick;
  runtime.lastMoveTick = fighter.moveTick;
  if (runtime.currentClip === desired.name && !restartingAttack) return;
  const clip = runtime.clips.get(desired.name) ?? runtime.clips.get("Idle_Loop");
  if (!clip) return;
  runtime.currentAction?.fadeOut(0.06);
  const action = runtime.mixer.clipAction(clip, runtime.model);
  action.reset();
  action.enabled = true;
  action.setLoop(desired.loop ? THREE.LoopRepeat : THREE.LoopOnce, desired.loop ? Infinity : 1);
  action.clampWhenFinished = !desired.loop;
  // speed is expressed relative to roughly one-second authored actions; scale
  // by clip duration so attacks fit the deterministic gameplay move window.
  action.timeScale = desired.loop ? desired.speed : Math.max(0.25, clip.duration * desired.speed);
  action.fadeIn(0.06).play();
  runtime.currentClip = desired.name;
  runtime.currentAction = action;
}

export function installQuaterniusModelSkin(visual: FighterVisual, primary: number): void {
  if (typeof window === "undefined" || runtimes.has(visual.root)) return;
  const token = {};
  installTokens.set(visual.root, token);
  visual.root.userData.modelSkin = "QUATERNIUS_UBC";
  visual.root.userData.quaterniusModelState = "loading";
  void loadResources().then((resources) => {
    if (installTokens.get(visual.root) !== token) return;
    const styled = cloneAndStyleModel(resources.model, visual, primary);
    const runtime: QuaterniusRuntime = {
      ...styled,
      mixer: new THREE.AnimationMixer(styled.model),
      clips: resources.clips,
      currentClip: "",
      currentAction: null,
      lastTime: 0,
      lastMoveTick: -1,
    };
    runtimes.set(visual.root, runtime);
    // Keep the canonical rig alive for deterministic hitboxes/IK, but hide its
    // original render meshes only after the imported model is fully installed.
    for (const mesh of visual.allMeshes) {
      if (mesh !== visual.aura) mesh.visible = false;
    }
    visual.root.userData.quaterniusModelState = "ready";
    visual.root.userData.quaterniusModelAsset = QUATERNIUS_UBC_MODEL_URL;
    visual.root.userData.quaterniusAnimationRigCoverage = 1;
  }).catch((error: unknown) => {
    if (installTokens.get(visual.root) !== token) return;
    visual.root.userData.quaterniusModelState = "failed";
    console.error("[POLY FIGHTER] Quaternius UBC model load failed", error);
  });
}

export function updateQuaterniusModelSkin(fighter: FighterRuntime, timeSeconds: number): void {
  const runtime = runtimes.get(fighter.visual.root);
  if (!runtime) return;
  play(runtime, fighter);
  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, 0.05) : 0;
  runtime.lastTime = timeSeconds;
  runtime.mixer.update(delta);
  runtime.model.updateMatrixWorld(true);
  attackContactCorrection(runtime, fighter);
  runtime.model.updateMatrixWorld(true);
}

export function disposeQuaterniusModelSkin(visual: FighterVisual): void {
  installTokens.delete(visual.root);
  const runtime = runtimes.get(visual.root);
  if (!runtime) return;
  runtime.mixer.stopAllAction();
  runtime.mixer.uncacheRoot(runtime.model);
  runtime.host.removeFromParent();
  runtime.ownedMaterials.forEach((material) => material.dispose());
  runtimes.delete(visual.root);
}
