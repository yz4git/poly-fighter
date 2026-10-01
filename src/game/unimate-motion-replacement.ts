import type * as THREE from "three";
import type { FighterState, VisualContactPoint } from "./types";

export const UNIMATE_MOTION_REPLACEMENT_VERSION = "UNIMATE_INSPIRED_TOPOLOGY_REPLACEMENT_V1";

export type UniMateReplacementInput = {
  bones: Map<string, THREE.Object3D>;
  state: FighterState;
  currentClip: string;
  visualContact?: VisualContactPoint;
  contactWeight: number;
};

export type UniMateReplacementProfile = {
  scales: Map<string, number>;
  mode: "NONE" | "ATTACK_GRAPH_PIN" | "LOCOMOTION_LOWER_BODY" | "GUARD_UPPER_BODY" | "LANDING_LOWER_BODY";
  seedBones: string[];
  protectedBoneCount: number;
  strongestPin: number;
};

const ATTACK_GRAPH_FALLOFF = [1.0, 0.84, 0.60, 0.34, 0.15] as const;
const SUPPORT_GRAPH_FALLOFF = [1.0, 0.82, 0.54, 0.26] as const;
const LIGHT_GRAPH_FALLOFF = [1.0, 0.62, 0.28] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function boneNameByLower(bones: Map<string, THREE.Object3D>, wanted: string): string | null {
  if (bones.has(wanted)) return wanted;
  const lower = wanted.toLowerCase();
  for (const name of bones.keys()) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

function skeletonAdjacency(bones: Map<string, THREE.Object3D>): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const objectToName = new Map<THREE.Object3D, string>();
  for (const [name, bone] of bones) {
    if (!(bone as THREE.Bone).isBone) continue;
    adjacency.set(name, new Set());
    objectToName.set(bone, name);
  }
  for (const [name, bone] of bones) {
    if (!(bone as THREE.Bone).isBone) continue;
    const parentName = bone.parent ? objectToName.get(bone.parent) : undefined;
    if (!parentName) continue;
    adjacency.get(name)?.add(parentName);
    adjacency.get(parentName)?.add(name);
  }
  return adjacency;
}

