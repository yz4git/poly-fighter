import * as THREE from "three";
import type { RetargetRotationMode } from "./motion-retarget";
import { retargetCmuPoseReferenced } from "./cmu-pose-retarget";
import { retargetCmuAnatomical } from "./cmu-anatomical-retarget";

/**
 * Opt-in MODEL VIEW experiment. Remote motion data is never fetched during a
 * match, never checked into the game, and never used for gameplay hit timing.
 *
 * Use the skeleton-only GLBs: the "objects" and "mobile" variants use
 * EXT_meshopt_compression and need additional decoders.
 */
export const CMU_MOCAP_PILOT_CLIPS = [
  { id: "WALK", label: "CMU WALK", file: "05_01-walk" },
  { id: "BOXING", label: "CMU BOXING", file: "13_17-boxing" },
  { id: "KICK", label: "CMU FRONT KICK", file: "135_04-front-kick" },
] as const;

export type CmuMocapPilotId = (typeof CMU_MOCAP_PILOT_CLIPS)[number]["id"];

export function cmuMocapPilotUrl(id: CmuMocapPilotId): string {
  const entry = CMU_MOCAP_PILOT_CLIPS.find((clip) => clip.id === id);
  if (!entry) throw new Error("Unknown CMU motion selection");
  const path = `skeleton/${entry.file}/${entry.file}_skeleton.glb`;
  return `https://huggingface.co/datasets/codepawl/cmu-mocap-glb/resolve/main/${path}`;
}

export function cmuMocapClipName(id: CmuMocapPilotId): string {
  return `CMU_${id}`;
}

function normalized(name: string): string {
  return name.toLowerCase()
    .replace(/^(mixamorig|armature)[_:]*/i, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * CMU's ASF/BVH naming and common GLB/FBX conventions. Target names are the
 * actual Quaternius UBC bones (see quaternius-male-flat-report.json).
 * This table intentionally avoids fitting finger joints without inspection.
 */
const CMU_TO_UBC: Readonly<Record<string, string>> = {
  hips: "pelvis", hip: "pelvis", pelvis: "pelvis", root: "pelvis",
  lowerback: "spine_01", spine: "spine_01", spine0: "spine_01",
  spine1: "spine_02", spine2: "spine_03", upperback: "spine_02",
  thorax: "spine_03", chest: "spine_03", neck: "neck_01",
  neck1: "neck_01", lowerneck: "neck_01", head: "Head",
  lclavicle: "clavicle_l", leftclavicle: "clavicle_l", leftshoulder: "clavicle_l",
  lhumerus: "upperarm_l", leftarm: "upperarm_l", leftupperarm: "upperarm_l",
  lradius: "lowerarm_l", leftforearm: "lowerarm_l", leftlowerarm: "lowerarm_l",
  lwrist: "hand_l", lefthand: "hand_l",
  lfemur: "thigh_l", leftupleg: "thigh_l", leftthigh: "thigh_l",
  ltibia: "calf_l", leftleg: "calf_l", leftcalf: "calf_l",
  lfoot: "foot_l", leftfoot: "foot_l", ltoes: "ball_l", lefttoebase: "ball_l",
  rclavicle: "clavicle_r", rightclavicle: "clavicle_r", rightshoulder: "clavicle_r",
  rhumerus: "upperarm_r", rightarm: "upperarm_r", rightupperarm: "upperarm_r",
  rradius: "lowerarm_r", rightforearm: "lowerarm_r", rightlowerarm: "lowerarm_r",
  rwrist: "hand_r", righthand: "hand_r",
  rfemur: "thigh_r", rightupleg: "thigh_r", rightthigh: "thigh_r",
  rtibia: "calf_r", rightleg: "calf_r", rightcalf: "calf_r",
  rfoot: "foot_r", rightfoot: "foot_r", rtoes: "ball_r", righttoebase: "ball_r",
};

export function buildCmuBoneMap(
  source: THREE.Object3D,
  target: THREE.Object3D,
): Record<string, string> {
  const targets = new Map<string, string>();
  target.traverse((node) => {
    if (node.name) targets.set(normalized(node.name), node.name);
  });
  const aliases: Record<string, string> = {};
  source.traverse((node) => {
    if (!node.name) return;
    const key = normalized(node.name);
    const wanted = CMU_TO_UBC[key] ?? node.name;
    const resolved = targets.get(normalized(wanted));
    if (resolved) aliases[node.name] = resolved;
  });
  return aliases;
}

export function retargetCmuPilotClip(
  source: THREE.Object3D,
  target: THREE.Object3D,
  animations: readonly THREE.AnimationClip[],
  id: CmuMocapPilotId,
  mode: RetargetRotationMode = "WORLD",
): THREE.AnimationClip {
  const sourceClip = animations.reduce<THREE.AnimationClip | null>(
    (best, clip) => !best || clip.duration > best.duration ? clip : best,
    null,
  );
  if (!sourceClip) throw new Error("CMU GLB did not contain animation tracks");
  const motion = sourceClip.clone();
  motion.name = cmuMocapClipName(id);
  // Captured-pose calibration avoids the original ASF wide-leg bind-pose
  // offset that made Quaternius' narrow stance cross both ankles.
  // Clip output stays in-place (no position tracks).
  const boneMap = buildCmuBoneMap(source, target);
  // WORLD = anatomical joint-direction reconstruction, not rotation deltas.
  // LOCAL retains the old 2026-11-20 trial for reversible screenshot A/B.
  const hasCmuAsf = Boolean(source.getObjectByName("lfemur") &&
    source.getObjectByName("rfemur") && source.getObjectByName("thorax"));
  const output = mode === "WORLD" && hasCmuAsf
    ? retargetCmuAnatomical(source, target, motion, boneMap, motion.name)
    : retargetCmuPoseReferenced(source, target, motion, boneMap, mode, motion.name);
  const animatedJoints = output?.tracks.filter((track) => track.name.endsWith(".quaternion")).length ?? 0;
  // Prevent two ASF hierarchy joints (e.g. lhipjoint and lfemur) from
  // driving the exact same target track in AnimationMixer.
  const names = output?.tracks.map((track) => track.name) ?? [];
  if (new Set(names).size !== names.length) {
    throw new Error("CMU retarget produced duplicate target bone tracks");
  }
  if (!output || animatedJoints < 6) {
    throw new Error(`CMU skeleton mapping insufficient (${animatedJoints} rotation joints); source rig must be inspected before use`);
  }
  return output;
}
