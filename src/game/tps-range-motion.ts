import * as THREE from "three";
import { TPS_RANGE_ATTACK_IDS, type TpsRangeAttackId } from "./tps-range-attack";

/** One cached baked full-body clip for each distinct committed distance strike. */
export const TPS_RANGE_CHOREOGRAPHY_VERSION = "THREE_RANGE_ATTACKS_V1";
export const TPS_RANGE_CLIP_SOURCES: Readonly<Record<TpsRangeAttackId, string>> = {
  rangeBlitz: "BF_Cross_R",
  rangeCrescent: "BF_FrontKick_R",
  rangeComet: "BF_DashKick_R",
};

export function tpsRangeClipName(id: TpsRangeAttackId): string {
  return `CM_Range_${id}`;
}

type PoseAccent = Readonly<Record<string, readonly [number, number, number]>>;
const ACCENTS: Readonly<Record<TpsRangeAttackId, PoseAccent>> = {
  rangeBlitz: {
    pelvis: [-.13, -.23, -.04], spine_02: [-.19, -.27, -.06],
    spine_03: [-.25, -.33, -.09], clavicle_r: [-.14, -.11, -.07],
    upperarm_r: [-.24, -.20, .12], lowerarm_r: [-.13, .08, 0],
    upperarm_l: [.20, .18, -.10],
  },
  rangeCrescent: {
    pelvis: [.06, -.32, -.10], spine_02: [.03, -.40, -.12],
    spine_03: [-.10, -.45, -.16], thigh_r: [-.29, .26, .24],
    calf_r: [.19, -.08, -.04], upperarm_l: [.27, -.13, .19],
    upperarm_r: [-.20, .11, -.12],
  },
  rangeComet: {
    pelvis: [-.20, -.21, -.10], spine_02: [-.30, -.22, -.13],
    spine_03: [-.42, -.18, -.19], thigh_r: [-.37, .26, .16],
    calf_r: [.27, 0, -.06], upperarm_l: [.34, -.16, .10],
    upperarm_r: [-.19, .18, -.03],
  },
};

function smooth(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Distinct visual beats: brace against the floor, accelerate, strike, recoil. */
export function tpsRangePoseEnvelope(phase: number): number {
  const u = THREE.MathUtils.clamp(Number.isFinite(phase) ? phase : 0, 0, 1);
  const load = smooth(u / .15) * (1 - smooth((u - .23) / .13));
  const strike = smooth((u - .22) / .24) * (1 - smooth((u - .60) / .26));
  const recovery = smooth((u - .74) / .08) * (1 - smooth((u - .87) / .13));
  return -.38 * load + strike - .19 * recovery;
}

export function bakeTpsRangeClip(
  source: THREE.AnimationClip,
  id: TpsRangeAttackId,
  fighterName = "KAIRO",
): THREE.AnimationClip {
  const strength = fighterName === "SERA" ? .91 : fighterName === "AXION" ? 1.13
    : fighterName === "VANTA" ? 1.07 : 1;
  const duration = Math.max(1 / 60, source.duration);
  const tracks = source.tracks.map(track => {
    const bone = track.name.split(".")[0];
    const accent = ACCENTS[id][bone];
    if (!accent || !(track instanceof THREE.QuaternionKeyframeTrack)) return track.clone();
    const copy = track.clone();
    for (let i = 0; i < copy.times.length; i += 1) {
      const envelope = tpsRangePoseEnvelope(copy.times[i] / duration) * strength;
      if (Math.abs(envelope) < 1e-8) continue;
      const original = new THREE.Quaternion().fromArray(copy.values, 4 * i);
      const delta = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(accent[0] * envelope, accent[1] * envelope, accent[2] * envelope),
      );
      original.multiply(delta).normalize().toArray(copy.values, 4 * i);
    }
    return copy;
  });
  return new THREE.AnimationClip(tpsRangeClipName(id), source.duration, tracks);
}

export function createTpsRangeMotionLibrary(
  sources: ReadonlyMap<string, THREE.AnimationClip>,
  fighterName = "KAIRO",
): Map<string, THREE.AnimationClip> {
  const clips = new Map<string, THREE.AnimationClip>();
  for (const id of TPS_RANGE_ATTACK_IDS) {
    const source = sources.get(TPS_RANGE_CLIP_SOURCES[id]);
    if (!source) continue;
    clips.set(tpsRangeClipName(id), bakeTpsRangeClip(source, id, fighterName));
  }
  return clips;
}