function graphDistances(
  adjacency: Map<string, Set<string>>,
  seed: string,
  maxDistance: number,
): Map<string, number> {
  const distances = new Map<string, number>();
  if (!adjacency.has(seed)) return distances;
  const queue: string[] = [seed];
  distances.set(seed, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index];
    const distance = distances.get(name) ?? 0;
    if (distance >= maxDistance) continue;
    for (const neighbor of adjacency.get(name) ?? []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distance + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

function applyGraphPin(
  pinStrengths: Map<string, number>,
  adjacency: Map<string, Set<string>>,
  seed: string | null,
  strength: number,
  falloff: readonly number[],
): void {
  if (!seed) return;
  const distances = graphDistances(adjacency, seed, falloff.length - 1);
  for (const [name, distance] of distances) {
    const pin = clamp01(strength * (falloff[distance] ?? 0));
    pinStrengths.set(name, Math.max(pinStrengths.get(name) ?? 0, pin));
  }
}

function contactBone(contact?: VisualContactPoint): string | null {
  switch (contact) {
    case "LEFT_FIST": return "hand_l";
    case "RIGHT_FIST": return "hand_r";
    case "LEFT_FOOT": return "foot_l";
    case "RIGHT_FOOT": return "foot_r";
    default: return null;
  }
}

function oppositeGuardHand(contact?: VisualContactPoint): string | null {
  if (contact === "LEFT_FIST") return "hand_r";
  if (contact === "RIGHT_FIST") return "hand_l";
  return null;
}

function supportFoot(contact?: VisualContactPoint): string | null {
  if (contact === "LEFT_FOOT") return "foot_r";
  if (contact === "RIGHT_FOOT") return "foot_l";
  if (contact === "LEFT_FIST") return "foot_r";
  if (contact === "RIGHT_FIST") return "foot_l";
  return null;
}

function secondaryGroundFoot(contact?: VisualContactPoint): string | null {
  // Punches should keep a two-foot base through the contact approach. The
  // opposite foot remains the primary support anchor; the same-side foot gets
  // a lighter local pin so inertial carry cannot make the stance visibly skate.
  if (contact === "LEFT_FIST") return "foot_l";
  if (contact === "RIGHT_FIST") return "foot_r";
  return null;
}

function finalize(
  bones: Map<string, THREE.Object3D>,
  pinStrengths: Map<string, number>,
  mode: UniMateReplacementProfile["mode"],
  seedBones: string[],
): UniMateReplacementProfile {
  const scales = new Map<string, number>();
  let strongestPin = 0;
  let protectedBoneCount = 0;
  for (const [name, bone] of bones) {
    if (!(bone as THREE.Bone).isBone) continue;
    const pin = clamp01(pinStrengths.get(name) ?? 0);
    const scale = 1 - pin;
    scales.set(name, scale);
    if (pin > 0.01) protectedBoneCount += 1;
    strongestPin = Math.max(strongestPin, pin);
  }
  return { scales, mode, seedBones, protectedBoneCount, strongestPin };
}

/**
 * UniMate-inspired replacement mask.
 *
 * UniMate keeps selected joints/frames exact while regenerating the rest and
 * uses skeleton-graph distance as an explicit structural signal. At runtime we
 * apply the same principle to clip transitions: authored destination joints are
 * progressively "pinned" (inertial scale -> 0) around important end effectors,
 * while unrelated body parts keep velocity-aware inertial continuity.
 */
export function buildUniMateReplacementProfile(input: UniMateReplacementInput): UniMateReplacementProfile {
  const adjacency = skeletonAdjacency(input.bones);
  const pins = new Map<string, number>();
  const seeds: string[] = [];

  const seed = (wanted: string | null, strength: number, falloff: readonly number[]) => {
    if (!wanted) return;
    const resolved = boneNameByLower(input.bones, wanted);
    if (!resolved) return;
    seeds.push(resolved);
    applyGraphPin(pins, adjacency, resolved, strength, falloff);
  };

  if (input.state === "ATTACK") {
    // Replacement-style pinning begins before ACTIVE so the striking chain does
    // not smear through the outgoing clip. It becomes strongest as authored
    // contact approaches. The existing global contact suppression still makes
    // the exact full-body contact frame authoritative.
    const contact = clamp01(input.contactWeight);
    const strikeStrength = 0.58 + contact * 0.42;
    const supportStrength = 0.48 + contact * 0.42;
    seed(contactBone(input.visualContact), strikeStrength, ATTACK_GRAPH_FALLOFF);
    seed(supportFoot(input.visualContact), supportStrength, SUPPORT_GRAPH_FALLOFF);
    seed(secondaryGroundFoot(input.visualContact), 0.26 + contact * 0.30, LIGHT_GRAPH_FALLOFF);
    seed(oppositeGuardHand(input.visualContact), 0.22 + contact * 0.28, LIGHT_GRAPH_FALLOFF);
    seed("pelvis", 0.16 + contact * 0.22, LIGHT_GRAPH_FALLOFF);
    return finalize(input.bones, pins, "ATTACK_GRAPH_PIN", seeds);
  }

  if (input.currentClip === "CM_Land") {
    seed("foot_l", 0.78, SUPPORT_GRAPH_FALLOFF);
    seed("foot_r", 0.78, SUPPORT_GRAPH_FALLOFF);
    seed("pelvis", 0.34, LIGHT_GRAPH_FALLOFF);
    return finalize(input.bones, pins, "LANDING_LOWER_BODY", seeds);
  }

  if (input.state === "WALK") {
    // UniMate's joint-editing mask suggests preserving the lower-body task while
    // allowing the upper body to keep continuity across direction changes.
    seed("foot_l", 0.52, SUPPORT_GRAPH_FALLOFF);
    seed("foot_r", 0.52, SUPPORT_GRAPH_FALLOFF);
    return finalize(input.bones, pins, "LOCOMOTION_LOWER_BODY", seeds);
  }

  if (input.state === "GUARD") {
    seed("hand_l", 0.36, LIGHT_GRAPH_FALLOFF);
    seed("hand_r", 0.36, LIGHT_GRAPH_FALLOFF);
    return finalize(input.bones, pins, "GUARD_UPPER_BODY", seeds);
  }

  return finalize(input.bones, pins, "NONE", seeds);
}
