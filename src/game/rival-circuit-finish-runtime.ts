import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import {
  RIVAL_CIRCUIT_FINISH_CHORD_TICKS,
  rivalCircuitFinishChordReady,
  rivalCircuitFinishMoveForArchetype,
  rivalCircuitFinishPursuitDistance,
  rivalCircuitFinishWindowOpen,
  type RivalCircuitFinishMoveId,
} from "./rival-circuit-finish";
import { TpsFightGame } from "./tps-game";
import type { InputFrame } from "./types";

const FIXED_STEP = 1 / 60;
const FINISH_HIT_HOLD_SECONDS = 1.02;

type FinishPhase = "NONE" | "READY" | "COMMIT" | "HIT";
type PendingAction = "punch" | "guard" | null;

type FinishRuntime = {
  p1: FighterRuntime;
  p2: FighterRuntime;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  simulationTicks: number;
  playerEvadeTicks: number;
  playerStepAttackQueued: boolean;
  playerAttackQueued: boolean;
  playerComboStage: number;
  playerComboGraceTicks: number;
  playerFlankAttackTicks: number;
  playerInterceptTicks: number;
  playerReversalTicks: number;
  enemyCooldown: number;
  enemyDirectorPendingMove: string | null;
  enemyDirectorTelegraphTicks: number;
  enemyDirectorTelegraphTotalTicks: number;
  setCombatBeat(label: string, ticks?: number): void;
  __finalImpactSeconds?: number;
};

type FinishBurst = {
  group: THREE.Group;
  rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  seconds: number;
};

type FinishState = {
  roundSerial: number;
  consumed: boolean;
  active: boolean;
  readyAnnounced: boolean;
  phase: FinishPhase;
  moveId: RivalCircuitFinishMoveId | null;
  lastAttackTick: number;
  lastStepTick: number;
  prevAttackHeld: boolean;
  prevStepHeld: boolean;
  pendingAction: PendingAction;
  pendingTick: number;
  activations: number;
  burst: FinishBurst | null;
};

const states = new WeakMap<object, FinishState>();
let installed = false;

function stateFor(game: object): FinishState {
  let state = states.get(game);
  if (state) return state;
  state = {
    roundSerial: 0,
    consumed: false,
    active: false,
    readyAnnounced: false,
    phase: "NONE",
    moveId: null,
    lastAttackTick: -9999,
    lastStepTick: -9999,
    prevAttackHeld: false,
    prevStepHeld: false,
    pendingAction: null,
    pendingTick: -9999,
    activations: 0,
    burst: null,
  };
  states.set(game, state);
  return state;
}

export function rivalCircuitFinishStageFromLabel(label: string): number {
  const match = label.toUpperCase().match(/(?:CIRCUIT|STAGE)\s+(\d+)\s*\/\s*5/);
  const value = Number(match?.[1] ?? 0);
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : 0;
}

function stageFromDom(): number {
  if (typeof document === "undefined") return 0;
  const strip = document.querySelector<HTMLElement>(".circuit-run-strip");
  return rivalCircuitFinishStageFromLabel(strip?.textContent ?? "");
}

function clearDomDiagnostics(): void {
  if (typeof document === "undefined") return;
  delete document.body.dataset.rivalCircuitFinishPolicy;
  delete document.body.dataset.rivalCircuitFinishReady;
  delete document.body.dataset.rivalCircuitFinishPhase;
  delete document.body.dataset.rivalCircuitFinishMove;
  delete document.body.dataset.rivalCircuitFinishStage;
  delete document.body.dataset.rivalCircuitFinishHealth;
  delete document.body.dataset.rivalCircuitFinishActivations;
}

function publishDomDiagnostics(
  stage: number,
  game: FinishRuntime,
  state: FinishState,
  ready: boolean,
): void {
  if (typeof document === "undefined") return;
  if (stage <= 0) {
    clearDomDiagnostics();
    return;
  }
  document.body.dataset.rivalCircuitFinishPolicy = "CIRCUIT_FINISH_V1";
  document.body.dataset.rivalCircuitFinishReady = ready ? "1" : "0";
  document.body.dataset.rivalCircuitFinishPhase = state.phase;
  document.body.dataset.rivalCircuitFinishMove = state.moveId ?? rivalCircuitFinishMoveForArchetype(game.p1.definition.archetype);
  document.body.dataset.rivalCircuitFinishStage = String(stage);
  document.body.dataset.rivalCircuitFinishHealth = String(game.p2.health);
  document.body.dataset.rivalCircuitFinishActivations = String(state.activations);
}

