import * as THREE from "three";
import { AudioManager } from "./audio";
import { EffectsManager } from "./effects";
import { fighterDnaForName, type FighterDna } from "./fighter-dna";
import { FighterRuntime, type CpuDifficulty } from "./fighter";
import { CpuFunDirector, isAttackIntent, type CpuDecision, type CpuIntent, type CpuSituation } from "./cpu-director";
import { FixedStepClock } from "./fixed";
import { InputSystem } from "./input";
import { PresentationAnimationController } from "./presentation-animation";
import { motionEventsAtContact, sampleCombatMotionAtEvent } from "./combat-motion-timeline";
import { SettingsManager } from "./settings";
import { TpsGraphicsDirector } from "./tps-graphics";
import { createCircularArena, TPS_ARENA_RADIUS as ARENA_RADIUS } from "./tps-arena-factory";
import {
  clampToArena,
  ease,
  horizontalDirection,
  horizontalDistance,
  horizontalRadius,
} from "./tps-geometry";
import { computeTpsMatchDrama, type TpsMatchDramaPhase } from "./tps-match-drama";
import { buildTpsHudSnapshot, type TpsHudSnapshotInput } from "./tps-hud-snapshot";
import { computeTpsLockOnProfile } from "./tps-lock-on-profile";
import { computeTpsEnemyThreat } from "./tps-threat-policy";
import {
  FIXED_STEP,
  ROUND_TICKS,
  TPS_ADAPT_REVIEW_TICKS,
  TPS_CLOSE_ATTACK_RANGE,
  TPS_COMBAT_BEAT_TICKS,
  TPS_COMBO_GRACE_TICKS,
  TPS_DRAMA_REVIEW_TICKS,
  TPS_FINISHER_BEAT_TICKS,
  TPS_FLANK_WINDOW_TICKS,
  TPS_INTERCEPT_TICKS,
  TPS_PERFECT_EVADE_TICKS,
  TPS_REVERSAL_TICKS,
  TPS_STEP_COOLDOWN_TICKS,
  TPS_STEP_TICKS,
  TPS_STRIKE_RANGE,
} from "./tps-gameplay-profile";
import { computeTpsContactSpacing } from "./tps-contact-spacing";
import { computeTpsHitResolution, tpsImpactHeightForMove } from "./tps-impact-resolution";
import { applyTpsImpactPresentation } from "./tps-impact-presentation";
import {
  adaptTpsCpuDecision,
  chooseTpsEnemyTactic,
  minimumTpsEnemyTelegraphTicks,
  reviewTpsEnemyHabits,
  tpsCpuActorSnapshot,
  tpsCpuAttackMove,
  tpsEnemyReactionWindowTicks,
  type EnemyAdaptation,
  type EnemyPersona,
  type EnemyTactic,
} from "./tps-enemy-policy";
import {
  advanceTpsFinishWindow,
  defeatedFighterForWinner,
  isTpsDefeatedSettled,
  tpsWinnerForHealth,
} from "./tps-finish-flow";
import {
  computeTpsCameraFraming,
  TPS_CAMERA_MAX_TRAVEL_SPEED,
  type TpsCameraFraming,
} from "./tps-camera-profile";
import {
  composeTpsMoveVector,
  planTpsContextAttack,
  planTpsStep,
  tpsCloseLocomotionSpeedScale,
  tpsInputAxes,
  tpsLegacyThrowPressed,
  tpsPlayerMoveSpeed,
  tpsReactiveStepThreat,
  tpsStepSpeedMultiplier,
} from "./tps-player-policy";
import { finalizeTpsFighterVisual, prepareTpsFighterVisual } from "./tps-visual-state";
import { createFighterVisual, disposeFighterVisual } from "./visual-entry";
import type { FighterModelId } from "./model-skins";
import type { FighterDefinition, HitEvent, HudSnapshot, InputAction, InputFrame, MoveDefinition } from "./types";
import { EMPTY_INPUT } from "./types";

export interface TpsFightGameOptions {
  p1Definition: FighterDefinition;
  p2Definition: FighterDefinition;
  p1Model?: FighterModelId;
  p2Model?: FighterModelId;
  difficulty?: CpuDifficulty;
  training?: boolean;
  onHud?: (snapshot: HudSnapshot) => void;
  onResult?: (winner: "p1" | "p2" | "draw") => void;
  onFallback?: (message: string) => void;
}


export class TpsFightGame {
  readonly input = new InputSystem();
  readonly settings = new SettingsManager();
  readonly audio = new AudioManager();
  readonly animation = new PresentationAnimationController();
  readonly p1: FighterRuntime;
  readonly p2: FighterRuntime;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly effects = new EffectsManager();
  readonly graphics: TpsGraphicsDirector;

  private readonly mount: HTMLElement;
  private readonly options: TpsFightGameOptions;
  private readonly clock = new FixedStepClock(FIXED_STEP);
  private readonly arenaDisposables: Array<THREE.BufferGeometry | THREE.Material>;
  private readonly lockRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly lockStem: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly targetGroundRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly visibilityHandler: () => void;
  private readonly difficulty: CpuDifficulty;
  private readonly p1Dna: FighterDna;
  private readonly p2Dna: FighterDna;
  private raf = 0;
  private running = false;
  private paused = false;
  private playerStepAttackQueued = false;
  // Cumulative across practice rounds so HUD sampling cannot lose a success.
  private readonly trainingProgress = { hits: 0, sideSteps: 0, perfectEvades: 0, punishes: 0, intercepts: 0 };
  private lastTime = 0;
  private renderTime = 0;
  private timerTicks = ROUND_TICKS;
  private enemyCooldown = 48;
  // Give the player a brief orientation/read window at the start of a TPS duel.
  // The CPU may reposition or guard during this window, but it cannot open with an attack.
  private enemyOpeningGraceTicks = 132;
  private finished = false;
  private finishPending = false;
  private finishTicks = 0;
  private finishSettledTicks = 0;
  private resultWinner: "p1" | "p2" | "draw" | null = null;
  private lastHudTick = -1;
  private runtimeFailureReported = false;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly cameraFrameStart = new THREE.Vector3();
  private readonly cameraFrameDelta = new THREE.Vector3();
  private readonly cameraPairMidpoint = new THREE.Vector3();
  private readonly cameraAnchor = new THREE.Vector3();
  private readonly cameraFocus = new THREE.Vector3();
  // `guard` remains the internal STEP input so the shared input layer and keyboard mapping stay compatible.
  // The TPS UI exposes only ATTACK + STEP.
  private playerEvadeTicks = 0;
  private playerEvadeCooldown = 0;
  private playerEvadeSign = 0;
  private readonly playerStepDirection = new THREE.Vector3();
  private playerStepForwardWeight = 0;
  private playerStepSideWeight = 0;
  private playerComboStage = 0;
  private playerComboGraceTicks = 0;
  private playerAttackQueued = false;
  private playerFlankWindowTicks = 0;
  private playerFlankAttackTicks = 0;
  private playerPerfectEvadeTicks = 0;
  private playerStepThreatTicks = 0;
  private playerStepThreatMoveId: string | null = null;
  private playerInterceptTicks = 0;
  private playerReversalTicks = 0;
  private combatBeatLabel: string | null = null;
  private combatBeatTicks = 0;
  private playerAttackSamples = 0;
  private playerStepSamples = 0;
  private playerRetreatSamples = 0;
  private playerLeftStepSamples = 0;
  private playerRightStepSamples = 0;
  private playerInterceptSamples = 0;
  private playerReversalSamples = 0;
  private enemyAdaptReviewTicks = TPS_ADAPT_REVIEW_TICKS;
  private enemyPersona: EnemyPersona = "BRAWLER";
  private enemyAdaptation: EnemyAdaptation = "NEUTRAL";
  private dramaPhase: TpsMatchDramaPhase = "OPENING";
  private dramaIntensity = 0.14;
  private dramaReviewTicks = TPS_DRAMA_REVIEW_TICKS;
  private simulationTicks = 0;
  private cameraImpact = 0;
  private enemyTactic: EnemyTactic = "ORBIT";
  private enemyTacticTicks = 0;
  private enemyOrbitSign = 1;
  private enemyFunDirector: CpuFunDirector;
  private enemyDirectorDecision: CpuDecision | null = null;
  private enemyDirectorHoldTicks = 0;
  private enemyDirectorTelegraphTicks = 0;
  private enemyDirectorTelegraphTotalTicks = 0;
  private enemyDirectorPendingMove: string | null = null;

