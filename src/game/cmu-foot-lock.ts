import * as THREE from "three";

/**
 * Optional source-contact-guided stance IK. The original anatomical CMU
 * clip is preserved as an A/B baseline. Only local leg rotations are baked;
 * horizontal pelvis travel and combat gameplay never change.
 */
export type FootLockReport = {
  lockedFrames: number;
  runs: number;
  meanBaselineDrift: number;
  meanCorrectedDrift: number;
  maxCorrectedDrift: number;
  maxLegRotationDegrees: number;
  sideRuns: { left: number; right: number };
};

type Side = "l" | "r";
type Nodes = {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
  toe: THREE.Object3D;
};
type State = {
  node: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};
const worldPosition = (node: THREE.Object3D): THREE.Vector3 =>
  node.getWorldPosition(new THREE.Vector3());

function sourceContacts(
  source: THREE.Object3D,
  clip: THREE.AnimationClip,
  times: Float32Array,
): Record<Side, boolean[]> {
  const toes = {
    l: source.getObjectByName("ltoes"),
    r: source.getObjectByName("rtoes"),
  };
  if (!toes.l || !toes.r) throw new Error("CMU foot lock needs left and right source toes");
  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const heights: Record<Side, number[]> = { l: [], r: [] };
  const positions: Record<Side, THREE.Vector3[]> = { l: [], r: [] };
  try {
    for (const time of times) {
      mixer.setTime(time);
      source.updateWorldMatrix(true, true);
      for (const side of ["l", "r"] as const) {
        const p = worldPosition(toes[side]!);
        heights[side].push(p.y);
        positions[side].push(p);
      }
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(source);
  }
  const mask: Record<Side, boolean[]> = { l: [], r: [] };
  for (const side of ["l", "r"] as const) {
    const floor = Math.min(...heights[side]);
    let touching = false;
    for (let i = 0; i < times.length; i++) {
      const speed = i === 0 ? 0 : positions[side][i]
        .distanceTo(positions[side][i - 1]) /
        Math.max(1e-4, times[i] - times[i - 1]);
      const height = heights[side][i] - floor;
      // Hysteresis prevents foot lock blinking at the source noise floor.
      const enter = speed < 0.13 && height < 0.085;
      const remain = speed < 0.22 && height < 0.105;
      touching = touching ? remain : enter;
      mask[side].push(touching);
    }
    // Reject one-frame contacts or toe jitter; every stance lasts >=100ms.
    for (let start = 0; start < mask[side].length;) {
      if (!mask[side][start]) { start++; continue; }
      let end = start + 1;
      while (end < mask[side].length && mask[side][end]) end++;
      if (end - start < 4) mask[side].fill(false, start, end);
      start = end;
    }
  }
  return mask;
}

function setWorldRotation(node: THREE.Object3D, world: THREE.Quaternion): void {
  const parentWorld = node.parent?.getWorldQuaternion(new THREE.Quaternion());
  node.quaternion.copy(parentWorld
    ? parentWorld.invert().multiply(world) : world).normalize();
}

function solveToeTwoBoneIK(nodes: Nodes, targetToe: THREE.Vector3): void {
  const { thigh, calf, foot, toe } = nodes;
  thigh.updateWorldMatrix(true, true);
  const root = worldPosition(thigh);
  const knee = worldPosition(calf);
  const ankle = worldPosition(foot);
  const toeNow = worldPosition(toe);
  const footWorld = foot.getWorldQuaternion(new THREE.Quaternion());

  const top = knee.distanceTo(root);
  const lower = ankle.distanceTo(knee);
  if (top < 1e-4 || lower < 1e-4) return;
  // Keep the exact original foot/world orientation. Shift the ankle target
  // by the measured toe error so toe position is not changed by ankle roll.
  const wantedAnkle = ankle.clone().add(targetToe).sub(toeNow);
  const toward = wantedAnkle.clone().sub(root);
  const reach = THREE.MathUtils.clamp(
    toward.length(), Math.abs(top - lower) + 0.004, top + lower - 0.004,
  );
  toward.normalize();
  // Preserve the original knee bending side instead of introducing a
  // new procedural knee pole that might invert or snap the joint.
  const along = top * (top * top + reach * reach - lower * lower) / (2 * top * reach);
  const across = Math.sqrt(Math.max(0, top * top - along * along));
  const projected = knee.clone().sub(root)
    .addScaledVector(toward, -knee.clone().sub(root).dot(toward));
  if (projected.lengthSq() < 1e-8) {
    projected.set(0, 0, 1).applyQuaternion(
      thigh.getWorldQuaternion(new THREE.Quaternion()),
    );
    projected.addScaledVector(toward, -projected.dot(toward));
  }
  if (projected.lengthSq() < 1e-8) return;
  projected.normalize();
  const desiredKnee = root.clone()
    .addScaledVector(toward, along)
    .addScaledVector(projected, across);
  const thighSwing = new THREE.Quaternion().setFromUnitVectors(
    knee.clone().sub(root).normalize(),
    desiredKnee.sub(root).normalize(),
  );
  setWorldRotation(thigh, thighSwing.multiply(
    thigh.getWorldQuaternion(new THREE.Quaternion()),
  ));
  thigh.updateWorldMatrix(true, true);
  const revisedKnee = worldPosition(calf);
  const revisedAnkle = worldPosition(foot);
  const desiredAnkle = root.clone().addScaledVector(toward, reach);
  const calfSwing = new THREE.Quaternion().setFromUnitVectors(
    revisedAnkle.clone().sub(revisedKnee).normalize(),
    desiredAnkle.sub(revisedKnee).normalize(),
  );
  setWorldRotation(calf, calfSwing.multiply(
    calf.getWorldQuaternion(new THREE.Quaternion()),
  ));
  calf.updateWorldMatrix(true, true);
  setWorldRotation(foot, footWorld);
  foot.updateWorldMatrix(true, true);
}

function nodesForSide(target: THREE.Object3D, side: Side): Nodes {
  const thigh = target.getObjectByName("thigh_" + side);
  const calf = target.getObjectByName("calf_" + side);
  const foot = target.getObjectByName("foot_" + side);
  const toe = target.getObjectByName("ball_" + side);
  if (!thigh || !calf || !foot || !toe) {
    throw new Error("UBC foot lock requires full " + side + " leg chain");
  }
  return { thigh, calf, foot, toe };
}

export function buildCmuStanceLockedClip(
  source: THREE.Object3D,
  target: THREE.Object3D,
  sourceMotion: THREE.AnimationClip,
  anatomical: THREE.AnimationClip,
  report?: FootLockReport,
): THREE.AnimationClip {
  const parent = target.parent;
  const index = parent?.children.indexOf(target) ?? -1;
  const targetTransform = {
    position: target.position.clone(),
    quaternion: target.quaternion.clone(),
    scale: target.scale.clone(),
  };
  const saved: State[] = [];
  target.traverse(node => saved.push({
    node, position: node.position.clone(),
    quaternion: node.quaternion.clone(), scale: node.scale.clone(),
  }));
  source.updateWorldMatrix(true, true);
  const sourceSaved: State[] = [];
  source.traverse(node => sourceSaved.push({
    node, position: node.position.clone(),
    quaternion: node.quaternion.clone(), scale: node.scale.clone(),
  }));
  target.removeFromParent();
  target.position.set(0, 0, 0);
  target.quaternion.identity();
  target.scale.set(1, 1, 1);
  target.updateWorldMatrix(true, true);
  const count = Math.max(2, Math.ceil(anatomical.duration * 30) + 1);
  const times = Float32Array.from({ length: count }, (_, i) =>
    anatomical.duration * i / (count - 1));
  const clips = new Map<string, Float32Array>();
  const bones = {
    l: nodesForSide(target, "l"),
    r: nodesForSide(target, "r"),
  };
  for (const side of ["l", "r"] as const) {
    for (const bone of [bones[side].thigh, bones[side].calf, bones[side].foot]) {
      clips.set(bone.name, new Float32Array(count * 4));
    }
  }
  const mixer = new THREE.AnimationMixer(target);
  const action = mixer.clipAction(anatomical).play();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  const anchors: Record<Side, THREE.Vector3 | null> = { l: null, r: null };
  const seen: Record<Side, number> = { l: 0, r: 0 };
  const stats = { locked: 0, runs: 0, initial: 0, corrected: 0, worst: 0, maxAngle: 0 };
  try {
    const mask = sourceContacts(source, sourceMotion, times);
    const prevQuats = new Map<string, THREE.Quaternion>();
    for (let frame = 0; frame < count; frame++) {
      mixer.setTime(times[frame]);
      target.updateWorldMatrix(true, true);
      for (const side of ["l", "r"] as const) {
        const chain = bones[side];
        if (mask[side][frame]) {
          if (!anchors[side]) {
            anchors[side] = worldPosition(chain.toe);
            seen[side] = 0;
            stats.runs++;
          }
          seen[side]++;
          const current = worldPosition(chain.toe);
          const drift = current.distanceTo(anchors[side]!);
          const fadeIn = THREE.MathUtils.smoothstep(seen[side], 1, 4);
          let tail = 0;
          for (let future = frame + 1; future < Math.min(count, frame + 4); future++) {
            if (mask[side][future]) tail++;
            else break;
          }
          const fadeOut = THREE.MathUtils.smoothstep(tail, 0, 3);
          const weight = Math.min(fadeIn, fadeOut);
          const correction = anchors[side]!.clone().sub(current).multiplyScalar(weight);
          if (correction.length() > 0.18) correction.setLength(0.18);
          const targetToe = current.clone().add(correction);
          const before = chain.thigh.getWorldQuaternion(new THREE.Quaternion());
          solveToeTwoBoneIK(chain, targetToe);
          target.updateWorldMatrix(true, true);
          const after = worldPosition(chain.toe);
          const difference = chain.thigh.getWorldQuaternion(new THREE.Quaternion()).angleTo(before);
          stats.maxAngle = Math.max(stats.maxAngle, THREE.MathUtils.radToDeg(difference));
          stats.locked++;
          stats.initial += drift;
          stats.corrected += after.distanceTo(anchors[side]!);
          stats.worst = Math.max(stats.worst, after.distanceTo(anchors[side]!));
        } else {
          anchors[side] = null;
          seen[side] = 0;
        }
      }
      for (const side of ["l", "r"] as const) {
        for (const bone of [bones[side].thigh, bones[side].calf, bones[side].foot]) {
          const track = clips.get(bone.name)!;
          const q = bone.quaternion.clone();
          const prev = prevQuats.get(bone.name);
          if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
          q.toArray(track, frame * 4);
          prevQuats.set(bone.name, q);
        }
      }
    }
    const newTracks = anatomical.tracks.filter(track => {
      const name = track.name.endsWith(".quaternion")
        ? track.name.slice(0, -".quaternion".length) : "";
      return !clips.has(name);
    });
    for (const [name, values] of clips) {
      newTracks.push(new THREE.QuaternionKeyframeTrack(name + ".quaternion", times, values));
    }
    const output = new THREE.AnimationClip(anatomical.name + "_STANCE",
      anatomical.duration, newTracks, anatomical.blendMode);
    output.optimize();
    if (report) {
      report.lockedFrames = stats.locked;
      report.runs = stats.runs;
      report.meanBaselineDrift = stats.locked ? stats.initial / stats.locked : 0;
      report.meanCorrectedDrift = stats.locked ? stats.corrected / stats.locked : 0;
      report.maxCorrectedDrift = stats.worst;
      report.maxLegRotationDegrees = stats.maxAngle;
      report.sideRuns = {
        left: mask.l.filter((x,i)=>x && (i===0 || !mask.l[i-1])).length,
        right: mask.r.filter((x,i)=>x && (i===0 || !mask.r[i-1])).length,
      };
    }
    return output;
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(target);
    sourceSaved.forEach(s => {
      s.node.position.copy(s.position);
      s.node.quaternion.copy(s.quaternion);
      s.node.scale.copy(s.scale);
    });
    source.updateWorldMatrix(true,true);
    saved.forEach(s => {
      s.node.position.copy(s.position);
      s.node.quaternion.copy(s.quaternion);
      s.node.scale.copy(s.scale);
    });
    target.position.copy(targetTransform.position);
    target.quaternion.copy(targetTransform.quaternion);
    target.scale.copy(targetTransform.scale);
    if (parent) {
      parent.add(target);
      if (index >= 0 && index < parent.children.length - 1) {
        parent.children.splice(parent.children.indexOf(target), 1);
        parent.children.splice(index, 0, target);
      }
    }
    target.updateWorldMatrix(true,true);
  }
}
