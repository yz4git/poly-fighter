import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FighterRuntime } from "./fighter";
import { motionCorrectionsEnabled } from "./motion-correction-state";
import type { FighterDefinition } from "./types";
import { getVisualContactPoint, type FighterVisual } from "./visual";
import { createCombatMotionLibrary, solveCombatLimb } from "./combat-motion-authoring";
import { AUTHORED_CONTACT_PHASE, COMBAT_MOTION_VERSION, combatAttackPhase, combatFootCycle, locomotionDirection, smoothMotion } from "./combat-motion-clock";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const QUATERNIUS_UBC_MALE_MODEL_URL = `${BASE_PATH}/models/quaternius/ubc-superhero-male-flat.glb`;
export const QUATERNIUS_UBC_FEMALE_MODEL_URL = `${BASE_PATH}/models/quaternius/ubc-superhero-female-flat.glb`;
export const QUATERNIUS_UAL_CORE_URL = `${BASE_PATH}/models/quaternius/ual-fight-core.glb`;
export const QUATERNIUS_PROCEDURAL_CORE_URL = `${BASE_PATH}/models/quaternius/procedural-fight-core.glb`;
export const QUATERNIUS_BLENDER_CORE_URL = `${BASE_PATH}/models/quaternius/blender-fight-core.glb`;
export const QUATERNIUS_BLENDER_CROSS_URL = `${BASE_PATH}/models/quaternius/blender-cross-core.glb`;
export const QUATERNIUS_BLENDER_STRIKES_URL = `${BASE_PATH}/models/quaternius/blender-strikes-core.glb`;
export const QUATERNIUS_BLENDER_KICKS_URL = `${BASE_PATH}/models/quaternius/blender-kicks-core.glb`;
export const QUATERNIUS_BLENDER_AIRBORNE_URL = `${BASE_PATH}/models/quaternius/blender-airborne-core.glb`;
export const QUATERNIUS_BLENDER_REACTIONS_URL = `${BASE_PATH}/models/quaternius/blender-reactions-core.glb`;

export type QuaterniusBodyType = "MALE" | "FEMALE";

type MotionClipSource = {
  source: THREE.Group;
  clips: THREE.AnimationClip[];
};

