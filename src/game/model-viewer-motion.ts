import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { retargetMotionClips, type RetargetRotationMode } from "./motion-retarget";
import type { FighterVisual } from "./visual-entry";
import { createCombatMotionLibrary } from "./combat-motion-authoring";
import { FIGHTER_DEFINITIONS } from "./definitions";
import {
  cmuMocapClipName,
  cmuMocapPilotUrl,
  retargetCmuPilotClip,
  type CmuMocapPilotId,
} from "./cmu-mocap-pilot";
import {
  QUATERNIUS_BLENDER_CORE_URL,
  QUATERNIUS_BLENDER_CROSS_URL,
  QUATERNIUS_BLENDER_STRIKES_URL,
  QUATERNIUS_BLENDER_KICKS_URL,
  QUATERNIUS_BLENDER_AIRBORNE_URL,
  QUATERNIUS_BLENDER_REACTIONS_URL,
  QUATERNIUS_PROCEDURAL_CORE_URL,
  QUATERNIUS_UAL_CORE_URL,
} from "./visual-quaternius-runtime";

export type ModelViewerMotionSource = "BLENDER" | "PROCEDURAL" | "BASE" | "CMU";

export interface ModelViewerMotionClipInfo {
  name: string;
  duration: number;
  source: ModelViewerMotionSource;
}

export interface ModelViewerMotionSnapshot {
  available: boolean;
  loading: boolean;
  rotationMode: RetargetRotationMode;
  cmuLoading: boolean;
  cmuError: string | null;
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
  cmuId?: CmuMocapPilotId;
};

let sourcePromise: Promise<MotionSourcePack[]> | null = null;

function loadMotionSources(): Promise<MotionSourcePack[]> {
  if (sourcePromise) return sourcePromise;
  const loader = new GLTFLoader();
  const blenderMotion = loader.loadAsync(QUATERNIUS_BLENDER_CORE_URL).catch(() => null);
  const blenderCrossMotion = loader.loadAsync(QUATERNIUS_BLENDER_CROSS_URL).catch(() => null);
  const blenderStrikeMotion = loader.loadAsync(QUATERNIUS_BLENDER_STRIKES_URL).catch(() => null);
  const blenderKickMotion = loader.loadAsync(QUATERNIUS_BLENDER_KICKS_URL).catch(() => null);
  const blenderAirborneMotion = loader.loadAsync(QUATERNIUS_BLENDER_AIRBORNE_URL).catch(() => null);
  const blenderReactionMotion = loader.loadAsync(QUATERNIUS_BLENDER_REACTIONS_URL).catch(() => null);
  sourcePromise = Promise.all([
    loader.loadAsync(QUATERNIUS_UAL_CORE_URL),
    loader.loadAsync(QUATERNIUS_PROCEDURAL_CORE_URL),
    blenderMotion,
    blenderCrossMotion,
    blenderStrikeMotion,
    blenderKickMotion,
    blenderAirborneMotion,
    blenderReactionMotion,
  ]).then(([base, procedural, blender, blenderCross, blenderStrikes, blenderKicks, blenderAirborne, blenderReactions]) => {
    const packs: MotionSourcePack[] = [
      { root: base.scene, clips: base.animations, source: "BASE" },
      { root: procedural.scene, clips: procedural.animations, source: "PROCEDURAL" },
    ];
    if (blender) packs.push({ root: blender.scene, clips: blender.animations, source: "BLENDER" });
    if (blenderCross) packs.push({ root: blenderCross.scene, clips: blenderCross.animations, source: "BLENDER" });
    if (blenderStrikes) packs.push({ root: blenderStrikes.scene, clips: blenderStrikes.animations, source: "BLENDER" });
    if (blenderKicks) packs.push({ root: blenderKicks.scene, clips: blenderKicks.animations, source: "BLENDER" });
    if (blenderAirborne) packs.push({ root: blenderAirborne.scene, clips: blenderAirborne.animations, source: "BLENDER" });
    if (blenderReactions) packs.push({ root: blenderReactions.scene, clips: blenderReactions.animations, source: "BLENDER" });
    return packs;
  }).catch((error) => {
    sourcePromise = null;
    throw error;
  });
  return sourcePromise;
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

function restoreBindPose(target: THREE.Object3D): void {
  const posed = new Set<THREE.Skeleton>();
  target.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton || posed.has(mesh.skeleton)) return;
    mesh.skeleton.pose();
    posed.add(mesh.skeleton);
  });
  target.updateMatrixWorld(true);
}

