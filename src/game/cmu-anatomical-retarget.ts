import * as THREE from "three";

/**
 * CMU ASF -> Quaternius UBC anatomical retargeting.
 *
 * Recover the source's ACTUAL limb directions at each captured frame instead
 * of applying frame-0 rotation deltas to the target's T-pose. This preserves
 * guard, elbow bend, walk arm swing and kick silhouette across different rest
 * poses and joint orientations. Opt-in preview only; fight hitboxes unchanged.
 */
type Segment = {
  bone: string;
  tip: string;
  origin: string;
  endpoint: string;
};

const SEGMENTS: readonly Segment[] = [
  { bone: "spine_01", tip: "spine_02", origin: "lowerback", endpoint: "upperback" },
  { bone: "spine_02", tip: "spine_03", origin: "upperback", endpoint: "thorax" },
  { bone: "spine_03", tip: "neck_01", origin: "thorax", endpoint: "lowerneck" },
  { bone: "neck_01", tip: "Head", origin: "lowerneck", endpoint: "head" },
  { bone: "clavicle_l", tip: "upperarm_l", origin: "lclavicle", endpoint: "lhumerus" },
  { bone: "upperarm_l", tip: "lowerarm_l", origin: "lhumerus", endpoint: "lradius" },
  { bone: "lowerarm_l", tip: "hand_l", origin: "lradius", endpoint: "lwrist" },
  { bone: "hand_l", tip: "middle_01_l", origin: "lwrist", endpoint: "lhand" },
  { bone: "clavicle_r", tip: "upperarm_r", origin: "rclavicle", endpoint: "rhumerus" },
  { bone: "upperarm_r", tip: "lowerarm_r", origin: "rhumerus", endpoint: "rradius" },
  { bone: "lowerarm_r", tip: "hand_r", origin: "rradius", endpoint: "rwrist" },
  { bone: "hand_r", tip: "middle_01_r", origin: "rwrist", endpoint: "rhand" },
  { bone: "thigh_l", tip: "calf_l", origin: "lfemur", endpoint: "ltibia" },
  { bone: "calf_l", tip: "foot_l", origin: "ltibia", endpoint: "lfoot" },
  { bone: "foot_l", tip: "ball_l", origin: "lfoot", endpoint: "ltoes" },
  { bone: "thigh_r", tip: "calf_r", origin: "rfemur", endpoint: "rtibia" },
  { bone: "calf_r", tip: "foot_r", origin: "rtibia", endpoint: "rfoot" },
  { bone: "foot_r", tip: "ball_r", origin: "rfoot", endpoint: "rtoes" },
];

/** X = character anatomical left, Y = torso up, Z = their forward. */
function torsoBasis(root: THREE.Object3D, left: string, right: string, chest: string, hips: string): THREE.Quaternion | null {
  const l = root.getObjectByName(left);
  const r = root.getObjectByName(right);
  const up = root.getObjectByName(chest);
  const hip = root.getObjectByName(hips);
  if (!l || !r || !up || !hip) return null;
  const side = l.getWorldPosition(new THREE.Vector3()).sub(r.getWorldPosition(new THREE.Vector3()));
  const vertical = up.getWorldPosition(new THREE.Vector3()).sub(hip.getWorldPosition(new THREE.Vector3()));
  if (side.lengthSq() < 1e-8 || vertical.lengthSq() < 1e-8) return null;
  side.normalize();
  vertical.addScaledVector(side, -side.dot(vertical));
  if (vertical.lengthSq() < 1e-8) return null;
  vertical.normalize();
  const forward = side.clone().cross(vertical).normalize();
  const y = forward.clone().cross(side).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, y, forward));
}

interface RestState {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
}
function savePose(root: THREE.Object3D): Map<THREE.Object3D, RestState> {
  const result = new Map<THREE.Object3D, RestState>();
  root.traverse(node => result.set(node, {
    position: node.position.clone(), rotation: node.quaternion.clone(), scale: node.scale.clone(),
  }));
  return result;
}
function restorePose(root: THREE.Object3D, original: Map<THREE.Object3D, RestState>): void {
  original.forEach((state, node) => {
    node.position.copy(state.position);
    node.quaternion.copy(state.rotation);
    node.scale.copy(state.scale);
  });
  root.updateWorldMatrix(true, true);
}