type MotionResources = {
  base: MotionClipSource;
  procedural: MotionClipSource;
  blender: MotionClipSource | null;
  blenderCross: MotionClipSource | null;
  blenderStrikes: MotionClipSource | null;
  blenderKicks: MotionClipSource | null;
  blenderAirborne: MotionClipSource | null;
  blenderReactions: MotionClipSource | null;
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
  lastReactionSerial: number;
  ownedMaterials: THREE.Material[];
  bodyType: QuaterniusBodyType;
  modelUrl: string;
  lastPosition: THREE.Vector3 | null;
  motionX: number;
  motionZ: number;
  gaitPhase: number;
  lastYaw: number | null;
  turnRate: number;
  lastState: string;
  lastStateTicks: number;
  stateDuration: number;
  clock: number;
  landingEnd: number;
  transitionAge: number;
  transitionDuration: number;
  transitionPose: Map<string, { position: THREE.Vector3; rotation: THREE.Quaternion }>;
  plantedFeet: { l: THREE.Vector3 | null; r: THREE.Vector3 | null };
  finalTime: number;
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
  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);
  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);
  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);
  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);
  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);
  const blenderReactionMotion = loader.loadAsync(QUATERNIUS_BLENDER_REACTIONS_URL).catch(() => null);
  motionPromise = Promise.all([
    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),
    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),
    blenderMotion,
    blenderCrossMotion,
    blenderStrikeMotion,
    blenderKickMotion,
    blenderAirborneMotion,
    blenderReactionMotion,
  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne, blenderReactions]) => ({
    // Each Blender Foundry pack is optional and falls back independently.
    // The shared strike pack carries Jab / Body Blow / Backfist in one GLB.
    base: { source: base.scene, clips: base.animations },
    procedural: { source: procedural.scene, clips: procedural.animations },
    blender: blender ? { source: blender.scene, clips: blender.animations } : null,
    blenderCross: blenderCross ? { source: blenderCross.scene, clips: blenderCross.animations } : null,
    blenderStrikes: blenderStrikes ? { source: blenderStrikes.scene, clips: blenderStrikes.animations } : null,
    blenderKicks: blenderKicks ? { source: blenderKicks.scene, clips: blenderKicks.animations } : null,
    blenderAirborne: blenderAirborne ? { source: blenderAirborne.scene, clips: blenderAirborne.animations } : null,
    blenderReactions: blenderReactions ? { source: blenderReactions.scene, clips: blenderReactions.animations } : null,
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
 * not collapse. Local pelvis XYZ deltas retain authored weight transfer; gameplay still owns world X/Z.
 */
export function retargetMotionClips(
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
          values[offset] = targetNode.position.x + (track.values[offset] - sourceNode.position.x);
          values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y);
          values[offset + 2] = targetNode.position.z + (track.values[offset + 2] - sourceNode.position.z);
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

const BLENDER_AUTHORED_CONTACT_SAFE_MOVES = new Set([
  "jab",
  "straight",
  "bodyBlow",
  "backfist",
  "power",
  "kick",
  "lowKick",
  "risingKick",
  "dashKick",
]);

function attackContactCorrection(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move || !fighter.isActive()) return;
  if (!move.visualContact || move.visualContact === "BODY") return;
  // Motion Foundry clips already contain authored hand/foot targets, pole vectors
  // and support-foot work. A second exact end-effector solve visibly destroyed
  // those silhouettes in the ON/OFF review, so preserve them verbatim.
  if (BLENDER_AUTHORED_CONTACT_SAFE_MOVES.has(move.id)) {
    fighter.visual.root.userData.quaterniusAttackCorrectionPolicy = "AUTHORED_CONTACT_PRESERVE";
    return;
  }
  fighter.visual.root.userData.quaterniusAttackCorrectionPolicy = "PROCEDURAL_CONTACT_ASSIST";
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
const IMPORTED_NEUTRAL_FORWARD_CLEARANCE = 0.58;
const IMPORTED_GUARD_FORWARD_CLEARANCE = 0.88;
const IMPORTED_NEUTRAL_HAND_LIFT = -0.085;
const IMPORTED_GUARD_HAND_LIFT = -0.015;

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
    solveImportedArm(runtime, suffix, root, mid, end, pose.target, pose.pole, 0.05);
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
    solveImportedArm(runtime, suffix, root, mid, end, pose.target, pose.pole, 0.08);
  }
}

const PROCEDURAL_ATTACK_CLIPS: Readonly<Record<string, string>> = {
  jab: "BF_Jab_L",
  straight: "BF_Cross_R",
  backfist: "BF_Backfist_R",
  bodyBlow: "BF_BodyBlow_L",
  power: "BF_Power_R",
  kick: "BF_FrontKick_R",
  lowKick: "BF_LowKick_L",
  risingKick: "BF_RisingKick_R",
  dashKick: "BF_DashKick_R",
  throw: "PF_Throw",
  counter: "PF_Counter_R",
};

function proceduralAttackClip(moveId: string): string | null {
  return PROCEDURAL_ATTACK_CLIPS[moveId] ?? null;
}

