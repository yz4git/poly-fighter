import * as THREE from "three";
import { bakeExpandedMotionClip } from "./expanded-motion-library";
import type { CinematicTechnique } from "./cinematic-techniques";

export const CINEMATIC_MOTION_VERSION = "SIGNATURE_HERO_CHOREOGRAPHY_V2";

export const CINEMATIC_CLIP_SOURCES: Readonly<Record<CinematicTechnique, string>> = {
  skyBreaker: "BF_RisingKick_R",
  airChase: "BF_FrontKick_R",
  airCarry: "BF_FrontKick_R",
  airPivot: "BF_RisingKick_R",
  meteorSlam: "BF_DashKick_R",
  cycloneSweep: "BF_LowKick_L",
  powerRush: "BF_Power_R",
};
export const CINEMATIC_CLIP_TAGS: Readonly<Record<CinematicTechnique, string>> = {
  skyBreaker: "LIFT", airChase: "CHASE", airCarry: "CARRY", airPivot: "PIVOT", meteorSlam: "METEOR",
  cycloneSweep: "CYCLONE", powerRush: "RUSH",
};

export function cinematicClipName(role: CinematicTechnique): string {
  return `FX_${CINEMATIC_CLIP_SOURCES[role]}_${CINEMATIC_CLIP_TAGS[role]}`;
}

const accent: Record<CinematicTechnique, Readonly<Record<string, readonly [number, number, number]>>> = {
  skyBreaker: {
    pelvis: [-.16, -.14, .10], spine_02: [-.24, -.17, .02], spine_03: [-.40, -.16, .07],
    thigh_r: [-.47, .22, .14], calf_r: [.43, 0, 0], upperarm_l: [.42, -.19, -.04], upperarm_r: [-.23, .10, .05],
  },
  airChase: {
    pelvis: [.06, .32, -.10], spine_02: [-.06, .24, .08], spine_03: [-.12, .27, .06],
    thigh_r: [-.24, -.18, .29], calf_r: [-.31, .08, -.10], upperarm_r: [.33, .14, .05], upperarm_l: [-.16, -.09, -.03],
  },
  airCarry: {
    pelvis: [.13, .20, -.09], spine_02: [-.16, -.19, .11], spine_03: [-.27, -.22, .05],
    thigh_r: [-.32, .18, .27], calf_r: [-.25, .08, -.13], upperarm_l: [.27, -.20, .14],
  },
  airPivot: {
    pelvis: [-.12, -.48, .13], spine_02: [.12, -.41, -.09], spine_03: [.18, -.39, .12],
    thigh_r: [-.41, .39, .30], calf_r: [.32, -.11, -.08], upperarm_l: [-.35, .24, -.41],
  },
  meteorSlam: {
    pelvis: [-.19, -.20, 0], spine_02: [.23, -.24, -.14], spine_03: [.39, -.30, -.19],
    thigh_r: [.36, -.14, -.25], calf_r: [-.33, .02, 0], upperarm_r: [-.39, .12, -.12], upperarm_l: [.18, -.08, .06],
  },
  cycloneSweep: {
    pelvis: [0, -.62, -.11], spine_02: [0, -.48, .10], spine_03: [.12, -.39, .12],
    thigh_l: [.26, .48, -.20], calf_l: [-.26, .12, 0], upperarm_r: [-.14, .32, .38], upperarm_l: [.10, -.09, -.06],
  },
  powerRush: {
    pelvis: [-.24, .26, 0], spine_02: [-.30, .19, -.14], spine_03: [-.36, .35, -.22],
    clavicle_r: [-.23, -.28, -.12], upperarm_r: [-.48, -.23, .24], lowerarm_r: [-.36, .17, .01], upperarm_l: [.27, .17, -.12],
  },
};

function ease01(value: number): number {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * The original midclip sine only made techniques 'lean forward'. A stronger
 * playable fighting-game arc has an opposite-direction load, a committed
 * contact silhouette and a counter-swing into recovery. Move timing, clip
 * endpoints, striking-limb IK and simulation transforms remain untouched.
 */
export function cinematicPoseEnvelope(u: number): number {
  const phase = THREE.MathUtils.clamp(Number.isFinite(u) ? u : 0, 0, 1);
  const windup = ease01(phase / .12) * (1 - ease01((phase - .20) / .15));
  const impact = ease01((phase - .24) / .22) * (1 - ease01((phase - .56) / .31));
  const afterfeel = ease01((phase - .69) / .10) * (1 - ease01((phase - .84) / .14));
  return impact - .36 * windup - .22 * afterfeel;
}

/** Distinct hero performance rather than identical skeleton posing on all four. */
export function cinematicHeroWeight(
  name: string,
  role: CinematicTechnique,
  bone: string,
): number {
  const id = name.toUpperCase();
  const torso = bone === "pelvis" || bone.startsWith("spine_") || bone.startsWith("clavicle_");
  if (id === "KAIRO" && (role === "powerRush" || role === "meteorSlam")) return torso ? 1.29 : 1.12;
  if (id === "SERA" && (role === "airChase" || role === "airPivot" || role === "cycloneSweep")) return torso ? 1.15 : 1.34;
  if (id === "VANTA" && (role === "airPivot" || role === "cycloneSweep")) return torso ? 1.33 : 1.18;
  if (id === "AXION" && (role === "skyBreaker" || role === "meteorSlam")) return torso ? 1.24 : 1.30;
  return 1.08;
}

export function bakeCinematicClip(
  source: THREE.AnimationClip,
  role: CinematicTechnique,
  fighterName = "KAIRO",
): THREE.AnimationClip {
  const variant = role === "airChase" || role === "airPivot" || role === "cycloneSweep" ? "PIVOT"
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
      const strength = cinematicPoseEnvelope(output.times[index] / duration)
        * cinematicHeroWeight(fighterName, role, boneName);
      if (Math.abs(strength) <= 1e-7) continue;
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
  fighterName = "KAIRO",
): Map<string, THREE.AnimationClip> {
  const output = new Map<string, THREE.AnimationClip>();
  for (const role of Object.keys(CINEMATIC_CLIP_SOURCES) as CinematicTechnique[]) {
    const source = clips.get(CINEMATIC_CLIP_SOURCES[role]);
    if (!source) continue;
    const clip = bakeCinematicClip(source, role, fighterName);
    output.set(clip.name, clip);
  }
  return output;
}
