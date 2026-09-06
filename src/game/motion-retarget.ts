import * as THREE from "three";

function nodeMap(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const result = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (object.name) result.set(object.name, object);
  });
  return result;
}

/**
 * Retargets local animation deltas from a source skeleton onto a target skeleton
 * with matching joint names. This is the only runtime retarget implementation:
 * targetRest * inverse(sourceRest) * sourceAnimated.
 *
 * Target bone positions remain authoritative. Pelvis translation preserves only
 * the authored local delta so body proportions and world gameplay position stay
 * independent from the source asset.
 */
export function retargetMotionClips(
  sourceRoot: THREE.Object3D,
  targetRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
): Map<string, THREE.AnimationClip> {
  const sourceNodes = nodeMap(sourceRoot);
  const targetNodes = nodeMap(targetRoot);
  const result = new Map<string, THREE.AnimationClip>();
  const sourceAnimated = new THREE.Quaternion();
  const sourceRestInverse = new THREE.Quaternion();
  const targetAnimated = new THREE.Quaternion();

  for (const clip of clips) {
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
          values[offset] = targetNode.position.x + (track.values[offset] - sourceNode.position.x);
          values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y);
          values[offset + 2] = targetNode.position.z + (track.values[offset + 2] - sourceNode.position.z);
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