function applyWebDriverAuditHealth(game: FinishRuntime): void {
  if (typeof document === "undefined" || typeof navigator === "undefined" || !navigator.webdriver) return;
  const raw = Number(document.body.dataset.rivalCircuitFinishAuditHealth ?? "");
  if (!Number.isFinite(raw) || raw <= 0 || raw > 100) return;
  game.p2.health = Math.min(game.p2.health, raw);
}

function distanceBetween(game: FinishRuntime): number {
  return Math.hypot(
    game.p2.position.x - game.p1.position.x,
    game.p2.position.z - game.p1.position.z,
  );
}

function finishWindowOpen(stage: number, game: FinishRuntime, state: FinishState): boolean {
  return rivalCircuitFinishWindowOpen({
    stage,
    defenderHealth: game.p2.health,
    defenderState: game.p2.state,
    distance: distanceBetween(game),
    consumed: state.consumed,
  });
}

function sanitizeChordInput(input: InputFrame): InputFrame {
  return { ...input, punch: false, guard: false };
}

function replayPendingInput(input: InputFrame, pending: Exclude<PendingAction, null>): InputFrame {
  return {
    ...input,
    punch: pending === "punch",
    guard: pending === "guard",
  };
}

function clearCombatQueues(game: FinishRuntime): void {
  game.playerEvadeTicks = 0;
  game.playerStepAttackQueued = false;
  game.playerAttackQueued = false;
  game.playerComboStage = 0;
  game.playerComboGraceTicks = 0;
  game.playerFlankAttackTicks = 0;
  game.playerInterceptTicks = 0;
  game.playerReversalTicks = 0;
}

function beginFinish(game: FinishRuntime, state: FinishState, input: InputFrame, stage: number): boolean {
  if (!game.p1.canAct()) return false;
  const moveId = rivalCircuitFinishMoveForArchetype(game.p1.definition.archetype);
  const move = game.p1.definition.moves[moveId];
  if (!move) return false;

  clearCombatQueues(game);
  const dx = game.p2.position.x - game.p1.position.x;
  const dz = game.p2.position.z - game.p1.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 1e-6) {
    const pursuit = rivalCircuitFinishPursuitDistance(distance);
    game.p1.position.x += (dx / distance) * pursuit;
    game.p1.position.z += (dz / distance) * pursuit;
  }

  if (!game.p1.beginMove(moveId)) return false;
  game.p1.setInput(input);
  game.p1.updatePhysics(FIXED_STEP);

  // The chord is an authored execution state, not a third normal attack input.
  // Freeze the rival through the finisher startup so the critical-health reward
  // cannot be interrupted by an already queued CPU strike.
  game.enemyDirectorPendingMove = null;
  game.enemyDirectorTelegraphTicks = 0;
  game.enemyDirectorTelegraphTotalTicks = 0;
  game.enemyCooldown = Math.max(game.enemyCooldown, move.startup + 12);
  game.p2.hitStop = Math.max(game.p2.hitStop, move.startup + 2);

  state.pendingAction = null;
  state.pendingTick = -9999;
  state.consumed = true;
  state.active = true;
  state.phase = "COMMIT";
  state.moveId = moveId;
  state.activations += 1;

  const data = game.p1.visual.root.userData;
  data.tpsRivalCircuitFinish = true;
  data.tpsRivalCircuitFinishMove = moveId;
  data.tpsRivalCircuitFinishStage = stage;
  data.tpsRivalCircuitFinishActivation = state.activations;
  game.p2.visual.root.userData.tpsRivalCircuitFinishTarget = true;
  game.camera.userData.tpsRivalCircuitFinishPhase = "COMMIT";
  game.setCombatBeat(`FINISH // ${move.label.toUpperCase()}`, 42);
  publishDomDiagnostics(stage, game, state, false);
  return true;
}