// The exported V6 mocap clips intentionally retain a readable anticipation arc,
// so their authored IMPACT pose lands around the middle of each clip. Gameplay,
// however, can connect on the first ACTIVE tick. Lock the three grounded V6 kicks
// to their measured impact phase at ACTIVE start, hold only a narrow contact arc
// through ACTIVE, then spend the remaining time on recovery. This keeps hit timing
// unchanged while making the rendered foot and gameplay hitbox agree.
const V6_KICK_CONTACT_PHASE: Readonly<Record<string, number>> = {
  BF_FrontKick_R: 0.5476190476190477,
  BF_LowKick_L: 0.5333333333333333,
  BF_RisingKick_R: 0.5625,
};
function observeMotion(runtime: QuaterniusRuntime, fighter: FighterRuntime, delta: number): void {
  const forwardArray = fighter.visual.root.userData.combatMotionForward as number[] | undefined;
  const forward = forwardArray ? new THREE.Vector3().fromArray(forwardArray) : new THREE.Vector3(0, 0, 1).applyQuaternion(fighter.visual.root.quaternion);
  const yaw = Math.atan2(forward.x, forward.z);
  if (runtime.lastYaw !== null && delta > 0) {
    const difference = Math.atan2(Math.sin(yaw - runtime.lastYaw), Math.cos(yaw - runtime.lastYaw));
    runtime.turnRate = THREE.MathUtils.damp(runtime.turnRate, difference / delta, 18, delta);
  }
  runtime.lastYaw = yaw;
  if (runtime.lastPosition && delta > 0 && fighter.hitStop <= 0) {
    const step = fighter.position.clone().sub(runtime.lastPosition);
    step.y = 0;
    // A round reset/throw placement is a discontinuity, never a locomotion stride.
    if (step.length() < .65 && fighter.state === "WALK") {
      const right = new THREE.Vector3(forward.z, 0, -forward.x);
      runtime.motionX = step.dot(right);
      runtime.motionZ = step.dot(forward);
      const stature = fighter.visual.root.scale.x;
      runtime.gaitPhase = (runtime.gaitPhase + step.length() * .62 / Math.max(.1, stature * .38)) % 1;
    }
  }
  runtime.lastPosition = fighter.position.clone();
}

function desiredClip(fighter: FighterRuntime, runtime: QuaterniusRuntime): { name: string; loop: boolean; speed: number } {
  const move = fighter.currentMove;
  if (fighter.state === "ATTACK" && move) {
    const seconds = Math.max(1 / 60, (move.startup + move.active + move.recovery) / 60);
    if (move.id === "counter") return { name: `CM_Counter_${move.visualContact === "LEFT_FIST" ? "L" : "R"}`, loop: false, speed: 1 / seconds };
    if (move.id === "throw") return { name: "CM_Throw", loop: false, speed: 1 / seconds };
    if (move.id === "backfist" && move.visualContact === "LEFT_FIST") return { name: "BF_Backfist_L", loop: false, speed: 1 / seconds };
    if (move.id === "bodyBlow" && move.visualContact === "RIGHT_FIST") return { name: "BF_BodyBlow_R", loop: false, speed: 1 / seconds };
    return { name: proceduralAttackClip(move.id) ?? "BF_Cross_R", loop: false, speed: 1 / seconds };
  }
  switch (fighter.state) {
    case "WALK": return { name: `CM_Move_${locomotionDirection(runtime.motionX, runtime.motionZ)}`, loop: true, speed: 1 };
    case "CROUCH": return { name: "CM_Crouch", loop: true, speed: 1 };
    case "GUARD": return { name: "CM_Guard", loop: true, speed: 1 };
    case "BLOCK_STUN": return { name: "CM_Block", loop: false, speed: 1 };
    case "SIDESTEP": {
      const direction = String(fighter.visual.root.userData.combatStepDirection ?? "R");
      return { name: `CM_Step_${direction}`, loop: false, speed: 1 };
    }
    case "JUMP": return { name: "CM_Jump", loop: false, speed: 1 };
    case "HIT": {
      const side = fighter.reactionSide === "LEFT" ? "L" : "R";
      if (!fighter.grounded && fighter.velocity.y > 2.5) return { name: "CM_Launch", loop: false, speed: 1 };
      if (fighter.reactionAtEdge) return { name: "BF_EdgeStagger", loop: false, speed: 1 };
      if (fighter.reactionKind === "COUNTER") return { name: `BF_CounterHit_${side}`, loop: false, speed: 1 };
      if (fighter.reactionKind === "LIGHT") return { name: `BF_HitLight_${side}`, loop: false, speed: 1 };
      if (fighter.reactionKind === "MID") return { name: `BF_HitMid_${side}`, loop: false, speed: 1 };
      return { name: "BF_HitHeavy", loop: false, speed: 1 };
    }
    case "KNOCKDOWN":
    case "KO":
    case "RING_OUT": return { name: "CM_Down", loop: false, speed: 1 };
    case "THROW": return { name: "CM_Thrown", loop: false, speed: 1 };
    case "WAKEUP": return { name: "CM_Wakeup", loop: false, speed: 1 };
    default:
      if (runtime.clock < runtime.landingEnd) return { name: "CM_Land", loop: false, speed: 1 };
      if (Math.abs(runtime.turnRate) > .4) return { name: `CM_Turn_${runtime.turnRate < 0 ? "L" : "R"}`, loop: true, speed: Math.max(.6, Math.min(1.5, Math.abs(runtime.turnRate))) };
      return { name: "CM_Ready", loop: true, speed: 1 };
  }
}

