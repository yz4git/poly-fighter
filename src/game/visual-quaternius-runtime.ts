import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FighterRuntime } from "./fighter";
import type { FighterDefinition } from "./types";
import { getVisualContactPoint, type FighterVisual } from "./visual";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const QUATERNIUS_UBC_MALE_MODEL_URL = `${BASE_PATH}/models/quaternius/ubc-superhero-male-flat.glb`;
export const QUATERNIUS_UBC_FEMALE_MODEL_URL = `${BASE_PATH}/models/quaternius/ubc-superhero-female-flat.glb`;
export const QUATERNIUS_UAL_CORE_URL = `${BASE_PATH}/models/quaternius/ual-fight-core.glb`;
export const QUATERNIUS_PROCEDURAL_CORE_URL = `${BASE_PATH}/models/quaternius/procedural-fight-core.glb`;

export type QuaterniusBodyType = "MALE" | "FEMALE";

type MotionResources = {
  source: THREE.Group;
  clips: THREE.AnimationClip[];
};

type RuntimeResources = {
  model: THREE.Group;
  motion: MotionResources;
  bodyType: QuaterniusBodyType;
  modelUrl: string;
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
  bodyType: QuaterniusBodyType;
  modelUrl: string;
};

const runtimes = new WeakMap<THREE.Group, QuaterniusRuntime>();
const installTokens = new WeakMap<THREE.Group, object>();
const modelPromises = new Map<QuaterniusBodyType, Promise<THREE.Group>>();
let motionPromise: Promise<MotionResources> | null = null;

export function quaterniusBodyTypeForDefinition(definition: FighterDefinition): QuaterniusBodyType {
  return definition.archetype === "SPEED" ? "FEMALE" : "MALE";
}

export function quaterniusModelUrlForBodyType(bodyType: QuaterniusBodyType): string {
  return bodyType === "FEMALE" ? QUATERNIUS_UBC_FEMALE_MODEL_URL : QUATERNIUS_UBC_MALE_MODEL_URL;
}

function loadModel(bodyType: QuaterniusBodyType): Promise<THREE.Group> {
  const cached = modelPromises.get(bodyType);
  if (cached) return cached;
  const url = quaterniusModelUrlForBodyType(bodyType);
  const promise = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene).catch((error) => {
    modelPromises.delete(bodyType);
    throw error;
  });
  modelPromises.set(bodyType, promise);
  return promise;
}

function loadMotion(): Promise<MotionResources> {
  if (motionPromise) return motionPromise;
  const loader = new GLTFLoader();
  motionPromise = Promise.all([
    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),
    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),
  ]).then(([base, procedural]) => ({
    // Keep canonical UAL locomotion/state clips and layer Procedural Fight v2
    // combat clips into the same visible fighter runtime.
    source: base.scene,
    clips: [...base.animations, ...procedural.animations],
  })).catch((error) => {
    motionPromise = null;
    throw error;
  });
  return motionPromise;
}

function loadResources(bodyType: QuaterniusBodyType): Promise<RuntimeResources> {
  const modelUrl = quaterniusModelUrlForBodyType(bodyType);
  return Promise.all([loadModel(bodyType), loadMotion()]).then(([model, motion]) => ({
    model,
    motion,
    bodyType,
    modelUrl,
  }));
}

function nodeMap(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const result = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (object.name) result.set(object.name, object);
  });
  return result;
}

/**
 * UAL and UBC share 65/65 joint names, but some releases use different local
 * rest rotations. Directly binding the absolute UAL quaternions therefore
 * creates an A/T-pose bias. Retarget each rotation as:
 * targetRest * inverse(sourceRest) * sourceAnimated.
 *
 * Bone positions/scales stay authored by the target model so limb lengths do
 * not collapse. Only pelvis Y delta is retained; gameplay owns world X/Z.
 */
