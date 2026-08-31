import * as THREE from "three";
import { AudioManager } from "./audio";
import { EffectsManager } from "./effects";
import { FighterRuntime, type CpuDifficulty } from "./fighter";
import { FixedStepClock } from "./fixed";
import { InputSystem } from "./input";
import { PresentationAnimationController } from "./presentation-animation";
import { SettingsManager } from "./settings";
import { TpsGraphicsDirector } from "./tps-graphics";
import { createFighterVisual, disposeFighterVisual } from "./visual-entry";
import type { FighterModelId } from "./model-skins";
import type { FighterDefinition, HitEvent, HudSnapshot, InputAction, InputFrame } from "./types";
import { EMPTY_INPUT } from "./types";

export interface TpsFightGameOptions {
  p1Definition: FighterDefinition;
  p2Definition: FighterDefinition;
  p1Model?: FighterModelId;
  p2Model?: FighterModelId;
  difficulty?: CpuDifficulty;
  onHud?: (snapshot: HudSnapshot) => void;
  onResult?: (winner: "p1" | "p2" | "draw") => void;
  onFallback?: (message: string) => void;
}

const ARENA_RADIUS = 6.8;
const FIXED_STEP = 1 / 60;
const ROUND_TICKS = 99 * 60;
const TPS_STRIKE_RANGE = 2.12;
const ENEMY_TACTIC_INTERVAL = 72;
const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
type EnemyTactic = "PRESSURE" | "ORBIT" | "BAIT";

function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(1, 0, 0);
}

function clampToArena(position: THREE.Vector3, margin = 0.72): void {
  const radial = new THREE.Vector2(position.x, position.z);
  const maximum = ARENA_RADIUS - margin;
  if (radial.lengthSq() <= maximum * maximum) return;
  radial.setLength(maximum);
  position.x = radial.x;
  position.z = radial.y;
}

function ease(current: THREE.Vector3, target: THREE.Vector3, rate: number, delta: number): void {
  current.lerp(target, 1 - Math.exp(-rate * delta));
}

