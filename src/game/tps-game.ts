import * as THREE from "three";
import { AudioManager } from "./audio";
import { EffectsManager } from "./effects";
import { FighterRuntime } from "./fighter";
import { FixedStepClock } from "./fixed";
import { InputSystem } from "./input";
import { PresentationAnimationController } from "./presentation-animation";
import { SettingsManager } from "./settings";
import { createFighterVisual, disposeFighterVisual } from "./visual-entry";
import type { FighterModelId } from "./model-skins";
import type { FighterDefinition, HitEvent, HudSnapshot, InputAction, InputFrame, MoveDefinition } from "./types";
import { EMPTY_INPUT } from "./types";

export interface TpsFightGameOptions {
  p1Definition: FighterDefinition;
  p2Definition: FighterDefinition;
  p1Model?: FighterModelId;
  p2Model?: FighterModelId;
  difficulty?: unknown;
  onHud?: (snapshot: HudSnapshot) => void;
  onResult?: (winner: "p1" | "p2" | "draw") => void;
  onFallback?: (message: string) => void;
}

const ARENA_RADIUS = 6.8;
const FIXED_STEP = 1 / 60;
const ROUND_TICKS = 99 * 60;
const UP = new THREE.Vector3(0, 1, 0);
const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);

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
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x09182b, roughness: 0.88, metalness: 0.12 });
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

  const pillarGeometry = new THREE.CylinderGeometry(0.13, 0.2, 2.2, 8);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x102844, emissive: 0x06294b, emissiveIntensity: 0.5, roughness: 0.7 });
  disposables.push(pillarGeometry, pillarMaterial);
  for (let index = 0; index < 16; index += 1) {
    const angle = index * Math.PI / 8;
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(Math.cos(angle) * (ARENA_RADIUS + 0.42), 1.1, Math.sin(angle) * (ARENA_RADIUS + 0.42));
    group.add(pillar);
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

  private readonly mount: HTMLElement;
  private readonly options: TpsFightGameOptions;
  private readonly clock = new FixedStepClock(FIXED_STEP);
  private readonly arenaDisposables: Array<THREE.BufferGeometry | THREE.Material>;
  private readonly lockRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly lockStem: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly visibilityHandler: () => void;
  private raf = 0;
  private running = false;
  private paused = false;
  private lastTime = 0;
  private renderTime = 0;
  private timerTicks = ROUND_TICKS;
  private enemyCooldown = 48;
  private finished = false;
  private lastHudTick = -1;
  private runtimeFailureReported = false;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();

  constructor(mount: HTMLElement, options: TpsFightGameOptions) {
    this.mount = mount;
    this.options = options;
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
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
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

    this.p1 = new FighterRuntime("p1", options.p1Definition, false, createFighterVisual(options.p1Definition, settings.quality, options.p1Model ?? "ORIGINAL"));
    this.p2 = new FighterRuntime("p2", options.p2Definition, true, createFighterVisual(options.p2Definition, settings.quality, options.p2Model ?? "ORIGINAL"));
    this.scene.add(this.p1.visual.root, this.p2.visual.root);

    const lockGeometry = new THREE.TorusGeometry(0.62, 0.025, 8, 48);
    const lockMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.92, depthTest: false });
    this.lockRing = new THREE.Mesh(lockGeometry, lockMaterial);
    this.lockRing.renderOrder = 20;
    this.scene.add(this.lockRing);
    this.arenaDisposables.push(lockGeometry, lockMaterial);

    const stemGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.34, 0)]);
    const stemMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.72, depthTest: false });
    this.lockStem = new THREE.Line(stemGeometry, stemMaterial);
    this.lockStem.renderOrder = 20;
    this.scene.add(this.lockStem);
    this.arenaDisposables.push(stemGeometry, stemMaterial);

    this.effects.onShake = () => undefined;
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
    this.camera.aspect = width / height;
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
    this.timerTicks = Math.max(0, this.timerTicks - 1);
    const input = this.input.frame();
    this.updatePlayer(input);
    this.updateEnemy();
    this.resolveAttack(this.p1, this.p2, input.guard);
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

    if (input.guard) {
      this.p1.state = "GUARD";
    } else if (move.lengthSq() > 0.001) {
      move.normalize();
      const speed = this.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;
      this.p1.position.addScaledVector(move, FIXED_STEP * speed);
      this.p1.state = "WALK";
    } else {
      this.p1.state = "IDLE";
    }

    const punchPressed = this.p1.justPressed("punch");
    const kickPressed = this.p1.justPressed("kick");
    if (input.punch && input.kick && (punchPressed || kickPressed)) this.p1.beginMove("power");
    else if (punchPressed) this.p1.beginMove(forwardAxis > 0 ? "straight" : "jab");
    else if (kickPressed) this.p1.beginMove(sideAxis !== 0 ? "dashKick" : "kick");

    this.p1.updatePhysics(FIXED_STEP);
  }

  private updateEnemy(): void {
    this.p2.setInput(EMPTY_INPUT);
    if (this.advanceLockedState(this.p2)) return;

    this.enemyCooldown -= 1;
    const towardPlayer = horizontalDirection(this.p2.position, this.p1.position);
    const distance = this.p2.position.distanceTo(this.p1.position);
    const tangent = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x);
    const orbitSign = Math.sin(this.renderTime * 0.72) >= 0 ? 1 : -1;
    const movement = new THREE.Vector3();

    if (distance > 2.55) movement.add(towardPlayer);
    else if (distance < 1.45) movement.addScaledVector(towardPlayer, -0.9);
    movement.addScaledVector(tangent, orbitSign * 0.58);

    const playerThreat = this.p1.state === "ATTACK" && this.p1.currentMove && distance < this.p1.currentMove.reach + 0.85;
    const shouldGuard = Boolean(playerThreat && this.p1.moveTick >= Math.max(0, (this.p1.currentMove?.startup ?? 8) - 2) && Math.sin(this.renderTime * 7.1) > -0.15);

    if (shouldGuard) {
      this.p2.state = "GUARD";
    } else if (this.enemyCooldown <= 0 && distance < 2.3) {
      const selector = Math.floor(this.renderTime * 3.7) % 5;
      this.p2.beginMove(selector === 0 ? "power" : selector <= 2 ? "jab" : "kick");
      this.enemyCooldown = selector === 0 ? 92 : 58;
    } else if (movement.lengthSq() > 0.001) {
      movement.normalize();
      const speed = this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;
      this.p2.position.addScaledVector(movement, FIXED_STEP * speed);
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
    this.audio.impact(event);
    if (!blocked && this.settings.get().vibration && attacker.id === "p1") navigator.vibrate?.(move.power > 1.45 ? 22 : 9);
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
    const forward = horizontalDirection(fighter.position, opponent.position);
    fighter.visual.root.quaternion.setFromUnitVectors(MODEL_FORWARD, forward);
    fighter.visual.root.updateMatrixWorld(true);
  }

  private updateCamera(delta: number): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.cameraTarget.copy(this.p1.position).addScaledVector(forward, 1.7).add(new THREE.Vector3(0, 1.16, 0));
    this.cameraDesired.copy(this.p1.position)
      .addScaledVector(forward, -4.75)
      .addScaledVector(right, 0.58)
      .add(new THREE.Vector3(0, 2.65, 0));
    ease(this.camera.position, this.cameraDesired, 9.5, delta);
    this.camera.lookAt(this.cameraTarget);
  }

  private updateLockOn(): void {
    const target = this.p2.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    this.lockRing.position.copy(target);
    this.lockRing.lookAt(this.camera.position);
    const pulse = 1 + Math.sin(this.renderTime * 5.5) * 0.055;
    this.lockRing.scale.setScalar(pulse);
    this.lockStem.position.copy(target).add(new THREE.Vector3(0, -0.72, 0));
    this.lockStem.lookAt(this.camera.position);
  }

  private checkFinish(): void {
    if (this.finished) return;
    if (this.p1.health > 0 && this.p2.health > 0 && this.timerTicks > 0) return;
    this.finished = true;
    this.input.clear();
    const winner = this.p1.health === this.p2.health ? "draw" : this.p1.health > this.p2.health ? "p1" : "p2";
    this.audio.ko();
    window.setTimeout(() => this.options.onResult?.(winner), 520);
  }

  private resetRound(): void {
    this.p1.resetForRound(0, 3.2, 1);
    this.p2.resetForRound(0, -2.2, -1);
    this.enemyCooldown = 52;
    this.timerTicks = ROUND_TICKS;
    this.updateVisual(this.p1, this.p2, 0);
    this.updateVisual(this.p2, this.p1, 0.23);
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    this.camera.position.copy(this.p1.position).addScaledVector(forward, -4.75).add(new THREE.Vector3(0.6, 2.65, 0));
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
      p1Wins: 0,
      p2Wins: 0,
      p1Name: this.p1.definition.name,
      p2Name: this.p2.definition.name,
      message: this.finished ? "BATTLE COMPLETE" : "TARGET LOCKED",
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
    this.effects.dispose();
    disposeFighterVisual(this.p1.visual);
    disposeFighterVisual(this.p2.visual);
    this.arenaDisposables.forEach((value) => value.dispose());
    this.renderer.dispose();
    this.mount.replaceChildren();
  }
}