  constructor(mount: HTMLElement, options: TpsFightGameOptions) {
    this.mount = mount;
    this.options = options;
    this.difficulty = options.difficulty ?? "NORMAL";
    const settings = this.settings.load();

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: settings.quality !== "LOW",
        alpha: false,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      options.onFallback?.("TPSモードのWebGLを初期化できませんでした。Safariを再読み込みしてもう一度お試しください。");
      throw new Error("POLY_FIGHTER_TPS_WEBGL_UNAVAILABLE");
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030b16);
    this.scene.fog = new THREE.FogExp2(0x030b16, 0.032);
    this.camera = new THREE.PerspectiveCamera(47, 1, 0.1, 80);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.setAttribute("aria-label", "POLY FIGHTER TPS lock-on battle arena");
    this.mount.replaceChildren(this.renderer.domElement);

    const dpr = settings.quality === "LOW" ? 1 : settings.quality === "HIGH" ? 1.75 : 1.35;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("orientationchange", this.resize);

    this.visibilityHandler = () => {
      if (!document.hidden) return;
      this.clock.reset();
      this.lastTime = performance.now();
      this.playerStepAttackQueued = false;
      this.input.clear();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.input.attachKeyboard(document);

    const hemi = new THREE.HemisphereLight(0xaedcff, 0x07101d, 2.35);
    const key = new THREE.DirectionalLight(0xffffff, 3.8);
    key.position.set(-4, 9, 5);
    const rim = new THREE.DirectionalLight(0x42c9ff, 2.8);
    rim.position.set(5, 4, -6);
    this.scene.add(hemi, key, rim);

    const arena = createCircularArena();
    this.arenaDisposables = arena.disposables;
    this.scene.add(arena.group, this.effects.group);
    this.graphics = new TpsGraphicsDirector(this.scene, this.renderer, ARENA_RADIUS, settings.quality);

    this.p1 = new FighterRuntime("p1", options.p1Definition, false, createFighterVisual(options.p1Definition, settings.quality, options.p1Model ?? "ORIGINAL"));
    this.p2 = new FighterRuntime("p2", options.p2Definition, true, createFighterVisual(options.p2Definition, settings.quality, options.p2Model ?? "ORIGINAL"));
    this.p1Dna = fighterDnaForName(this.p1.definition.name);
    this.p2Dna = fighterDnaForName(this.p2.definition.name);
    this.scene.add(this.p1.visual.root, this.p2.visual.root);
    this.enemyPersona = this.p2.definition.archetype === "SPEED" ? "SKIRMISHER" : "BRAWLER";
    this.enemyFunDirector = new CpuFunDirector(this.difficulty, 47);

    const lockGeometry = new THREE.TorusGeometry(0.38, 0.018, 8, 48);
    const lockMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.82, depthTest: true, depthWrite: false });
    this.lockRing = new THREE.Mesh(lockGeometry, lockMaterial);
    this.lockRing.renderOrder = 20;
    this.scene.add(this.lockRing);
    this.arenaDisposables.push(lockGeometry, lockMaterial);

    const stemGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.34, 0)]);
    const stemMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.76, depthTest: true, depthWrite: false });
    this.lockStem = new THREE.Line(stemGeometry, stemMaterial);
    this.lockStem.renderOrder = 20;
    this.scene.add(this.lockStem);
    this.arenaDisposables.push(stemGeometry, stemMaterial);

    // Keep target location readable even when the foreground player overlaps it.
    const targetGroundGeometry = new THREE.RingGeometry(0.58, 0.70, 48);
    const targetGroundMaterial = new THREE.MeshBasicMaterial({
      color: 0x7ce8ff,
      transparent: true,
      opacity: 0.3,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetGroundRing = new THREE.Mesh(targetGroundGeometry, targetGroundMaterial);
    this.targetGroundRing.name = "tps-target-ground-ring";
    this.targetGroundRing.rotation.x = -Math.PI / 2;
    this.targetGroundRing.position.y = 0.035;
    this.scene.add(this.targetGroundRing);
    this.arenaDisposables.push(targetGroundGeometry, targetGroundMaterial);

    this.effects.onShake = (amount) => {
      if (!this.settings.get().cameraShake) return;
      this.cameraImpact = Math.min(0.085, this.cameraImpact + amount * 0.55);
    };
    this.resetRound();
    this.publishHud(true);
  }

  interact(): void { void this.audio.resume(); }
  press(action: InputAction, owner: number | string): void { this.interact(); this.input.press(action, owner); }
  release(action: InputAction, owner: number | string): void { this.input.release(action, owner); }
  releaseOwner(owner: number | string): void { this.input.releaseOwner(owner); }
  pause(): void { this.paused = true; this.playerStepAttackQueued = false; this.input.clear(); }
  resume(): void { this.paused = false; this.lastTime = performance.now(); }

  updateSettings(patch: Parameters<SettingsManager["update"]>[0]): void {
    const settings = this.settings.update(patch);
    this.audio.setEnabled(settings.audio);
    const dpr = settings.quality === "LOW" ? 1 : settings.quality === "HIGH" ? 1.75 : 1.35;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    this.resize();
    this.graphics.setQuality(settings.quality);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.audio.roundStart();
    this.raf = window.requestAnimationFrame(this.loop);
  }

  rematch(): void {
    this.finished = false;
    this.timerTicks = ROUND_TICKS;
    this.resetRound();
    this.audio.roundStart();
    this.publishHud(true);
  }

  private resize = (): void => {
    const width = Math.max(1, this.mount.clientWidth || window.innerWidth);
    const height = Math.max(1, this.mount.clientHeight || window.innerHeight);
    const aspect = width / height;
    this.camera.aspect = aspect;
    // iPhone landscape has much less vertical room than the wide desktop audit.
    // A slightly wider lens keeps both fighters readable without shrinking touch UI.
    this.camera.fov = width > height && aspect < 2.4 ? 52 : 47;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private loop = (now: number): void => {
    if (!this.running || this.runtimeFailureReported) return;
    try {
      const elapsed = Math.min(0.2, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.clock.advance(elapsed, () => this.step());
      this.renderTime += elapsed;
      this.effects.update(elapsed);
      this.graphics.update(this.p1, this.p2, this.renderTime, elapsed);
      this.updateCamera(Math.max(0.001, elapsed));
      this.updateLockOn();
      this.renderer.render(this.scene, this.camera);
      this.raf = window.requestAnimationFrame(this.loop);
    } catch (error) {
      this.runtimeFailureReported = true;
      this.running = false;
      console.error("[POLY FIGHTER TPS] runtime failure", error);
      this.options.onFallback?.("TPSモードの描画中にエラーが発生しました。Safariを再読み込みしてもう一度お試しください。");
    }
  };

  private step(): void {
    if (this.paused || this.finished) return;
    this.tickCombatBeat();
    if (this.finishPending) {
      this.advancePendingFinish();
      return;
    }
    this.advanceActiveFight();
  }

  private tickCombatBeat(): void {
    if (this.combatBeatTicks > 0) this.combatBeatTicks -= 1;
    else this.combatBeatLabel = null;
  }

  private advancePendingFinish(): void {
    this.simulationTicks += 1;
    this.input.clear();

    // A KO must remain visible as a physical event. Stop all new combat/input,
    // but keep deterministic passive physics and presentation alive until the
    // defeated fighter has actually landed and rested on the floor.
    this.p1.updatePhysics(FIXED_STEP);
    this.p2.updatePhysics(FIXED_STEP);
    clampToArena(this.p1.position);
    clampToArena(this.p2.position);
    this.updateVisual(this.p1, this.p2, this.renderTime);
    this.updateVisual(this.p2, this.p1, this.renderTime + 0.23);

    const defeated = defeatedFighterForWinner(this.resultWinner, this.p1, this.p2);
    const finishWindow = advanceTpsFinishWindow(
      this.finishTicks,
      this.finishSettledTicks,
      isTpsDefeatedSettled(defeated),
    );
    this.finishTicks = finishWindow.ticks;
    this.finishSettledTicks = finishWindow.settledTicks;

    if (!finishWindow.complete) {
      this.publishHud(false);
      return;
    }

    this.finishPending = false;
    this.finished = true;
    const winner = this.resultWinner ?? "draw";
    this.publishHud(true);
    if (this.options.training) this.rematch();
    else this.options.onResult?.(winner);
  }

  private advanceActiveFight(): void {
    this.simulationTicks += 1;
    if (!this.options.training) this.timerTicks = Math.max(0, this.timerTicks - 1);

    const input = this.input.frame();
    this.updatePlayer(input);
    this.updateEnemy();

    // A short authored step-in keeps lock-on melee responsive without pulling a
    // fighter across the arena. It is only active during startup and only when
    // the target is already just outside normal contact range.
    this.applyAttackStepIn(this.p1, this.p2);
    this.applyAttackStepIn(this.p2, this.p1);
    this.resolveAttack(this.p1, this.p2, this.p2.state === "GUARD");
    this.resolveAttack(this.p2, this.p1, this.p1.state === "GUARD");
    this.updateMatchDrama();
    this.separateFighters();
    clampToArena(this.p1.position);
    clampToArena(this.p2.position);
    this.updateVisual(this.p1, this.p2, this.renderTime);
    this.updateVisual(this.p2, this.p1, this.renderTime + 0.23);
    this.checkFinish();
    this.publishHud(false);
  }

  private updateMatchDrama(): void {
    this.dramaReviewTicks -= 1;
    if (this.dramaReviewTicks > 0) return;
    this.dramaReviewTicks = TPS_DRAMA_REVIEW_TICKS;

    const drama = computeTpsMatchDrama({
      previousPhase: this.dramaPhase,
      timerTicks: this.timerTicks,
      p1Health: this.p1.health,
      p2Health: this.p2.health,
      playerComboStage: this.playerComboStage,
      playerPerfectEvadeTicks: this.playerPerfectEvadeTicks,
      combatBeatTicks: this.combatBeatTicks,
    });
    this.dramaPhase = drama.phase;
    this.dramaIntensity = drama.intensity;
    this.camera.userData.tpsDramaPhase = drama.phase;
    this.camera.userData.tpsDramaIntensity = drama.intensity;
    this.p1.visual.root.userData.tpsDramaPhase = drama.phase;
    this.p2.visual.root.userData.tpsDramaPhase = drama.phase;
    if (drama.beatLabel) this.setCombatBeat(drama.beatLabel, drama.beatTicks);
  }

  private updatePlayer(input: InputFrame): void {
    this.p1.setInput(input);
    const attackPressed = this.p1.justPressed("punch");
    const stepPressed = this.p1.justPressed("guard");
    const legacyKickPressed = this.p1.justPressed("kick");
    if (attackPressed) this.playerAttackSamples += 1;
    if (stepPressed) this.playerStepSamples += 1;

    this.tickPlayerWindows();

    const toEnemy = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-toEnemy.z, 0, toEnemy.x);
    const { forwardAxis, sideAxis } = tpsInputAxes(input);
    if (forwardAxis < 0 && this.simulationTicks % 12 === 0) this.playerRetreatSamples += 1;
    const move = composeTpsMoveVector(toEnemy, right, { forwardAxis, sideAxis });
    const moveSpeed = tpsPlayerMoveSpeed(
      this.p1.definition.archetype,
      this.p1Dna.moveSpeedScale,
    );

    if (this.tryLegacyPlayerThrow(input, stepPressed, legacyKickPressed)) return;
    if (this.advancePlayerAttack(attackPressed)) return;
    if (this.recoverPlayerFromLockedState()) return;
    if (this.consumeQueuedStepAttack()) return;

    if (stepPressed && this.playerEvadeCooldown <= 0) {
      this.beginPlayerStep(move, toEnemy, right, sideAxis);
    }
    if (this.advancePlayerStep(attackPressed, toEnemy, moveSpeed)) return;

    this.applyPlayerLocomotion(move, moveSpeed, forwardAxis, sideAxis);

    if (attackPressed) {
      const threat = this.enemyThreatStatus();
      if (threat.windup && !threat.incoming) {
        this.playerInterceptTicks = TPS_INTERCEPT_TICKS;
        this.playerInterceptSamples += 1;
        this.setCombatBeat("INTERCEPT");
      }
      this.beginContextAttack();
    }
    this.p1.updatePhysics(FIXED_STEP);
  }

  private tickPlayerWindows(): void {
    if (this.playerEvadeCooldown > 0) this.playerEvadeCooldown -= 1;
    if (this.playerComboGraceTicks > 0) this.playerComboGraceTicks -= 1;
    else if (this.p1.state !== "ATTACK") this.playerComboStage = 0;
    if (this.playerFlankWindowTicks > 0) this.playerFlankWindowTicks -= 1;
    if (this.playerFlankAttackTicks > 0) this.playerFlankAttackTicks -= 1;
    if (this.playerPerfectEvadeTicks > 0) this.playerPerfectEvadeTicks -= 1;
    if (this.playerStepThreatTicks > 0) this.playerStepThreatTicks -= 1;
    if (this.playerInterceptTicks > 0) this.playerInterceptTicks -= 1;
    if (this.playerReversalTicks > 0) this.playerReversalTicks -= 1;
  }

  private tryLegacyPlayerThrow(
    input: InputFrame,
    stepPressed: boolean,
    legacyKickPressed: boolean,
  ): boolean {
    // Keep the old keyboard-only G+K throw reachable for regression/debugging,
    // but it is deliberately absent from the TPS touch UI. The player-facing
    // control scheme is ATTACK + STEP only.
    const legacyThrowPressed = tpsLegacyThrowPressed(input, stepPressed, legacyKickPressed);
    if (!legacyThrowPressed || !this.p1.canAct()) return false;

    this.playerEvadeTicks = 0;
    this.playerAttackQueued = false;
    this.playerComboStage = 0;
    this.playerComboGraceTicks = 0;
    this.p1.beginMove("throw");
    this.p1.updatePhysics(FIXED_STEP);
    return true;
  }

  private advancePlayerAttack(attackPressed: boolean): boolean {
    if (this.p1.state !== "ATTACK") return false;

    // ATTACK taps during recovery are buffered. Once the current move finishes,
    // the next context-sensitive strike starts immediately.
    if (attackPressed && this.playerComboStage < 3) this.playerAttackQueued = true;
    // A repeated ATTACK only chains if the previous strike actually reached the target.
    const comboConfirmed = this.p1.hitTargets.has(this.p2.id);
    this.p1.advanceAttack();
    this.p1.updatePhysics(FIXED_STEP);

    if (this.p1.state !== "ATTACK") {
      if (
        this.playerAttackQueued
        && this.playerComboStage < 3
        && comboConfirmed
        && this.p1.canAct()
      ) {
        this.playerAttackQueued = false;
        this.beginContextAttack();
      } else {
        this.playerAttackQueued = false;
        if (!comboConfirmed || this.playerComboStage >= 3) {
          this.playerComboStage = 0;
          this.playerComboGraceTicks = 0;
        }
      }
    }
    return true;
  }

  private recoverPlayerFromLockedState(): boolean {
    if (!this.advanceLockedState(this.p1)) return false;

    this.playerEvadeTicks = 0;
    this.playerStepAttackQueued = false;
    this.playerAttackQueued = false;
    this.playerComboStage = 0;
    this.playerComboGraceTicks = 0;
    this.playerFlankAttackTicks = 0;
    return true;
  }

  private consumeQueuedStepAttack(): boolean {
    // Consume once at the first actionable tick after STEP. Never shorten the
    // evade itself, carry it through a hit, or turn held ATTACK into auto-fire.
    if (!this.playerStepAttackQueued || this.playerEvadeTicks > 0) return false;

    this.playerStepAttackQueued = false;
    this.beginContextAttack();
    this.p1.updatePhysics(FIXED_STEP);
    return true;
  }

  private beginPlayerStep(
    move: THREE.Vector3,
    toEnemy: THREE.Vector3,
    right: THREE.Vector3,
    sideAxis: number,
  ): void {
    const stepPlan = planTpsStep(move, toEnemy, right, sideAxis);
    this.applyPlayerStepPlan(stepPlan.stepVector, stepPlan.forwardWeight, stepPlan.sideWeight, stepPlan.evadeSign);
    this.trackPlayerStepThreat();
  }

  private applyPlayerStepPlan(
    stepVector: THREE.Vector3,
    forwardWeight: number,
    sideWeight: number,
    evadeSign: number,
  ): void {
    this.playerStepDirection.copy(stepVector);
    this.playerStepForwardWeight = forwardWeight;
    this.playerStepSideWeight = sideWeight;
    this.playerEvadeSign = evadeSign;

    if (sideWeight > 0.45) this.trainingProgress.sideSteps += 1;
    if (evadeSign < 0) this.playerLeftStepSamples += 1;
    else if (evadeSign > 0) this.playerRightStepSamples += 1;
    if (forwardWeight < -0.45) this.playerRetreatSamples += 1;

    this.playerEvadeTicks = TPS_STEP_TICKS;
    this.playerEvadeCooldown = Math.max(
      12,
      Math.round(TPS_STEP_COOLDOWN_TICKS * this.p1Dna.stepCooldownScale),
    );

    // A side STEP by itself is only movement. Flank advantage is awarded later,
    // inside resolveAttack, when an in-range enemy strike is actually evaded.
    this.playerFlankWindowTicks = 0;
    this.playerPerfectEvadeTicks = 0;
  }

  private trackPlayerStepThreat(): void {
    const activeIncomingMove = this.p2.state === "ATTACK" ? this.p2.currentMove : null;
    const pendingMove = this.enemyDirectorPendingMove
      ? this.p2.definition.moves[this.enemyDirectorPendingMove] ?? null
      : null;
    const pendingReaction = Boolean(
      pendingMove
      && this.enemyDirectorTelegraphTicks > 0
      && this.enemyDirectorTelegraphTicks <= tpsEnemyReactionWindowTicks(this.difficulty)
    );
    const incomingDistance = horizontalDistance(this.p1.position, this.p2.position);
    const stepThreat = tpsReactiveStepThreat({
      sideWeight: this.playerStepSideWeight,
      activeIncomingMove,
      pendingMove,
      pendingMoveId: this.enemyDirectorPendingMove,
      pendingReaction,
      pendingTelegraphTicks: this.enemyDirectorTelegraphTicks,
      enemyMoveTick: this.p2.moveTick,
      incomingDistance,
      stepTicks: TPS_STEP_TICKS,
    });
    this.playerStepThreatTicks = stepThreat.ticks;
    this.playerStepThreatMoveId = stepThreat.moveId;
  }

  private advancePlayerStep(
    attackPressed: boolean,
    toEnemy: THREE.Vector3,
    moveSpeed: number,
  ): boolean {
    if (this.playerEvadeTicks <= 0) return false;

    if (attackPressed && this.playerStepForwardWeight <= 0.45) {
      this.playerStepAttackQueued = true;
    }
    if (attackPressed && this.playerStepForwardWeight > 0.45) {
      this.playerEvadeTicks = 0;
      this.playerFlankWindowTicks = 0;
      this.beginDashAttack(toEnemy);
      this.p1.updatePhysics(FIXED_STEP);
      return true;
    }

    const stepMultiplier = tpsStepSpeedMultiplier(
      this.p1.definition.archetype,
      this.playerStepForwardWeight,
      this.p1Dna.stepSpeedScale,
    );
    this.playerEvadeTicks -= 1;
    this.p1.position.addScaledVector(
      this.playerStepDirection,
      FIXED_STEP * moveSpeed * stepMultiplier,
    );
    this.p1.state = "SIDESTEP";
    this.p1.updatePhysics(FIXED_STEP);
    return true;
  }

  private applyPlayerLocomotion(
    move: THREE.Vector3,
    moveSpeed: number,
    forwardAxis: number,
    sideAxis: number,
  ): void {
    if (move.lengthSq() <= 0.001) {
      this.p1.state = "IDLE";
      return;
    }

    move.normalize();
    // Near-contact pure strafing can otherwise orbit the opponent fast enough
    // to outrun an over-shoulder camera. Taper only ordinary lateral locomotion;
    // forward/back movement and the authored STEP burst keep their full speed.
    const fightDistance = horizontalDistance(this.p1.position, this.p2.position);
    const locomotionSpeedScale = tpsCloseLocomotionSpeedScale(
      fightDistance,
      forwardAxis,
      sideAxis,
    );
    this.p1.position.addScaledVector(
      move,
      FIXED_STEP * moveSpeed * locomotionSpeedScale,
    );
    this.p1.state = "WALK";
  }

  private beginContextAttack(): boolean {
    if (!this.p1.canAct()) return false;

    const plan = planTpsContextAttack({
      fighterName: this.p1.definition.name,
      distance: horizontalDistance(this.p1.position, this.p2.position),
      comboStage: this.playerComboStage,
      playerReversalTicks: this.playerReversalTicks,
      playerStepSideWeight: this.playerStepSideWeight,
      playerFlankWindowTicks: this.playerFlankWindowTicks,
      playerInterceptTicks: this.playerInterceptTicks,
      defenderState: this.p2.state,
      defenderNearWall: horizontalRadius(this.p2.position) >= ARENA_RADIUS - 1.35,
      selfHealth: this.p1.health,
      defenderHealth: this.p2.health,
    });
    if (!this.p1.beginMove(plan.choice.moveId)) return false;

    this.playerComboStage = plan.nextComboStage;
    this.playerComboGraceTicks = TPS_COMBO_GRACE_TICKS;
    this.p1.visual.root.userData.tpsFighterDna = this.p1Dna.id;
    this.p1.visual.root.userData.tpsContextMove = plan.choice.moveId;
    this.p1.visual.root.userData.tpsSignatureAction = plan.choice.signature;
    this.p1.visual.root.userData.tpsContextBeat = plan.choice.beat;
    if (plan.choice.beat) this.setCombatBeat(plan.choice.beat);

    if (plan.reversalStrike) {
      this.playerReversalSamples += 1;
      this.playerReversalTicks = 0;
    }
    if (plan.flankStrike) {
      this.playerFlankAttackTicks = 28;
      this.playerFlankWindowTicks = 0;
    }
    return true;
  }

  private beginDashAttack(toEnemy: THREE.Vector3): boolean {
    this.playerAttackQueued = false;
    this.playerComboStage = 0;
    this.playerComboGraceTicks = 0;
    this.playerFlankAttackTicks = 0;
    if (!this.p1.beginMove("dashKick")) return false;
    const burstSpeed = this.p1.definition.archetype === "SPEED" ? 7.4 : 6.8;
    this.p1.velocity.x = toEnemy.x * burstSpeed;
    this.p1.velocity.z = toEnemy.z * burstSpeed;
    return true;
  }

  private updateEnemy(): void {
    this.p2.setInput(EMPTY_INPUT);
    const liveDistance = horizontalDistance(this.p2.position, this.p1.position);
    this.enemyFunDirector.observe(this.enemySituation());
    if (this.advanceLockedState(this.p2)) return;

    this.enemyCooldown = Math.max(0, this.enemyCooldown - 1);
    if (this.enemyOpeningGraceTicks > 0) this.enemyOpeningGraceTicks -= 1;
    this.reviewEnemyHabitsIfDue();
    this.refreshEnemyTacticIfDue();

    const towardPlayer = horizontalDirection(this.p2.position, this.p1.position);
    const tangent = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x);

    if (this.advanceEnemyTelegraph(towardPlayer)) return;
    if (this.runEnemyOpeningGrace(liveDistance, towardPlayer, tangent)) return;
    if (this.runHeldEnemyDecision(towardPlayer, tangent)) return;

    const decision = adaptTpsCpuDecision(
      this.enemyFunDirector.decide(this.enemySituation()),
      {
        persona: this.enemyPersona,
        adaptation: this.enemyAdaptation,
        liveDistance,
        simulationTicks: this.simulationTicks,
      },
    );
    this.enemyDirectorDecision = decision;
    this.publishEnemyDecision(decision);

    if (this.queueEnemyAttackDecision(decision)) return;

    this.enemyDirectorHoldTicks = Math.max(1, decision.holdTicks - 1);
    this.moveEnemy(decision.intent, towardPlayer, tangent);
    this.p2.updatePhysics(FIXED_STEP);
  }

  private enemySituation(): CpuSituation {
    return {
      self: tpsCpuActorSnapshot(this.p2),
      opponent: tpsCpuActorSnapshot(this.p1),
      distance: horizontalDistance(this.p2.position, this.p1.position),
    };
  }

  private reviewEnemyHabitsIfDue(): void {
    this.enemyAdaptReviewTicks -= 1;
    if (this.enemyAdaptReviewTicks > 0) return;

    const review = reviewTpsEnemyHabits(this.enemyAdaptation, {
      attacks: this.playerAttackSamples,
      steps: this.playerStepSamples,
      retreats: this.playerRetreatSamples,
      leftSteps: this.playerLeftStepSamples,
      rightSteps: this.playerRightStepSamples,
      intercepts: this.playerInterceptSamples,
      reversals: this.playerReversalSamples,
    });
    this.enemyAdaptation = review.adaptation;
    if (review.readLabel) this.setCombatBeat(`RIVAL: ${review.readLabel}`, 28);
    this.playerAttackSamples = review.samples.attacks;
    this.playerStepSamples = review.samples.steps;
    this.playerRetreatSamples = review.samples.retreats;
    this.playerLeftStepSamples = review.samples.leftSteps;
    this.playerRightStepSamples = review.samples.rightSteps;
    this.playerInterceptSamples = review.samples.intercepts;
    this.playerReversalSamples = review.samples.reversals;
    this.enemyAdaptReviewTicks = TPS_ADAPT_REVIEW_TICKS;
  }

  private refreshEnemyTacticIfDue(): void {
    this.enemyTacticTicks -= 1;
    if (this.enemyTacticTicks > 0) return;

    const selection = chooseTpsEnemyTactic({
      simulationTicks: this.simulationTicks,
      p1Health: this.p1.health,
      p2Health: this.p2.health,
      persona: this.enemyPersona,
      adaptation: this.enemyAdaptation,
      difficulty: this.difficulty,
      dramaPhase: this.dramaPhase,
    });
    this.enemyTactic = selection.tactic;
    this.enemyOrbitSign = selection.orbitSign;
    this.enemyTacticTicks = selection.tacticTicks;
  }

  private advanceEnemyTelegraph(towardPlayer: THREE.Vector3): boolean {
    if (!this.enemyDirectorPendingMove) return false;
    if (this.enemyDirectorTelegraphTicks > 0) {
      this.tickEnemyTelegraph();
      this.p2.updatePhysics(FIXED_STEP);
      return true;
    }
    return this.commitEnemyTelegraphedMove(towardPlayer);
  }

  private tickEnemyTelegraph(): void {
    this.enemyDirectorTelegraphTicks -= 1;
    const rootData = this.p2.visual.root.userData;
    rootData.tpsCpuDirectorTelegraphTicks = this.enemyDirectorTelegraphTicks;

    const totalTicks = Math.max(1, this.enemyDirectorTelegraphTotalTicks);
    const progress = THREE.MathUtils.clamp(
      1 - this.enemyDirectorTelegraphTicks / totalTicks,
      0,
      1,
    );
    const reactionWindow = tpsEnemyReactionWindowTicks(this.difficulty);
    rootData.tpsEnemyTelegraphProgress = progress;
    rootData.tpsEnemyTelegraphMove = this.enemyDirectorPendingMove;
    rootData.tpsEnemyTelegraphPhase = this.enemyDirectorTelegraphTicks <= reactionWindow
      ? "REACT"
      : "LOAD";
    rootData.tpsEnemyReactionWindowTicks = reactionWindow;

    const intent = this.enemyDirectorDecision?.intent ?? "WAIT";
    this.p2.state = ["POWER", "THROW", "COUNTER"].includes(intent)
      ? "GUARD"
      : "IDLE";
  }

  private commitEnemyTelegraphedMove(towardPlayer: THREE.Vector3): boolean {
    const moveId = this.enemyDirectorPendingMove;
    if (!moveId) return false;

    const intent = this.enemyDirectorDecision?.intent ?? "JAB";
    this.enemyDirectorPendingMove = null;
    if (!this.beginEnemyDirectorMove(moveId, intent, towardPlayer)) return false;
    this.p2.updatePhysics(FIXED_STEP);
    return true;
  }

  private runEnemyOpeningGrace(
    liveDistance: number,
    towardPlayer: THREE.Vector3,
    tangent: THREE.Vector3,
  ): boolean {
    if (this.enemyOpeningGraceTicks <= 0) return false;

    // Keep the title-card/read window non-hostile. It still moves so the enemy
    // feels alive, but no decision is remembered as an attack before play begins.
    const openingIntent: CpuIntent = liveDistance > 2.35 ? "APPROACH" : "SIDESTEP";
    const openingDecision: CpuDecision = {
      intent: openingIntent,
      holdTicks: 1,
      telegraphTicks: 0,
      reason: "opening-read-window",
      comebackMercy: 0,
      pressure: 0,
    };
    this.publishEnemyDecision(openingDecision);
    this.moveEnemy(openingIntent, towardPlayer, tangent);
    this.p2.updatePhysics(FIXED_STEP);
    return true;
  }

  private runHeldEnemyDecision(
    towardPlayer: THREE.Vector3,
    tangent: THREE.Vector3,
  ): boolean {
    if (!this.enemyDirectorDecision || this.enemyDirectorHoldTicks <= 0) return false;

    const heldIntent = isAttackIntent(this.enemyDirectorDecision.intent)
      ? "WAIT"
      : this.enemyDirectorDecision.intent;
    this.enemyDirectorHoldTicks -= 1;
    this.publishEnemyDecision(
      this.enemyDirectorDecision,
      isAttackIntent(this.enemyDirectorDecision.intent)
        ? this.p2.visual.root.userData.tpsCpuDirectorMove ?? null
        : null,
    );
    this.moveEnemy(heldIntent, towardPlayer, tangent);
    this.p2.updatePhysics(FIXED_STEP);
    if (this.enemyDirectorHoldTicks <= 0) this.enemyDirectorDecision = null;
    return true;
  }

  private queueEnemyAttackDecision(decision: CpuDecision): boolean {
    if (!isAttackIntent(decision.intent)) return false;

    const moveId = tpsCpuAttackMove(decision.intent);
    if (!moveId) return false;

    const rootData = this.p2.visual.root.userData;
    rootData.tpsCpuDirectorMove = moveId;
    const telegraphTicks = Math.max(
      decision.telegraphTicks,
      minimumTpsEnemyTelegraphTicks(this.difficulty, moveId),
    );
    this.enemyDirectorPendingMove = moveId;
    this.enemyDirectorTelegraphTicks = telegraphTicks;
    this.enemyDirectorTelegraphTotalTicks = telegraphTicks;
    rootData.tpsCpuDirectorTelegraphTicks = telegraphTicks;
    rootData.tpsEnemyTelegraphProgress = 0;
    rootData.tpsEnemyTelegraphMove = moveId;
    rootData.tpsEnemyTelegraphPhase = "LOAD";
    this.p2.state = ["POWER", "THROW", "COUNTER"].includes(decision.intent)
      ? "GUARD"
      : "IDLE";
    this.p2.updatePhysics(FIXED_STEP);
    return true;
  }

  private publishEnemyDecision(
    decision: CpuDecision,
    moveId: string | null = null,
  ): void {
    const rootData = this.p2.visual.root.userData;
    rootData.tpsCpuDirectorPolicy = "FUN_DIRECTOR_V1";
    rootData.tpsCpuDirectorIntent = decision.intent;
    rootData.tpsCpuDirectorReason = decision.reason;
    rootData.tpsCpuDirectorComebackMercy = decision.comebackMercy;
    rootData.tpsCpuDirectorPressure = decision.pressure;
    rootData.tpsCpuDirectorTelegraphTicks = this.enemyDirectorTelegraphTicks;
    rootData.tpsCpuDirectorMove = moveId;
    rootData.tpsCpuPersona = this.enemyPersona;
    rootData.tpsCpuAdaptation = this.enemyAdaptation;
  }

  private moveEnemy(
    intent: CpuIntent,
    towardPlayer: THREE.Vector3,
    tangent: THREE.Vector3,
  ): void {
    if (intent === "GUARD") {
      this.p2.state = "GUARD";
      return;
    }
    if (intent === "WAIT") {
      this.p2.state = "IDLE";
      return;
    }

    const movement = new THREE.Vector3();
    if (intent === "APPROACH") movement.copy(towardPlayer);
    else if (intent === "RETREAT") movement.copy(towardPlayer).multiplyScalar(-1);
    else if (intent === "SIDESTEP" || intent === "JUMP") {
      movement.copy(tangent).multiplyScalar(this.enemyOrbitSign);
    }

    if (movement.lengthSq() <= 1e-6) {
      this.p2.state = "IDLE";
      return;
    }

    const baseSpeed = (this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95)
      * this.p2Dna.moveSpeedScale;
    const difficultySpeed = this.difficulty === "HARD"
      ? 1.08
      : this.difficulty === "EASY"
        ? 0.9
        : 1;
    this.p2.position.addScaledVector(
      movement.normalize(),
      FIXED_STEP * baseSpeed * difficultySpeed,
    );
    this.p2.state = "WALK";
  }

  private beginEnemyDirectorMove(
    moveId: string,
    intent: CpuIntent,
    towardPlayer: THREE.Vector3,
  ): boolean {
    const began = this.p2.beginMove(moveId);
    if (!began) return false;

    const rootData = this.p2.visual.root.userData;
    rootData.tpsCpuDirectorMove = moveId;
    rootData.tpsCpuDirectorIntent = intent;
    rootData.tpsCpuDirectorTelegraphTicks = 0;
    rootData.tpsEnemyTelegraphProgress = 0;
    rootData.tpsEnemyTelegraphPhase = "STRIKE";
    this.enemyDirectorTelegraphTotalTicks = 0;

    if (moveId === "dashKick") {
      const burstSpeed = this.p2.definition.archetype === "SPEED" ? 5.0 : 4.45;
      this.p2.velocity.x = towardPlayer.x * burstSpeed;
      this.p2.velocity.z = towardPlayer.z * burstSpeed;
    }

    // Mirror the shared director's two neutral post-attack input frames. The
    // hold begins only after ATTACK unlocks, so it creates a real punish/read beat.
    this.enemyDirectorHoldTicks = 2;
    this.enemyCooldown = Math.max(this.enemyCooldown, 2);
    return true;
  }

  private advanceLockedState(fighter: FighterRuntime): boolean {
    if (fighter.hitStop > 0) {
      fighter.updatePhysics(FIXED_STEP);
      return true;
    }
    if (fighter.state === "ATTACK") {
      fighter.advanceAttack();
      fighter.updatePhysics(FIXED_STEP);
      return true;
    }
    if (["HIT", "BLOCK_STUN", "KNOCKDOWN", "WAKEUP", "THROW", "KO", "RING_OUT"].includes(fighter.state)) {
      fighter.updatePhysics(FIXED_STEP);
      return true;
    }
    return false;
  }

  private resolveAttack(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    defenderGuarding: boolean,
  ): void {
    const move = attacker.currentMove;
    if (
      attacker.state !== "ATTACK"
      || !move
      || !attacker.isActive()
      || attacker.hitTargets.has(defender.id)
    ) return;

    if (this.tryResolveTrackedSideEvade(attacker, defender, move)) return;

    const distance = horizontalDistance(attacker.position, defender.position);
    if (distance > move.reach + 0.72) return;

    attacker.hitTargets.add(defender.id);
    const defenderWasAttacking = defender.state === "ATTACK";
    const interceptStrike = attacker === this.p1
      && defender === this.p2
      && this.playerInterceptTicks > 0;
    const reversalStrike = attacker === this.p1
      && this.playerFlankAttackTicks > 0
      && move.hitLevel !== "THROW";

    const resolution = computeTpsHitResolution({
      move,
      defenderHealth: defender.health,
      defenderGuarding,
      defenderWasAttacking,
      interceptStrike,
      reversalStrike,
      playerDna: this.p1Dna,
      simulationTicks: this.simulationTicks,
      attackerIsPlayer: attacker === this.p1,
    });
    const { blocked, resolvedDamage, lethalImpact, reactionStrength } = resolution;
    const direction = horizontalDirection(attacker.position, defender.position);
    const impactPosition = attacker.position.clone().lerp(defender.position, 0.55);
    impactPosition.y = tpsImpactHeightForMove(move);

    this.recordPlayerHitProgress(attacker, blocked, interceptStrike, reversalStrike);
    this.applyResolvedDamage(
      defender,
      move,
      blocked,
      resolvedDamage,
      reactionStrength,
      direction,
    );
    this.applySpecialStrikeState(
      interceptStrike,
      reversalStrike,
      defenderWasAttacking,
      blocked,
    );

    applyTpsImpactPresentation({
      attacker,
      defender,
      simulationTicks: this.simulationTicks,
      moveId: move.id,
      contact: impactPosition,
      direction,
      reactionType: resolution.reactionType,
      reactionRegion: resolution.reactionRegion,
      reactionVariant: resolution.reactionVariant,
      reactionStrength,
      impactPairStrength: resolution.impactPairStrength,
    });
    if (lethalImpact) this.applyLethalImpactFreeze(attacker, defender, move);

    const event: HitEvent = {
      attacker: attacker.id,
      defender: defender.id,
      move,
      blocked,
      counter: resolution.counter,
      throwEscape: false,
      damage: resolvedDamage,
      position: {
        x: impactPosition.x,
        y: impactPosition.y,
        z: impactPosition.z,
      },
    };
    this.emitImpactFeedback(
      attacker,
      event,
      blocked,
      lethalImpact,
      interceptStrike,
      reversalStrike,
    );
  }

  private tryResolveTrackedSideEvade(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    move: MoveDefinition,
  ): boolean {
    const trackedSideEvade = defender === this.p1
      && attacker === this.p2
      && this.playerStepThreatTicks > 0
      && this.playerStepThreatMoveId === move.id
      && this.playerStepSideWeight > 0.45
      && move.hitLevel !== "THROW";
    if (!trackedSideEvade) return false;

    attacker.hitTargets.add(defender.id);
    this.playerStepThreatTicks = 0;
    this.playerStepThreatMoveId = null;
    this.playerFlankWindowTicks = Math.max(
      this.playerFlankWindowTicks,
      TPS_FLANK_WINDOW_TICKS,
    );
    this.playerPerfectEvadeTicks = Math.max(
      this.playerPerfectEvadeTicks,
      TPS_PERFECT_EVADE_TICKS + this.p1Dna.perfectEvadeBonusTicks,
    );
    this.playerReversalTicks = Math.max(
      this.playerReversalTicks,
      TPS_REVERSAL_TICKS,
    );
    this.trainingProgress.perfectEvades += 1;
    this.setCombatBeat("REVERSAL");
    return true;
  }

  private recordPlayerHitProgress(
    attacker: FighterRuntime,
    blocked: boolean,
    interceptStrike: boolean,
    reversalStrike: boolean,
  ): void {
    if (attacker !== this.p1 || blocked) return;

    this.trainingProgress.hits += 1;
    if (interceptStrike) this.trainingProgress.intercepts += 1;
    if (reversalStrike) this.trainingProgress.punishes += 1;
  }

  private applyLethalImpactFreeze(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    move: MoveDefinition,
  ): void {
    defender.hitStop = Math.max(defender.hitStop, move.hitStop + 5);
    attacker.hitStop = Math.max(attacker.hitStop, move.hitStop + 3);
    this.cameraImpact = Math.max(this.cameraImpact, 0.078);
    this.setCombatBeat("FINAL IMPACT", TPS_FINISHER_BEAT_TICKS);
  }

  private applyResolvedDamage(
    defender: FighterRuntime,
    move: MoveDefinition,
    blocked: boolean,
    resolvedDamage: number,
    reactionStrength: number,
    direction: THREE.Vector3,
  ): void {
    if (blocked) {
      defender.receiveBlock(move.guardDamage, move.blockStun, move.hitStop);
      defender.velocity.x = direction.x * move.knockback * 5;
      defender.velocity.z = direction.z * move.knockback * 5;
      return;
    }

    defender.receiveDamage(
      resolvedDamage,
      move.hitStun,
      move.knockback,
      direction.x >= 0 ? 1 : -1,
      Boolean(move.knockdown),
      move.hitStop,
    );
    const knockback = move.knockback * 18 * reactionStrength;
    defender.velocity.x = direction.x * knockback;
    defender.velocity.z = direction.z * knockback;
  }

  private applySpecialStrikeState(
    interceptStrike: boolean,
    reversalStrike: boolean,
    defenderWasAttacking: boolean,
    blocked: boolean,
  ): void {
    if (interceptStrike) {
      this.playerInterceptTicks = 0;
      this.enemyDirectorPendingMove = null;
      this.enemyDirectorTelegraphTicks = 0;
      this.enemyDirectorTelegraphTotalTicks = 0;
      this.p2.visual.root.userData.tpsEnemyTelegraphProgress = 0;
      this.p2.visual.root.userData.tpsEnemyTelegraphMove = null;
      this.p2.visual.root.userData.tpsEnemyTelegraphPhase = "INTERRUPTED";
      this.enemyDirectorDecision = null;
      this.enemyDirectorHoldTicks = Math.max(this.enemyDirectorHoldTicks, 12);
      this.setCombatBeat(this.p1Dna.signature.intercept);
      return;
    }

    if (reversalStrike) {
      this.setCombatBeat(this.p1Dna.signature.reversal);
      return;
    }

    if (defenderWasAttacking && !blocked) this.setCombatBeat("COUNTER HIT");
  }

  private emitImpactFeedback(
    attacker: FighterRuntime,
    event: HitEvent,
    blocked: boolean,
    lethalImpact: boolean,
    interceptStrike: boolean,
    reversalStrike: boolean,
  ): void {
    this.effects.hit(event);
    this.graphics.hit(event, this.camera);
    this.audio.impact(event);

    if (!blocked) {
      const attackerDna = attacker === this.p1 ? this.p1Dna : this.p2Dna;
      if (lethalImpact) this.audio.combatSignature("FINAL_IMPACT", attackerDna.id);
      else if (interceptStrike) this.audio.combatSignature("INTERCEPT", attackerDna.id);
      else if (reversalStrike) this.audio.combatSignature("REVERSAL", attackerDna.id);
    }

    if (!blocked && this.settings.get().vibration && attacker.id === "p1") {
      const hapticPattern: number | number[] = lethalImpact
        ? [28, 18, 42]
        : interceptStrike
          ? [8, 14, 16]
          : reversalStrike
            ? [12, 12, 22]
            : event.move.power > 1.45 ? 22 : 9;
      navigator.vibrate?.(hapticPattern);
    }
  }

  private applyAttackStepIn(attacker: FighterRuntime, defender: FighterRuntime): void {
    const move = attacker.currentMove;
    if (attacker.state !== "ATTACK" || !move || attacker.moveTick > move.startup) return;
    const distance = horizontalDistance(attacker.position, defender.position);
    const desiredContact = Math.max(1.02, move.reach + 0.52);
    if (distance <= desiredContact || distance > desiredContact + 0.72) return;
    const remaining = distance - desiredContact;
    const stepDistance = Math.min(remaining, 0.038 + move.power * 0.014);
    attacker.position.addScaledVector(horizontalDirection(attacker.position, defender.position), stepDistance);
  }

  private separateFighters(): void {
    const delta = new THREE.Vector3(
      this.p2.position.x - this.p1.position.x,
      0,
      this.p2.position.z - this.p1.position.z,
    );
    const distance = delta.length();
    const spacing = computeTpsContactSpacing({
      p1State: this.p1.state,
      p2State: this.p2.state,
      p1Move: this.p1.currentMove,
      p2Move: this.p2.currentMove,
      p1HitStop: this.p1.hitStop,
      p2HitStop: this.p2.hitStop,
    });

    this.publishContactSpacing(spacing.mode, spacing.minimum, spacing.impactMoveId);
    if (distance >= spacing.minimum || distance < 1e-5) return;

    const correction = delta.normalize().multiplyScalar(
      (spacing.minimum - distance) * 0.5,
    );
    this.p1.position.addScaledVector(correction, -1);
    this.p2.position.add(correction);
  }

  private publishContactSpacing(
    mode: "THROW" | "IMPACT_PAIR" | "NEUTRAL",
    minimum: number,
    impactMoveId: string | null,
  ): void {
    this.p1.visual.root.userData.tpsContactSpacingMode = mode;
    this.p2.visual.root.userData.tpsContactSpacingMode = mode;
    this.p1.visual.root.userData.tpsContactSpacingMinimum = minimum;
    this.p2.visual.root.userData.tpsContactSpacingMinimum = minimum;
    this.p1.visual.root.userData.tpsContactSpacingMove = impactMoveId;
    this.p2.visual.root.userData.tpsContactSpacingMove = impactMoveId;
  }

  private updateVisual(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    time: number,
  ): void {
    const forward = prepareTpsFighterVisual({
      fighter,
      opponent,
      fighterDnaId: fighter === this.p1 ? this.p1Dna.id : this.p2Dna.id,
      playerStepDirection: this.playerStepDirection,
    });
    this.animation.update(fighter, opponent, time);
    finalizeTpsFighterVisual(fighter, forward);
  }

  private updateCamera(delta: number): void {
    this.cameraFrameStart.copy(this.camera.position);
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const fightDistance = horizontalDistance(this.p1.position, this.p2.position);
    const attackMove = this.p1.state === "ATTACK" ? this.p1.currentMove : null;
    const attackMoveId = attackMove?.id ?? null;

    // Read the same deterministic 60 Hz contact envelope that drives authored
    // clip sampling instead of depending on presentation-only runtime telemetry.
    const authoredContactWeight = attackMove
      ? sampleCombatMotionAtEvent(
        attackMove,
        this.p1.moveTick,
        motionEventsAtContact(0.5),
      ).contactWeight
      : 0;

    const framing = computeTpsCameraFraming({
      fightDistance,
      aspect: this.camera.aspect,
      playerPerfectEvadeTicks: this.playerPerfectEvadeTicks,
      playerFlankWindowTicks: this.playerFlankWindowTicks,
      playerFlankAttackTicks: this.playerFlankAttackTicks,
      flankWindowTicks: TPS_FLANK_WINDOW_TICKS,
      playerEvadeSign: this.playerEvadeSign,
      maxHitStop: Math.max(this.p1.hitStop, this.p2.hitStop),
      attackMoveId,
      authoredContactWeight,
      dramaPhase: this.dramaPhase,
      dramaIntensity: this.dramaIntensity,
    });

    this.configureCameraTargets(framing, right);
    this.publishCameraFraming(framing, attackMoveId);
    this.advanceCameraRig(framing, forward, right, delta);
  }

  private configureCameraTargets(
    framing: TpsCameraFraming,
    right: THREE.Vector3,
  ): void {
    // At melee range, orbit around the pair instead of keeping the camera rooted
    // directly behind the foreground player.
    this.cameraPairMidpoint.copy(this.p1.position).lerp(this.p2.position, 0.5);
    this.cameraAnchor.copy(this.p1.position)
      .lerp(this.cameraPairMidpoint, framing.closeAnchorBlend);
    this.cameraFocus.copy(this.p2.position)
      .lerp(this.cameraPairMidpoint, framing.closeTargetBlend);
    this.cameraTarget.copy(this.cameraFocus)
      .addScaledVector(right, framing.targetSideShift)
      .add(new THREE.Vector3(0, framing.targetHeight, 0));
  }

  private publishCameraFraming(
    framing: TpsCameraFraming,
    attackMoveId: string | null,
  ): void {
    const data = this.camera.userData;
    data.tpsCloseReadabilityFactor = framing.closeFactor;
    data.tpsAuthoredContactReadabilityFactor = framing.authoredContactReadabilityFactor;
    data.tpsKickContactReadabilityFactor = framing.kickContactReadabilityFactor;
    data.tpsFrontKickReadabilityFactor = framing.frontKickReadabilityFactor;
    data.tpsLowKickReadabilityFactor = framing.lowKickReadabilityFactor;
    data.tpsContactReadabilityMove = attackMoveId;
    data.tpsCloseAnchorBlend = framing.closeAnchorBlend;
    data.tpsCloseTargetBlend = framing.closeTargetBlend;
    data.tpsImpactReadabilityFactor = framing.impactReadabilityFactor;
    data.tpsDramaCinematicFactor = framing.dramaCinematicFactor;
    data.tpsShoulderOffset = framing.shoulderOffset;
    data.tpsBackDistance = framing.backDistance;
    data.tpsTargetHeight = framing.targetHeight;
  }

  private advanceCameraRig(
    framing: TpsCameraFraming,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    delta: number,
  ): void {
    this.cameraDesired.copy(this.cameraAnchor)
      .addScaledVector(forward, -framing.backDistance)
      .addScaledVector(right, framing.desiredShoulderOffset)
      .add(new THREE.Vector3(0, framing.cameraHeight, 0));

    // Keep distant navigation responsive, but add inertia as the fight closes.
    ease(this.camera.position, this.cameraDesired, framing.cameraPositionRate, delta);
    this.applyCameraImpactShake(right, delta);
    this.clampCameraFrameTravel(delta);

    // Smooth the look target as well as camera position.
    ease(this.cameraLookTarget, this.cameraTarget, 12.0, delta);
    this.camera.lookAt(this.cameraLookTarget);
  }

  private applyCameraImpactShake(right: THREE.Vector3, delta: number): void {
    if (this.cameraImpact <= 0.001) return;

    const impact = this.cameraImpact;
    this.cameraImpact *= Math.exp(-10 * delta);
    this.camera.position.addScaledVector(
      right,
      Math.sin(this.renderTime * 76) * impact,
    );
    this.camera.position.y += Math.cos(this.renderTime * 91) * impact * 0.36;
  }

  private clampCameraFrameTravel(delta: number): void {
    // Cap the complete frame displacement after both follow motion and impact shake.
    const maxCameraTravel = TPS_CAMERA_MAX_TRAVEL_SPEED * delta;
    this.cameraFrameDelta.copy(this.camera.position).sub(this.cameraFrameStart);
    if (
      maxCameraTravel > 0
      && this.cameraFrameDelta.lengthSq() > maxCameraTravel * maxCameraTravel
    ) {
      this.camera.position.copy(this.cameraFrameStart)
        .add(this.cameraFrameDelta.setLength(maxCameraTravel));
    }
  }

  private setCombatBeat(label: string, ticks = TPS_COMBAT_BEAT_TICKS): void {
    if (ticks >= this.combatBeatTicks || label === "FINAL IMPACT") {
      this.combatBeatLabel = label;
      this.combatBeatTicks = ticks;
    }
  }

  private enemyThreatStatus(): { windup: boolean; incoming: boolean } {
    const pendingMove = this.enemyDirectorPendingMove
      ? this.p2.definition.moves[this.enemyDirectorPendingMove] ?? null
      : null;
    const distance = horizontalDistance(this.p1.position, this.p2.position);
    return computeTpsEnemyThreat({
      pendingMove,
      pendingTelegraphTicks: this.enemyDirectorTelegraphTicks,
      reactionWindowTicks: tpsEnemyReactionWindowTicks(this.difficulty),
      activeState: this.p2.state,
      activeMove: this.p2.currentMove,
      activeMoveTick: this.p2.moveTick,
      distance,
    });
  }

  private updateLockOn(): void {
    this.p2.visual.root.updateMatrixWorld(true);
    const distance = horizontalDistance(this.p1.position, this.p2.position);
    const { windup, incoming: threat } = this.enemyThreatStatus();
    const inStrikeRange = distance < TPS_STRIKE_RANGE;
    const profile = computeTpsLockOnProfile({
      inStrikeRange,
      windup,
      threat,
      perfectEvade: this.playerPerfectEvadeTicks > 0,
      renderTime: this.renderTime,
      contactReadability: Number(
        this.camera.userData.tpsAuthoredContactReadabilityFactor ?? 0,
      ),
    });

    const target = this.p2.visual.root.localToWorld(
      new THREE.Vector3(
        0,
        this.p2.visual.layout.ribY + profile.lockLift,
        0,
      ),
    );
    this.lockRing.material.color.setHex(profile.lockColor);
    this.lockStem.material.color.setHex(profile.lockColor);
    this.targetGroundRing.material.color.setHex(profile.lockColor);
    this.lockRing.position.copy(target);
    this.lockRing.lookAt(this.camera.position);
    this.lockRing.scale.setScalar(profile.pulse);
    this.lockStem.position.copy(target).add(new THREE.Vector3(0, -0.30, 0));
    this.lockStem.lookAt(this.camera.position);
    this.targetGroundRing.position.set(
      this.p2.position.x,
      0.035,
      this.p2.position.z,
    );
    this.targetGroundRing.scale.setScalar(profile.groundPulse);
    this.targetGroundRing.material.opacity = profile.groundOpacity;
  }

  private checkFinish(): void {
    if (this.finished || this.finishPending) return;
    if (this.p1.health > 0 && this.p2.health > 0 && this.timerTicks > 0) return;
    this.finishPending = true;
    this.finishTicks = 0;
    this.finishSettledTicks = 0;
    this.input.clear();
    const winner = tpsWinnerForHealth(this.p1.health, this.p2.health);
    this.resultWinner = winner;
    this.publishHud(true);
    this.audio.ko();
  }

  private resetRound(): void {
    this.p1.resetForRound(0, 3.2, 1);
    this.p2.resetForRound(0, -2.2, -1);
    this.resetPlayerRoundState();
    this.resetEnemyRoundState();
    this.resetMatchRoundState();

    this.graphics.reset();
    this.updateVisual(this.p1, this.p2, 0);
    this.updateVisual(this.p2, this.p1, 0.23);
    this.resetRoundCamera();
    this.updateLockOn();
  }

  private resetPlayerRoundState(): void {
    this.playerStepAttackQueued = false;
    this.playerEvadeTicks = 0;
    this.playerEvadeCooldown = 0;
    this.playerEvadeSign = 0;
    this.playerStepDirection.set(0, 0, 0);
    this.playerStepForwardWeight = 0;
    this.playerStepSideWeight = 0;
    this.playerComboStage = 0;
    this.playerComboGraceTicks = 0;
    this.playerAttackQueued = false;
    this.playerFlankWindowTicks = 0;
    this.playerFlankAttackTicks = 0;
    this.playerPerfectEvadeTicks = 0;
    this.playerStepThreatTicks = 0;
    this.playerStepThreatMoveId = null;
    this.playerInterceptTicks = 0;
    this.playerReversalTicks = 0;

    this.playerAttackSamples = 0;
    this.playerStepSamples = 0;
    this.playerRetreatSamples = 0;
    this.playerLeftStepSamples = 0;
    this.playerRightStepSamples = 0;
    this.playerInterceptSamples = 0;
    this.playerReversalSamples = 0;
  }

  private resetEnemyRoundState(): void {
    this.enemyCooldown = 52;
    this.enemyOpeningGraceTicks = 132;
    this.enemyTactic = "ORBIT";
    this.enemyTacticTicks = 0;
    this.enemyOrbitSign = 1;
    this.enemyFunDirector = new CpuFunDirector(this.difficulty, 47);
    this.enemyDirectorDecision = null;
    this.enemyDirectorHoldTicks = 0;
    this.enemyDirectorTelegraphTicks = 0;
    this.enemyDirectorTelegraphTotalTicks = 0;
    this.enemyDirectorPendingMove = null;

    const rootData = this.p2.visual.root.userData;
    rootData.tpsEnemyTelegraphProgress = 0;
    rootData.tpsEnemyTelegraphMove = null;
    rootData.tpsEnemyTelegraphPhase = "NONE";

    this.enemyAdaptReviewTicks = TPS_ADAPT_REVIEW_TICKS;
    this.enemyPersona = this.p2.definition.archetype === "SPEED"
      ? "SKIRMISHER"
      : "BRAWLER";
    this.enemyAdaptation = "NEUTRAL";
  }

  private resetMatchRoundState(): void {
    this.combatBeatLabel = null;
    this.combatBeatTicks = 0;
    this.dramaPhase = "OPENING";
    this.dramaIntensity = 0.14;
    this.dramaReviewTicks = TPS_DRAMA_REVIEW_TICKS;
    this.simulationTicks = 0;
    this.cameraImpact = 0;
    this.timerTicks = ROUND_TICKS;
    this.finishPending = false;
    this.finishTicks = 0;
    this.finishSettledTicks = 0;
    this.resultWinner = null;
  }

  private resetRoundCamera(): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.camera.position.copy(this.p1.position)
      .addScaledVector(forward, -4.92)
      .addScaledVector(right, 2.50)
      .add(new THREE.Vector3(0, 2.32, 0));
    this.updateCamera(1);
  }

  private publishHud(force: boolean): void {
    if (!force && this.simulationTicks % 4 !== 0) return;
    if (!force && this.lastHudTick === this.simulationTicks) return;
    this.lastHudTick = this.simulationTicks;
    this.options.onHud?.(buildTpsHudSnapshot(this.hudSnapshotInput()));
  }

  private hudSnapshotInput(): TpsHudSnapshotInput {
    return {
      trainingProgress: this.trainingProgress,
      enemyThreat: this.enemyThreatStatus(),
      finishPending: this.finishPending,
      finished: this.finished,
      playerReversalTicks: this.playerReversalTicks,
      playerPerfectEvadeTicks: this.playerPerfectEvadeTicks,
      playerEvadeTicks: this.playerEvadeTicks,
      playerStepSideWeight: this.playerStepSideWeight,
      playerFlankWindowTicks: this.playerFlankWindowTicks,
      playerComboStage: this.playerComboStage,
      combatBeatTicks: this.combatBeatTicks,
      combatBeatLabel: this.combatBeatLabel,
      enemyOpeningGraceTicks: this.enemyOpeningGraceTicks,
      p1State: this.p1.state,
      p2State: this.p2.state,
      p1MoveId: this.p1.currentMove?.id ?? null,
      fightDistance: horizontalDistance(this.p1.position, this.p2.position),
      strikeRange: TPS_STRIKE_RANGE,
      timerTicks: this.timerTicks,
      p1Health: this.p1.health,
      p2Health: this.p2.health,
      resultWinner: this.resultWinner,
      p1Name: this.p1.definition.name,
      p2Name: this.p2.definition.name,
    };
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
    this.graphics.dispose();
    this.effects.dispose();
    disposeFighterVisual(this.p1.visual);
    disposeFighterVisual(this.p2.visual);
    this.arenaDisposables.forEach((value) => value.dispose());
    this.renderer.dispose();
    this.mount.replaceChildren();
  }
}

