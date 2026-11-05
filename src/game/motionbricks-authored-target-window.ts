import * as THREE from "three";

/**
 * MotionBricks-inspired target conditioning for already-authored animations.
 *
 * Read a short future pose from the CURRENT destination clip WITHOUT advancing
 * its mixer or changing the game clock. The target is not a neural prediction:
 * this browser-friendly adapter samples a legitimate authored keyframe.
 */
export const MOTIONBRICKS_AUTHORED_TARGET_WINDOW_VERSION = "AUTHORED_LOOKAHEAD_V1";
export const TARGET_LOOKAHEAD_SECONDS = 1 / 30;

export type AuthoredMotionGoal = Readonly<{
  position?: THREE.Vector3;
  rotation?: THREE.Quaternion;
}>;

type PoseChannel = "position" | "quaternion";
type PoseTrackSampler = Readonly<{
  bone: string;
  channel: PoseChannel;
  interpolant: THREE.Interpolant;
}>;

const samplersByClip = new WeakMap<THREE.AnimationClip, readonly PoseTrackSampler[]>();

function trackSamplers(clip: THREE.AnimationClip): readonly PoseTrackSampler[] {
  const cached = samplersByClip.get(clip);
  if (cached) return cached;
  const samplers: PoseTrackSampler[] = [];
  for (const track of clip.tracks) {
    const match = /^(.+)\.(position|quaternion)$/.exec(track.name);
    if (!match) continue;
    const channel = match[2] as PoseChannel;
    if (channel === "position" && !(track instanceof THREE.VectorKeyframeTrack)) continue;
    if (channel === "quaternion" && !(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    samplers.push({ bone: match[1], channel, interpolant: track.createInterpolant() });
  }
  samplersByClip.set(clip, samplers);
  return samplers;
}

/**
 * Only called while a short inertial transition is active. No mixer sampling,
 * pose writes, heavy runtimes or persistent per-frame allocations outside the
 * short handoff. Untracked channels simply use the current authored goal.
 */
export function sampleAuthoredTargetWindow(
  clip: THREE.AnimationClip,
  bones: ReadonlyMap<string, THREE.Object3D>,
  currentClipTime: number,
): ReadonlyMap<string, AuthoredMotionGoal> {
  const output = new Map<string, AuthoredMotionGoal>();
  if (!Number.isFinite(currentClipTime) || !(clip.duration > 0)) return output;
  const time = THREE.MathUtils.clamp(currentClipTime, 0, clip.duration);
  if (clip.duration - time < 1 / 120) return output;
  const futureTime = Math.min(clip.duration, time + TARGET_LOOKAHEAD_SECONDS);
  const samples = new Map<string, { position?: THREE.Vector3; rotation?: THREE.Quaternion }>();
  for (const sampler of trackSamplers(clip)) {
    if (!bones.has(sampler.bone)) continue;
    const values = sampler.interpolant.evaluate(futureTime);
    let goal = samples.get(sampler.bone);
    if (!goal) {
      goal = {};
      samples.set(sampler.bone, goal);
    }
    if (sampler.channel === "position") {
      const position = new THREE.Vector3().fromArray(values);
      if ([position.x, position.y, position.z].every(Number.isFinite)) goal.position = position;
    } else {
      const rotation = new THREE.Quaternion().fromArray(values);
      if ([rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)
          && rotation.lengthSq() > 1e-8) goal.rotation = rotation.normalize();
    }
  }
  for (const [name, goal] of samples) if (goal.position || goal.rotation) output.set(name, goal);
  return output;
}
