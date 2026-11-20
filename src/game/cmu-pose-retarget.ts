import * as THREE from "three";
import type { RetargetRotationMode } from "./motion-retarget";

type Pair = { source: THREE.Object3D; target: THREE.Object3D };

/**
 * CMU's ASF rest skeleton has outward-slanted thighs whereas the Quaternius
 * UBC rest pose has nearly vertical legs. Copying source-rest deltas bends
 * UBC's narrow stance inward and *swaps the feet*. Pose-reference transfer
 * avoids treating the ASF T/relaxed bind stance as a walking frame.
 *
 * This routine is exclusive to CMU Model View. Existing shipped combat
 * remains on the established retargeting system.
 */
export function retargetCmuPoseReferenced(
  source: THREE.Object3D,
  target: THREE.Object3D,
  clip: THREE.AnimationClip,
  boneMap: Readonly<Record<string, string>>,
  mode: RetargetRotationMode,
  outputName: string,
): THREE.AnimationClip {
  source.updateWorldMatrix(true, true);
  target.updateWorldMatrix(true, true);

  const original = new Map<THREE.Object3D, {
    position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3;
  }>();
  source.traverse((node) => {
    original.set(node, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  });

  const animated = new Set(clip.tracks.filter((track) =>
    THREE.PropertyBinding.parseTrackName(track.name).propertyName === "quaternion"
  ).map((track) => THREE.PropertyBinding.parseTrackName(track.name).nodeName));

  const byName = new Map<string, THREE.Object3D>();
  source.traverse((node) => { if (node.name) byName.set(node.name, node); });
  const sourceForTarget = new Map<THREE.Object3D, THREE.Object3D>();
  target.traverse((node) => {
    if (!node.name) return;
    for (const [src, dst] of Object.entries(boneMap)) {
      if (node.name !== dst || !animated.has(src)) continue;
      const sourceNode = byName.get(src);
      if (sourceNode) sourceForTarget.set(node, sourceNode);
    }
  });
  const mapped: Pair[] = [];
  target.traverse((node) => {
    const sourceNode = sourceForTarget.get(node);
    if (sourceNode) mapped.push({ source: sourceNode, target: node });
  });
  if (mapped.length < 6) throw new Error(`CMU motion skeleton mapping insufficient (${mapped.length})`);

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  try {
    // Source reference comes from the actual first captured pose, NOT from
    // the ASF model's broad, knees-out bind stance.
    mixer.setTime(0);
    source.updateWorldMatrix(true, true);
    const sourceReference = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const pair of mapped) {
      sourceReference.set(pair.source, pair.source.getWorldQuaternion(new THREE.Quaternion()).invert());
    }

    const targetRest = new Map<THREE.Object3D, THREE.Quaternion>();
    target.traverse((node) => {
      targetRest.set(node, node.getWorldQuaternion(new THREE.Quaternion()));
    });

    // Align anatomical left/right at the start pose. Both rigs are Y-up;
    // yaw-only avoids accidentally tilting the ground plane.
    const sideVector = (root: THREE.Object3D, l: string, r: string): THREE.Vector3 | null => {
      const left = root.getObjectByName(l);
      const right = root.getObjectByName(r);
      if (!left || !right) return null;
      const side = right.getWorldPosition(new THREE.Vector3())
        .sub(left.getWorldPosition(new THREE.Vector3()));
      side.y = 0;
      return side.lengthSq() < 1e-8 ? null : side.normalize();
    };
    const srcSide = sideVector(source, "lfemur", "rfemur");
    const dstSide = sideVector(target, "thigh_l", "thigh_r");
    let align = new THREE.Quaternion();
    if (srcSide && dstSide && mode === "WORLD") {
      const dot = THREE.MathUtils.clamp(srcSide.dot(dstSide), -1, 1);
      const yaw = Math.atan2(srcSide.z * dstSide.x - srcSide.x * dstSide.z, dot);
      align = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    }
    const inverseAlign = align.clone().invert();
    const count = Math.max(2, Math.ceil(clip.duration * 30) + 1);
    const times = Array.from({ length: count }, (_, index) => (index / (count - 1)) * clip.duration);
    const rotations = new Map<THREE.Object3D, Float32Array>();
    for (const pair of mapped) rotations.set(pair.target, new Float32Array(count * 4));

    const dynamicWorld = new Map<THREE.Object3D, THREE.Quaternion>();
    const delta = new THREE.Quaternion();
    const world = new THREE.Quaternion();
    const local = new THREE.Quaternion();
    for (let index = 0; index < times.length; index++) {
      mixer.setTime(times[index]);
      source.updateWorldMatrix(true, true);
      dynamicWorld.clear();

      // Target hierarchy is traversed in parent-first order. The resulting
      // LOCAL rotation includes animated helper-parent transforms from the ASF
      // source, even though UBC has no lhipjoint/rhipjoint nodes.
      for (const pair of mapped) {
        const animatedWorld = pair.source.getWorldQuaternion(new THREE.Quaternion());
        delta.copy(animatedWorld).multiply(sourceReference.get(pair.source)!);
        world.copy(align).multiply(delta).multiply(inverseAlign)
          .multiply(targetRest.get(pair.target)!);
        const parentWorld = (pair.target.parent && (
          dynamicWorld.get(pair.target.parent) ?? targetRest.get(pair.target.parent)
        )) ?? new THREE.Quaternion();
        local.copy(parentWorld).invert().multiply(world).normalize();
        dynamicWorld.set(pair.target, world.clone());
        const values = rotations.get(pair.target)!;
        const offset = index * 4;
        if (index > 0 && (
          values[offset - 4] * local.x + values[offset - 3] * local.y +
          values[offset - 2] * local.z + values[offset - 1] * local.w
        ) < 0) {
          local.set(-local.x, -local.y, -local.z, -local.w);
        }
        local.toArray(values, offset);
      }
    }
    const tracks = mapped.map((pair) =>
      new THREE.QuaternionKeyframeTrack(`${pair.target.name}.quaternion`, times,
        rotations.get(pair.target)!)
    );
    const result = new THREE.AnimationClip(outputName, clip.duration, tracks, clip.blendMode);
    result.optimize();
    return result;
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(source);
    original.forEach((pose, node) => {
      node.position.copy(pose.position);
      node.quaternion.copy(pose.quaternion);
      node.scale.copy(pose.scale);
    });
    source.updateWorldMatrix(true, true);
  }
}