function disposeBurst(state: FinishState): void {
  if (!state.burst) return;
  state.burst.group.removeFromParent();
  for (const geometry of state.burst.geometries) geometry.dispose();
  for (const material of state.burst.materials) material.dispose();
  state.burst = null;
}

function createFinishBurst(game: FinishRuntime, state: FinishState): void {
  disposeBurst(state);
  const group = new THREE.Group();
  group.name = "rival-circuit-finish-burst";
  const color = game.p1.definition.colors.glow;
  const rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  for (let index = 0; index < 3; index += 1) {
    const geometry = new THREE.TorusGeometry(0.22 + index * 0.055, 0.018 - index * 0.003, 6, 36);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.82 - index * 0.15,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.set(Math.PI / 2 + index * 0.23, index * 0.44, index * 0.32);
    group.add(ring);
    rings.push(ring);
    geometries.push(geometry);
    materials.push(material);
  }
  const midpoint = game.p1.position.clone().lerp(game.p2.position, 0.55);
  midpoint.y = state.moveId === "risingKick" ? 1.72 : 1.34;
  group.position.copy(midpoint);
  game.scene.add(group);
  state.burst = { group, rings, geometries, materials, seconds: 0.72 };
}

function updateFinishBurst(state: FinishState, delta: number): void {
  const burst = state.burst;
  if (!burst) return;
  burst.seconds = Math.max(0, burst.seconds - delta);
  const life = burst.seconds / 0.72;
  const progress = 1 - life;
  burst.group.scale.setScalar(1 + progress * 3.1);
  burst.group.rotation.y += delta * 2.8;
  burst.rings.forEach((ring, index) => {
    ring.rotation.z += delta * (1.8 + index * 0.75);
    ring.material.opacity = Math.max(0, (0.82 - index * 0.15) * life * life);
  });
  if (burst.seconds <= 0) disposeBurst(state);
}

function resetRoundState(game: FinishRuntime, state: FinishState): void {
  disposeBurst(state);
  state.roundSerial += 1;
  state.consumed = false;
  state.active = false;
  state.readyAnnounced = false;
  state.phase = "NONE";
  state.moveId = null;
  state.lastAttackTick = -9999;
  state.lastStepTick = -9999;
  state.prevAttackHeld = false;
  state.prevStepHeld = false;
  state.pendingAction = null;
  state.pendingTick = -9999;
  game.camera.userData.tpsRivalCircuitFinishPhase = null;
  game.p1.visual.root.userData.tpsRivalCircuitFinish = false;
  game.p2.visual.root.userData.tpsRivalCircuitFinishTarget = false;
}