function clipSort(a: ModelViewerMotionClipInfo, b: ModelViewerMotionClipInfo): number {
  if (a.name === "Idle_Loop") return -1;
  if (b.name === "Idle_Loop") return 1;
  if (a.source !== b.source) {
    const priority: Record<ModelViewerMotionSource, number> = { CMU: 0, BLENDER: 1, PROCEDURAL: 2, BASE: 3 };
    return priority[a.source] - priority[b.source];
  }
  return a.name.localeCompare(b.name);
}

export function unavailableModelViewerMotionSnapshot(loading = false): ModelViewerMotionSnapshot {
  return {
    available: false,
    loading,
    rotationMode: "LOCAL",
    cmuLoading: false,
    cmuError: null,
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
  private readonly visual: FighterVisual;
  private sourcePacks: MotionSourcePack[] = [];
  private rotationMode: RetargetRotationMode = "LOCAL";
  private readonly clipBanks = new Map<RetargetRotationMode, Map<string, { clip: THREE.AnimationClip; source: ModelViewerMotionSource }>>();
  private readonly clips = new Map<string, { clip: THREE.AnimationClip; source: ModelViewerMotionSource }>();
  private currentAction: THREE.AnimationAction | null = null;
  private clipName = "";
  private playing = true;
  private loop = true;
  private speed = 1;
  private cmuLoading = false;
  private cmuError: string | null = null;
  private cmuAuditAlignment: number[] = [];
  private destroyed = false;

  private constructor(target: THREE.Object3D, visual: FighterVisual) {
    this.target = target;
    this.visual = visual;
    this.mixer = new THREE.AnimationMixer(target);
  }

  static async create(visual: FighterVisual): Promise<ModelViewerMotionController> {
    const target = findQuaterniusTarget(visual);
    if (!target) throw new Error("Quaternius Model View target is not ready");
    const controller = new ModelViewerMotionController(target, visual);
    controller.sourcePacks = await loadMotionSources();
    controller.rebuildClips();
    const initial = controller.clips.has("Idle_Loop") ? "Idle_Loop" : controller.clipInfos()[0]?.name;
    if (!initial) throw new Error("No compatible motion clips found for Model View");
    controller.setClip(initial, true);
    return controller;
  }

  /** Called only on preview creation or an explicit comparison toggle. */
  private rebuildClips(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.target);
    this.currentAction = null;
    restoreBindPose(this.target);
    this.clips.clear();

    let bank = this.clipBanks.get(this.rotationMode);
    if (!bank) {
      bank = new Map();
      for (const pack of this.sourcePacks) {
        if (pack.source === "CMU" && pack.cmuId) {
          const diagnostics = { fitted: [] as string[], fallback: [] as string[], alignment: [] as number[] };
          const clip = retargetCmuPilotClip(
            pack.root, this.target, pack.clips, pack.cmuId, this.rotationMode, diagnostics,
          );
          this.cmuAuditAlignment = diagnostics.alignment;
          bank.set(clip.name, { clip, source: "CMU" });
        } else {
          const retargeted = retargetMotionClips(pack.root, this.target, pack.clips, {
            rotationMode: this.rotationMode,
          });
          for (const [name, clip] of retargeted) bank.set(name, { clip, source: pack.source });
        }
      }
      const bodyDefinition = this.visual.root.userData.quaterniusBodyType === "FEMALE"
        ? FIGHTER_DEFINITIONS.blue : FIGHTER_DEFINITIONS.red;
      const combatClips = createCombatMotionLibrary(
        this.target as THREE.Group,
        new Map([...bank].map(([name, entry]) => [name, entry.clip])),
        bodyDefinition,
      );
      for (const [name, clip] of combatClips) {
        bank.set(name, { clip, source: name.startsWith("BF_") ? "BLENDER" : "PROCEDURAL" });
      }
      this.clipBanks.set(this.rotationMode, bank);
    }
    for (const [name, entry] of bank) this.clips.set(name, entry);
  }

  /** Preview-only A/B test: shipping gameplay keeps its proven LOCAL method. */
  setRotationMode(mode: RetargetRotationMode): void {
    if (mode === this.rotationMode) return;
    const previousClip = this.clipName;
    const previousTime = this.currentAction?.time ?? 0;
    const wasPlaying = this.playing;
    this.rotationMode = mode;
    this.rebuildClips();
    const nextClip = this.clips.has(previousClip) ? previousClip : "Idle_Loop";
    this.clipName = "";
    this.setClip(nextClip, true);
    if (this.currentAction) {
      this.currentAction.time = THREE.MathUtils.clamp(previousTime, 0, this.currentAction.getClip().duration);
      this.mixer.update(0);
    }
    this.setPlaying(wasPlaying);
  }

  /**
   * On-demand only. The base game's motion packs remain local. The CMU GLB
   * is never fetched from the fight renderer or during MODEL VIEW startup.
   */
  async loadCmuMotion(id: CmuMocapPilotId): Promise<void> {
    if (this.destroyed || this.cmuLoading) return;
    const name = cmuMocapClipName(id);
    this.cmuError = null;
    if (this.clips.has(name)) {
      this.setClip(name, true);
      return;
    }

    this.cmuLoading = true;
    const previous = this.clipName;
    const wasPlaying = this.playing;
    try {
      const gltf = await new GLTFLoader().loadAsync(cmuMocapPilotUrl(id));
      if (this.destroyed) return;
      // Retargeting must use bind/rest poses, not the animated screen pose.
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.target);
      restoreBindPose(this.target);
      // Rebuilding the bank validates the clip once; avoid doing a full
      // 30fps, 40-second boxing bake twice on an iPhone.
      this.sourcePacks.push({
        root: gltf.scene,
        clips: gltf.animations,
        source: "CMU",
        cmuId: id,
      });
      this.rotationMode = "WORLD";
      this.clipBanks.clear();
      this.rebuildClips();
      this.clipName = "";
      this.setClip(name, true);
    } catch (error) {
      if (this.destroyed) return;
      this.cmuError = error instanceof Error ? error.message : "CMU motion could not be loaded";
      console.warn("[POLY FIGHTER] CMU mocap pilot failed:", error);
      // Restore the locally authored clip if the network or skeleton fails.
      this.sourcePacks = this.sourcePacks.filter((pack) => pack.cmuId !== id);
      this.clipBanks.clear();
      this.rebuildClips();
      this.clipName = "";
      this.setClip(this.clips.has(previous) ? previous : "Idle_Loop", true);
      this.setPlaying(wasPlaying);
    } finally {
      this.cmuLoading = false;
    }
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
    // Enabled only for explicit WebGL audit runs. Read true posed skeleton
    // coordinates from the rendered scene to catch skin/rig discrepancies
    // that stand-alone GLB retarget math tests cannot detect.
    if (typeof window !== "undefined" && window.location.search.includes("cmuAudit=1") &&
        this.clipName.startsWith("CMU_")) {
      this.target.updateWorldMatrix(true, true);
      const names = ["pelvis", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
        "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
        "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"];
      const joints: Record<string, number[] | null> = {};
      for (const name of names) {
        const bone = this.target.getObjectByName(name);
        joints[name] = bone
          ? bone.getWorldPosition(new THREE.Vector3()).toArray().map((x) => Number(x.toFixed(5)))
          : null;
      }
      const skinned: Array<{ mesh: string; upperarmBound: boolean; firstBone: string }> = [];
      this.target.traverse((node) => {
        const mesh = node as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        const upperarm = this.target.getObjectByName("upperarm_l");
        skinned.push({
          mesh: mesh.name,
          upperarmBound: Boolean(upperarm && mesh.skeleton?.bones.includes(upperarm as THREE.Bone)),
          firstBone: mesh.skeleton?.bones[0]?.name ?? "",
        });
      });
      const actionClip = this.currentAction?.getClip();
      const trackDeltaDegrees: Record<string, number | null> = {};
      for (const name of ["upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r",
        "thigh_l", "calf_l", "thigh_r", "calf_r"]) {
        const bone = this.target.getObjectByName(name);
        const track = actionClip?.tracks.find((t) => t.name === name + ".quaternion");
        if (!bone || !track) { trackDeltaDegrees[name] = null; continue; }
        const time = THREE.MathUtils.clamp(this.currentAction?.time ?? 0, 0, actionClip!.duration);
        const sampled = track.createInterpolant().evaluate(time);
        trackDeltaDegrees[name] = Number(THREE.MathUtils.radToDeg(
          bone.quaternion.angleTo(new THREE.Quaternion().fromArray(sampled)),
        ).toFixed(3));
      }
      document.documentElement.dataset.cmuAuditPose = JSON.stringify({
        clip: this.clipName, time: this.currentAction?.time ?? -1,
        calibration: this.cmuAuditAlignment, trackDeltaDegrees,
        bodyType: this.visual.root.userData.quaterniusBodyType,
        modelName: this.target.name,
        activeRoot: this.mixer.getRoot().name,
        joints, skinned,
      });
    }
    const duration = this.currentAction?.getClip().duration ?? 0;
    return {
      available: true,
      loading: false,
      rotationMode: this.rotationMode,
      cmuLoading: this.cmuLoading,
      cmuError: this.cmuError,
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
    this.destroyed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.target);
    this.currentAction = null;
    this.clips.clear();
    this.clipBanks.clear();
  }
}
