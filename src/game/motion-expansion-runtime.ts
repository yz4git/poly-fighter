import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FighterRuntime } from "./fighter";
import { motionClipForMove, motionClipForReaction } from "./motion-profile";
import { motionReactionFor } from "./motion-reaction";
import { getVisualContactPoint } from "./visual";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const UAL1_URL = `${BASE_PATH}/models/quaternius/ual-fight-core.glb`;
const UAL2_URL = `${BASE_PATH}/models/quaternius/ual2-fight-core.glb`;

const EXPANDED_STATES = new Set([
  "ATTACK",
  "HIT",
  "BLOCK_STUN",
  "KNOCKDOWN",
  "THROW",
  "KO",
  "RING_OUT",
  "WAKEUP",
  "SIDESTEP",
  "JUMP",
]);

const FALLBACK_CLIPS: Readonly<Record<string, string>> = {
  Melee_Hook: "Punch_Cross",
  Hit_Knockback: "Hit_Chest",
  OverhandThrow: "Punch_Cross",
  Slide_Start: "Roll",
  Slide_Loop: "Roll",
  Slide_Exit: "Jump_Land",
  NinjaJump_Start: "Jump_Start",
  NinjaJump_Idle_Loop: "Jump_Loop",
  NinjaJump_Land: "Jump_Land",
  Idle_Shield_Loop: "Idle_Loop",
};

type SourcePack = { source: THREE.Group; clips: THREE.AnimationClip[] };
type ExpansionRuntime = {
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  bones: Map<string, THREE.Object3D>;
  currentClip: string;
  currentAction: THREE.AnimationAction | null;
  lastTime: number;
  lastMoveTick: number;
  lastReactionSerial: number;
  ready: boolean;
  loading: boolean;
};

const runtimes = new WeakMap<THREE.Group, ExpansionRuntime>();
let sourcePromise: Promise<SourcePack[]> | null = null;

function nodeMap(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const result = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (object.name) result.set(object.name, object);
  });
  return result;
}

function loadSourcePacks(): Promise<SourcePack[]> {
  if (sourcePromise) return sourcePromise;
  const loader = new GLTFLoader();
  sourcePromise = Promise.all([
    loader.loadAsync(UAL1_URL).then((gltf) => ({ source: gltf.scene, clips: gltf.animations })),
    loader.loadAsync(UAL2_URL)
      .then((gltf) => ({ source: gltf.scene, clips: gltf.animations }))
      .catch(() => null),
  ]).then((packs) => packs.filter((pack): pack is SourcePack => Boolean(pack)));
  return sourcePromise;
}

function findImportedModel(fighter: FighterRuntime): THREE.Group | null {
  const host = fighter.visual.root.children.find((child) => child.name.startsWith("quaternius-ubc-"));
  if (!host) return null;
  const model = host.children.find((child) => child.type === "Group" || child.children.length > 0);
  return (model ?? host.children[0] ?? null) as THREE.Group | null;
}

