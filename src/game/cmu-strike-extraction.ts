import * as THREE from "three";

/**
 * Measured, opt-in CMU boxing excerpts for MODEL VIEW only.
 *
 * Source windows were chosen after scanning the actual 13_17-boxing GLB,
 * not guessed from character poses. "Contact" is the source wrist's maximum
 * forward extension, NOT a validated gameplay hitbox collision.
 */
export type CmuStrikeSide = "LEFT" | "RIGHT";

export interface CmuStrikeContact {
  hand: CmuStrikeSide;
  /** Time within the extracted clip, seconds. */
  time: number;
  /** Absolute time within original CMU 13_17 source, seconds. */
  sourceTime: number;
  /** Contact position as fraction of extracted clip duration. */
  normalized: number;
  forwardReach: number;
  extensionGain: number;
  recoveryGain: number;
  peakApproachSpeed: number;
}

export interface CmuStrikePreview {
  name: string;
  label: string;
  sourceStart: number;
  sourceEnd: number;
  contacts: CmuStrikeContact[];
}

export interface ExtractedCmuStrike {
  clip: THREE.AnimationClip;
  preview: CmuStrikePreview;
}

interface ContactWindow {
  hand: CmuStrikeSide;
  first: number;
  last: number;
}
interface ExtractionWindow {
  name: string;
  label: string;
  start: number;
  end: number;
  contacts: readonly ContactWindow[];
}

const CURATED_BOXING_WINDOWS: readonly ExtractionWindow[] = [
  {
    name: "CMU_BOXING_RIGHT_STRAIGHT",
    label: "RIGHT STRAIGHT",
    start: 1.70,
    end: 2.48,
    contacts: [{ hand: "RIGHT", first: 1.89, last: 2.12 }],
  },
  {
    name: "CMU_BOXING_LEFT_RIGHT_COMBO",
    label: "LEFT → RIGHT COMBO",
    start: 2.74,
    end: 3.76,
    contacts: [
      { hand: "LEFT", first: 2.99, last: 3.16 },
      { hand: "RIGHT", first: 3.19, last: 3.39 },
    ],
  },
];

type HandBones = { wrist: THREE.Object3D; shoulder: THREE.Object3D };
type SourceRig = {
  lHip: THREE.Object3D;
  rHip: THREE.Object3D;
  thorax: THREE.Object3D;
  root: THREE.Object3D;
  hands: Record<CmuStrikeSide, HandBones>;
};

function requireNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error("CMU boxing is missing anatomical joint " + name);
  return node;
}

function sourceRig(root: THREE.Object3D): SourceRig {
  return {
    lHip: requireNode(root, "lfemur"),
    rHip: requireNode(root, "rfemur"),
    thorax: requireNode(root, "thorax"),
    root: requireNode(root, "root"),
    hands: {
      LEFT: { wrist: requireNode(root, "lwrist"), shoulder: requireNode(root, "lhumerus") },
      RIGHT: { wrist: requireNode(root, "rwrist"), shoulder: requireNode(root, "rhumerus") },
    },
  };
}

/** Forward wrist reach measured in the body's own anatomical frame. */
function forwardReach(rig: SourceRig, hand: CmuStrikeSide): number {
  const side = rig.lHip.getWorldPosition(new THREE.Vector3())
    .sub(rig.rHip.getWorldPosition(new THREE.Vector3())).normalize();
  const up = rig.thorax.getWorldPosition(new THREE.Vector3())
    .sub(rig.root.getWorldPosition(new THREE.Vector3())).normalize();
  const forward = side.cross(up);
  if (forward.lengthSq() < 1e-7) throw new Error("CMU boxing torso basis collapsed");
  const { wrist, shoulder } = rig.hands[hand];
  return wrist.getWorldPosition(new THREE.Vector3())
    .sub(shoulder.getWorldPosition(new THREE.Vector3()))
    .dot(forward.normalize());
}

type Transform = {
  node: THREE.Object3D;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
};

function preserveScene(root: THREE.Object3D): Transform[] {
  const states: Transform[] = [];
  root.traverse((node) => states.push({
    node, position: node.position.clone(),
    rotation: node.quaternion.clone(), scale: node.scale.clone(),
  }));
  return states;
}

function restoreScene(root: THREE.Object3D, states: Transform[]): void {
  for (const state of states) {
    state.node.position.copy(state.position);
    state.node.quaternion.copy(state.rotation);
    state.node.scale.copy(state.scale);
  }
  root.updateWorldMatrix(true, true);
}

