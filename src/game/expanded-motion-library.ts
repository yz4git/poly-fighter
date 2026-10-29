import * as THREE from "three";
import { MOVE_VARIANTS, type MoveVariant } from "./move-expansion";

/**
 * Bake small but actual full-body differences into Three.js clips at load time.
 * NO per-frame IK, shader work, AI inference or remote models on mobile.
 *
 * Support feet and authored contact windows are left alone. Position accents
 * affect only the pelvis, and rotation accents keep the main striking path
 * recognizable while changing the shoulder/torso/strike-leg silhouette.
 */
export const EXPANDED_MOTION_VERSION = "COMBAT_VARIANT_CLIPS_V1";

export function expandedClipName(source: string, variant: MoveVariant): string {
  return `VM_${source}_${variant}`;
}

export function sourceOfExpandedClip(name: string): string {
  const match = /^VM_(.+)_(SNAP|DRIVE|PIVOT|CRUSH)$/.exec(name);
  return match?.[1] ?? name;
}

export function selectExpandedClip(
  source: string,
  variant: MoveVariant | undefined,
  hasClip: (name: string) => boolean,
): string {
  if (!variant) return source;
  const name = expandedClipName(source, variant);
  return hasClip(name) ? name : source;
}

type Eulers = readonly [number, number, number];

function boneAccent(
  bone: string,
  variant: MoveVariant,
  isKick: boolean,
  strikeSide: "l" | "r",
): Eulers | null {
  if (bone === "pelvis") {
    if (variant === "PIVOT") return [0, .12, .035];
    if (variant === "DRIVE") return [-.045, -.03, 0];
    if (variant === "CRUSH") return [-.08, .035, 0];
    return [.025, 0, 0];
  }
  if (bone === "spine_02" || bone === "spine_03") {
    const scale = bone === "spine_03" ? 1 : .62;
    if (variant === "PIVOT") return [0, .19 * scale, .055 * scale];
    if (variant === "DRIVE") return [-.085 * scale, -.045 * scale, 0];
    if (variant === "CRUSH") return [-.13 * scale, .025 * scale, -.04 * scale];
    return [.06 * scale, -.03 * scale, 0];
  }
  if (bone === "Head") {
    if (variant === "PIVOT") return [0, -.07, 0];
    if (variant === "CRUSH") return [.04, 0, 0];
    return null;
  }
  const limb = isKick ? `thigh_${strikeSide}` : `upperarm_${strikeSide}`;
  const distal = isKick ? `calf_${strikeSide}` : `lowerarm_${strikeSide}`;
  if (bone === limb) {
    if (variant === "SNAP") return [-.06, -.01, .04];
    if (variant === "DRIVE") return [.09, .03, -.04];
    if (variant === "PIVOT") return [.02, .10, .05];
    return [.12, 0, -.05];
  }
  if (bone === distal) {
    if (variant === "SNAP") return [-.055, 0, 0];
    if (variant === "DRIVE") return [.07, 0, 0];
    if (variant === "PIVOT") return [0, .05, 0];
    return [.075, 0, -.025];
  }
  // Off-side guard stays where the authored animator placed it.
  return null;
}

function smoothAccent(u: number): number {
  const v = Math.max(0, Math.min(1, u));
  // Original ready/entry/recovery frames remain identical for seamless handoff.
  return Math.sin(Math.PI * v) ** 2;
}

export function bakeExpandedMotionClip(
  source: THREE.AnimationClip,
  variant: MoveVariant,
): THREE.AnimationClip {
  const isKick = /Kick/i.test(source.name);
  const strikeSide: "l" | "r" = /(?:BF_LowKick_L|BF_Jab_L|BF_Backfist_L|BF_BodyBlow_L|CM_Counter_L)/.test(source.name) ? "l" : "r";
  const duration = Math.max(1 / 60, source.duration);
  const tracks = source.tracks.map(track => {
    const bone = track.name.split(".")[0];
    const isRotation = track.name.endsWith(".quaternion") && track instanceof THREE.QuaternionKeyframeTrack;
    const isPelvis = track.name === "pelvis.position" && track instanceof THREE.VectorKeyframeTrack;
    if (!isRotation && !isPelvis) return track.clone();
    const accent = boneAccent(bone, variant, isKick, strikeSide);
    if (isRotation && !accent) return track.clone();
    const copy = track.clone();
    const values = copy.values;
    for (let i = 0; i < copy.times.length; i += 1) {
      const u = copy.times[i] / duration;
      const weight = smoothAccent(u);
      if (weight < 1e-7) continue;
      if (isRotation && accent) {
        const q = new THREE.Quaternion().fromArray(values, i * 4);
        const delta = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(accent[0] * weight, accent[1] * weight, accent[2] * weight, "XYZ"),
        );
        q.multiply(delta).normalize().toArray(values, i * 4);
      } else if (isPelvis) {
        const side = variant === "PIVOT" ? .010 : variant === "SNAP" ? -.004 : 0;
        const forward = variant === "DRIVE" ? .014 : variant === "CRUSH" ? .007 : 0;
        values[i * 3] += side * weight;
        values[i * 3 + 2] += forward * weight;
      }
    }
    return copy;
  });
  return new THREE.AnimationClip(expandedClipName(source.name, variant), source.duration, tracks);
}

export function buildExpandedMotionLibrary(clips: ReadonlyMap<string, THREE.AnimationClip>): Map<string, THREE.AnimationClip> {
  const output = new Map<string, THREE.AnimationClip>();
  // Only generate a variant for clips actually present on the bound skeleton.
  const sourceNames = [
    "BF_Jab_L", "BF_Cross_R", "BF_Backfist_L", "BF_Backfist_R",
    "BF_BodyBlow_L", "BF_BodyBlow_R", "BF_Power_R",
    "BF_FrontKick_R", "BF_LowKick_L", "BF_RisingKick_R", "BF_DashKick_R",
    "BF_Counter_R", "CM_Counter_L",
  ];
  for (const name of sourceNames) {
    const source = clips.get(name);
    if (!source) continue;
    for (const variant of MOVE_VARIANTS) {
      const clip = bakeExpandedMotionClip(source, variant);
      output.set(clip.name, clip);
    }
  }
  return output;
}
