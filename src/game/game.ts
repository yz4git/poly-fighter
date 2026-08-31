import * as THREE from "three";
import { Arena } from "./arena";
import { AudioManager } from "./audio";
import { FightCamera } from "./camera";
import { CombatSystem } from "./combat";
import { EffectsManager } from "./effects";
import {
  CpuController,
  FighterController,
  FighterRuntime,
  type CpuDifficulty,
} from "./fighter";
import { PresentationAnimationController } from "./presentation-animation";
import { InputSystem } from "./input";
import { FightHUD } from "./hud";
import { RoundManager } from "./round";
import { SettingsManager } from "./settings";
import { FixedStepClock } from "./fixed";
import { createFighterVisual, disposeFighterVisual } from "./visual-entry";
import type { FighterDefinition, HudSnapshot, InputAction } from "./types";

export interface PolyFightGameOptions {
  p1Definition: FighterDefinition;
  p2Definition: FighterDefinition;
  difficulty?: CpuDifficulty;
  onHud?: (snapshot: HudSnapshot) => void;
  onResult?: (winner: "p1" | "p2" | "draw") => void;
  onFallback?: (message: string) => void;
}

export class PolyFightGame {
  readonly hud = new FightHUD();
  readonly input = new InputSystem();
  readonly settings = new SettingsManager();
  readonly audio = new AudioManager();
  readonly round = new RoundManager();
  readonly combat = new CombatSystem();
  readonly controller = new FighterController();
  readonly animation = new PresentationAnimationController();
  readonly cpu: CpuController;
  readonly p1: FighterRuntime;
  readonly p2: FighterRuntime;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly arena: Arena;
  readonly effects: EffectsManager;
  readonly fightCamera: FightCamera;
  private readonly mount: HTMLElement;
  private readonly options: PolyFightGameOptions;
  private readonly fixedStep = 1 / 60;
  private readonly clock = new FixedStepClock(this.fixedStep);
  private readonly visibilityHandler: () => void;
  private raf = 0;
  private running = false;
  private lastTime = 0;
  private renderTime = 0;
  private outcome: { winner: FighterRuntime | null; ringOut: boolean } | null = null;
  private lastHudTick = -1;
  private finished = false;
  private paused = false;
  private runtimeFailureReported = false;
  private readonly contextLostHandler = (event: Event): void => {
    event.preventDefault();
    this.handleRuntimeFailure("WebGLコンテキストが失われました。Safariを再読み込みしてもう一度お試しください。", event);
  };

