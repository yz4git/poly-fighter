import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FighterRuntime } from "./fighter";
import {
  motionClipForMove,
  motionClipForReaction,
  motionRecoveryClipForMove,
  motionSpecForMove,
  type MotionStyle,
} from "./motion-profile";
import { motionReactionFor } from "./motion-reaction";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const UAL1_URL = `${BASE_PATH}/models/quaternius/ual-fight-core.glb`;
const UAL2_URL = `${BASE_PATH}/models/quaternius/ual2-fight-core.glb`;
const PROCEDURAL_URL = `${BASE_PATH}/models/quaternius/procedural-fight-core.glb`;

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
  PF_Jab_L: "Punch_Jab",
  PF_Cross_R: "Punch_Cross",
  PF_Backfist_R: "Melee_Hook",
  PF_Backfist_L: "Melee_Hook",
  PF_BodyBlow_L: "Shield_OneShot",
  PF_BodyBlow_R: "Shield_OneShot",
  PF_Power_R: "Sword_Regular_C",
  PF_FrontKick_R: "NinjaJump_Start",
  PF_LowKick_L: "Slide_Start",
  PF_RisingKick_R: "NinjaJump_Start",
  PF_DashKick_R: "NinjaJump_Start",
  PF_Throw: "OverhandThrow",
  PF_Counter_R: "Punch_Cross",
  PF_Counter_L: "Punch_Cross",
  PF_HitHeavy: "Hit_Knockback",
  PF_Launch: "NinjaJump_Start",
  PF_DownBack: "Death01",
  PF_Wakeup: "LayToIdle",
  PF_GuardBreak: "Idle_Shield_Break",
  PF_Sidestep_L: "Slide_Start",
  PF_Sidestep_R: "Slide_Start",
  PF_KickRecover: "NinjaJump_Land",
  PF_HeavyRecover: "Melee_Hook_Rec",
  Melee_Hook: "Punch_Cross",
  Melee_Hook_Rec: "Punch_Cross",
  Hit_Knockback: "Hit_Chest",
  Idle_Shield_Break: "Hit_Chest",
  OverhandThrow: "Punch_Cross",
  Shield_OneShot: "Punch_Cross",
  Sword_Regular_C: "Melee_Hook",
  Slide_Start: "Roll",
  Slide_Loop: "Roll",
  Slide_Exit: "Jump_Land",
  NinjaJump_Start: "Jump_Start",
  NinjaJump_Idle_Loop: "Jump_Loop",
  NinjaJump_Land: "Jump_Land",
  LayToIdle: "Jump_Land",
  Idle_Shield_Loop: "Idle_Loop",
};

type SourcePack = { source: THREE.Group; clips: THREE.AnimationClip[] };
type MotionPhase = "STARTUP" | "ACTIVE" | "RECOVERY" | "REACTION" | "AIR" | "DOWN" | "EVASION" | "SETTLE";
type MotionTail = {
  kind: "ATTACK" | "REACTION" | "BLOCK";
  holdUntil: number;
  endAt: number;
  blending: boolean;
};
type ExpansionRuntime = {
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  bones: Map<string, THREE.Object3D>;
  currentClip: string;
  currentPhase: MotionPhase | "";
  currentAction: THREE.AnimationAction | null;
  lastTime: number;
  lastMoveTick: number;
  lastReactionSerial: number;
  lastGameplayState: FighterRuntime["state"];
  lastAttackPower: number;
  lastReactionTier: 1 | 2 | 3;
  lastComboLinkSerial: number;
  tail: MotionTail | null;
  ready: boolean;
  loading: boolean;
};

type DesiredMotion = { name: string; loop: boolean; speed: number; phase: MotionPhase };
type AttackWeights = { drive: number; impact: number; phase: "STARTUP" | "ACTIVE" | "RECOVERY"; progress: number };

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
    loader.loadAsync(PROCEDURAL_URL)
      .then((gltf) => ({ source: gltf.scene, clips: gltf.animations }))
      .catch(() => null),
  ]).then((packs) => packs.filter((pack): pack is SourcePack => Boolean(pack)));
  return sourcePromise;
}