function transitionFadeSeconds(previous: string, next: string): number {
  if (next === "CM_Block" || next.startsWith("BF_Hit") || next.startsWith("BF_Counter")) return .032;
  if (next === "CM_Wakeup") return .05;
  if (next.startsWith("CM_Move") && previous.startsWith("CM_Move")) return .085;
  if (next.startsWith("CM_Step")) return .035;
  if (next === "CM_Ready" || next === "CM_Guard") return .11;
  return .055;
}

function playClip(runtime: QuaterniusRuntime, name: string, loop: boolean, speed: number, restart = false): void {
  const clip = runtime.clips.get(name) ?? runtime.clips.get("CM_Ready") ?? runtime.clips.get("Idle_Loop");
  if (!clip) return;
  if (runtime.currentClip === clip.name && !restart) {
    runtime.currentAction?.setEffectiveTimeScale(loop ? speed : Math.max(.25, clip.duration * speed));
    return;
  }
  runtime.transitionPose.clear();
  if (runtime.currentAction) {
    for (const [boneName, bone] of runtime.bones) {
      if (!(bone as THREE.Bone).isBone) continue;
      runtime.transitionPose.set(boneName, { position: bone.position.clone(), rotation: bone.quaternion.clone() });
    }
  }
  runtime.transitionDuration = transitionFadeSeconds(runtime.currentClip, clip.name);
  runtime.transitionAge = 0;
  // Snapshot the rendered pose before stopping. Same-clip repeats and combo
  // interruptions cannot reset a live outgoing action or accumulate old weights.
  runtime.mixer.stopAllAction();
  const action = runtime.mixer.clipAction(clip, runtime.model);
  action.reset().setEffectiveWeight(1).setEffectiveTimeScale(loop ? speed : Math.max(.25, clip.duration * speed));
  action.enabled = true;
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.play();
  runtime.currentClip = clip.name;
  runtime.currentAction = action;
  runtime.host.userData.quaterniusCurrentClip = clip.name;
}

function advance(runtime: QuaterniusRuntime, timeSeconds: number, frozen = false): number {
  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, .05) : 0;
  runtime.lastTime = timeSeconds;
  if (!frozen) {
    runtime.clock += delta;
    runtime.transitionAge += delta;
    runtime.mixer.update(delta);
  }
  return frozen ? 0 : delta;
}