function sampleContact(
  mixer: THREE.AnimationMixer,
  root: THREE.Object3D,
  rig: SourceRig,
  window: ExtractionWindow,
  contact: ContactWindow,
): CmuStrikeContact {
  const sample = (t: number): number => {
    mixer.setTime(t);
    root.updateWorldMatrix(true, true);
    return forwardReach(rig, contact.hand);
  };

  const startReach = sample(window.start);
  const endReach = sample(window.end);
  const step = 1 / 120;
  const frames = Math.ceil((contact.last - contact.first) / step);
  let bestTime = contact.first;
  let bestReach = -Infinity;
  let maxApproachSpeed = 0;
  let previousTime = contact.first;
  let previousReach = sample(previousTime);
  for (let i = 0; i <= frames; i++) {
    const t = contact.first + (contact.last - contact.first) * i / frames;
    const reach = sample(t);
    if (reach > bestReach) {
      bestReach = reach;
      bestTime = t;
    }
    if (i > 0) {
      maxApproachSpeed = Math.max(maxApproachSpeed,
        (reach - previousReach) / (t - previousTime));
    }
    previousTime = t;
    previousReach = reach;
  }
  const extensionGain = bestReach - startReach;
  const recoveryGain = bestReach - endReach;

  // Real contact candidate must begin from guard and recover, rather than
  // merely be a quick sideways arm wave. Enforce this against source GLB.
  if (extensionGain < 0.12 || recoveryGain < 0.10 || maxApproachSpeed < 0.70) {
    throw new Error(
      window.name + " " + contact.hand +
      " is not a guard→extension→recovery punch: " +
      JSON.stringify({ extensionGain, recoveryGain, maxApproachSpeed }),
    );
  }
  return {
    hand: contact.hand,
    time: bestTime - window.start,
    sourceTime: bestTime,
    normalized: (bestTime - window.start) / (window.end - window.start),
    forwardReach: bestReach,
    extensionGain,
    recoveryGain,
    peakApproachSpeed: maxApproachSpeed,
  };
}

/**
 * Build a fresh subclip by resampling the actual already-retargeted target
 * tracks. In particular this does NOT try to re-retarget the CMU ASF clip.
 * All body, head, pelvis, wrist, leg and toe motion is preserved.
 */
function sliceClip(clip: THREE.AnimationClip, def: ExtractionWindow): THREE.AnimationClip {
  const duration = def.end - def.start;
  const count = Math.max(3, Math.ceil(duration * 30) + 1);
  const times = Float32Array.from({ length: count }, (_, i) =>
    duration * i / (count - 1));
  const tracks = clip.tracks.map((track) => {
    const size = track.getValueSize();
    const samples = new Float32Array(count * size);
    const interpolant = track.createInterpolant();
    for (let i = 0; i < count; i++) {
      const value = interpolant.evaluate(def.start + times[i]);
      for (let c = 0; c < size; c++) {
        samples[i * size + c] = value[c];
      }
    }
    const sliced = track.clone();
    sliced.times = times.slice();
    sliced.values = samples;
    return sliced;
  });
  const result = new THREE.AnimationClip(def.name, duration, tracks, clip.blendMode);
  result.optimize();
  return result;
}

export function extractCmuBoxingStrikes(
  source: THREE.Object3D,
  motion: THREE.AnimationClip,
  anatomical: THREE.AnimationClip,
): ExtractedCmuStrike[] {
  if (motion.duration < 4 || anatomical.duration < 4 ||
      Math.abs(motion.duration - anatomical.duration) > 0.08) {
    throw new Error("CMU strike extraction requires matching full-length source/target clips");
  }
  const rig = sourceRig(source);
  const before = preserveScene(source);
  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(motion);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  try {
    return CURATED_BOXING_WINDOWS.map((window) => {
      if (window.end >= motion.duration || window.start < 0 ||
          window.contacts.some(c => c.first < window.start || c.last > window.end)) {
        throw new Error("CMU boxing source window exceeded clip boundaries");
      }
      const contacts = window.contacts.map(c =>
        sampleContact(mixer, source, rig, window, c));
      for (let i = 1; i < contacts.length; i++) {
        if (contacts[i].time <= contacts[i - 1].time) {
          throw new Error("CMU combination contacts are not chronologically ordered");
        }
      }
      return {
        clip: sliceClip(anatomical, window),
        preview: {
          name: window.name,
          label: window.label,
          sourceStart: window.start,
          sourceEnd: window.end,
          contacts,
        },
      };
    });
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(source);
    restoreScene(source, before);
  }
}