export interface CmuAnatomicalDiagnostics {
  fitted: string[];
  fallback: string[];
  alignment: number[];
}

export function retargetCmuAnatomical(
  source: THREE.Object3D,
  target: THREE.Object3D,
  motion: THREE.AnimationClip,
  aliases: Readonly<Record<string, string>>,
  outputName: string,
  diagnostics?: CmuAnatomicalDiagnostics,
): THREE.AnimationClip {
  // A live fighter is parented under a rescaled/possibly rotated visual host.
  // Calibration must be invariant to that display transform. Temporarily
  // evaluate the SAME local skeleton in canonical object space, then restore
  // its exact scene placement. This changes no permanent game/model state.
  const parent = target.parent;
  const index = parent?.children.indexOf(target) ?? -1;
  const position = target.position.clone();
  const rotation = target.quaternion.clone();
  const scale = target.scale.clone();
  target.removeFromParent();
  target.position.set(0, 0, 0);
  target.quaternion.identity();
  target.scale.set(1, 1, 1);
  target.updateWorldMatrix(true, true);
  try {
    return retargetCanonical(source, target, motion, aliases, outputName, diagnostics);
  } finally {
    target.position.copy(position);
    target.quaternion.copy(rotation);
    target.scale.copy(scale);
    if (parent) {
      parent.add(target);
      if (index >= 0 && index < parent.children.length - 1) {
        parent.children.splice(parent.children.indexOf(target), 1);
        parent.children.splice(index, 0, target);
      }
    }
    target.updateWorldMatrix(true, true);
  }
}

