import * as THREE from "three";

/**
 * LOCAL preserves the established Poly Fighter/Quaternius clip pipeline.
 * WORLD carries the source bone's rest-relative rotation in world space,
 * allowing the same source motion to drive a differently-oriented humanoid.
 * This is computed once while retargeting the clip, never every render frame.
 */
export type RetargetRotationMode = "LOCAL" | "WORLD";

export interface MotionRetargetOptions {
  rotationMode?: RetargetRotationMode;
  /** Source node name -> target node name (e.g. VRM "hips" -> "pelvis"). */
  boneNameMap?: Readonly<Record<string, string>>;
  /** Target node allowed to receive authored root/hip translation. */
  rootMotionBone?: string;
  /** Scale authored hip deltas for different body proportions. */
  translationScale?: number;
}

function nodeMap(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const result = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (object.name) result.set(object.name, object);
  });
  return result;
}

function parentWorldQuaternion(node: THREE.Object3D): THREE.Quaternion {
  return node.parent
    ? node.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
}

/**
 * Retarget separately loaded animation GLBs onto a skinned character.
 * Gameplay positions and mesh skinning remain the responsibility of their
 * existing systems. Only the designated hip node receives translation.
 *
 * LOCAL (default) is unchanged for shipping Quaternius animations.
 * WORLD rotates each source local-rest delta into its parent world-rest
 * basis, then into the target parent world-rest basis. This avoids
 * interpreting a source X-axis punch as a target Z-axis twist on rigs with
 * different bone orientations. Caller must pass *rest-pose* skeletons.
 */
export function retargetMotionClips(
  sourceRoot: THREE.Object3D,
  targetRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  options: MotionRetargetOptions = {},
): Map<string, THREE.AnimationClip> {
  sourceRoot.updateWorldMatrix(true, true);
  targetRoot.updateWorldMatrix(true, true);
  const sourceNodes = nodeMap(sourceRoot);
  const targetNodes = nodeMap(targetRoot);
  const result = new Map<string, THREE.AnimationClip>();
  const mode = options.rotationMode ?? "LOCAL";
  const translationScale = Number.isFinite(options.translationScale) && (options.translationScale ?? 0) > 0
    ? options.translationScale!
    : 1;
  const rootMotionBone = options.rootMotionBone ?? "pelvis";
  const sourceAnimated = new THREE.Quaternion();
  const sourceRestInverse = new THREE.Quaternion();
  const targetAnimated = new THREE.Quaternion();
  const localDelta = new THREE.Quaternion();
  // A fixed change-of-basis pair per bone track; no per-key allocations.
  const fromParent = new THREE.Quaternion();
  const toParent = new THREE.Quaternion();
  const sourceToTarget = new THREE.Quaternion();
  const targetToSource = new THREE.Quaternion();

  for (const clip of clips) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      const sourceName = parsed.nodeName;
      const propertyName = parsed.propertyName;
      if (!sourceName || !propertyName) continue;
      const targetName = options.boneNameMap?.[sourceName] ?? sourceName;
      const sourceNode = sourceNodes.get(sourceName);
      const targetNode = targetNodes.get(targetName);
      if (!sourceNode || !targetNode) continue;
      const targetTrackName = targetName === sourceName ? track.name : `${targetName}.${propertyName}`;

      if (propertyName === "quaternion" && track.values.length % 4 === 0) {
        const values = new Float32Array(track.values.length);
        sourceRestInverse.copy(sourceNode.quaternion).invert();
        if (mode === "WORLD") {
          fromParent.copy(parentWorldQuaternion(sourceNode));
          toParent.copy(parentWorldQuaternion(targetNode));
          sourceToTarget.copy(toParent).invert().multiply(fromParent);
          targetToSource.copy(sourceToTarget).invert();
        }
        for (let offset = 0; offset < track.values.length; offset += 4) {
          sourceAnimated.fromArray(track.values, offset).normalize();
          if (mode === "WORLD") {
            // Global delta = P_s * (A_s * R_s^-1) * P_s^-1
            // A_t = P_t^-1 * globalDelta * P_t * R_t
            localDelta.copy(sourceAnimated).multiply(sourceRestInverse);
            targetAnimated.copy(sourceToTarget)
              .multiply(localDelta)
              .multiply(targetToSource)
              .multiply(targetNode.quaternion)
              .normalize();
          } else {
            targetAnimated.copy(targetNode.quaternion)
              .multiply(sourceRestInverse)
              .multiply(sourceAnimated)
              .normalize();
          }
          // Maintain continuous quaternion signs for interpolation/blending.
          if (offset > 0 &&
            targetAnimated.x * values[offset - 4] +
            targetAnimated.y * values[offset - 3] +
            targetAnimated.z * values[offset - 2] +
            targetAnimated.w * values[offset - 1] < 0) {
            targetAnimated.set(-targetAnimated.x, -targetAnimated.y, -targetAnimated.z, -targetAnimated.w);
          }
          targetAnimated.toArray(values, offset);
        }
        const next = new THREE.QuaternionKeyframeTrack(targetTrackName, track.times, values);
        next.setInterpolation(track.getInterpolation());
        tracks.push(next);
        continue;
      }

      if (propertyName === "position" && targetName === rootMotionBone && track.values.length % 3 === 0) {
        const values = new Float32Array(track.values.length);
        for (let offset = 0; offset < track.values.length; offset += 3) {
          values[offset] = targetNode.position.x + (track.values[offset] - sourceNode.position.x) * translationScale;
          values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y) * translationScale;
          values[offset + 2] = targetNode.position.z + (track.values[offset + 2] - sourceNode.position.z) * translationScale;
        }
        const next = new THREE.VectorKeyframeTrack(targetTrackName, track.times, values);
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