function retargetMotionClips(
  sourceRoot: THREE.Object3D,
  targetRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
): Map<string, THREE.AnimationClip> {
  const sourceNodes = nodeMap(sourceRoot);
  const targetNodes = nodeMap(targetRoot);
  const result = new Map<string, THREE.AnimationClip>();
  const sourceAnimated = new THREE.Quaternion();
  const sourceRestInverse = new THREE.Quaternion();
  const targetAnimated = new THREE.Quaternion();

  for (const clip of clips) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      const nodeName = parsed.nodeName;
      const propertyName = parsed.propertyName;
      if (!nodeName || !propertyName) continue;
      const sourceNode = sourceNodes.get(nodeName);
      const targetNode = targetNodes.get(nodeName);
      if (!sourceNode || !targetNode) continue;

      if (propertyName === "quaternion" && track.values.length % 4 === 0) {
        const values = new Float32Array(track.values.length);
        sourceRestInverse.copy(sourceNode.quaternion).invert();
        for (let offset = 0; offset < track.values.length; offset += 4) {
          sourceAnimated.fromArray(track.values, offset).normalize();
          targetAnimated.copy(targetNode.quaternion)
            .multiply(sourceRestInverse)
            .multiply(sourceAnimated)
            .normalize();
          targetAnimated.toArray(values, offset);
        }
        const next = new THREE.QuaternionKeyframeTrack(track.name, track.times, values);
        next.setInterpolation(track.getInterpolation());
        tracks.push(next);
        continue;
      }

      if (propertyName === "position" && nodeName === "pelvis" && track.values.length % 3 === 0) {
        const values = new Float32Array(track.values.length);
        for (let offset = 0; offset < track.values.length; offset += 3) {
          values[offset] = targetNode.position.x;
          values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y);
          values[offset + 2] = targetNode.position.z;
        }
        const next = new THREE.VectorKeyframeTrack(track.name, track.times, values);
        next.setInterpolation(track.getInterpolation());
        tracks.push(next);
      }
    }
    const retargeted = new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
    retargeted.optimize();
    result.set(retargeted.name, retargeted);
  }
  return result;
}

function styleMaterial(material: THREE.Material, definition: FighterDefinition): THREE.Material {
  const next = material.clone();
  if (!(next instanceof THREE.MeshStandardMaterial)) return next;

  const name = next.name.toLowerCase();
  const primary = new THREE.Color(definition.colors.primary);
  const secondary = new THREE.Color(definition.colors.secondary);
  const accent = new THREE.Color(definition.colors.accent);
  const skin = new THREE.Color(definition.colors.skin);
  const hair = new THREE.Color(definition.colors.hair);

  next.map = null;
  next.normalMap = null;
  next.roughnessMap = null;
  next.metalnessMap = null;
  next.aoMap = null;
  next.emissiveMap = null;
  next.alphaMap = null;
  next.flatShading = true;
  next.roughness = 0.84;
  next.metalness = 0.04;

  if (name.includes("hair")) next.color.copy(hair);
  else if (name.includes("skin") || name.includes("face")) next.color.copy(skin);
  else if (name.includes("eye")) next.color.copy(accent);
  else if (name.includes("dark") || name.includes("black")) next.color.copy(secondary);
  else next.color.lerp(primary, 0.72);

  next.needsUpdate = true;
  return next;
}

function cloneAndStyleModel(
  source: THREE.Group,
  visual: FighterVisual,
  definition: FighterDefinition,
  bodyType: QuaterniusBodyType,
): Pick<QuaterniusRuntime, "host" | "model" | "bones" | "ownedMaterials"> {
  const model = cloneSkeleton(source) as THREE.Group;
  const ownedMaterials: THREE.Material[] = [];
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
      const next = styleMaterial(material, definition);
      ownedMaterials.push(next);
      return next;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });

  const host = new THREE.Group();
  host.name = `quaternius-ubc-${bodyType.toLowerCase()}-runtime`;
  host.scale.setScalar(1 / height);
  model.position.set(-center.x, -sourceBounds.min.y, -center.z);
  host.add(model);
  visual.root.add(host);

  return { host, model, bones: nodeMap(model), ownedMaterials };
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
  const poleVector = pole.clone().sub(rootPos);
  const poleDirection = poleVector.clone().addScaledVector(direction, -poleVector.dot(direction));
  if (poleDirection.lengthSq() < 1e-8) poleDirection.set(0, 1, 0);
  poleDirection.normalize();
  const cosRoot = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
  const along = a * cosRoot;
  const jointHeight = Math.sqrt(Math.max(0, a * a - along * along));
  const joint = rootPos.clone().addScaledVector(direction, along).addScaledVector(poleDirection, jointHeight);

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


// UBC shoulder skinning is shared between clavicle and upper-arm joints. Driving
// upperarm_* alone with IK can fold the shoulder volume inward when the fist is
// pulled toward the guard/contact target. Share a small, clamped part of the
// upper-arm swing with clavicle_* first, then solve the residual on the arm.
const MAX_IMPORTED_CLAVICLE_SWING = THREE.MathUtils.degToRad(14);