function retargetCanonical(
  source: THREE.Object3D,
  target: THREE.Object3D,
  motion: THREE.AnimationClip,
  aliases: Readonly<Record<string, string>>,
  outputName: string,
  diagnostics?: CmuAnatomicalDiagnostics,
): THREE.AnimationClip {
  source.updateWorldMatrix(true, true);
  target.updateWorldMatrix(true, true);
  const sourceBefore = savePose(source);
  const targetBefore = savePose(target);
  const restQuat = new Map<THREE.Object3D, THREE.Quaternion>();
  const restPos = new Map<THREE.Object3D, THREE.Vector3>();
  target.traverse(node => {
    restQuat.set(node, node.getWorldQuaternion(new THREE.Quaternion()));
    restPos.set(node, node.getWorldPosition(new THREE.Vector3()));
  });

  const sourceByTarget = new Map<string, string>();
  Object.entries(aliases).forEach(([src, dst]) => sourceByTarget.set(dst, src));

  const segments = new Map<string, {
    srcFrom: THREE.Object3D;
    srcTo: THREE.Object3D;
    restAim: THREE.Vector3;
  }>();
  for (const info of SEGMENTS) {
    const targetBone = target.getObjectByName(info.bone);
    const targetTip = target.getObjectByName(info.tip);
    const srcFrom = source.getObjectByName(info.origin);
    const srcTo = source.getObjectByName(info.endpoint);
    if (!targetBone || !targetTip || !srcFrom || !srcTo) continue;
    const restAim = restPos.get(targetTip)!.clone().sub(restPos.get(targetBone)!);
    const srcAim = srcTo.getWorldPosition(new THREE.Vector3())
      .sub(srcFrom.getWorldPosition(new THREE.Vector3()));
    if (restAim.lengthSq() < 1e-7 || srcAim.lengthSq() < 1e-7) continue;
    segments.set(info.bone, { srcFrom, srcTo, restAim: restAim.normalize() });
  }

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(motion);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  try {
    mixer.setTime(0);
    source.updateWorldMatrix(true, true);
    const sourceBasis0 = torsoBasis(source, "lfemur", "rfemur", "thorax", "root");
    const targetBasis0 = torsoBasis(target, "thigh_l", "thigh_r", "spine_03", "pelvis");
    if (!sourceBasis0 || !targetBasis0) {
      throw new Error("CMU anatomical calibration failed: missing torso/hip landmarks");
    }
    // One fixed source->target transform; the actor's turns are not erased.
    const align = targetBasis0.clone().multiply(sourceBasis0.clone().invert()).normalize();
    const inverseAlign = align.clone().invert();
    if (diagnostics) diagnostics.alignment = align.toArray();
    const firstSourceWorldInv = new Map<string, THREE.Quaternion>();
    for (const [dst, src] of sourceByTarget) {
      const bone = source.getObjectByName(src);
      if (bone && target.getObjectByName(dst)) {
        firstSourceWorldInv.set(dst, bone.getWorldQuaternion(new THREE.Quaternion()).invert());
      }
    }

    const driven: THREE.Object3D[] = [];
    target.traverse(node => {
      if (node.name === "pelvis" || segments.has(node.name) ||
          (sourceByTarget.has(node.name) && firstSourceWorldInv.has(node.name))) {
        driven.push(node);
      }
    });
    if (driven.length < 10 || !segments.has("upperarm_l") || !segments.has("upperarm_r") ||
        !segments.has("thigh_l") || !segments.has("thigh_r")) {
      throw new Error("CMU anatomical mapping requires both arms and legs");
    }
    if (diagnostics) {
      diagnostics.fitted = [...segments.keys()];
      diagnostics.fallback = driven.filter(node => node.name !== "pelvis" &&
        !segments.has(node.name)).map(node => node.name);
    }

    const count = Math.max(2, Math.ceil(motion.duration * 30) + 1);
    const times = Float32Array.from({ length: count }, (_, i) => motion.duration * i / (count - 1));
    const values = new Map<THREE.Object3D, Float32Array>();
    for (const node of driven) values.set(node, new Float32Array(count * 4));
    // Correct only vertical foot contact. Horizontal root travel belongs to
    // the gameplay controller and is never imported into this in-place preview.
    const pelvis = target.getObjectByName("pelvis");
    const toeL = target.getObjectByName("ball_l");
    const toeR = target.getObjectByName("ball_r");
    const sourceToeL = source.getObjectByName("ltoes");
    const sourceToeR = source.getObjectByName("rtoes");
    const rootPositionTrack = pelvis && pelvis.parent && toeL && toeR && sourceToeL && sourceToeR
      ? new Float32Array(count * 3) : null;
    const pelvisRestLocal = pelvis ? targetBefore.get(pelvis)!.position.clone() : null;
    const footRestHeight = toeL && toeR
      ? Math.min(restPos.get(toeL)!.y, restPos.get(toeR)!.y) : 0;
    const sourceRestHeight = sourceToeL && sourceToeR
      ? Math.min(sourceToeL.getWorldPosition(new THREE.Vector3()).y,
                 sourceToeR.getWorldPosition(new THREE.Vector3()).y) : 0;
    let previousFootOffset = 0;
    const computedWorld = new Map<THREE.Object3D, THREE.Quaternion>();
    const local = new THREE.Quaternion();
    const wanted = new THREE.Quaternion();
    const delta = new THREE.Quaternion();
    const swing = new THREE.Quaternion();
    const direction = new THREE.Vector3();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    for (let frame = 0; frame < count; frame++) {
      mixer.setTime(times[frame]);
      source.updateWorldMatrix(true, true);
      computedWorld.clear();
      if (pelvis && pelvisRestLocal) pelvis.position.copy(pelvisRestLocal);
      const currentBasis = torsoBasis(source, "lfemur", "rfemur", "thorax", "root");
      if (!currentBasis) throw new Error("CMU lost torso frame during sampling");
      const torsoDelta = align.clone().multiply(currentBasis)
        .multiply(sourceBasis0.clone().invert()).multiply(inverseAlign);

      for (const node of driven) {
        const restWorld = restQuat.get(node)!;
        const segment = segments.get(node.name);
        if (node.name === "pelvis") {
          wanted.copy(torsoDelta).multiply(restWorld).normalize();
        } else if (segment) {
          segment.srcFrom.getWorldPosition(p0);
          segment.srcTo.getWorldPosition(p1);
          direction.copy(p1).sub(p0);
          if (direction.lengthSq() < 1e-9) {
            wanted.copy(restWorld);
          } else {
            direction.normalize().applyQuaternion(align);
            swing.setFromUnitVectors(segment.restAim, direction);
            wanted.copy(swing).multiply(restWorld).normalize();
          }
        } else {
          const src = source.getObjectByName(sourceByTarget.get(node.name)!);
          const firstInv = firstSourceWorldInv.get(node.name);
          if (src && firstInv) {
            delta.copy(src.getWorldQuaternion(new THREE.Quaternion())).multiply(firstInv);
            wanted.copy(align).multiply(delta).multiply(inverseAlign)
              .multiply(restWorld).normalize();
          } else wanted.copy(restWorld);
        }
        const parentWorld = node.parent
          ? (computedWorld.get(node.parent) ?? restQuat.get(node.parent) ?? new THREE.Quaternion())
          : new THREE.Quaternion();
        local.copy(parentWorld).invert().multiply(wanted).normalize();
        const track = values.get(node)!;
        const offset = frame * 4;
        if (frame > 0 && (
          local.x * track[offset-4] + local.y * track[offset-3] +
          local.z * track[offset-2] + local.w * track[offset-1] < 0
        )) local.set(-local.x, -local.y, -local.z, -local.w);
        local.toArray(track, offset);
        node.quaternion.copy(local);
        computedWorld.set(node, wanted.clone());
      }
      if (rootPositionTrack && pelvis && pelvisRestLocal && toeL && toeR && sourceToeL && sourceToeR) {
        // Keep the planted toes at the original UBC sole height, without
        // forcing genuinely airborne mocap frames down onto the platform.
        target.updateWorldMatrix(true, true);
        const currentToeHeight = Math.min(
          toeL.getWorldPosition(new THREE.Vector3()).y,
          toeR.getWorldPosition(new THREE.Vector3()).y,
        );
        const currentSourceToeHeight = Math.min(
          sourceToeL.getWorldPosition(new THREE.Vector3()).y,
          sourceToeR.getWorldPosition(new THREE.Vector3()).y,
        );
        const sourceRise = currentSourceToeHeight - sourceRestHeight;
        const plantedWeight = 1 - THREE.MathUtils.smoothstep(sourceRise, 0.045, 0.16);
        const desiredOffset = THREE.MathUtils.clamp(
          footRestHeight - currentToeHeight, -0.18, 0.18,
        ) * plantedWeight;
        previousFootOffset = frame === 0
          ? desiredOffset : THREE.MathUtils.lerp(previousFootOffset, desiredOffset, 0.45);
        // The smoothing filter must never bury a planted toe. Enforce a
        // small sole-height safety margin even during fast kick recovery.
        previousFootOffset = Math.max(
          previousFootOffset, footRestHeight - 0.008 - currentToeHeight,
        );
        const parentQuatInv = pelvis.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
        const localUp = new THREE.Vector3(0, previousFootOffset, 0)
          .applyQuaternion(parentQuatInv);
        pelvis.position.copy(pelvisRestLocal).add(localUp);
        pelvis.position.toArray(rootPositionTrack, frame * 3);
      }
    }
    const tracks: THREE.KeyframeTrack[] = driven.map(node =>
      new THREE.QuaternionKeyframeTrack(node.name + ".quaternion", times, values.get(node)!));
    if (rootPositionTrack) {
      tracks.push(new THREE.VectorKeyframeTrack("pelvis.position", times, rootPositionTrack));
    }
    const output = new THREE.AnimationClip(outputName, motion.duration, tracks, motion.blendMode);
    output.optimize();
    return output;
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(source);
    restorePose(source, sourceBefore);
    restorePose(target, targetBefore);
  }
}