export function installRivalCircuitFinishRuntime(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype as unknown as {
    updatePlayer(input: InputFrame): void;
    resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void;
    updateCamera(delta: number): void;
    resetRound(): void;
    destroy(): void;
  };
  const baseUpdatePlayer = prototype.updatePlayer;
  const baseResolveAttack = prototype.resolveAttack;
  const baseUpdateCamera = prototype.updateCamera;
  const baseResetRound = prototype.resetRound;
  const baseDestroy = prototype.destroy;

  prototype.updatePlayer = function updatePlayerWithCircuitFinish(input: InputFrame): void {
    const game = this as unknown as FinishRuntime;
    const state = stateFor(this as unknown as object);
    const stage = stageFromDom();
    applyWebDriverAuditHealth(game);

    const attackEdge = input.punch && !state.prevAttackHeld;
    const stepEdge = input.guard && !state.prevStepHeld;
    state.prevAttackHeld = input.punch;
    state.prevStepHeld = input.guard;
    if (attackEdge) state.lastAttackTick = game.simulationTicks;
    if (stepEdge) state.lastStepTick = game.simulationTicks;

    if (stage <= 0) {
      state.pendingAction = null;
      state.phase = "NONE";
      publishDomDiagnostics(0, game, state, false);
      baseUpdatePlayer.call(this, input);
      return;
    }

    const ready = finishWindowOpen(stage, game, state);
    if (ready && !state.readyAnnounced) {
      state.readyAnnounced = true;
      state.phase = "READY";
      game.setCombatBeat("FINISH READY // ATTACK + STEP", 34);
    } else if (ready && state.phase === "NONE") {
      state.phase = "READY";
    } else if (!ready && !state.active && state.phase === "READY") {
      state.phase = "NONE";
    }
    publishDomDiagnostics(stage, game, state, ready);

    const directChord = ready && input.punch && input.guard && (attackEdge || stepEdge);
    const bufferedChord = ready && rivalCircuitFinishChordReady(
      state.lastAttackTick,
      state.lastStepTick,
      game.simulationTicks,
    );
    if ((directChord || bufferedChord) && game.p1.canAct()) {
      if (beginFinish(game, state, input, stage)) return;
    }

    // While the opponent is in the FINISH window, delay a lone ATTACK or STEP
    // by at most three simulation ticks. That tiny buffer lets two independent
    // iPhone touch pointers form a reliable chord without adding a third button.
    if (ready && game.p1.canAct()) {
      if (!state.pendingAction && (attackEdge !== stepEdge)) {
        state.pendingAction = attackEdge ? "punch" : "guard";
        state.pendingTick = game.simulationTicks;
      }
      if (state.pendingAction) {
        const pendingAge = game.simulationTicks - state.pendingTick;
        if (pendingAge < RIVAL_CIRCUIT_FINISH_CHORD_TICKS) {
          baseUpdatePlayer.call(this, sanitizeChordInput(input));
          return;
        }
        const pending = state.pendingAction;
        state.pendingAction = null;
        state.pendingTick = -9999;
        baseUpdatePlayer.call(this, replayPendingInput(input, pending));
        return;
      }
    } else if (state.pendingAction) {
      const pending = state.pendingAction;
      state.pendingAction = null;
      state.pendingTick = -9999;
      baseUpdatePlayer.call(this, replayPendingInput(input, pending));
      return;
    }

    baseUpdatePlayer.call(this, input);
  };

  prototype.resolveAttack = function resolveAttackWithCircuitFinish(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    defenderGuarding: boolean,
  ): void {
    const game = this as unknown as FinishRuntime;
    const state = stateFor(this as unknown as object);
    const finisherContact = state.active
      && attacker === game.p1
      && defender === game.p2
      && Boolean(state.moveId)
      && attacker.currentMove?.id === state.moveId;
    const beforeHealth = defender.health;
    baseResolveAttack.call(this, attacker, defender, finisherContact ? false : defenderGuarding);
    if (!finisherContact || defender.health >= beforeHealth || !attacker.hitTargets.has(defender.id)) return;

    state.active = false;
    state.phase = defender.health <= 0 ? "HIT" : "COMMIT";
    attacker.visual.root.userData.tpsRivalCircuitFinishConnected = true;
    defender.visual.root.userData.tpsRivalCircuitFinishReceived = true;
    game.camera.userData.tpsRivalCircuitFinishPhase = state.phase;
    if (defender.health <= 0) {
      game.__finalImpactSeconds = Math.max(game.__finalImpactSeconds ?? 0, FINISH_HIT_HOLD_SECONDS);
      game.camera.userData.tpsRivalCircuitFinishMove = state.moveId;
      game.camera.userData.tpsRivalCircuitFinishHold = FINISH_HIT_HOLD_SECONDS;
      game.setCombatBeat("CIRCUIT FINISH", 72);
      createFinishBurst(game, state);
    }
    publishDomDiagnostics(stageFromDom(), game, state, false);
  };

  prototype.updateCamera = function updateCameraWithCircuitFinish(delta: number): void {
    baseUpdateCamera.call(this, delta);
    const game = this as unknown as FinishRuntime;
    const state = stateFor(this as unknown as object);
    updateFinishBurst(state, delta);
    if (state.phase === "COMMIT") {
      game.camera.fov = Math.max(42, game.camera.fov - Math.min(1.4, delta * 16));
      game.camera.updateProjectionMatrix();
    }
  };

  prototype.resetRound = function resetRoundWithCircuitFinish(): void {
    baseResetRound.call(this);
    const game = this as unknown as FinishRuntime;
    const state = stateFor(this as unknown as object);
    resetRoundState(game, state);
    publishDomDiagnostics(stageFromDom(), game, state, false);
  };

  prototype.destroy = function destroyWithCircuitFinish(): void {
    const state = states.get(this as unknown as object);
    if (state) disposeBurst(state);
    states.delete(this as unknown as object);
    clearDomDiagnostics();
    baseDestroy.call(this);
  };
}
