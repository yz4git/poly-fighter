import * as THREE from "three";

type SampledProperty = "quaternion" | "position" | "scale";

type CompiledTrack = {
  nodeName: string;
  property: SampledProperty;
  valueSize: number;
  result: Float32Array;
  interpolant: THREE.Interpolant;
};

const compiledClips = new WeakMap<THREE.AnimationClip, readonly CompiledTrack[]>();

function compileClip(clip: THREE.AnimationClip): readonly CompiledTrack[] {
  const cached = compiledClips.get(clip);
  if (cached) return cached;

  const compiled: CompiledTrack[] = [];
  for (const track of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const nodeName = parsed.nodeName;
    const property = parsed.propertyName;
    if (!nodeName || (property !== "quaternion" && property !== "position" && property !== "scale")) continue;

    const valueSize = track.getValueSize();
    if (property === "quaternion" && valueSize !== 4) continue;
    if ((property === "position" || property === "scale") && valueSize !== 3) continue;

    const result = new Float32Array(valueSize);
    compiled.push({
      nodeName,
      property,
      valueSize,
      result,
      interpolant: track.createInterpolant(result),
    });
  }

  compiledClips.set(clip, compiled);
  return compiled;
}

/**
 * Samples an authored combat AnimationClip without AnimationMixer history.
 *
 * Combat is gameplay-tick authoritative, so a phase must map to exactly one set
 * of local bone transforms regardless of render cadence, hitstop redraws, or a
 * previous AnimationAction. Retargeting happens before this function; this layer
 * only evaluates the already-final target-rig tracks at an absolute clip time.
 */
export function sampleCombatClipPose(
  clip: THREE.AnimationClip,
  phase: number,
  nodes: ReadonlyMap<string, THREE.Object3D>,
): number {
  const normalizedPhase = THREE.MathUtils.clamp(Number.isFinite(phase) ? phase : 0, 0, 1);
  const time = normalizedPhase * Math.max(0, clip.duration);
  let applied = 0;

  for (const track of compileClip(clip)) {
    const node = nodes.get(track.nodeName);
    if (!node) continue;
    track.interpolant.evaluate(time);

    if (track.property === "quaternion") {
      node.quaternion.fromArray(track.result).normalize();
    } else if (track.property === "position") {
      node.position.fromArray(track.result);
    } else {
      node.scale.fromArray(track.result);
    }
    applied += 1;
  }

  return applied;
}

export function combatPoseSamplerTrackCount(clip: THREE.AnimationClip): number {
  return compileClip(clip).length;
}