function solveImportedArm(
  runtime: QuaterniusRuntime,
  suffix: "l" | "r",
  upperArm: THREE.Object3D,
  forearm: THREE.Object3D,
  hand: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  shoulderShare: number,
): void {
  const clavicle = runtime.bones.get(`clavicle_${suffix}`);
  if (clavicle) {
    upperArm.updateWorldMatrix(true, true);
    const rootPos = upperArm.getWorldPosition(new THREE.Vector3());
    const midPos = forearm.getWorldPosition(new THREE.Vector3());
    const endPos = hand.getWorldPosition(new THREE.Vector3());
    const a = Math.max(1e-4, rootPos.distanceTo(midPos));
    const b = Math.max(1e-4, midPos.distanceTo(endPos));
    const toTarget = target.clone().sub(rootPos);
    const rawDistance = Math.max(1e-4, toTarget.length());
    const distance = THREE.MathUtils.clamp(rawDistance, Math.abs(a - b) + 1e-4, a + b - 1e-4);
    const direction = toTarget.normalize();
    const poleVector = pole.clone().sub(rootPos);
    const poleDirection = poleVector.clone().addScaledVector(direction, -poleVector.dot(direction));
    if (poleDirection.lengthSq() < 1e-8) poleDirection.set(0, 1, 0);
    poleDirection.normalize();
    const cosRoot = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
    const along = a * cosRoot;
    const jointHeight = Math.sqrt(Math.max(0, a * a - along * along));
    const joint = rootPos.clone().addScaledVector(direction, along).addScaledVector(poleDirection, jointHeight);
    const currentDirection = midPos.clone().sub(rootPos).normalize();
    const desiredDirection = joint.clone().sub(rootPos).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(currentDirection, desiredDirection);
    const swingAngle = new THREE.Quaternion().angleTo(swing);
    if (swingAngle > 1e-5) {
      const distributedAngle = Math.min(MAX_IMPORTED_CLAVICLE_SWING, swingAngle * THREE.MathUtils.clamp(shoulderShare, 0, 0.45));
      const distributed = new THREE.Quaternion().slerp(swing, distributedAngle / swingAngle);
      const clavicleWorld = clavicle.getWorldQuaternion(new THREE.Quaternion());
      setWorldQuaternion(clavicle, distributed.multiply(clavicleWorld));
      clavicle.updateWorldMatrix(true, true);
    }
  }
  solveImportedLimb(upperArm, forearm, hand, target, pole);
}

function attackContactCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move || !fighter.isActive()) return;
  if (!move.visualContact || move.visualContact === "BODY") return;
  const target = getVisualContactPoint(fighter.visual, move.visualContact);
  const isFoot = move.visualContact.endsWith("FOOT");
  const candidates = (["l", "r"] as const).map((suffix) => {
    const root = runtime.bones.get(isFoot ? `thigh_${suffix}` : `upperarm_${suffix}`);
    const mid = runtime.bones.get(isFoot ? `calf_${suffix}` : `lowerarm_${suffix}`);
    const end = runtime.bones.get(isFoot ? `foot_${suffix}` : `hand_${suffix}`);
    return root && mid && end ? { root, mid, end, distance: end.getWorldPosition(new THREE.Vector3()).distanceTo(target), suffix } : null;
  }).filter((value): value is NonNullable<typeof value> => Boolean(value));
  candidates.sort((a, b) => a.distance - b.distance);
  const chain = candidates[0];
  if (!chain) return;
  const side = chain.suffix === "l" ? 1 : -1;
  const pole = fighter.visual.root.localToWorld(new THREE.Vector3(side * (isFoot ? 0.48 : 0.62), isFoot ? 0.42 : 0.74, isFoot ? 0.24 : 0.32));
  if (isFoot) solveImportedLimb(chain.root, chain.mid, chain.end, target, pole);
  else solveImportedArm(runtime, chain.suffix, chain.root, chain.mid, chain.end, target, pole, 0.24);
}


// Imported UBC neutral/guard poses use UBC shoulder space, not the hidden
// procedural fighter's fist end-effectors. Reusing those legacy targets pulled
// the imported arms through the chest. Build a compact fighting guard from the
// actual imported shoulder position and keep both hands explicitly in front of
// the torso. Active attacks still use deterministic gameplay contact targets.
const IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 1.72;
const IMPORTED_GUARD_FORWARD_CLEARANCE = 1.98;
const IMPORTED_NEUTRAL_HAND_LIFT = 0.035;
const IMPORTED_GUARD_HAND_LIFT = 0.082;