function synchronizeMotion(runtime: QuaterniusRuntime, fighter: FighterRuntime): void {
  const action = runtime.currentAction;
  const clip = runtime.clips.get(runtime.currentClip);
  if (!action || !clip) return;
  const ticks = fighter.stateMachine.stateTicks;
  let phase: number | null = null;
  const move = fighter.currentMove;
  if (fighter.state === "ATTACK" && move) {
    const impact = AUTHORED_CONTACT_PHASE[runtime.currentClip] ?? .5;
    phase = combatAttackPhase(move, fighter.moveTick, impact);
    runtime.host.userData.combatMotionContactPhase = impact;
    runtime.host.userData.combatMotionSampledPhase = phase;
    if (V6_KICK_CONTACT_PHASE[runtime.currentClip] !== undefined) {
      runtime.host.userData.quaterniusKickTimingPolicy = "V6_ACTIVE_CONTACT_SYNC";
      runtime.host.userData.quaterniusKickSampledPhase = phase;
    }
  } else if (fighter.state === "WALK") phase = runtime.gaitPhase;
  else if (fighter.state === "SIDESTEP") phase = Math.min(1, ticks / (fighter.visual.root.userData.combatTps ? 8 : 12));
  else if (fighter.state === "HIT" || fighter.state === "BLOCK_STUN") phase = Math.min(1, ticks / Math.max(1, runtime.stateDuration - 1));
  else if (["KNOCKDOWN", "KO", "THROW", "RING_OUT"].includes(fighter.state)) phase = Math.min(1, ticks / 29);
  else if (fighter.state === "WAKEUP") phase = Math.min(1, ticks / 22);
  else if (fighter.state === "JUMP") phase = Math.min(1, ticks / 38);
  else if (runtime.currentClip === "CM_Land") phase = Math.min(1, 1 - (runtime.landingEnd - runtime.clock) / .18);
  if (phase !== null) {
    action.setEffectiveTimeScale(0);
    action.time = clip.duration * phase;
    runtime.mixer.update(0);
  }
  if (runtime.transitionPose.size) {
    const weight = 1 - smoothMotion(runtime.transitionAge / runtime.transitionDuration);
    if (weight <= 0) runtime.transitionPose.clear();
    else for (const [name, from] of runtime.transitionPose) {
      const bone = runtime.bones.get(name)!;
      bone.quaternion.slerp(from.rotation, weight);
      bone.position.lerp(from.position, weight);
    }
  }
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
    const baseClips = retargetMotionClips(resources.motion.base.source, styled.model, resources.motion.base.clips);
    const proceduralClips = retargetMotionClips(
      resources.motion.procedural.source,
      styled.model,
      resources.motion.procedural.clips,
    );
    if (!proceduralClips.has("PF_Jab_L") || !proceduralClips.has("PF_Power_R")) {
      throw new Error(`Procedural Fight v2 clips missing after retarget: ${[...proceduralClips.keys()].join(",")}`);
    }
    const blenderClips = resources.motion.blender
      ? retargetMotionClips(resources.motion.blender.source, styled.model, resources.motion.blender.clips)
      : new Map<string, THREE.AnimationClip>();
    const blenderCrossClips = resources.motion.blenderCross
      ? retargetMotionClips(resources.motion.blenderCross.source, styled.model, resources.motion.blenderCross.clips)
      : new Map<string, THREE.AnimationClip>();
    const blenderStrikeClips = resources.motion.blenderStrikes
      ? retargetMotionClips(resources.motion.blenderStrikes.source, styled.model, resources.motion.blenderStrikes.clips)
      : new Map<string, THREE.AnimationClip>();
    const blenderKickClips = resources.motion.blenderKicks
      ? retargetMotionClips(resources.motion.blenderKicks.source, styled.model, resources.motion.blenderKicks.clips)
      : new Map<string, THREE.AnimationClip>();
    const blenderAirborneClips = resources.motion.blenderAirborne
      ? retargetMotionClips(resources.motion.blenderAirborne.source, styled.model, resources.motion.blenderAirborne.clips)
      : new Map<string, THREE.AnimationClip>();
    const blenderReactionClips = resources.motion.blenderReactions
      ? retargetMotionClips(resources.motion.blenderReactions.source, styled.model, resources.motion.blenderReactions.clips)
      : new Map<string, THREE.AnimationClip>();
    const retargetedClips = new Map<string, THREE.AnimationClip>([
      ...baseClips,
      ...proceduralClips,
      ...blenderClips,
      ...blenderCrossClips,
      ...blenderStrikeClips,
      ...blenderKickClips,
      ...blenderAirborneClips,
      ...blenderReactionClips,
    ]);
    if (!retargetedClips.has("BF_Power_R")) {
      const fallback = proceduralClips.get("PF_Power_R");
      if (fallback) {
        const alias = fallback.clone();
        alias.name = "BF_Power_R";
        retargetedClips.set(alias.name, alias);
      }
    }
    if (!retargetedClips.has("BF_Cross_R")) {
      const fallback = proceduralClips.get("PF_Cross_R");
      if (fallback) {
        const alias = fallback.clone();
        alias.name = "BF_Cross_R";
        retargetedClips.set(alias.name, alias);
      }
    }
    for (const [authored, procedural] of [
      ["BF_Jab_L", "PF_Jab_L"],
      ["BF_BodyBlow_L", "PF_BodyBlow_L"],
      ["BF_Backfist_R", "PF_Backfist_R"],
      ["BF_FrontKick_R", "PF_FrontKick_R"],
      ["BF_LowKick_L", "PF_LowKick_L"],
      ["BF_RisingKick_R", "PF_RisingKick_R"],
      ["BF_DashKick_R", "PF_DashKick_R"],
      ["BF_HitHeavy", "PF_HitHeavy"],
      ["BF_HitLight_L", "PF_HitHeavy"],
      ["BF_HitLight_R", "PF_HitHeavy"],
      ["BF_HitMid_L", "PF_HitHeavy"],
      ["BF_HitMid_R", "PF_HitHeavy"],
      ["BF_CounterHit_L", "PF_HitHeavy"],
      ["BF_CounterHit_R", "PF_HitHeavy"],
      ["BF_EdgeStagger", "PF_HitHeavy"],
      ["BF_GuardBreak", "PF_GuardBreak"],
    ] as const) {
      if (retargetedClips.has(authored)) continue;
      const fallback = proceduralClips.get(procedural);
      if (!fallback) continue;
      const alias = fallback.clone();
      alias.name = authored;
      retargetedClips.set(alias.name, alias);
    }
    const combatClips = createCombatMotionLibrary(styled.model, retargetedClips, definition);
    for (const [name, clip] of combatClips) retargetedClips.set(name, clip);
    visual.root.userData.combatMotionClipCount = combatClips.size;
    visual.root.userData.combatMotionVersion = COMBAT_MOTION_VERSION;
    const runtime: QuaterniusRuntime = {
      ...styled,
      mixer: new THREE.AnimationMixer(styled.model),
      clips: retargetedClips,
      currentClip: "",
      currentAction: null,
      lastTime: 0,
      lastMoveTick: -1,
      lastReactionSerial: -1,
      lastPosition: null, motionX: 0, motionZ: 1, gaitPhase: 0,
      lastYaw: null, turnRate: 0, lastState: "", lastStateTicks: 0,
      stateDuration: 1, clock: 0, landingEnd: 0,
      transitionAge: 1, transitionDuration: .05, transitionPose: new Map(),
      plantedFeet: { l: null, r: null }, finalTime: -1,
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
    visual.root.userData.quaterniusRetargetMode = "rest-delta-separated-sources";
    visual.root.userData.quaterniusProceduralClipCount = proceduralClips.size;
    visual.root.userData.quaterniusBlenderClipCount = blenderClips.size + blenderCrossClips.size + blenderStrikeClips.size + blenderKickClips.size + blenderAirborneClips.size + blenderReactionClips.size;
    visual.root.userData.quaterniusBlenderCrossClipCount = blenderCrossClips.size;
    visual.root.userData.quaterniusBlenderStrikeClipCount = blenderStrikeClips.size;
    visual.root.userData.quaterniusBlenderKickClipCount = blenderKickClips.size;
    visual.root.userData.quaterniusBlenderAirborneClipCount = blenderAirborneClips.size;
    visual.root.userData.quaterniusBlenderReactionClipCount = blenderReactionClips.size;
    visual.root.userData.quaterniusPowerMotionSource = blenderClips.has("BF_Power_R")
      ? "BLENDER_MOTION_FOUNDRY_V1"
      : "PROCEDURAL_FALLBACK";
    visual.root.userData.quaterniusStraightMotionSource = blenderCrossClips.has("BF_Cross_R")
      ? "BLENDER_MOTION_FOUNDRY_V2_CROSS"
      : "PROCEDURAL_FALLBACK";
    const sharedStrikeSource = (name: string) => blenderStrikeClips.has(name)
      ? "BLENDER_MOTION_FOUNDRY_V2_SHARED_STRIKES"
      : "PROCEDURAL_FALLBACK";
    visual.root.userData.quaterniusJabMotionSource = sharedStrikeSource("BF_Jab_L");
    visual.root.userData.quaterniusBodyBlowMotionSource = sharedStrikeSource("BF_BodyBlow_L");
    visual.root.userData.quaterniusBackfistMotionSource = sharedStrikeSource("BF_Backfist_R");
    const kickSource = (name: string) => blenderKickClips.has(name)
      ? "BLENDER_MOTION_FOUNDRY_V6_REFERENCE_KICKS"
      : "PROCEDURAL_FALLBACK";
    visual.root.userData.quaterniusFrontKickMotionSource = kickSource("BF_FrontKick_R");
    visual.root.userData.quaterniusLowKickMotionSource = kickSource("BF_LowKick_L");
    visual.root.userData.quaterniusRisingKickMotionSource = kickSource("BF_RisingKick_R");
    visual.root.userData.quaterniusDashKickMotionSource = blenderAirborneClips.has("BF_DashKick_R")
      ? "BLENDER_MOTION_FOUNDRY_V2_AIRBORNE"
      : "PROCEDURAL_FALLBACK";
    const reactionSource = (name: string) => blenderReactionClips.has(name)
      ? "BLENDER_MOTION_FOUNDRY_V2_REACTIONS"
      : "PROCEDURAL_FALLBACK";
    visual.root.userData.quaterniusHitReactionMotionSource = reactionSource("BF_HitHeavy");
    const directionalReactions = ["BF_HitLight_L", "BF_HitLight_R", "BF_HitMid_L", "BF_HitMid_R", "BF_CounterHit_L", "BF_CounterHit_R", "BF_EdgeStagger"];
    visual.root.userData.quaterniusDirectionalReactionMotionSource = directionalReactions.every((name) => blenderReactionClips.has(name))
      ? "BLENDER_MOTION_FOUNDRY_V2_DIRECTIONAL_REACTIONS"
      : "PROCEDURAL_FALLBACK";
    visual.root.userData.quaterniusGuardBreakMotionSource = reactionSource("BF_GuardBreak");
  }).catch((error: unknown) => {
    if (installTokens.get(visual.root) !== token) return;
    visual.root.userData.quaterniusModelState = "failed";
    console.error(`[POLY FIGHTER] Quaternius UBC ${bodyType.toLowerCase()} model load failed`, error);
  });
}

