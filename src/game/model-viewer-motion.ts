import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FighterVisual } from "./visual-entry";
import {
  QUATERNIUS_PROCEDURAL_CORE_URL,
  QUATERNIUS_UAL_CORE_URL,
} from "./visual-quaternius-runtime";

export type ModelViewerMotionSource = "PROCEDURAL" | "BASE";

export interface ModelViewerMotionClipInfo {
  name: string;
  duration: number;
  source: ModelViewerMotionSource;
}

export interface ModelViewerMotionSnapshot {
  available: boolean;
  loading: boolean;
  clips: ModelViewerMotionClipInfo[];
  clipName: string;
  playing: boolean;
  loop: boolean;
  speed: number;
  time: number;
  duration: number;
}

type MotionSourcePack = {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  source: ModelViewerMotionSource;
};

let sourcePromise: Promise<MotionSourcePack[]> | null = null;

function loadMotionSources(): Promise<MotionSourcePack[]> {
  if (sourcePromise) return sourcePromise;
  const loader = new GLTFLoader();
  sourcePromise = Promise.all([
    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),
    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),
  ]).then(([base, procedural]) => [
    { root: base.scene, clips: base.animations, source: "BASE" as const },
    { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" as const },
  ]).catch((error) => {
    sourcePromise = null;
    throw error;
  });
  return sourcePromise;
}

function nodeMap(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const result = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (object.name) result.set(object.name, object);
  });
  return result;
}

function findQuaterniusTarget(visual: FighterVisual): THREE.Object3D | null {
  let target: THREE.Object3D | null = null;
  visual.root.traverse((object) => {
    if (target) return;
    if (object.name.startsWith("quaternius-ubc-") && object.name.endsWith("-runtime")) {
      target = object.children[0] ?? null;
    }
  });
  return target;
}

function retargetClip(
  sourceRoot: THREE.Object3D,
  targetRoot: THREE.Object3D,
  clip: THREE.AnimationClip,
): THREE.AnimationClip {
  const sourceNodes = nodeMap(sourceRoot);
  const targetNodes = nodeMap(targetRoot);
  const tracks: THREE.KeyframeTrack[] = [];
  const sourceAnimated = new THREE.Quaternion();
  const sourceRestInverse = new THREE.Quaternion();
  const targetAnimated = new THREE.Quaternion();

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
        values[offset] = targetNode.position.x;
        values[offset + 1] = targetNode.position.y + (track.values[offset + 1] - sourceNode.position.y);
        values[offset + 2] = targetNode.position.z;
      }
      const next = new THREE.VectorKeyframeTrack(track.name, track.times, values);
      next.setInterpolation(track.getInterpolation());
      tracks.push(next);
    }
  }

  const result = new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  result.optimize();
  return result;
}

function clipSort(a: ModelViewerMotionClipInfo, b: ModelViewerMotionClipInfo): number {
  if (a.name === "Idle_Loop") return -1;
  if (b.name === "Idle_Loop") return 1;
  if (a.source !== b.source) return a.source === "PROCEDURAL" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function unavailableModelViewerMotionSnapshot(loading = false): ModelViewerMotionSnapshot {
  return {
    available: false,
    loading,
    clips: [],
    clipName: "",
    playing: false,
    loop: true,
    speed: 1,
    time: 0,
    duration: 0,
  };
}

export class ModelViewerMotionController {
  private readonly mixer: THREE.AnimationMixer;
  private readonly target: THREE.Object3D;
  private readonly clips = new Map<string, { clip: THREE.AnimationClip; source: ModelViewerMotionSource }>();
  private currentAction: THREE.AnimationAction | null = null;
  private clipName = "";
  private playing = true;
  private loop = true;
  private speed = 1;

  private constructor(target: THREE.Object3D) {
    this.target = target;
    this.mixer = new THREE.AnimationMixer(target);
  }

  static async create(visual: FighterVisual): Promise<ModelViewerMotionController> {
    const target = findQuaterniusTarget(visual);
    if (!target) throw new Error("Quaternius Model View target is not ready");
    const controller = new ModelViewerMotionController(target);
    const packs = await loadMotionSources();
    for (const pack of packs) {
      for (const clip of pack.clips) {
        const retargeted = retargetClip(pack.root, target, clip);
        controller.clips.set(retargeted.name, { clip: retargeted, source: pack.source });
      }
    }
    const initial = controller.clips.has("Idle_Loop") ? "Idle_Loop" : controller.clipInfos()[0]?.name;
    if (!initial) throw new Error("No compatible motion clips found for Model View");
    controller.setClip(initial, true);
    return controller;
  }

  private clipInfos(): ModelViewerMotionClipInfo[] {
    return [...this.clips.entries()].map(([name, entry]) => ({
      name,
      duration: entry.clip.duration,
      source: entry.source,
    })).sort(clipSort);
  }

  private applyActionSettings(): void {
    if (!this.currentAction) return;
    this.currentAction.enabled = true;
    this.currentAction.paused = !this.playing;
    this.currentAction.timeScale = this.speed;
    this.currentAction.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce, this.loop ? Infinity : 1);
    this.currentAction.clampWhenFinished = !this.loop;
  }

  setClip(name: string, restart = false): void {
    const entry = this.clips.get(name);
    if (!entry) return;
    if (this.clipName === name && !restart) return;
    this.currentAction?.stop();
    const action = this.mixer.clipAction(entry.clip, this.target);
    action.reset().play();
    this.currentAction = action;
    this.clipName = name;
    this.playing = true;
    this.applyActionSettings();
    this.mixer.update(0);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.applyActionSettings();
  }

  togglePlaying(): void {
    this.setPlaying(!this.playing);
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.applyActionSettings();
  }

  setSpeed(speed: number): void {
    this.speed = THREE.MathUtils.clamp(speed, 0.1, 2);
    this.applyActionSettings();
  }

  seekNormalized(value: number): void {
    if (!this.currentAction) return;
    const duration = this.currentAction.getClip().duration;
    this.currentAction.time = THREE.MathUtils.clamp(value, 0, 1) * duration;
    this.mixer.update(0);
  }

  restart(): void {
    if (!this.currentAction) return;
    this.currentAction.reset().play();
    this.playing = true;
    this.applyActionSettings();
    this.mixer.update(0);
  }

  step(seconds: number): void {
    if (!this.currentAction) return;
    const duration = this.currentAction.getClip().duration;
    this.playing = false;
    this.currentAction.paused = false;
    this.currentAction.time = THREE.MathUtils.clamp(this.currentAction.time + seconds, 0, duration);
    this.mixer.update(0);
    this.currentAction.paused = true;
  }

  update(deltaSeconds: number): void {
    if (!this.currentAction) return;
    this.applyActionSettings();
    this.mixer.update(THREE.MathUtils.clamp(deltaSeconds, 0, 0.05));
    if (!this.loop && this.currentAction.time >= this.currentAction.getClip().duration - 1e-4) {
      this.playing = false;
      this.applyActionSettings();
    }
    this.target.updateMatrixWorld(true);
  }

  snapshot(): ModelViewerMotionSnapshot {
    const duration = this.currentAction?.getClip().duration ?? 0;
    return {
      available: true,
      loading: false,
      clips: this.clipInfos(),
      clipName: this.clipName,
      playing: this.playing,
      loop: this.loop,
      speed: this.speed,
      time: Math.min(this.currentAction?.time ?? 0, duration),
      duration,
    };
  }

  destroy(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.target);
    this.currentAction = null;
    this.clips.clear();
  }
}
