import * as THREE from "three";
import type { CombatMotionHandoffMode } from "./combat-motion-handoff";

/**
 * MotionBricks-inspired duration planner. NVIDIA's root model learns the
 * transition duration; we deliberately use a deterministic authored-pose gap
 * heuristic here. This affects presentation only, never move timing/hitboxes.
 */
export const MOTIONBRICKS_ADAPTIVE_HANDOFF_VERSION = "POSE_GAP_DURATION_V1";

type OutgoingPose = Readonly<{ position: THREE.Vector3; rotation: THREE.Quaternion }>;

export type AdaptiveHandoffPlan = Readonly<{
  duration: number;
  severity: number;
  evaluatedBones: number;
}>;

const REACTIVE_MODES = new Set<CombatMotionHandoffMode>([
  "REACTION_INTERRUPT",
  "BLOCK_INTERRUPT",
  "LANDING",
]);

const PROBE_WEIGHTS: Readonly<Record<string, number>> = {
  pelvis: 1.6,
  spine_02: 1.1,
  spine_03: 1.3,
  Head: .35,
  upperarm_l: .8,
  upperarm_r: .8,
  thigh_l: .9,
  thigh_r: .9,
  calf_l: .65,
  calf_r: .65,
};

/**
 * Replan once, *after* the incoming authored clip has been sampled at its
 * actual combat-timeline phase. Reaction and landing interruptions remain
 * immediate. Continuous movement and neutral handoffs become faster when the
 * poses already match; large combo pose changes get slightly longer crossfades.
 */
export function planAdaptiveMotionHandoff(
  mode: CombatMotionHandoffMode,
  plannedSeconds: number,
  outgoing: ReadonlyMap<string, OutgoingPose>,
  incoming: ReadonlyMap<string, THREE.Object3D>,
): AdaptiveHandoffPlan {
  const base = Number.isFinite(plannedSeconds) ? THREE.MathUtils.clamp(plannedSeconds, 0, .12) : 0;
  if (!(base > 0) || REACTIVE_MODES.has(mode) || outgoing.size === 0) {
    return { duration: base, severity: 0, evaluatedBones: 0 };
  }
  let weighted = 0;
  let totalWeight = 0;
  let evaluatedBones = 0;
  for (const [name, weight] of Object.entries(PROBE_WEIGHTS)) {
    const from = outgoing.get(name), to = incoming.get(name);
    if (!from || !to) continue;
    const angle = from.rotation.angleTo(to.quaternion);
    if (!Number.isFinite(angle)) continue;
    // Roughly 1.1 radians of *mean* local-joint change counts as a large
    // discontinuity; a maximum of 15% pelvis-local translation is included.
    let poseGap = THREE.MathUtils.clamp(angle / 1.1, 0, 1);
    if (name === "pelvis") {
      const translation = from.position.distanceTo(to.position);
      if (Number.isFinite(translation)) {
        poseGap = Math.max(poseGap, THREE.MathUtils.clamp(translation / .15, 0, 1));
      }
    }
    weighted += poseGap * weight;
    totalWeight += weight;
    evaluatedBones += 1;
  }
  if (evaluatedBones === 0) return { duration: base, severity: 0, evaluatedBones: 0 };
  const severity = THREE.MathUtils.clamp(weighted / totalWeight, 0, 1);
  // Limit overlap for move entries to preserve startup silhouette readability.
  // Guard/neutral recovery may spend one more frame restoring the torso.
  const attackEntry = mode === "ATTACK_ENTRY";
  const maxDuration = attackEntry ? .077 :
    mode === "ATTACK_COMBO" ? .108 :
    mode === "ATTACK_TO_GUARD" || mode === "ATTACK_TO_READY" ? .115 : .11;
  const minDuration = attackEntry ? .043 : Math.min(.06, base * .76);
  return {
    duration: THREE.MathUtils.clamp(base * (.84 + severity * .53), minDuration, maxDuration),
    severity,
    evaluatedBones,
  };
}
