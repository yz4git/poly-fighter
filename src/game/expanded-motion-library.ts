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
export const EXPANDED_MOTION_VERSION = "COMBAT_VARIANT_CLIPS_V2_HERO";

export function expandedClipName(source: string, variant: MoveVariant): string {
  return `VM_${source}_${variant}`;
}

export function sourceOfExpandedClip(name: string): string {
  const match = /^VM_(.+)_(SNAP|DRIVE|PIVOT|CRUSH)$/.exec(name)
    ?? /^FX_(.+)_(LIFT|CHASE|CARRY|PIVOT|METEOR|CYCLONE|RUSH)$/.exec(name);
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
    if (variant === "PIVOT") return [0, .23, .075];
    if (variant === "DRIVE") return [-.092, -.065, .025];
    if (variant === "CRUSH") return [-.15, .07, -.045];
    return [.052, 0, 0];
  }
  if (bone === "spine_02" || bone === "spine_03") {
    const scale = bone === "spine_03" ? 1 : .62;
    if (variant === "PIVOT") return [0, .30 * scale, .105 * scale];
    if (variant === "DRIVE") return [-.16 * scale, -.09 * scale, .05 * scale];
    if (variant === "CRUSH") return [-.25 * scale, .05 * scale, -.095 * scale];
    return [.095 * scale, -.035 * scale, 0];
  }
  if (bone === "Head") {
    if (variant === "PIVOT") return [0, -.13, 0];
    if (variant === "CRUSH") return [.085, 0, 0];
    return null;
  }
  const limb = isKick ? `thigh_${strikeSide}` : `upperarm_${strikeSide}`;
  const distal = isKick ? `calf_${strikeSide}` : `lowerarm_${strikeSide}`;
  if (bone === limb) {
    if (variant === "SNAP") return [-.11, -.02, .07];
    if (variant === "DRIVE") return [.15, .07, -.07];
    if (variant === "PIVOT") return [.04, .19, .13];
    return [.21, 0, -.09];
  }
  if (bone === distal) {
    if (variant === "SNAP") return [-.095, 0, 0];
    if (variant === "DRIVE") return [.12, 0, 0];
    if (variant === "PIVOT") return [0, .105, 0];
    return [.14, 0, -.045];
  }
  // Off-side guard stays where the authored animator placed it.
  return null;
}

function smoothAccent(u: number): number {
  const v = Math.max(0, Math.min(1, u));
  // Hero-shaped three-beat arc: visible *opposite* winding during startup,
  // full contact silhouette, then a restrained counter-swing into recovery.
  // Every clip still matches the exact authored guard pose at t=0 and t=1.
  const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  const anticipation = smooth(v / .12) * (1 - smooth((v - .19) / .14));
  const strike = smooth((v - .22) / .22) * (1 - smooth((v - .56) / .29));
  const recoil = smooth((v - .68) / .09) * (1 - smooth((v - .85) / .13));
  return strike - anticipation * .37 - recoil * .19;
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
      if (Math.abs(weight) < 1e-7) continue;
      if (isRotation && accent) {
        const q = new THREE.Quaternion().fromArray(values, i * 4);
        const delta = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(accent[0] * weight, accent[1] * weight, accent[2] * weight, "XYZ"),
        );
        q.multiply(delta).normalize().toArray(values, i * 4);
      } else if (isPelvis) {
        const side = variant === "PIVOT" ? .017 : variant === "SNAP" ? -.007 : 0;
        const forward = variant === "DRIVE" ? .022 : variant === "CRUSH" ? .012 : 0;
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
