import * as THREE from "three";
import type { RetargetRotationMode } from "./motion-retarget";

type Pair = { source: THREE.Object3D; target: THREE.Object3D };

/**
 * Offline hip-abduction correction in the character's current anatomical
 * frame. It acts only if transferred ankles/knees cross the body's leg lane.
 * The two thighs rotate equally in opposite directions around a horizontal
 * axis; knee/ankle child rotations and contact timing remain untouched.
 */
function separateCrossedLegs(
  target: THREE.Object3D,
  rotations: Map<THREE.Object3D, Float32Array>,
  index: number,
  previousAngle: number,
): number {
  const thighL = target.getObjectByName("thigh_l");
  const thighR = target.getObjectByName("thigh_r");
  const calfL = target.getObjectByName("calf_l");
  const calfR = target.getObjectByName("calf_r");
  const footL = target.getObjectByName("foot_l");
  const footR = target.getObjectByName("foot_r");
  if (!thighL || !thighR || !calfL || !calfR || !footL || !footR ||
      !rotations.has(thighL) || !rotations.has(thighR)) return 0;

  target.updateWorldMatrix(true, true);
  const pos = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3());
  const hL = pos(thighL);
  const hR = pos(thighR);
  const kL = pos(calfL);
  const kR = pos(calfR);
  const fL = pos(footL);
  const fR = pos(footR);
  const side = hL.clone().sub(hR);
  side.y = 0;
  if (side.lengthSq() < 1e-8) return 0;
  side.normalize();
  const hipSep = hL.clone().sub(hR).dot(side);
  const footSep = fL.clone().sub(fR).dot(side);
  const kneeSep = kL.clone().sub(kR).dot(side);

  // Rotating the upper legs out by +theta / -theta changes lateral distance:
  // hipSep + (oldSep-hipSep)*cos(theta) + (dropL+dropR)*sin(theta)
  // (one term from each upper-leg pivot). Solve the smallest safe angle.
  const clearanceAngle = (sep: number, drop: number, minimum: number): number => {
    if (sep >= minimum) return 0;
    const estimate = (angle: number) =>
      hipSep + (sep - hipSep) * Math.cos(angle) + drop * Math.sin(angle);
    const maximum = 0.85;
    if (estimate(maximum) < minimum) return maximum;
    let low = 0;
    let high = maximum;
    for (let iteration = 0; iteration < 18; iteration++) {
      const mid = (low + high) * 0.5;
      if (estimate(mid) < minimum) low = mid;
      else high = mid;
    }
    return high;
  };
  const angle = Math.max(
    clearanceAngle(footSep, hL.y - fL.y + hR.y - fR.y, hipSep * 0.4),
    clearanceAngle(kneeSep, hL.y - kL.y + hR.y - kR.y, hipSep * 0.36),
    previousAngle * 0.84,
  );
  if (angle < 1e-5) return 0;

  const axis = side.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  for (const [thigh, sign] of [[thighL, 1], [thighR, -1]] as const) {
    const parent = thigh.parent;
    if (!parent) continue;
    const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());
    const outside = new THREE.Quaternion().setFromAxisAngle(axis, sign * angle);
    // Premultiply with a world-space abduction expressed in parent axes.
    const localAdjustment = parentWorld.clone().invert()
      .multiply(outside).multiply(parentWorld);
    thigh.quaternion.premultiply(localAdjustment).normalize();
    const values = rotations.get(thigh)!;
    const offset = index * 4;
    const q = thigh.quaternion.clone();
    if (index > 0 && (
      values[offset - 4] * q.x + values[offset - 3] * q.y +
      values[offset - 2] * q.z + values[offset - 1] * q.w
    ) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    q.toArray(values, offset);
  }
  return angle;
}

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

  const targetOriginal = new Map<THREE.Object3D, THREE.Quaternion>();
  target.traverse((node) => targetOriginal.set(node, node.quaternion.clone()));

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
    let lastLegCorrection = 0;
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
        // Pose the actual UBC bones so the clearance audit can use real
        // upper/lower-leg lengths, not angles guessed from ASF bone axes.
        pair.target.quaternion.copy(local);
      }
      lastLegCorrection = separateCrossedLegs(
        target, rotations, index, lastLegCorrection,
      );
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
    targetOriginal.forEach((quaternion, node) => node.quaternion.copy(quaternion));
    target.updateWorldMatrix(true, true);
  }
}