export function updateQuaterniusModelSkin(fighter: FighterRuntime, timeSeconds: number): void {
  const runtime = runtimes.get(fighter.visual.root);
  if (!runtime) return;
  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, .05) : 0;
  observeMotion(runtime, fighter, delta);
  const stateChanged = runtime.lastState !== fighter.state;
  const restartedState = fighter.stateMachine.stateTicks < runtime.lastStateTicks;
  const restartingAttack = fighter.state === "ATTACK" && (stateChanged || fighter.moveTick < runtime.lastMoveTick);
  const restartingReaction = fighter.state === "HIT" && fighter.reactionSerial !== runtime.lastReactionSerial;
  if (stateChanged || restartedState || restartingReaction) {
    runtime.stateDuration = fighter.stateMachine.stateTicks + (fighter.state === "HIT" ? fighter.hitStun : fighter.blockStun);
    runtime.plantedFeet.l = null; runtime.plantedFeet.r = null;
  }
  if (runtime.lastState === "JUMP" && fighter.grounded && fighter.state === "IDLE") runtime.landingEnd = runtime.clock + .18;
  if (fighter.state !== "IDLE") runtime.landingEnd = 0;
  runtime.lastState = fighter.state;
  runtime.lastStateTicks = fighter.stateMachine.stateTicks;
  runtime.lastMoveTick = fighter.moveTick;
  runtime.lastReactionSerial = fighter.reactionSerial;
  const desired = desiredClip(fighter, runtime);
  playClip(runtime, desired.name, desired.loop, desired.speed, restartingAttack || restartingReaction || (restartedState && !desired.loop));
  advance(runtime, timeSeconds, fighter.hitStop > 0);
  synchronizeMotion(runtime, fighter);
  const correctionsEnabled = motionCorrectionsEnabled();
  // New clips already contain an anatomical guard. The legacy assistance toggle
  // remains meaningful only for an independently missing optional clip pack.
  if (correctionsEnabled && !runtime.clips.has("CM_Ready")) {
    neutralPoseCorrection(runtime, fighter);
    guardPoseCorrection(runtime, fighter);
    attackContactCorrection(runtime, fighter);
  }
  runtime.host.userData.quaterniusMotionCorrectionsEnabled = correctionsEnabled;
  runtime.host.userData.quaterniusMotionMode = correctionsEnabled ? "CORRECTED" : "RAW_CLIP_PLAYBACK";
  fighter.visual.root.userData.combatMotionCurrentClip = runtime.currentClip;
  fighter.visual.root.userData.combatMotionGaitPhase = runtime.gaitPhase;
  fighter.visual.root.userData.combatMotionSingleMixer = true;
  runtime.model.updateMatrixWorld(true);
}