function importedReadyArmPose(
  fighter: FighterRuntime,
  suffix: "l" | "r",
  upperArm: THREE.Object3D,
  guard: boolean,
): { target: THREE.Vector3; pole: THREE.Vector3 } {
  upperArm.updateWorldMatrix(true, true);
  const shoulderWorld = upperArm.getWorldPosition(new THREE.Vector3());
  const shoulderLocal = fighter.visual.root.worldToLocal(shoulderWorld.clone());
  const side = suffix === "l" ? 1 : -1;
  const layout = fighter.visual.layout;

  const targetLocal = shoulderLocal.clone();
  // Keep the fists in a compact forward guard. The previous neutral pole sat
  // below the shoulder, which made the two-bone solver choose a hanging elbow
  // plane and visibly folded the forearm downward.
  targetLocal.x -= side * layout.shoulderWidth * (guard ? 0.07 : 0.11);
  targetLocal.y += guard ? IMPORTED_GUARD_HAND_LIFT : IMPORTED_NEUTRAL_HAND_LIFT;
  targetLocal.z += layout.chestDepth * (guard ? IMPORTED_GUARD_FORWARD_CLEARANCE : IMPORTED_NEUTRAL_FORWARD_CLEARANCE);

  // The pole stays lateral and at shoulder height so the elbow bends outward,
  // never underneath the upper arm. The fist target remains slightly above it.
  const poleLocal = shoulderLocal.clone();
  poleLocal.x += side * layout.shoulderWidth * (guard ? 0.86 : 0.82);
  poleLocal.y += guard ? 0.010 : 0.0;
  poleLocal.z += layout.chestDepth * (guard ? 1.12 : 0.94);

  return {
    target: fighter.visual.root.localToWorld(targetLocal),
    pole: fighter.visual.root.localToWorld(poleLocal),
  };
}

function neutralPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  if (fighter.state !== "IDLE" && fighter.state !== "WALK" && fighter.state !== "CROUCH") return;
  for (const suffix of ["l", "r"] as const) {
    const root = runtime.bones.get(`upperarm_${suffix}`);
    const mid = runtime.bones.get(`lowerarm_${suffix}`);
    const end = runtime.bones.get(`hand_${suffix}`);
    if (!root || !mid || !end) continue;
    const pose = importedReadyArmPose(fighter, suffix, root, false);
    solveImportedArm(runtime, suffix, root, mid, end, pose.target, pose.pole, 0.18);
  }
}

function guardPoseCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  if (fighter.state !== "GUARD") return;
  for (const suffix of ["l", "r"] as const) {
    const root = runtime.bones.get(`upperarm_${suffix}`);
    const mid = runtime.bones.get(`lowerarm_${suffix}`);
    const end = runtime.bones.get(`hand_${suffix}`);
    if (!root || !mid || !end) continue;
    const pose = importedReadyArmPose(fighter, suffix, root, true);
    solveImportedArm(runtime, suffix, root, mid, end, pose.target, pose.pole, 0.24);
  }
}

const PROCEDURAL_ATTACK_CLIPS: Readonly<Record<string, string>> = {
  jab: "PF_Jab_L",
  straight: "PF_Cross_R",
  backfist: "PF_Backfist_R",
  bodyBlow: "PF_BodyBlow_L",
  power: "PF_Power_R",
  kick: "PF_FrontKick_R",
  lowKick: "PF_LowKick_L",
  risingKick: "PF_RisingKick_R",
  dashKick: "PF_DashKick_R",
  throw: "PF_Throw",
  counter: "PF_Counter_R",
};

function proceduralAttackClip(moveId: string): string | null {
  return PROCEDURAL_ATTACK_CLIPS[moveId] ?? null;
}

function desiredClip(fighter: FighterRuntime): { name: string; loop: boolean; speed: number } {
  const move = fighter.currentMove;
  if (fighter.state === "ATTACK" && move) {
    const seconds = Math.max(1 / 60, (move.startup + move.active + move.recovery) / 60);
    const proceduralClip = proceduralAttackClip(move.id);
    if (proceduralClip) return { name: proceduralClip, loop: false, speed: 1 / seconds };
    if (move.animation === "punch") return { name: "Punch_Cross", loop: false, speed: 1 / seconds };
    if (move.animation === "kick") return { name: "Jump_Start", loop: false, speed: 1 / seconds };
    if (move.animation === "throw") return { name: "PF_Throw", loop: false, speed: 1 / seconds };
    return { name: "Punch_Cross", loop: false, speed: 1 / seconds };
  }
  switch (fighter.state) {
    case "WALK": return { name: "Walk_Loop", loop: true, speed: 1 };
    case "CROUCH": return { name: "Crouch_Idle_Loop", loop: true, speed: 1 };
    case "GUARD": return { name: "Idle_Loop", loop: true, speed: 0.82 };
    case "BLOCK_STUN": return { name: "PF_GuardBreak", loop: false, speed: 1.35 };
    case "SIDESTEP": return { name: "Roll", loop: false, speed: 1.2 };
    case "JUMP": return { name: "Jump_Loop", loop: true, speed: 1 };
    case "HIT": return { name: "PF_HitHeavy", loop: false, speed: 1.35 };
    case "KNOCKDOWN":
    case "KO":
    case "RING_OUT": return { name: "PF_DownBack", loop: false, speed: 1 };
    case "THROW": return { name: "PF_Throw", loop: false, speed: 1 };
    case "WAKEUP": return { name: "PF_Wakeup", loop: false, speed: 1.2 };
    default: return { name: "Idle_Loop", loop: true, speed: 1 };
  }
}