function retargetPack(pack: SourcePack, targetRoot: THREE.Object3D): Map<string, THREE.AnimationClip> {
  const sourceNodes = nodeMap(pack.source);
  const targetNodes = nodeMap(targetRoot);
  const result = new Map<string, THREE.AnimationClip>();
  const sourceAnimated = new THREE.Quaternion();
  const sourceRestInverse = new THREE.Quaternion();
  const targetAnimated = new THREE.Quaternion();

  for (const clip of pack.clips) {
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

function ensureRuntime(fighter: FighterRuntime): ExpansionRuntime | null {
  const existing = runtimes.get(fighter.visual.root);
  if (existing) return existing;
  const model = findImportedModel(fighter);
  if (!model) return null;
  const runtime: ExpansionRuntime = {
    model,
    mixer: new THREE.AnimationMixer(model),
    clips: new Map(),
    bones: nodeMap(model),
    currentClip: "",
    currentAction: null,
    lastTime: 0,
    lastMoveTick: -1,
    lastReactionSerial: -1,
    ready: false,
    loading: true,
  };
  runtimes.set(fighter.visual.root, runtime);
  void loadSourcePacks().then((packs) => {
    for (const pack of packs) {
      for (const [name, clip] of retargetPack(pack, model)) runtime.clips.set(name, clip);
    }
    runtime.ready = runtime.clips.size > 0;
    runtime.loading = false;
    fighter.visual.root.userData.motionExpansionVersion = "MOTION_EXPANSION_V1";
    fighter.visual.root.userData.motionExpansionClipCount = runtime.clips.size;
    fighter.visual.root.userData.motionExpansionHasUAL2 = runtime.clips.has("Melee_Hook");
  }).catch((error: unknown) => {
    runtime.loading = false;
    console.error("[POLY FIGHTER] Motion Expansion load failed", error);
  });
  return runtime;
}

function resolveClip(runtime: ExpansionRuntime, requested: string): string {
  if (runtime.clips.has(requested)) return requested;
  const fallback = FALLBACK_CLIPS[requested];
  if (fallback && runtime.clips.has(fallback)) return fallback;
  return runtime.clips.has("Idle_Loop") ? "Idle_Loop" : requested;
}

function desiredMotion(fighter: FighterRuntime): { name: string; loop: boolean; speed: number } {
  const reaction = motionReactionFor(fighter);
  const move = fighter.currentMove;
  if (fighter.state === "ATTACK" && move) {
    const seconds = Math.max(1 / 60, (move.startup + move.active + move.recovery) / 60);
    return { name: motionClipForMove(move), loop: false, speed: 1 / seconds };
  }
  if (fighter.state === "HIT") {
    return { name: motionClipForReaction(reaction.kind === "NONE" ? "BODY" : reaction.kind), loop: false, speed: 2.4 - reaction.tier * 0.25 };
  }
  if (fighter.state === "BLOCK_STUN") return { name: "Hit_Knockback", loop: false, speed: 2.2 };
  if (["KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(fighter.state)) {
    if (!fighter.grounded) {
      if (fighter.velocity.y > 0.5) {
        return { name: reaction.kind === "LAUNCH" ? "NinjaJump_Start" : "Hit_Knockback", loop: false, speed: 1.45 };
      }
      return { name: "NinjaJump_Idle_Loop", loop: true, speed: 1.1 };
    }
    return { name: fighter.health <= 0 ? "Death01" : "Death01", loop: false, speed: fighter.health <= 0 ? 0.82 : 1.12 };
  }
  if (fighter.state === "WAKEUP") return { name: "NinjaJump_Land", loop: false, speed: 1.45 };
  if (fighter.state === "SIDESTEP") return { name: "Slide_Start", loop: false, speed: 2.05 };
  if (fighter.state === "JUMP") return { name: "NinjaJump_Idle_Loop", loop: true, speed: 1.1 };
  return { name: "Idle_Loop", loop: true, speed: 1 };
}

function playClip(runtime: ExpansionRuntime, requested: string, loop: boolean, speed: number, restart: boolean): void {
  const name = resolveClip(runtime, requested);
  if (runtime.currentClip === name && !restart) return;
  const clip = runtime.clips.get(name);
  if (!clip) return;
  const blend = name.startsWith("Hit_") || name === "Death01" ? 0.025 : 0.045;
  runtime.currentAction?.fadeOut(blend);
  const action = runtime.mixer.clipAction(clip, runtime.model);
  action.reset();
  action.enabled = true;
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.timeScale = loop ? speed : Math.max(0.25, clip.duration * speed);
  action.fadeIn(blend).play();
  runtime.currentClip = name;
  runtime.currentAction = action;
}

function setWorldQuaternion(object: THREE.Object3D, desiredWorld: THREE.Quaternion): void {
  const parentWorld = new THREE.Quaternion();
  object.parent?.getWorldQuaternion(parentWorld);
  object.quaternion.copy(object.parent ? parentWorld.invert().multiply(desiredWorld) : desiredWorld);
}

function solveLimb(root: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  root.updateWorldMatrix(true, true);
  const rootPos = root.getWorldPosition(new THREE.Vector3());
  const midPos = mid.getWorldPosition(new THREE.Vector3());
  const endPos = end.getWorldPosition(new THREE.Vector3());
  const a = Math.max(1e-4, rootPos.distanceTo(midPos));
  const b = Math.max(1e-4, midPos.distanceTo(endPos));
  const toTarget = target.clone().sub(rootPos);
  const distance = THREE.MathUtils.clamp(toTarget.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const direction = toTarget.normalize();
  const poleVector = pole.clone().sub(rootPos);
  const poleDirection = poleVector.clone().addScaledVector(direction, -poleVector.dot(direction));
  if (poleDirection.lengthSq() < 1e-8) poleDirection.set(0, 1, 0);
  poleDirection.normalize();
  const cosRoot = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
  const joint = rootPos.clone()
    .addScaledVector(direction, a * cosRoot)
    .addScaledVector(poleDirection, Math.sqrt(Math.max(0, a * a - (a * cosRoot) ** 2)));
  const rootDelta = new THREE.Quaternion().setFromUnitVectors(midPos.clone().sub(rootPos).normalize(), joint.clone().sub(rootPos).normalize());
  setWorldQuaternion(root, rootDelta.multiply(root.getWorldQuaternion(new THREE.Quaternion())));
  root.updateWorldMatrix(true, true);
  const solvedMid = mid.getWorldPosition(new THREE.Vector3());
  const solvedEnd = end.getWorldPosition(new THREE.Vector3());
  const midDelta = new THREE.Quaternion().setFromUnitVectors(solvedEnd.clone().sub(solvedMid).normalize(), target.clone().sub(solvedMid).normalize());
  setWorldQuaternion(mid, midDelta.multiply(mid.getWorldQuaternion(new THREE.Quaternion())));
  mid.updateWorldMatrix(true, true);
}

function contactCorrection(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move || !fighter.isActive() || !move.visualContact || move.visualContact === "BODY") return;
  const target = getVisualContactPoint(fighter.visual, move.visualContact);
  const foot = move.visualContact.endsWith("FOOT");
  const preferred = move.visualContact.startsWith("LEFT") ? "l" : "r";
  const order = [preferred, preferred === "l" ? "r" : "l"];
  for (const suffix of order) {
    const root = runtime.bones.get(foot ? `thigh_${suffix}` : `upperarm_${suffix}`);
    const mid = runtime.bones.get(foot ? `calf_${suffix}` : `lowerarm_${suffix}`);
    const end = runtime.bones.get(foot ? `foot_${suffix}` : `hand_${suffix}`);
    if (!root || !mid || !end) continue;
    const side = suffix === "l" ? 1 : -1;
    const pole = fighter.visual.root.localToWorld(new THREE.Vector3(side * (foot ? 0.5 : 0.66), foot ? 0.44 : 0.78, foot ? 0.26 : 0.34));
    solveLimb(root, mid, end, target, pole);
    break;
  }
}

function reactionAccent(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  if (!fighter.state.startsWith("HIT") && fighter.state !== "BLOCK_STUN") return;
  const reaction = motionReactionFor(fighter);
  const amount = reaction.side * (0.025 + reaction.tier * 0.018);
  for (const name of ["spine_02", "spine_03", "neck_01", "head"]) {
    const bone = runtime.bones.get(name);
    if (bone) bone.rotation.z += amount;
  }
}

/**
 * Returns true when the expanded runtime owns the current pose. Neutral/guard
 * states intentionally return false so the older audited UBC ready-pose layer
 * remains authoritative there.
 */
export function updateMotionExpansionSkin(fighter: FighterRuntime, timeSeconds: number): boolean {
  motionReactionFor(fighter);
  if (!EXPANDED_STATES.has(fighter.state)) return false;
  const runtime = ensureRuntime(fighter);
  if (!runtime?.ready) return false;
  const reaction = motionReactionFor(fighter);
  const desired = desiredMotion(fighter);
  const restartedMove = fighter.state === "ATTACK" && fighter.moveTick < runtime.lastMoveTick;
  const restartedReaction = reaction.serial !== runtime.lastReactionSerial && fighter.state !== "ATTACK";
  runtime.lastMoveTick = fighter.moveTick;
  runtime.lastReactionSerial = reaction.serial;
  playClip(runtime, desired.name, desired.loop, desired.speed, restartedMove || restartedReaction);
  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, 0.05) : 0;
  runtime.lastTime = timeSeconds;
  runtime.mixer.update(delta);
  runtime.model.updateMatrixWorld(true);
  reactionAccent(runtime, fighter);
  contactCorrection(runtime, fighter);
  runtime.model.updateMatrixWorld(true);
  return true;
}

export function motionExpansionStats(fighter: FighterRuntime): { ready: boolean; clips: number; currentClip: string } | null {
  const runtime = runtimes.get(fighter.visual.root);
  if (!runtime) return null;
  return { ready: runtime.ready, clips: runtime.clips.size, currentClip: runtime.currentClip };
}