/** Run after the final TPS yaw, never in the side-camera coordinate basis. */
export function finalizeQuaterniusModelPose(fighter: FighterRuntime, timeSeconds: number): void {
  const runtime = runtimes.get(fighter.visual.root);
  if (!runtime || runtime.finalTime === timeSeconds) return;
  runtime.finalTime = timeSeconds;
  const walking = fighter.state === "WALK";
  if (!walking || fighter.hitStop > 0) {
    if (!walking) { runtime.plantedFeet.l = null; runtime.plantedFeet.r = null; }
    return;
  }
  runtime.model.updateMatrixWorld(true);
  let maxDrift = 0;
  for (const suffix of ["l", "r"] as const) {
    const cycle = combatFootCycle(runtime.gaitPhase + (suffix === "r" ? .5 : 0));
    const foot = runtime.bones.get(`foot_${suffix}`)!;
    const root = runtime.bones.get(`thigh_${suffix}`)!;
    const knee = runtime.bones.get(`calf_${suffix}`)!;
    const current = foot.getWorldPosition(new THREE.Vector3());
    if (!cycle.planted || Math.abs(runtime.turnRate) > 2) { runtime.plantedFeet[suffix] = null; continue; }
    const anchor = runtime.plantedFeet[suffix];
    if (!anchor || anchor.distanceTo(current) > fighter.visual.root.scale.x * .08) {
      runtime.plantedFeet[suffix] = current; continue;
    }
    const rotation = foot.getWorldQuaternion(new THREE.Quaternion());
    // Preserve the authored bend plane. This solve is restricted to walking;
    // Foundry strike/support legs are never re-solved after retargeting.
    const pole = knee.getWorldPosition(new THREE.Vector3());
    solveCombatLimb(root, knee, foot, anchor, pole);
    setWorldQuaternion(foot, rotation);
    maxDrift = Math.max(maxDrift, foot.getWorldPosition(new THREE.Vector3()).distanceTo(anchor));
  }
  fighter.visual.root.userData.combatMotionFootDrift = maxDrift;
  runtime.model.updateMatrixWorld(true);
}

export function updateQuaterniusModelPreview(visual: FighterVisual, timeSeconds: number): void {
  const runtime = runtimes.get(visual.root);
  if (!runtime) return;
  playClip(runtime, "CM_Ready", true, 1);
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