function findImportedModel(fighter: FighterRuntime): THREE.Group | null {
  const host = fighter.visual.root.children.find((child) =>
    child.name.startsWith("quaternius-ubc-") && child.name.endsWith("-runtime"),
  );
  if (!host) return null;
  const model = (host.children.find((child) => child.type === "Group" || child.children.length > 0)
    ?? host.children[0]
    ?? null) as THREE.Group | null;
  if (!model) return null;
  // Motion Expansion is not a hidden proxy rig: it drives the exact imported
  // Quaternius model that is rendered to the player. Keep this explicit so
  // audits cannot confuse the baseline idle mixer with the active combat mixer.
  fighter.visual.root.userData.motionExpansionTargetHost = host.name;
  fighter.visual.root.userData.motionExpansionTargetModelName = model.name || model.type;
  fighter.visual.root.userData.motionExpansionTargetsVisibleQuaternius = true;
  return model;
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
        const preserveProceduralPlanarRoot = clip.name.startsWith("PF_");
        for (let offset = 0; offset < track.values.length; offset += 3) {
          const planarX = preserveProceduralPlanarRoot
            ? THREE.MathUtils.clamp(track.values[offset] - sourceNode.position.x, -0.09, 0.09)
            : 0;
          const planarZ = preserveProceduralPlanarRoot
            ? THREE.MathUtils.clamp(track.values[offset + 2] - sourceNode.position.z, -0.09, 0.09)
            : 0;
          values[offset] = targetNode.position.x + planarX;
          values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y);
          values[offset + 2] = targetNode.position.z + planarZ;
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
    currentPhase: "",
    currentAction: null,
    lastTime: 0,
    lastMoveTick: -1,
    lastReactionSerial: -1,
    lastGameplayState: fighter.state,
    lastAttackPower: 1,
    lastReactionTier: 1,
    lastComboLinkSerial: 0,
    tail: null,
    ready: false,
    loading: true,
  };
  runtimes.set(fighter.visual.root, runtime);
  fighter.visual.root.userData.motionExpansionVersion = "MOTION_READABILITY_V2";
  fighter.visual.root.userData.motionExpansionLoading = true;
  void loadSourcePacks().then((packs) => {
    for (const pack of packs) {
      for (const [name, clip] of retargetPack(pack, model)) runtime.clips.set(name, clip);
    }
    runtime.ready = runtime.clips.size > 0;
    runtime.loading = false;
    fighter.visual.root.userData.motionExpansionVersion = "MOTION_READABILITY_V2";
    fighter.visual.root.userData.motionExpansionClipCount = runtime.clips.size;
    fighter.visual.root.userData.motionExpansionHasUAL2 = runtime.clips.has("Melee_Hook");
    fighter.visual.root.userData.motionExpansionHasProcedural = runtime.clips.has("PF_Jab_L")
      && runtime.clips.has("PF_Backfist_L")
      && runtime.clips.has("PF_BodyBlow_R")
      && runtime.clips.has("PF_Counter_L")
      && runtime.clips.has("PF_RisingKick_R")
      && runtime.clips.has("PF_GuardBreak")
      && runtime.clips.has("PF_KickRecover");
    fighter.visual.root.userData.motionExpansionProceduralClipCount = Array.from(runtime.clips.keys()).filter((name) => name.startsWith("PF_")).length;
    fighter.visual.root.userData.motionExpansionProceduralVersion = "PROCEDURAL_FIGHT_V2";
    fighter.visual.root.userData.motionExpansionRootMotionPolicy = "BOUNDED_PROCEDURAL_COM_XZ_PLUS_Y";
    fighter.visual.root.userData.motionExpansionLoading = false;
  }).catch((error: unknown) => {
    runtime.loading = false;
    fighter.visual.root.userData.motionExpansionLoading = false;
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

function smooth01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function attackWeights(fighter: FighterRuntime): AttackWeights {
  const move = fighter.currentMove;
  if (!move) return { drive: 0, impact: 0, phase: "RECOVERY", progress: 1 };
  const tick = Math.max(0, fighter.moveTick);
  if (tick < move.startup) {
    const progress = tick / Math.max(1, move.startup);
    return {
      drive: smooth01(progress),
      impact: smooth01((progress - 0.68) / 0.32) * 0.22,
      phase: "STARTUP",
      progress,
    };
  }
  if (tick < move.startup + move.active) {
    const progress = (tick - move.startup) / Math.max(1, move.active);
    return {
      drive: 1,
      impact: 0.76 + Math.sin(progress * Math.PI) * 0.24,
      phase: "ACTIVE",
      progress,
    };
  }
  const progress = (tick - move.startup - move.active) / Math.max(1, move.recovery);
  return {
    drive: 1 - smooth01(progress),
    impact: 0,
    phase: "RECOVERY",
    progress,
  };
}

function desiredMotion(fighter: FighterRuntime): DesiredMotion {
  const reaction = motionReactionFor(fighter);
  const move = fighter.currentMove;
  if (fighter.state === "ATTACK" && move) {
    const spec = motionSpecForMove(move);
    const weights = attackWeights(fighter);
    const recoveryClip = motionRecoveryClipForMove(move);
    if (weights.phase === "RECOVERY" && recoveryClip) {
      const seconds = Math.max(0.12, move.recovery / 60);
      return { name: recoveryClip, loop: false, speed: spec.speedScale / seconds, phase: "RECOVERY" };
    }
    const phaseTicks = recoveryClip ? move.startup + move.active : move.startup + move.active + move.recovery;
    const seconds = Math.max(0.16, phaseTicks / 60);
    return { name: motionClipForMove(move), loop: false, speed: spec.speedScale / seconds, phase: weights.phase };
  }
  if (fighter.state === "HIT") {
    return { name: motionClipForReaction(reaction.kind === "NONE" ? "BODY" : reaction.kind), loop: false, speed: 2.25 - reaction.tier * 0.20, phase: "REACTION" };
  }
  if (fighter.state === "BLOCK_STUN") return { name: "PF_GuardBreak", loop: false, speed: 1.75, phase: "REACTION" };
  if (["KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(fighter.state)) {
    if (!fighter.grounded) {
      if (fighter.velocity.y > 0.5) {
        return { name: reaction.kind === "LAUNCH" ? "PF_Launch" : "PF_HitHeavy", loop: false, speed: 1.2, phase: "AIR" };
      }
      return { name: "NinjaJump_Idle_Loop", loop: true, speed: 0.92, phase: "AIR" };
    }
    return { name: "PF_DownBack", loop: false, speed: fighter.health <= 0 ? 0.78 : 0.96, phase: "DOWN" };
  }
  if (fighter.state === "WAKEUP") return { name: "PF_Wakeup", loop: false, speed: 1.05, phase: "DOWN" };
  if (fighter.state === "SIDESTEP") {
    const clip = fighter.position.z < 0 ? "PF_Sidestep_L" : "PF_Sidestep_R";
    return { name: clip, loop: false, speed: 1.65, phase: "EVASION" };
  }
  if (fighter.state === "JUMP") return { name: "NinjaJump_Idle_Loop", loop: true, speed: 0.95, phase: "AIR" };
  return { name: "Idle_Loop", loop: true, speed: 1, phase: "REACTION" };
}

function playClip(
  runtime: ExpansionRuntime,
  requested: string,
  loop: boolean,
  speed: number,
  restart: boolean,
  blendOverride?: number,
): void {
  const name = resolveClip(runtime, requested);
  if (runtime.currentClip === name && !restart) return;
  const clip = runtime.clips.get(name);
  if (!clip) return;
  const defaultBlend = name.startsWith("Hit_") || name === "Death01" || name === "Idle_Shield_Break" ? 0.025 : 0.045;
  const blend = blendOverride ?? defaultBlend;
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

function addRotation(runtime: ExpansionRuntime, name: string, x: number, y: number, z: number, weight: number): void {
  const bone = runtime.bones.get(name);
  if (!bone || weight <= 0) return;
  bone.rotation.x += x * weight;
  bone.rotation.y += y * weight;
  bone.rotation.z += z * weight;
}

function strikeSide(fighter: FighterRuntime): -1 | 1 {
  return fighter.currentMove?.visualContact?.startsWith("LEFT") ? -1 : 1;
}

function styleTarget(opponent: FighterRuntime, style: MotionStyle, side: -1 | 1): THREE.Vector3 {
  opponent.visual.root.updateMatrixWorld(true);
  const bones = opponent.visual.rig.bones;
  const head = bones.head.getWorldPosition(new THREE.Vector3());
  const chest = bones.chest.getWorldPosition(new THREE.Vector3());
  const hips = bones.hips.getWorldPosition(new THREE.Vector3());
  const leftShin = bones.leftShin.getWorldPosition(new THREE.Vector3());
  const rightShin = bones.rightShin.getWorldPosition(new THREE.Vector3());
  const body = chest.clone().lerp(hips, 0.42);
  const legs = leftShin.clone().lerp(rightShin, 0.5).lerp(hips, 0.18);
  const forward = opponent.position.clone().sub(bones.hips.getWorldPosition(new THREE.Vector3()));
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  const lateral = new THREE.Vector3(forward.z, 0, -forward.x);

  switch (style) {
    case "JAB":
    case "CROSS":
    case "HOOK":
    case "COUNTER":
      return head.addScaledVector(lateral, side * 0.035);
    case "BODY_BLOW":
      return body.lerp(hips, 0.22).addScaledVector(lateral, side * 0.025);
    case "HEAVY":
      return body.addScaledVector(lateral, side * 0.05);
    case "LOW_KICK":
      return legs.addScaledVector(lateral, side * 0.12);
    case "RISING_KICK":
      return body.lerp(head, 0.72).addScaledVector(lateral, side * 0.04);
    case "DASH_KICK":
      return body.lerp(chest, 0.42).addScaledVector(lateral, side * 0.06);
    case "FRONT_KICK":
      return body.lerp(chest, 0.28);
    default:
      return body;
  }
}

function attackSilhouette(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move) return;
  const weights = attackWeights(fighter);
  const spec = motionSpecForMove(move);
  const side = strikeSide(fighter);
  const w = weights.drive;

  switch (spec.style) {
    case "JAB":
      addRotation(runtime, "spine_03", 0, side * 0.055, 0, w);
      break;
    case "CROSS":
      addRotation(runtime, "pelvis", 0, side * 0.07, 0, w);
      addRotation(runtime, "spine_02", 0, side * 0.14, 0, w);
      addRotation(runtime, "spine_03", 0, side * 0.11, -side * 0.025, w);
      break;
    case "HOOK":
      addRotation(runtime, "pelvis", 0, side * 0.06, 0, w);
      addRotation(runtime, "spine_02", 0, side * 0.11, side * 0.015, w);
      addRotation(runtime, "spine_03", 0, side * 0.08, side * 0.025, w);
      break;
    case "BODY_BLOW":
      addRotation(runtime, "spine_02", 0.13, side * 0.18, 0, w);
      addRotation(runtime, "spine_03", 0.08, side * 0.12, -side * 0.035, w);
      break;
    case "HEAVY":
      addRotation(runtime, "pelvis", 0, side * 0.08, 0, w);
      addRotation(runtime, "spine_02", 0.05, side * 0.14, side * 0.020, w);
      addRotation(runtime, "spine_03", 0.03, side * 0.10, side * 0.025, w);
      addRotation(runtime, "head", 0, -side * 0.025, 0, w);
      break;
    case "FRONT_KICK":
      addRotation(runtime, "pelvis", 0.035, -side * 0.055, 0, w);
      addRotation(runtime, "spine_03", -0.15, 0, -side * 0.025, w);
      break;
    case "LOW_KICK":
      addRotation(runtime, "pelvis", 0.02, -side * 0.18, side * 0.045, w);
      addRotation(runtime, "spine_02", 0.035, -side * 0.16, side * 0.075, w);
      break;
    case "RISING_KICK":
      addRotation(runtime, "pelvis", -0.04, -side * 0.10, 0, w);
      addRotation(runtime, "spine_03", -0.21, side * 0.04, -side * 0.035, w);
      break;
    case "DASH_KICK":
      addRotation(runtime, "pelvis", -0.055, -side * 0.075, 0, w);
      addRotation(runtime, "spine_02", -0.07, 0, 0, w);
      addRotation(runtime, "spine_03", -0.25, side * 0.05, 0, w);
      break;
    case "THROW":
      addRotation(runtime, "pelvis", 0.05, side * 0.09, 0, w);
      addRotation(runtime, "spine_02", 0.12, side * 0.15, 0, w);
      break;
    case "COUNTER":
      addRotation(runtime, "pelvis", 0, side * 0.09, -side * 0.025, w);
      addRotation(runtime, "spine_02", 0, side * 0.20, -side * 0.035, w);
      addRotation(runtime, "spine_03", -0.035, side * 0.12, 0, w);
      break;
  }
}

/**
 * Preserve the imported authored animation and only bias the striking limb near
 * the contact frame. V1 solved the imported limb all the way to the OLD
 * procedural rig's own fist/foot position, which visually collapsed different
 * clips back into one generic pose. V2 instead aims partly toward the opponent.
 */
function strikeTrajectory(runtime: ExpansionRuntime, fighter: FighterRuntime, opponent: FighterRuntime): void {
  const move = fighter.currentMove;
  if (fighter.state !== "ATTACK" || !move || !move.visualContact || move.visualContact === "BODY") return;
  const weights = attackWeights(fighter);
  if (weights.impact <= 0.02) return;
  const spec = motionSpecForMove(move);
  const foot = move.visualContact.endsWith("FOOT");
  const suffix = move.visualContact.startsWith("LEFT") ? "l" : "r";
  const root = runtime.bones.get(foot ? `thigh_${suffix}` : `upperarm_${suffix}`);
  const mid = runtime.bones.get(foot ? `calf_${suffix}` : `lowerarm_${suffix}`);
  const end = runtime.bones.get(foot ? `foot_${suffix}` : `hand_${suffix}`);
  if (!root || !mid || !end) return;

  runtime.model.updateMatrixWorld(true);
  const current = end.getWorldPosition(new THREE.Vector3());
  const side = suffix === "l" ? -1 : 1;
  const target = styleTarget(opponent, spec.style, side);
  const blend = THREE.MathUtils.clamp(spec.contactBlend * weights.impact, 0, 0.92);
  const solvedTarget = current.clone().lerp(target, blend);
  const pole = fighter.visual.root.localToWorld(new THREE.Vector3(
    (suffix === "l" ? -1 : 1) * (foot ? 0.48 : 0.62),
    foot ? 0.46 : 0.80,
    foot ? 0.24 : 0.32,
  ));
  solveLimb(root, mid, end, solvedTarget, pole);
}

function reactionAccent(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  if (fighter.state !== "HIT" && fighter.state !== "BLOCK_STUN") return;
  const reaction = motionReactionFor(fighter);
  const side = reaction.side;
  const tier = reaction.tier;
  const strength = 0.72 + tier * 0.14;

  switch (reaction.kind) {
    case "HEAD":
      addRotation(runtime, "spine_03", 0.015, -side * 0.055, side * 0.075, strength);
      addRotation(runtime, "neck_01", 0.02, -side * 0.08, side * 0.14, strength);
      addRotation(runtime, "head", 0.015, -side * 0.09, side * 0.18, strength);
      break;
    case "LOW":
      addRotation(runtime, "pelvis", 0.04, 0, side * 0.13, strength);
      addRotation(runtime, side < 0 ? "thigh_l" : "thigh_r", 0.16, 0, side * 0.06, strength);
      addRotation(runtime, "spine_02", 0.04, 0, -side * 0.055, strength);
      break;
    case "HEAVY":
    case "THROW":
      addRotation(runtime, "pelvis", 0.08, -side * 0.07, side * 0.12, strength);
      addRotation(runtime, "spine_02", 0.14, -side * 0.12, side * 0.15, strength);
      addRotation(runtime, "spine_03", 0.12, -side * 0.10, side * 0.17, strength);
      addRotation(runtime, "head", 0.04, -side * 0.06, side * 0.12, strength);
      break;
    case "BLOCK":
      addRotation(runtime, "spine_02", -0.07, 0, side * 0.06, strength);
      addRotation(runtime, "spine_03", -0.10, 0, side * 0.08, strength);
      break;
    default:
      addRotation(runtime, "spine_02", 0.07, -side * 0.06, side * 0.09, strength);
      addRotation(runtime, "spine_03", 0.08, -side * 0.05, side * 0.11, strength);
      addRotation(runtime, "head", 0.02, -side * 0.035, side * 0.07, strength);
      break;
  }
}

function airborneAccent(runtime: ExpansionRuntime, fighter: FighterRuntime): void {
  if (fighter.grounded || !["KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(fighter.state)) return;
  const reaction = motionReactionFor(fighter);
  const vertical = THREE.MathUtils.clamp(fighter.velocity.y / 5, -1, 1);
  addRotation(runtime, "pelvis", vertical > 0 ? -0.18 : 0.22, 0, reaction.side * 0.16, 1);
  addRotation(runtime, "spine_02", vertical > 0 ? -0.10 : 0.16, 0, reaction.side * 0.18, 1);
  addRotation(runtime, "thigh_l", 0.12, 0, -0.04, 1);
  addRotation(runtime, "thigh_r", 0.18, 0, 0.04, 1);
}

const TAIL_NEUTRAL_STATES = new Set<FighterRuntime["state"]>(["IDLE", "WALK", "CROUCH"]);
const COMBO_LINK_BLEND_SECONDS = 0.075;

function attackTailTiming(power: number): { hold: number; blend: number } {
  if (power >= 1.55) return { hold: 0.075, blend: 0.135 };
  if (power >= 1.05) return { hold: 0.055, blend: 0.115 };
  return { hold: 0.038, blend: 0.090 };
}

function reactionTailTiming(tier: 1 | 2 | 3, blocked: boolean): { hold: number; blend: number } {
  if (blocked) return { hold: 0.040, blend: 0.095 };
  if (tier === 3) return { hold: 0.095, blend: 0.175 };
  if (tier === 2) return { hold: 0.070, blend: 0.145 };
  return { hold: 0.050, blend: 0.115 };
}

function beginTail(
  runtime: ExpansionRuntime,
  kind: MotionTail["kind"],
  timeSeconds: number,
  timing: { hold: number; blend: number },
): void {
  runtime.tail = {
    kind,
    holdUntil: timeSeconds + timing.hold,
    endAt: timeSeconds + timing.hold + timing.blend,
    blending: false,
  };
}

/**
 * Returns true when the expanded runtime owns the current pose. Neutral/guard
 * states intentionally return false so the older audited UBC ready-pose layer
 * remains authoritative there. The runtime is still primed during neutral so
 * the FIRST attack no longer falls back while the animation GLBs are loading.
 */
export function updateMotionExpansionSkin(fighter: FighterRuntime, opponent: FighterRuntime, timeSeconds: number): boolean {
  const reaction = motionReactionFor(fighter);
  const runtime = ensureRuntime(fighter);
  if (!runtime?.ready) return false;

  const previousState = runtime.lastGameplayState;
  const tailNeutral = TAIL_NEUTRAL_STATES.has(fighter.state);

  if (fighter.state === "ATTACK" && fighter.currentMove) {
    runtime.lastAttackPower = fighter.currentMove.power;
    runtime.tail = null;
  } else if (fighter.state === "HIT" || fighter.state === "BLOCK_STUN") {
    runtime.lastReactionTier = reaction.tier;
    runtime.tail = null;
  } else if (tailNeutral && !runtime.tail) {
    if (previousState === "ATTACK") {
      beginTail(runtime, "ATTACK", timeSeconds, attackTailTiming(runtime.lastAttackPower));
    } else if (previousState === "HIT" || previousState === "BLOCK_STUN") {
      beginTail(
        runtime,
        previousState === "BLOCK_STUN" ? "BLOCK" : "REACTION",
        timeSeconds,
        reactionTailTiming(runtime.lastReactionTier, previousState === "BLOCK_STUN"),
      );
    }
  } else if (!tailNeutral && !EXPANDED_STATES.has(fighter.state)) {
    runtime.tail = null;
  }
  runtime.lastGameplayState = fighter.state;

  const delta = runtime.lastTime > 0 ? THREE.MathUtils.clamp(timeSeconds - runtime.lastTime, 0, 0.05) : 0;
  runtime.lastTime = timeSeconds;

  // Presentation-only settle: gameplay is already free to move/act, but the
  // rendered body is allowed to finish and briefly hold the final strike/recoil
  // pose before a slower return to ready stance. Any new combat state cancels
  // this tail immediately, so responsiveness is unchanged.
  if (runtime.tail && tailNeutral) {
    const tail = runtime.tail;
    if (timeSeconds >= tail.endAt) {
      runtime.tail = null;
      runtime.currentPhase = "SETTLE";
      playClip(runtime, "Idle_Loop", true, 1, false, 0.070);
      runtime.mixer.update(delta);
      runtime.model.updateMatrixWorld(true);
      fighter.visual.root.userData.motionExpansionTailKind = null;
      fighter.visual.root.userData.motionExpansionTailRemaining = 0;
      return true;
    }
    if (timeSeconds >= tail.holdUntil && !tail.blending) {
      tail.blending = true;
      playClip(runtime, "Idle_Loop", true, 1, false, Math.max(0.080, tail.endAt - tail.holdUntil));
    }
    runtime.currentPhase = "SETTLE";
    runtime.mixer.update(delta);
    runtime.model.updateMatrixWorld(true);
    fighter.visual.root.userData.motionExpansionCurrentClip = runtime.currentClip;
    fighter.visual.root.userData.motionExpansionCurrentMove = null;
    fighter.visual.root.userData.motionExpansionPhase = runtime.currentPhase;
    fighter.visual.root.userData.motionExpansionTailKind = tail.kind;
    fighter.visual.root.userData.motionExpansionTailRemaining = Math.max(0, tail.endAt - timeSeconds);
    fighter.visual.root.userData.motionExpansionContactMode = "OPPONENT_WEIGHTED_IK";
    return true;
  }

  if (!EXPANDED_STATES.has(fighter.state)) return false;

  const desired = desiredMotion(fighter);
  const restartedMove = fighter.state === "ATTACK" && fighter.moveTick < runtime.lastMoveTick;
  const restartedReaction = reaction.serial !== runtime.lastReactionSerial && fighter.state !== "ATTACK";
  const comboLinkSerial = Number(fighter.visual.root.userData.tpsComboLinkSerial ?? 0);
  const comboLinkState = fighter.visual.root.userData.tpsComboLinkState;
  // Link serials intentionally reset with each round. Comparing only with `>`
  // made the first links of later rounds miss their visual crossfade whenever a
  // previous round had already reached a larger serial. A real linked restart is
  // defined by the published LINKED state plus a serial change in either direction.
  const comboLinked = restartedMove
    && comboLinkState === "LINKED"
    && comboLinkSerial !== runtime.lastComboLinkSerial;
  if (comboLinkSerial !== runtime.lastComboLinkSerial) runtime.lastComboLinkSerial = comboLinkSerial;
  runtime.lastMoveTick = fighter.moveTick;
  runtime.lastReactionSerial = reaction.serial;
  runtime.currentPhase = desired.phase;
  playClip(
    runtime,
    desired.name,
    desired.loop,
    desired.speed,
    restartedMove || restartedReaction,
    comboLinked ? COMBO_LINK_BLEND_SECONDS : undefined,
  );
  runtime.mixer.update(delta);
  runtime.model.updateMatrixWorld(true);
  attackSilhouette(runtime, fighter);
  reactionAccent(runtime, fighter);
  airborneAccent(runtime, fighter);
  runtime.model.updateMatrixWorld(true);
  strikeTrajectory(runtime, fighter, opponent);
  runtime.model.updateMatrixWorld(true);

  fighter.visual.root.userData.motionExpansionCurrentClip = runtime.currentClip;
  fighter.visual.root.userData.motionExpansionCurrentMove = fighter.currentMove?.id ?? null;
  fighter.visual.root.userData.motionExpansionPhase = runtime.currentPhase;
  fighter.visual.root.userData.motionExpansionTailKind = null;
  fighter.visual.root.userData.motionExpansionTailRemaining = 0;
  fighter.visual.root.userData.motionExpansionComboBlendSeconds = comboLinked ? COMBO_LINK_BLEND_SECONDS : 0;
  fighter.visual.root.userData.motionExpansionContactMode = "OPPONENT_WEIGHTED_IK";
  return true;
}

export function motionExpansionStats(fighter: FighterRuntime): {
  ready: boolean;
  loading: boolean;
  clips: number;
  currentClip: string;
  currentPhase: string;
} | null {
  const runtime = runtimes.get(fighter.visual.root);
  if (!runtime) return null;
  return {
    ready: runtime.ready,
    loading: runtime.loading,
    clips: runtime.clips.size,
    currentClip: runtime.currentClip,
    currentPhase: runtime.currentPhase,
  };
}