function createCircularArena(): { group: THREE.Group; disposables: Array<THREE.BufferGeometry | THREE.Material> } {
  const group = new THREE.Group();
  group.name = "tps-circular-arena";
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const floorGeometry = new THREE.CircleGeometry(ARENA_RADIUS, 72);
  const floorMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x081827,
  emissive: 0x02070e,
  emissiveIntensity: 0.34,
  roughness: 0.62,
  metalness: 0.28,
  clearcoat: 0.32,
  clearcoatRoughness: 0.78,
});
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  group.add(floor);
  disposables.push(floorGeometry, floorMaterial);

  const boundaryGeometry = new THREE.TorusGeometry(ARENA_RADIUS, 0.055, 8, 96);
  const boundaryMaterial = new THREE.MeshBasicMaterial({ color: 0x4bd7ff, transparent: true, opacity: 0.9 });
  const boundary = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
  boundary.rotation.x = Math.PI / 2;
  boundary.position.y = 0.025;
  group.add(boundary);
  disposables.push(boundaryGeometry, boundaryMaterial);

  // A faint elevated rail gives the shoulder camera a stable horizon reference.
  // It also fills the otherwise empty upper half of the TPS composition without
  // placing opaque scenery between the camera and the fighters.
  const horizonGeometry = new THREE.TorusGeometry(ARENA_RADIUS + 2.15, 0.018, 6, 96);
  const horizonMaterial = new THREE.MeshBasicMaterial({
    color: 0x2d8dbf,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const horizon = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizon.rotation.x = Math.PI / 2;
  horizon.position.y = 1.45;
  group.add(horizon);
  disposables.push(horizonGeometry, horizonMaterial);

  for (let radius = 1.7; radius < ARENA_RADIUS; radius += 1.7) {
    const geometry = new THREE.TorusGeometry(radius, 0.012, 4, 64);
    const material = new THREE.MeshBasicMaterial({ color: 0x173a5a, transparent: true, opacity: 0.58 });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.004;
    group.add(ring);
    disposables.push(geometry, material);
  }

  const spokeMaterial = new THREE.LineBasicMaterial({ color: 0x173a5a, transparent: true, opacity: 0.52 });
  disposables.push(spokeMaterial);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.008, 0),
      new THREE.Vector3(Math.cos(angle) * ARENA_RADIUS, 0.008, Math.sin(angle) * ARENA_RADIUS),
    ]);
    group.add(new THREE.Line(geometry, spokeMaterial));
    disposables.push(geometry);
  }

  // Keep scenery outside the shoulder-camera orbit. The previous pillar ring
  // sat directly between the camera and fighters and produced large foreground
  // slabs during strafing. These thinner beacons preserve depth without blocking play.
  const pillarGeometry = new THREE.CylinderGeometry(0.07, 0.12, 1.45, 8);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x143454, emissive: 0x07365d, emissiveIntensity: 0.9, roughness: 0.7 });
  const beaconGeometry = new THREE.OctahedronGeometry(0.11, 0);
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0x61ddff, transparent: true, opacity: 0.72 });
  disposables.push(pillarGeometry, pillarMaterial, beaconGeometry, beaconMaterial);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    const x = Math.cos(angle) * (ARENA_RADIUS + 2.15);
    const z = Math.sin(angle) * (ARENA_RADIUS + 2.15);
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(x, 0.725, z);
    const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
    beacon.position.set(x, 1.5, z);
    group.add(pillar, beacon);
  }

  return { group, disposables };
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
  private raf = 0;
  private running = false;
  private paused = false;
  private lastTime = 0;
  private renderTime = 0;
  private timerTicks = ROUND_TICKS;
  private enemyCooldown = 48;
  // Give the player a brief orientation/read window at the start of a TPS duel.
  // The CPU may reposition or guard during this window, but it cannot open with an attack.
  private enemyOpeningGraceTicks = 132;
  private finished = false;
  private resultWinner: "p1" | "p2" | "draw" | null = null;
  private lastHudTick = -1;
  private runtimeFailureReported = false;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private playerEvadeTicks = 0;
  private playerEvadeCooldown = 0;
  private playerEvadeSign = 0;
  private simulationTicks = 0;
  private cameraImpact = 0;
  private enemyTactic: EnemyTactic = "ORBIT";
  private enemyTacticTicks = 0;
  private enemyOrbitSign = 1;

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
    this.scene.add(this.p1.visual.root, this.p2.visual.root);

    const lockGeometry = new THREE.TorusGeometry(0.46, 0.022, 8, 48);
    const lockMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.96, depthTest: true, depthWrite: false });
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
  pause(): void { this.paused = true; this.input.clear(); }
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
    this.simulationTicks += 1;
    this.timerTicks = Math.max(0, this.timerTicks - 1);
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
    this.separateFighters();
    clampToArena(this.p1.position);
    clampToArena(this.p2.position);
    this.updateVisual(this.p1, this.p2, this.renderTime);
    this.updateVisual(this.p2, this.p1, this.renderTime + 0.23);
    this.checkFinish();
    this.publishHud(false);
  }

  private updatePlayer(input: InputFrame): void {
    this.p1.setInput(input);
    if (this.advanceLockedState(this.p1)) return;

    const toEnemy = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-toEnemy.z, 0, toEnemy.x);
    const forwardAxis = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const sideAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const move = toEnemy.multiplyScalar(forwardAxis).addScaledVector(right, sideAxis);

    const moveSpeed = this.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;
    if (this.playerEvadeCooldown > 0) this.playerEvadeCooldown -= 1;
    const evadePressed = input.guard && sideAxis !== 0 && (
      this.p1.justPressed("guard") || this.p1.justPressed("left") || this.p1.justPressed("right")
    );
    if (evadePressed && this.playerEvadeCooldown <= 0) {
      this.playerEvadeTicks = 9;
      this.playerEvadeCooldown = 32;
      this.playerEvadeSign = sideAxis > 0 ? 1 : -1;
    }
    if (this.playerEvadeTicks > 0) {
      this.playerEvadeTicks -= 1;
      this.p1.position.addScaledVector(right, FIXED_STEP * moveSpeed * 2.35 * this.playerEvadeSign);
      this.p1.state = "SIDESTEP";
      this.p1.updatePhysics(FIXED_STEP);
      return;
    }
    if (input.guard) {
      // TPS defense should not root the player in place. Guard-step movement is
      // deliberately slow enough that offense can still corner or chase it.
      if (move.lengthSq() > 0.001) {
        move.normalize();
        this.p1.position.addScaledVector(move, FIXED_STEP * moveSpeed * 0.42);
      }
      this.p1.state = "GUARD";
    } else if (move.lengthSq() > 0.001) {
      move.normalize();
      this.p1.position.addScaledVector(move, FIXED_STEP * moveSpeed);
      this.p1.state = "WALK";
    } else {
      this.p1.state = "IDLE";
    }

    const punchPressed = this.p1.justPressed("punch");
    const kickPressed = this.p1.justPressed("kick");
    const guardPressed = this.p1.justPressed("guard");
    const throwPressed = input.guard && input.kick && (guardPressed || kickPressed);
    const counterPressed = input.guard && input.punch && (guardPressed || punchPressed);
    if (throwPressed) this.p1.beginMove("throw");
    else if (counterPressed) this.p1.beginMove("counter");
    else if (input.punch && input.kick && (punchPressed || kickPressed)) this.p1.beginMove("power");
    else if (punchPressed) this.p1.beginMove(forwardAxis > 0 ? "straight" : "jab");
    else if (kickPressed) this.p1.beginMove(sideAxis !== 0 ? "dashKick" : "kick");

    this.p1.updatePhysics(FIXED_STEP);
  }

  private updateEnemy(): void {
    this.p2.setInput(EMPTY_INPUT);
    if (this.advanceLockedState(this.p2)) return;

    this.enemyCooldown -= 1;
    if (this.enemyOpeningGraceTicks > 0) this.enemyOpeningGraceTicks -= 1;
    this.enemyTacticTicks -= 1;
    if (this.enemyTacticTicks <= 0) {
      const slot = Math.floor(this.simulationTicks / ENEMY_TACTIC_INTERVAL);
      const healthPressure = this.p2.health < this.p1.health ? 1 : 0;
      const tacticIndex = (slot + healthPressure + (this.difficulty === "HARD" ? 1 : 0)) % 3;
      this.enemyTactic = tacticIndex === 0 ? "PRESSURE" : tacticIndex === 1 ? "ORBIT" : "BAIT";
      this.enemyOrbitSign = (slot + (this.difficulty === "EASY" ? 1 : 0)) % 2 === 0 ? 1 : -1;
      this.enemyTacticTicks = this.difficulty === "HARD" ? 56 : this.difficulty === "EASY" ? 90 : ENEMY_TACTIC_INTERVAL;
    }

    const towardPlayer = horizontalDirection(this.p2.position, this.p1.position);
    const distance = this.p2.position.distanceTo(this.p1.position);
    const tangent = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x);
    const movement = new THREE.Vector3();
    const desiredDistance = this.enemyTactic === "PRESSURE" ? 1.48 : this.enemyTactic === "BAIT" ? 2.25 : 1.82;
    const orbitStrength = this.enemyTactic === "ORBIT" ? 0.66 : this.enemyTactic === "BAIT" ? 0.34 : 0.22;

    if (distance > desiredDistance + 0.18) movement.add(towardPlayer);
    else if (distance < desiredDistance - 0.24) movement.addScaledVector(towardPlayer, -1);
    movement.addScaledVector(tangent, this.enemyOrbitSign * orbitStrength);

    const playerThreat = this.p1.state === "ATTACK" && this.p1.currentMove && distance < this.p1.currentMove.reach + 0.9;
    const playerGuarding = this.p1.state === "GUARD";
    const reactionLead = this.difficulty === "HARD" ? 4 : this.difficulty === "NORMAL" ? 2 : 0;
    const guardGate = this.difficulty === "EASY" ? 0.55 : this.difficulty === "HARD" ? -0.6 : -0.1;
    const shouldGuard = Boolean(
      playerThreat
      && this.p1.moveTick >= Math.max(0, (this.p1.currentMove?.startup ?? 8) - reactionLead)
      && Math.sin(this.simulationTicks * 0.41) > guardGate
    );

    if (shouldGuard) {
      this.p2.state = "GUARD";
    } else if (this.enemyOpeningGraceTicks <= 0 && this.enemyCooldown <= 0 && distance < (this.enemyTactic === "BAIT" ? 1.82 : 2.12)) {
      const selector = (Math.floor(this.simulationTicks / 17) + (this.enemyTactic === "PRESSURE" ? 1 : 0)) % 5;
      const punishGuard = playerGuarding && distance < 1.42;
      const punishRecovery = this.difficulty !== "EASY"
        && this.p1.state === "ATTACK"
        && Boolean(this.p1.currentMove)
        && this.p1.moveTick > (this.p1.currentMove?.startup ?? 0) + (this.p1.currentMove?.active ?? 0);
      const moveId = punishGuard
        ? "throw"
        : punishRecovery
          ? "straight"
          : selector === 0
            ? "power"
            : selector <= 2
              ? "jab"
              : "kick";
      this.p2.beginMove(moveId);
      const difficultyScale = this.difficulty === "HARD" ? 0.72 : this.difficulty === "EASY" ? 1.3 : 1;
      const baseCooldown = moveId === "throw" ? 72 : moveId === "power" ? 92 : moveId === "straight" ? 64 : 58;
      this.enemyCooldown = Math.round(baseCooldown * difficultyScale);
    } else if (movement.lengthSq() > 0.001) {
      movement.normalize();
      const baseSpeed = this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;
      const difficultySpeed = this.difficulty === "HARD" ? 1.08 : this.difficulty === "EASY" ? 0.9 : 1;
      this.p2.position.addScaledVector(movement, FIXED_STEP * baseSpeed * difficultySpeed);
      this.p2.state = "WALK";
    } else {
      this.p2.state = "IDLE";
    }

    this.p2.updatePhysics(FIXED_STEP);
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

  private resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void {
    const move = attacker.currentMove;
    if (attacker.state !== "ATTACK" || !move || !attacker.isActive() || attacker.hitTargets.has(defender.id)) return;
    // The opening frames of a guard-side quickstep evade strikes, while throws
    // still catch the movement. This gives TPS lateral movement a real timing
    // purpose without changing the shared deterministic move definitions.
    if (defender === this.p1 && this.playerEvadeTicks > 3 && move.hitLevel !== "THROW") return;
    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);
    if (distance > move.reach + 0.72) return;

    attacker.hitTargets.add(defender.id);
    const blocked = defenderGuarding && move.hitLevel !== "THROW";
    const direction = horizontalDirection(attacker.position, defender.position);
    const impactPosition = attacker.position.clone().lerp(defender.position, 0.55);
    impactPosition.y = move.hitLevel === "LOW" ? 0.55 : 1.35;

    if (blocked) {
      defender.receiveBlock(move.guardDamage, move.blockStun, move.hitStop);
      defender.velocity.x = direction.x * move.knockback * 5;
      defender.velocity.z = direction.z * move.knockback * 5;
    } else {
      defender.receiveDamage(move.damage, move.hitStun, move.knockback, direction.x >= 0 ? 1 : -1, Boolean(move.knockdown), move.hitStop);
      const knockback = move.knockback * 18;
      defender.velocity.x = direction.x * knockback;
      defender.velocity.z = direction.z * knockback;
    }

    const event: HitEvent = {
      attacker: attacker.id,
      defender: defender.id,
      move,
      blocked,
      counter: defender.state === "ATTACK",
      throwEscape: false,
      damage: blocked ? 0 : move.damage,
      position: { x: impactPosition.x, y: impactPosition.y, z: impactPosition.z },
    };
    this.effects.hit(event);
    this.graphics.hit(event, this.camera);
    this.audio.impact(event);
    if (!blocked && this.settings.get().vibration && attacker.id === "p1") navigator.vibrate?.(move.power > 1.45 ? 22 : 9);
  }

  private applyAttackStepIn(attacker: FighterRuntime, defender: FighterRuntime): void {
    const move = attacker.currentMove;
    if (attacker.state !== "ATTACK" || !move || attacker.moveTick > move.startup) return;
    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);
    const desiredContact = Math.max(1.02, move.reach + 0.52);
    if (distance <= desiredContact || distance > desiredContact + 0.72) return;
    const remaining = distance - desiredContact;
    const stepDistance = Math.min(remaining, 0.038 + move.power * 0.014);
    attacker.position.addScaledVector(horizontalDirection(attacker.position, defender.position), stepDistance);
  }

  private separateFighters(): void {
    const delta = new THREE.Vector3(this.p2.position.x - this.p1.position.x, 0, this.p2.position.z - this.p1.position.z);
    const distance = delta.length();
    const minimum = 0.92;
    if (distance >= minimum || distance < 1e-5) return;
    const correction = delta.normalize().multiplyScalar((minimum - distance) * 0.5);
    this.p1.position.addScaledVector(correction, -1);
    this.p2.position.add(correction);
  }

  private updateVisual(fighter: FighterRuntime, opponent: FighterRuntime, time: number): void {
    fighter.facing = opponent.position.x >= fighter.position.x ? 1 : -1;
    this.animation.update(fighter, opponent, time);
    // The shared 1v1 attack aura is intentionally large and reads well from
    // the side camera, but in shoulder-view TPS it becomes a full-screen
    // translucent slab at contact. Keep particles/flash impacts and suppress
    // only that presentation aura in this mode.
    fighter.visual.aura.visible = false;
    const forward = horizontalDirection(fighter.position, opponent.position);
    fighter.visual.root.quaternion.setFromUnitVectors(MODEL_FORWARD, forward);
    fighter.visual.root.updateMatrixWorld(true);
  }

  private updateCamera(delta: number): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const fightDistance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const closeFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);
    const compactLandscapeFactor = THREE.MathUtils.clamp((2.45 - this.camera.aspect) / 0.45, 0, 1);
    // Open a screen-space lane to the opponent at contact by widening laterally.
    // Compact iPhone landscape gets extra shoulder separation because the player
    // silhouette otherwise covers the opponent at melee distance.
    const backDistance = 4.85 - closeFactor * 0.45 + compactLandscapeFactor * 0.30;
    const shoulderOffset = 2.2 + closeFactor * 1.25 + compactLandscapeFactor * (0.55 + closeFactor * 0.55);
    const cameraHeight = 2.28 + closeFactor * 0.17 + compactLandscapeFactor * 0.04;
    this.cameraTarget.copy(this.p2.position)
      .addScaledVector(right, -0.28 * closeFactor)
      .add(new THREE.Vector3(0, 1.16 + closeFactor * 0.04, 0));
    this.cameraDesired.copy(this.p1.position)
      .addScaledVector(forward, -backDistance)
      .addScaledVector(right, shoulderOffset)
      .add(new THREE.Vector3(0, cameraHeight, 0));
    ease(this.camera.position, this.cameraDesired, 12.2, delta);
    if (this.cameraImpact > 0.001) {
      const impact = this.cameraImpact;
      this.cameraImpact *= Math.exp(-10 * delta);
      this.camera.position.addScaledVector(right, Math.sin(this.renderTime * 76) * impact);
      this.camera.position.y += Math.cos(this.renderTime * 91) * impact * 0.36;
    }
    this.camera.lookAt(this.cameraTarget);
  }

  private updateLockOn(): void {
    this.p2.visual.root.updateMatrixWorld(true);
    const target = this.p2.visual.root.localToWorld(new THREE.Vector3(0, this.p2.visual.layout.ribY + 0.04, 0));
    const distance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const threat = this.p2.state === "ATTACK";
    const inStrikeRange = distance < TPS_STRIKE_RANGE;
    const lockColor = threat ? 0xff667f : inStrikeRange ? 0xffd45c : 0x7ce8ff;
    this.lockRing.material.color.setHex(lockColor);
    this.lockStem.material.color.setHex(lockColor);
    this.targetGroundRing.material.color.setHex(lockColor);
    this.lockRing.position.copy(target);
    this.lockRing.lookAt(this.camera.position);
    const pulseRate = threat ? 11.5 : 5.5;
    const pulse = (threat ? 1.04 : inStrikeRange ? 0.96 : 0.9) + Math.sin(this.renderTime * pulseRate) * 0.055;
    this.lockRing.scale.setScalar(pulse);
    this.lockStem.position.copy(target).add(new THREE.Vector3(0, -0.30, 0));
    this.lockStem.lookAt(this.camera.position);
    this.targetGroundRing.position.set(this.p2.position.x, 0.035, this.p2.position.z);
    const groundPulse = 0.95 + Math.sin(this.renderTime * pulseRate) * 0.06;
    this.targetGroundRing.scale.setScalar(groundPulse);
    this.targetGroundRing.material.opacity = threat ? 0.58 : inStrikeRange ? 0.46 : 0.28;
  }

  private checkFinish(): void {
    if (this.finished) return;
    if (this.p1.health > 0 && this.p2.health > 0 && this.timerTicks > 0) return;
    this.finished = true;
    this.input.clear();
    const winner = this.p1.health === this.p2.health ? "draw" : this.p1.health > this.p2.health ? "p1" : "p2";
    this.resultWinner = winner;
    this.publishHud(true);
    this.audio.ko();
    window.setTimeout(() => this.options.onResult?.(winner), 520);
  }

  private resetRound(): void {
    this.p1.resetForRound(0, 3.2, 1);
    this.p2.resetForRound(0, -2.2, -1);
    this.enemyCooldown = 52;
    this.enemyOpeningGraceTicks = 132;
    this.enemyTactic = "ORBIT";
    this.enemyTacticTicks = 0;
    this.enemyOrbitSign = 1;
    this.playerEvadeTicks = 0;
    this.playerEvadeCooldown = 0;
    this.playerEvadeSign = 0;
    this.simulationTicks = 0;
    this.cameraImpact = 0;
    this.timerTicks = ROUND_TICKS;
    this.resultWinner = null;
    this.graphics.reset();
    this.updateVisual(this.p1, this.p2, 0);
    this.updateVisual(this.p2, this.p1, 0.23);
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.camera.position.copy(this.p1.position)
      .addScaledVector(forward, -4.85)
      .addScaledVector(right, 2.2)
      .add(new THREE.Vector3(0, 2.28, 0));
    this.updateCamera(1);
    this.updateLockOn();
  }

  private publishHud(force: boolean): void {
    if (!force && this.timerTicks % 4 !== 0) return;
    if (!force && this.lastHudTick === this.timerTicks) return;
    this.lastHudTick = this.timerTicks;
    const snapshot: HudSnapshot = {
      phase: "MATCH",
      round: 1,
      timer: Math.ceil(this.timerTicks / 60),
      p1Health: this.p1.health,
      p2Health: this.p2.health,
      p1Wins: this.resultWinner === "p1" ? 1 : 0,
      p2Wins: this.resultWinner === "p2" ? 1 : 0,
      p1Name: this.p1.definition.name,
      p2Name: this.p2.definition.name,
      message: this.finished
        ? "BATTLE COMPLETE"
        : this.enemyOpeningGraceTicks > 0
          ? "READ THE TARGET"
          : this.p2.state === "ATTACK"
          ? "INCOMING"
          : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE
            ? "STRIKE RANGE"
            : "TARGET LOCKED",
      p1State: this.p1.state,
      p2State: this.p2.state,
    };
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
    this.graphics.dispose();
    this.effects.dispose();
    disposeFighterVisual(this.p1.visual);
    disposeFighterVisual(this.p2.visual);
    this.arenaDisposables.forEach((value) => value.dispose());
    this.renderer.dispose();
    this.mount.replaceChildren();
  }
}
