import * as THREE from "three";
import { bakeExpandedMotionClip } from "./expanded-motion-library";
import type { CinematicTechnique } from "./cinematic-techniques";

export const CINEMATIC_MOTION_VERSION = "SIGNATURE_KEYFRAME_CHOREOGRAPHY_V1";

export const CINEMATIC_CLIP_SOURCES: Readonly<Record<CinematicTechnique, string>> = {
  skyBreaker: "BF_RisingKick_R",
  airChase: "BF_FrontKick_R",
  meteorSlam: "BF_DashKick_R",
  cycloneSweep: "BF_LowKick_L",
  powerRush: "BF_Power_R",
};
export const CINEMATIC_CLIP_TAGS: Readonly<Record<CinematicTechnique, string>> = {
  skyBreaker: "LIFT", airChase: "CHASE", meteorSlam: "METEOR",
  cycloneSweep: "CYCLONE", powerRush: "RUSH",
};

export function cinematicClipName(role: CinematicTechnique): string {
  return `FX_${CINEMATIC_CLIP_SOURCES[role]}_${CINEMATIC_CLIP_TAGS[role]}`;
}

const accent: Record<CinematicTechnique, Readonly<Record<string, readonly [number, number, number]>>> = {
  skyBreaker: {
    pelvis: [-.12, -.10, .08], spine_02: [-.18, -.15, 0], spine_03: [-.30, -.12, .05],
    thigh_r: [-.28, .16, .07], calf_r: [.30, 0, 0], upperarm_l: [.28, -.12, 0],
  },
  airChase: {
    pelvis: [.06, .32, -.10], spine_02: [-.06, .24, .08], spine_03: [-.12, .27, .06],
    thigh_r: [-.16, -.12, .18], calf_r: [-.23, .06, -.06], upperarm_r: [.24, .10, .03],
  },
  meteorSlam: {
    pelvis: [-.16, -.16, 0], spine_02: [.18, -.20, -.12], spine_03: [.30, -.25, -.16],
    thigh_r: [.25, -.08, -.18], calf_r: [-.25, 0, 0], upperarm_r: [-.28, .08, -.08],
  },
  cycloneSweep: {
    pelvis: [0, -.62, -.11], spine_02: [0, -.48, .10], spine_03: [.12, -.39, .12],
    thigh_l: [.16, .36, -.12], calf_l: [-.18, .06, 0], upperarm_r: [-.08, .24, .28],
  },
  powerRush: {
    pelvis: [-.19, .23, 0], spine_02: [-.25, .14, -.10], spine_03: [-.26, .28, -.18],
    clavicle_r: [-.14, -.20, -.07], upperarm_r: [-.36, -.17, .16], lowerarm_r: [-.26, .12, .0],
  },
};

function profile(u: number, role: CinematicTechnique): number {
  // Strong but bounded authored motion envelope. Entry and recovery remain
  // exactly at the source rest/guard pose; strike phase is most expressive.
  const normalized = THREE.MathUtils.clamp(u, 0, 1);
  const peak = role === "skyBreaker" ? .46
    : role === "meteorSlam" ? .47
    : role === "cycloneSweep" ? .50 : .44;
  if (normalized <= peak) return Math.sin(normalized / peak * Math.PI / 2) ** 2;
  return Math.sin((1 - normalized) / (1 - peak) * Math.PI / 2) ** 2;
}

export function bakeCinematicClip(
  source: THREE.AnimationClip,
  role: CinematicTechnique,
): THREE.AnimationClip {
  const variant = role === "airChase" || role === "cycloneSweep" ? "PIVOT"
    : role === "powerRush" ? "CRUSH" : "DRIVE";
  const stage = bakeExpandedMotionClip(source, variant);
  const duration = Math.max(1 / 60, stage.duration);
  const tracks = stage.tracks.map(track => {
    const boneName = track.name.split(".")[0];
    const pose = accent[role][boneName];
    if (!pose || !track.name.endsWith(".quaternion")
      || !(track instanceof THREE.QuaternionKeyframeTrack)) return track.clone();
    const output = track.clone();
    const values = output.values;
    for (let index = 0; index < output.times.length; index += 1) {
      const strength = profile(output.times[index] / duration, role);
      if (strength <= 1e-7) continue;
      const q = new THREE.Quaternion().fromArray(values, index * 4);
      q.multiply(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(pose[0] * strength, pose[1] * strength, pose[2] * strength),
      )).normalize().toArray(values, index * 4);
    }
    return output;
  });
  return new THREE.AnimationClip(cinematicClipName(role), source.duration, tracks);
}

export function createCinematicMotionLibrary(
  clips: ReadonlyMap<string, THREE.AnimationClip>,
): Map<string, THREE.AnimationClip> {
  const output = new Map<string, THREE.AnimationClip>();
  for (const role of Object.keys(CINEMATIC_CLIP_SOURCES) as CinematicTechnique[]) {
    const source = clips.get(CINEMATIC_CLIP_SOURCES[role]);
    if (!source) continue;
    const clip = bakeCinematicClip(source, role);
    output.set(clip.name, clip);
  }
  return output;
}
