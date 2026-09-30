import * as THREE from "three";
import type { FighterRuntime } from "./fighter";

/**
 * Lightweight runtime conditioning inspired by NVIDIA Kimodo's public motion
 * representation: smoothed root trajectory, joint velocity awareness and foot
 * contacts are treated separately from the authored body pose.
 *
 * This does NOT run the Kimodo diffusion model in the browser. It preserves the
 * committed Blender/Motion Foundry clip as the authoritative pose and applies a
 * bounded presentation-only cleanup pass after clip sampling.
 */
export const KIMODO_MOTION_CONDITIONING_VERSION = "KIMODO_INSPIRED_RUNTIME_V1";

type FootSide = "l" | "r";

type FootState = {
  previous: THREE.Vector3 | null;
  anchor: THREE.Vector3 | null;
  contact: number;
};

type ConditioningState = {
  lastState: string;
  lastMove: string | null;
  smoothedPelvis: THREE.Vector3 | null;
  feet: Record<FootSide, FootState>;
  bodyRotations: Map<string, THREE.Quaternion>;
};

export type KimodoConditioningRig = {
  model: THREE.Object3D;
  bones: Map<string, THREE.Object3D>;
};

const states = new WeakMap<THREE.Object3D, ConditioningState>();
const BODY_DAMPING_BONES = ["pelvis", "spine_02", "spine_03", "Head"] as const;
const CALM_STATES = new Set(["IDLE", "WALK", "GUARD", "CROUCH", "BLOCK_STUN"]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smooth01(value: number): number {
  const u = clamp01(value);
  return u * u * (3 - 2 * u);
}

function contactWeight(height: number, horizontalSpeed: number, scale: number): number {
  const heightWeight = 1 - smooth01((height - 0.012 * scale) / Math.max(1e-5, 0.06 * scale));
  const speedWeight = 1 - smooth01((horizontalSpeed - 0.05 * scale) / Math.max(1e-5, 0.75 * scale));
  return clamp01(heightWeight * speedWeight);
}

function boundedHorizontal(vector: THREE.Vector3, limit: number): THREE.Vector3 {
  vector.y = 0;
  const length = vector.length();
  if (length > limit && length > 1e-8) vector.multiplyScalar(limit / length);
  return vector;
}

function stateFor(root: THREE.Object3D): ConditioningState {
  let state = states.get(root);
  if (!state) {
    state = {
      lastState: "",
      lastMove: null,
      smoothedPelvis: null,
      feet: {
        l: { previous: null, anchor: null, contact: 0 },
        r: { previous: null, anchor: null, contact: 0 },
      },
      bodyRotations: new Map(),
    };
    states.set(root, state);
  }
  return state;
}

function applyPelvisWorldOffset(pelvis: THREE.Object3D, worldOffset: THREE.Vector3): void {
  if (!pelvis.parent || worldOffset.lengthSq() <= 1e-12) return;
  pelvis.updateWorldMatrix(true, false);
  const world = pelvis.getWorldPosition(new THREE.Vector3());
  const currentLocal = pelvis.parent.worldToLocal(world.clone());
  const targetLocal = pelvis.parent.worldToLocal(world.clone().add(worldOffset));
  pelvis.position.add(targetLocal.sub(currentLocal));
}

/**
 * Applies a bounded root/body conditioning pass after the imported clip has
 * been sampled. Gameplay position, hitboxes, move timing and authored strike
 * end-effectors remain untouched.
 */
export function applyKimodoMotionConditioning(
  rig: KimodoConditioningRig,
  fighter: FighterRuntime,
  deltaSeconds: number,
): void {
  const root = fighter.visual.root;
  const pelvis = rig.bones.get("pelvis");
  const leftFoot = rig.bones.get("foot_l");
  const rightFoot = rig.bones.get("foot_r");
  if (!pelvis || !leftFoot || !rightFoot) return;

  const state = stateFor(root);
  const moveId = fighter.currentMove?.id ?? null;
  const changed = state.lastState !== fighter.state || state.lastMove !== moveId;
  state.lastState = fighter.state;
  state.lastMove = moveId;

  rig.model.updateMatrixWorld(true);
  const scale = Math.max(1e-5, Math.abs(root.scale.x));
  const pelvisWorld = pelvis.getWorldPosition(new THREE.Vector3());
  const footWorld: Record<FootSide, THREE.Vector3> = {
    l: leftFoot.getWorldPosition(new THREE.Vector3()),
    r: rightFoot.getWorldPosition(new THREE.Vector3()),
  };

  if (changed) {
    state.smoothedPelvis = pelvisWorld.clone();
    state.bodyRotations.clear();
    state.feet.l.anchor = null;
    state.feet.r.anchor = null;
  }

  if (!(deltaSeconds > 0)) {
    state.feet.l.previous = footWorld.l.clone();
    state.feet.r.previous = footWorld.r.clone();
    return;
  }

  const airborneVisualMove = moveId === "dashKick";
  const canGround = fighter.grounded
    && !airborneVisualMove
    && !["JUMP", "KNOCKDOWN", "THROW", "KO", "RING_OUT"].includes(fighter.state);
  const floor = Math.min(footWorld.l.y, footWorld.r.y);

  const driftCorrection = new THREE.Vector3();
  let driftWeight = 0;
  for (const side of ["l", "r"] as const) {
    const foot = state.feet[side];
    const previous = foot.previous;
    const current = footWorld[side];
    const horizontalSpeed = previous
      ? Math.hypot(current.x - previous.x, current.z - previous.z) / Math.max(1e-4, deltaSeconds)
      : Number.POSITIVE_INFINITY;
    foot.contact = canGround ? contactWeight(current.y - floor, horizontalSpeed, scale) : 0;

    if (foot.contact >= 0.72) {
      if (!foot.anchor || foot.anchor.distanceTo(current) > 0.095 * scale) foot.anchor = current.clone();
    } else if (foot.contact <= 0.28) {
      foot.anchor = null;
    }

    if (foot.anchor && foot.contact > 0.35) {
      driftCorrection.x += (foot.anchor.x - current.x) * foot.contact;
      driftCorrection.z += (foot.anchor.z - current.z) * foot.contact;
      driftWeight += foot.contact;
    }
    foot.previous = current.clone();
  }
  if (driftWeight > 0) driftCorrection.multiplyScalar(1 / driftWeight);

  // Kimodo separates a smooth root trajectory from body articulation. Recreate
  // that idea conservatively: calm states receive only a tiny high-frequency
  // root cleanup; attacks never have their authored forward drive low-pass
  // filtered.
  const rootCorrection = new THREE.Vector3();
  const calm = CALM_STATES.has(fighter.state);
  if (!state.smoothedPelvis) state.smoothedPelvis = pelvisWorld.clone();
  const rootAlpha = 1 - Math.exp(-deltaSeconds * (fighter.state === "WALK" ? 26 : 18));
  state.smoothedPelvis.lerp(pelvisWorld, rootAlpha);
  if (calm) {
    rootCorrection.copy(state.smoothedPelvis).sub(pelvisWorld);
    boundedHorizontal(rootCorrection, 0.012 * scale);
  } else {
    state.smoothedPelvis.copy(pelvisWorld);
  }

  // Foot cleanup is allowed during grounded attacks, but at reduced strength so
  // support-foot skating is suppressed without flattening authored hip drive.
  const footStrength = fighter.state === "ATTACK" ? 0.55 : fighter.state === "WALK" ? 0.82 : 0.95;
  boundedHorizontal(driftCorrection, 0.032 * scale).multiplyScalar(footStrength);
  const combined = rootCorrection.add(driftCorrection);
  boundedHorizontal(combined, 0.036 * scale);
  applyPelvisWorldOffset(pelvis, combined);
  rig.model.updateMatrixWorld(true);

  // Joint-velocity damping is deliberately restricted to calm states. Contact
  // frames and recovery arcs stay exactly as authored.
  let dampingApplied = 0;
  if (calm) {
    const bodyAlpha = 1 - Math.exp(-deltaSeconds * 42);
    for (const name of BODY_DAMPING_BONES) {
      const bone = rig.bones.get(name);
      if (!bone) continue;
      const previous = state.bodyRotations.get(name);
      if (!previous) {
        state.bodyRotations.set(name, bone.quaternion.clone());
        continue;
      }
      const filtered = previous.clone().slerp(bone.quaternion, bodyAlpha).normalize();
      dampingApplied = Math.max(dampingApplied, previous.angleTo(bone.quaternion));
      bone.quaternion.copy(filtered);
      previous.copy(filtered);
    }
    rig.model.updateMatrixWorld(true);
  } else {
    state.bodyRotations.clear();
  }

  root.userData.kimodoConditioningVersion = KIMODO_MOTION_CONDITIONING_VERSION;
  root.userData.kimodoConditioningMode = "ROOT_BODY_FOOT_CONTACT";
  root.userData.kimodoRootCorrection = combined.length();
  root.userData.kimodoLeftFootContact = state.feet.l.contact;
  root.userData.kimodoRightFootContact = state.feet.r.contact;
  root.userData.kimodoBodyVelocityDamping = dampingApplied;
  root.userData.kimodoAuthoredStrikePreserved = fighter.state === "ATTACK";
}