function playClip(runtime: QuaterniusRuntime, name: string, loop: boolean, speed: number, restart = false): void {
  if (runtime.currentClip === name && !restart) return;
  const clip = runtime.clips.get(name) ?? runtime.clips.get("Idle_Loop");
  if (!clip) return;
  runtime.currentAction?.fadeOut(0.06);
  const action = runtime.mixer.clipAction(clip, runtime.model);
  action.reset();
  action.enabled = true;
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.timeScale = loop ? speed : Math.max(0.25, clip.duration * speed);
  action.fadeIn(0.06).play();
  runtime.currentClip = name;
  runtime.currentAction = action;
  runtime.host.userData.quaterniusCurrentClip = clip.name;
}

function advance(runtime: QuaterniusRuntime, timeSeconds: number): void {
  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, 0.05) : 0;
  runtime.lastTime = timeSeconds;
  runtime.mixer.update(delta);
  runtime.model.updateMatrixWorld(true);
}

export function installQuaterniusModelSkin(visual: FighterVisual, definition: FighterDefinition): void {
  if (typeof window === "undefined" || runtimes.has(visual.root)) return;
  const token = {};
  const bodyType = quaterniusBodyTypeForDefinition(definition);
  const modelUrl = quaterniusModelUrlForBodyType(bodyType);
  installTokens.set(visual.root, token);
  visual.root.userData.modelSkin = "QUATERNIUS_UBC";
  visual.root.userData.quaterniusBodyType = bodyType;
  visual.root.userData.quaterniusModelState = "loading";
  void loadResources(bodyType).then((resources) => {
    if (installTokens.get(visual.root) !== token) return;
    const styled = cloneAndStyleModel(resources.model, visual, definition, bodyType);
    const retargetedClips = retargetMotionClips(resources.motion.source, styled.model, resources.motion.clips);
    const runtime: QuaterniusRuntime = {
      ...styled,
      mixer: new THREE.AnimationMixer(styled.model),
      clips: retargetedClips,
      currentClip: "",
      currentAction: null,
      lastTime: 0,
      lastMoveTick: -1,
      bodyType: resources.bodyType,
      modelUrl: resources.modelUrl,
    };
    runtimes.set(visual.root, runtime);
    for (const mesh of visual.allMeshes) {
      if (mesh !== visual.aura) mesh.visible = false;
    }
    visual.root.userData.quaterniusModelState = "ready";
    visual.root.userData.quaterniusModelAsset = modelUrl;
    visual.root.userData.quaterniusAnimationRigCoverage = 1;
    visual.root.userData.quaterniusRetargetMode = "rest-delta";
  }).catch((error: unknown) => {
    if (installTokens.get(visual.root) !== token) return;
    visual.root.userData.quaterniusModelState = "failed";
    console.error(`[POLY FIGHTER] Quaternius UBC ${bodyType.toLowerCase()} model load failed`, error);
  });
}

export function updateQuaterniusModelSkin(fighter: FighterRuntime, timeSeconds: number): void {
  const runtime = runtimes.get(fighter.visual.root);
  if (!runtime) return;
  const desired = desiredClip(fighter);
  const restartingAttack = fighter.state === "ATTACK" && fighter.moveTick < runtime.lastMoveTick;
  runtime.lastMoveTick = fighter.moveTick;
  playClip(runtime, desired.name, desired.loop, desired.speed, restartingAttack);
  advance(runtime, timeSeconds);
  neutralPoseCorrection(runtime, fighter);
  guardPoseCorrection(runtime, fighter);
  attackContactCorrection(runtime, fighter);
  runtime.model.updateMatrixWorld(true);
}

export function updateQuaterniusModelPreview(visual: FighterVisual, timeSeconds: number): void {
  const runtime = runtimes.get(visual.root);
  if (!runtime) return;
  playClip(runtime, "Idle_Loop", true, 0.8);
  advance(runtime, timeSeconds);
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