  constructor(mount: HTMLElement, options: PolyFightGameOptions) {
    this.mount = mount;
    this.options = options;
    const settings = this.settings.load();
    this.cpu = new CpuController(options.difficulty ?? "NORMAL");
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: settings.quality !== "LOW",
        alpha: false,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      options.onFallback?.("WebGLを初期化できませんでした。Safariの設定または端末のグラフィック機能を確認してください。");
      throw new Error("POLY_FIGHTER_WEBGL_UNAVAILABLE");
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x071426);
    this.scene.fog = new THREE.Fog(0x071426, 14, 31);
    this.camera = new THREE.PerspectiveCamera(31, 1, 0.1, 60);
    this.camera.position.set(0, 3.6, 12.5);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.mount.replaceChildren(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-label", "POLY FIGHTER 3D battle arena");
    this.renderer.domElement.addEventListener("webglcontextlost", this.contextLostHandler, false);

    const qualityDpr = settings.quality === "LOW" ? 1 : settings.quality === "HIGH" ? 1.9 : 1.45;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityDpr));
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("orientationchange", this.resize);
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.clock.reset();
        this.lastTime = performance.now();
        this.input.clear();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.input.attachKeyboard(document);

    const hemi = new THREE.HemisphereLight(0xbad8ff, 0x0a1020, 2.15);
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(-4, 8, 7);
    const rim = new THREE.DirectionalLight(0x5ddcff, 2.4);
    rim.position.set(5, 3, -7);
    this.scene.add(hemi, key, rim);

    this.arena = new Arena();
    this.effects = new EffectsManager();
    this.scene.add(this.arena.group, this.effects.group);
    this.p1 = new FighterRuntime("p1", options.p1Definition, false, createFighterVisual(options.p1Definition, settings.quality));
    this.p2 = new FighterRuntime("p2", options.p2Definition, true, createFighterVisual(options.p2Definition, settings.quality));
    this.scene.add(this.p1.visual.root, this.p2.visual.root);
    this.fightCamera = new FightCamera(this.camera);
    this.effects.onShake = (amount) => {
      if (this.settings.get().cameraShake) this.fightCamera.addShake(amount);
    };
    this.combat.onHit = (event) => {
      this.effects.hit(event);
      this.audio.impact(event);
      if (!event.blocked && !event.throwEscape && this.settings.get().vibration && typeof navigator !== "undefined") {
        navigator.vibrate?.(event.move.power > 1.45 ? 24 : 10);
      }
    };
    this.round.start();
    this.resetPositions();
    this.animation.update(this.p1, this.p2, 0);
    this.animation.update(this.p2, this.p1, 0.22);
    this.publishHud(true);
  }

  private resize = (): void => {
    if (!this.renderer || !this.mount) return;
    const width = Math.max(1, this.mount.clientWidth || window.innerWidth);
    const height = Math.max(1, this.mount.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    try {
      this.audio.roundStart();
      this.raf = window.requestAnimationFrame(this.loop);
    } catch (error) {
      this.handleRuntimeFailure("ゲームを開始できませんでした。Safariを再読み込みしてもう一度お試しください。", error);
    }
  }

  interact(): void { void this.audio.resume(); }
  press(action: InputAction, owner: number | string): void { this.interact(); this.input.press(action, owner); }
  release(action: InputAction, owner: number | string): void { this.input.release(action, owner); }
  releaseOwner(owner: number | string): void { this.input.releaseOwner(owner); }

  rematch(): void {
    this.p1.wins = 0;
    this.p2.wins = 0;
    this.finished = false;
    this.outcome = null;
    this.round.start();
    this.resetPositions();
    this.audio.roundStart();
    this.publishHud(true);
  }

  pause(): void { this.paused = true; this.input.releaseOwner("keyboard"); }
  resume(): void { this.paused = false; this.lastTime = performance.now(); }

  updateSettings(patch: Parameters<SettingsManager["update"]>[0]): void {
    const settings = this.settings.update(patch);
    this.audio.setEnabled(settings.audio);
    const dpr = settings.quality === "LOW" ? 1 : settings.quality === "HIGH" ? 1.9 : 1.45;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    this.resize();
  }

  private loop = (now: number): void => {
    if (!this.running || this.runtimeFailureReported) return;
    try {
      const elapsed = Math.min(0.2, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.clock.advance(elapsed, () => this.step());
      this.renderTime += elapsed;
      this.effects.update(elapsed);
      this.fightCamera.update(this.p1, this.p2, Math.max(0.001, elapsed));
      this.renderer.render(this.scene, this.camera);
      this.raf = window.requestAnimationFrame(this.loop);
    } catch (error) {
      this.handleRuntimeFailure("ゲーム描画中にエラーが発生しました。Safariを再読み込みしてもう一度お試しください。", error);
    }
  };

  private handleRuntimeFailure(message: string, error: unknown): void {
    if (this.runtimeFailureReported) return;
    this.runtimeFailureReported = true;
    this.running = false;
    window.cancelAnimationFrame(this.raf);
    this.clock.reset();
    this.input.clear();
    console.error("[POLY FIGHTER] runtime failure", error);
    this.options.onFallback?.(message);
  }

  private step(): void {
    if (this.paused) return;
    if (this.round.canSimulateCombat()) {
      const p1Input = this.input.frame();
      const p2Input = this.cpu.update(this.p2, this.p1);
      this.controller.update(this.p1, this.p2, p1Input, this.fixedStep);
      this.controller.update(this.p2, this.p1, p2Input, this.fixedStep);
      this.combat.resolve(this.p1, this.p2);
      this.combat.resolve(this.p2, this.p1);
      this.checkRingOut(this.p1);
      this.checkRingOut(this.p2);
    }
    const result = this.round.tick(this.p1, this.p2);
    if (result && !this.outcome) {
      this.outcome = result;
      this.audio.ko();
    }
    if (this.round.canSimulatePassive() && !this.round.canSimulateCombat()) {
      this.controller.updatePassive(this.p1, this.fixedStep);
      this.controller.updatePassive(this.p2, this.fixedStep);
    }
    if (this.round.phase === "ROUND_END" && this.round.phaseTicks > 120 && this.outcome) {
      const phaseResult = this.round.finishRound(this.outcome.winner);
      if (phaseResult === "MATCH_RESULT") {
        this.finished = true;
        const winner = this.outcome.winner;
        this.options.onResult?.(winner ? (winner.id as "p1" | "p2") : "draw");
      } else {
        this.outcome = null;
        this.resetPositions();
        this.audio.roundStart();
      }
    }
    this.animation.update(this.p1, this.p2, this.renderTime);
    this.animation.update(this.p2, this.p1, this.renderTime + 0.22);
    this.publishHud(false);
  }

  private checkRingOut(fighter: FighterRuntime): void {
    if (fighter.state === "KO" || fighter.state === "RING_OUT") return;
    if (!this.arena.isOut(fighter.position)) return;
    fighter.state = "RING_OUT";
    fighter.velocity.set(fighter.facing * 2.6, 3.6, fighter.velocity.z);
    this.fightCamera.addShake(0.1);
  }

  private resetPositions(): void {
    this.p1.resetForRound(-2.15, 0, 1);
    this.p2.resetForRound(2.15, 0, -1);
    this.finished = false;
    this.outcome = null;
  }

  private publishHud(force: boolean): void {
    if (!force && this.round.phase === "FIGHT" && this.round.phaseTicks % 4 !== 0) return;
    if (!force && this.lastHudTick === this.round.phaseTicks) return;
    this.lastHudTick = this.round.phaseTicks;
    const snapshot: HudSnapshot = {
      phase: "MATCH",
      round: this.round.round,
      timer: Math.ceil(this.round.timerTicks / 60),
      p1Health: this.p1.health,
      p2Health: this.p2.health,
      p1Wins: this.p1.wins,
      p2Wins: this.p2.wins,
      p1Name: this.p1.definition.name,
      p2Name: this.p2.definition.name,
      message: this.finished ? this.round.message : this.round.message,
      p1State: this.p1.state,
      p2State: this.p2.state,
    };
    this.hud.update(snapshot);
    this.options.onHud?.(snapshot);
  }

  destroy(): void {
    this.running = false;
    this.runtimeFailureReported = true;
    window.cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("orientationchange", this.resize);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.input.destroy();
    this.audio.destroy();
    this.effects.dispose();
    this.arena.dispose();
    disposeFighterVisual(this.p1.visual);
    disposeFighterVisual(this.p2.visual);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.contextLostHandler);
    this.renderer.dispose();
    this.mount.replaceChildren();
  }
}
