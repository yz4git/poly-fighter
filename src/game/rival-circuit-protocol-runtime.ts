import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import {
  RIVAL_CIRCUIT_PROTOCOLS,
  type RivalCircuitProtocolId,
} from "./rival-circuit";
import { TpsFightGame } from "./tps-game";
import type { InputFrame } from "./types";

export interface RivalCircuitProtocolRuntimeEffect {
  id: RivalCircuitProtocolId;
  gameplay: string;
  value: number;
  unit: "TICKS" | "DISTANCE" | "SCALE";
}

export const RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS: Readonly<Record<RivalCircuitProtocolId, RivalCircuitProtocolRuntimeEffect>> = Object.freeze({
  PRESSURE_STACK: Object.freeze({ id: "PRESSURE_STACK", gameplay: "Confirmed hits keep the combo route alive longer.", value: 46, unit: "TICKS" }),
  PHASE_STEP: Object.freeze({ id: "PHASE_STEP", gameplay: "Perfect STEP refreshes STEP sooner and extends the earned reversal window.", value: 6, unit: "TICKS" }),
  PUNISH_DRIVE: Object.freeze({ id: "PUNISH_DRIVE", gameplay: "An earned reversal arms one short pursuit drive for the next ATTACK.", value: 0.28, unit: "DISTANCE" }),
  INTERCEPT_CORE: Object.freeze({ id: "INTERCEPT_CORE", gameplay: "A committed intercept read stays valid for a longer reaction beat.", value: 8, unit: "TICKS" }),
  CLUTCH_VECTOR: Object.freeze({ id: "CLUTCH_VECTOR", gameplay: "At critical health, STEP cooldown is shortened after every committed STEP.", value: 5, unit: "TICKS" }),
  CLEAN_LINE: Object.freeze({ id: "CLEAN_LINE", gameplay: "While health is high, ordinary grounded movement carries extra tempo.", value: 1.1, unit: "SCALE" }),
});

type TrainingProgress = {
  hits: number;
  sideSteps: number;
  perfectEvades: number;
  punishes: number;
  intercepts: number;
};

type ProtocolRuntime = {
  p1: FighterRuntime;
  p2: FighterRuntime;
  playerEvadeCooldown: number;
  playerComboGraceTicks: number;
  playerPerfectEvadeTicks: number;
  playerReversalTicks: number;
  playerInterceptTicks: number;
  trainingProgress: TrainingProgress;
  simulationTicks: number;
};

type ProtocolRuntimeState = {
  punishDriveTicks: number;
  activations: Partial<Record<RivalCircuitProtocolId, number>>;
  lastPressureTick: number;
};

const ownedProtocols = new Set<RivalCircuitProtocolId>();
const states = new WeakMap<object, ProtocolRuntimeState>();
let installed = false;

function stateFor(game: object): ProtocolRuntimeState {
  let state = states.get(game);
  if (state) return state;
  state = { punishDriveTicks: 0, activations: {}, lastPressureTick: -9999 };
  states.set(game, state);
  return state;
}

export function rivalCircuitProtocolIdFromLabel(label: string): RivalCircuitProtocolId | null {
  const upper = label.toUpperCase().replaceAll("_", " ");
  const ids = Object.keys(RIVAL_CIRCUIT_PROTOCOLS) as RivalCircuitProtocolId[];
  for (const id of ids) {
    const protocol = RIVAL_CIRCUIT_PROTOCOLS[id];
    if (upper.includes(protocol.name.toUpperCase())) return id;
  }
  return null;
}

export function rivalCircuitProtocolGameplayText(id: RivalCircuitProtocolId): string {
  return RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS[id].gameplay;
}

function circuitActive(): boolean {
  return typeof document !== "undefined" && Boolean(document.querySelector(".circuit-run-strip"));
}

function hasProtocol(id: RivalCircuitProtocolId): boolean {
  return ownedProtocols.has(id);
}

function activationCount(state: ProtocolRuntimeState, id: RivalCircuitProtocolId): number {
  return state.activations[id] ?? 0;
}

function markActivation(state: ProtocolRuntimeState, id: RivalCircuitProtocolId): void {
  state.activations[id] = activationCount(state, id) + 1;
}

function publishDiagnostics(game: ProtocolRuntime, state: ProtocolRuntimeState): void {
  const ordered = [...ownedProtocols];
  const root = game.p1.visual.root;
  root.userData.tpsRivalCircuitProtocols = ordered;
  root.userData.tpsRivalCircuitProtocolCount = ordered.length;
  root.userData.tpsRivalCircuitProtocolPunishDriveTicks = state.punishDriveTicks;
  root.userData.tpsRivalCircuitProtocolActivations = { ...state.activations };
  if (typeof document !== "undefined") {
    document.body.dataset.rivalCircuitProtocols = ordered.join(",");
    document.body.dataset.rivalCircuitProtocolCount = String(ordered.length);
    document.body.dataset.rivalCircuitProtocolPressureActivations = String(activationCount(state, "PRESSURE_STACK"));
    document.body.dataset.rivalCircuitProtocolPhaseActivations = String(activationCount(state, "PHASE_STEP"));
    document.body.dataset.rivalCircuitProtocolPunishActivations = String(activationCount(state, "PUNISH_DRIVE"));
    document.body.dataset.rivalCircuitProtocolInterceptActivations = String(activationCount(state, "INTERCEPT_CORE"));
    document.body.dataset.rivalCircuitProtocolClutchActivations = String(activationCount(state, "CLUTCH_VECTOR"));
    document.body.dataset.rivalCircuitProtocolCleanActivations = String(activationCount(state, "CLEAN_LINE"));
  }
}

function clearRunProtocols(): void {
  ownedProtocols.clear();
  if (typeof document === "undefined") return;
  document.body.dataset.rivalCircuitProtocols = "";
  document.body.dataset.rivalCircuitProtocolCount = "0";
}

function onDocumentClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("button");
  if (!button) return;

  if (button.classList.contains("circuit-primary")) {
    clearRunProtocols();
    return;
  }

  if (!button.classList.contains("protocol-card")) return;
  const protocol = rivalCircuitProtocolIdFromLabel(button.textContent ?? "");
  if (!protocol) return;
  ownedProtocols.add(protocol);
}

function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return direction.lengthSq() > 1e-8 ? direction.normalize() : new THREE.Vector3(1, 0, 0);
}

export function installRivalCircuitProtocolRuntime(): void {
  if (installed) return;
  installed = true;
  if (typeof document !== "undefined") document.addEventListener("click", onDocumentClick, true);

  const prototype = TpsFightGame.prototype as unknown as {
    updatePlayer(input: InputFrame): void;
    resolveAttack(attacker: FighterRuntime, defender: FighterRuntime, defenderGuarding: boolean): void;
    resetRound(): void;
  };
  const baseUpdatePlayer = prototype.updatePlayer;
  const baseResolveAttack = prototype.resolveAttack;
  const baseResetRound = prototype.resetRound;

  prototype.updatePlayer = function updatePlayerWithCircuitProtocols(input: InputFrame): void {
    const game = this as unknown as ProtocolRuntime;
    if (!circuitActive()) {
      baseUpdatePlayer.call(this, input);
      return;
    }

    const state = stateFor(this as unknown as object);
    const beforePosition = game.p1.position.clone();
    const beforeState = game.p1.state;
    const beforeMoveId = game.p1.currentMove?.id ?? null;
    const beforeInterceptTicks = game.playerInterceptTicks;

    baseUpdatePlayer.call(this, input);

    const startedStep = beforeState !== "SIDESTEP" && game.p1.state === "SIDESTEP";
    const afterMoveId = game.p1.currentMove?.id ?? null;
    const startedAttack = afterMoveId !== null && afterMoveId !== beforeMoveId && game.p1.state === "ATTACK";

    if (state.punishDriveTicks > 0) state.punishDriveTicks -= 1;

    if (hasProtocol("INTERCEPT_CORE") && beforeInterceptTicks <= 0 && game.playerInterceptTicks > 0) {
      game.playerInterceptTicks += RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.INTERCEPT_CORE.value;
      markActivation(state, "INTERCEPT_CORE");
      game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "INTERCEPT CORE";
    }

    if (hasProtocol("CLUTCH_VECTOR") && game.p1.health <= 30 && startedStep) {
      const reduction = RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.CLUTCH_VECTOR.value;
      game.playerEvadeCooldown = Math.max(8, game.playerEvadeCooldown - reduction);
      markActivation(state, "CLUTCH_VECTOR");
      game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "CLUTCH VECTOR";
    }

    if (hasProtocol("CLEAN_LINE") && game.p1.health >= 70 && game.p1.state === "WALK") {
      const movement = game.p1.position.clone().sub(beforePosition);
      if (movement.lengthSq() > 1e-8) {
        const scale = RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.CLEAN_LINE.value;
        game.p1.position.copy(beforePosition).addScaledVector(movement, scale);
        markActivation(state, "CLEAN_LINE");
        game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "CLEAN LINE";
      }
    }

    if (hasProtocol("PUNISH_DRIVE") && state.punishDriveTicks > 0 && startedAttack) {
      const distance = Math.hypot(
        game.p2.position.x - game.p1.position.x,
        game.p2.position.z - game.p1.position.z,
      );
      const maximum = RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.PUNISH_DRIVE.value;
      const lunge = THREE.MathUtils.clamp(distance - 1.28, 0, maximum);
      if (lunge > 1e-4) {
        game.p1.position.addScaledVector(horizontalDirection(game.p1.position, game.p2.position), lunge);
      }
      state.punishDriveTicks = 0;
      markActivation(state, "PUNISH_DRIVE");
      game.p1.visual.root.userData.tpsRivalCircuitProtocolPursuit = lunge;
      game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "PUNISH DRIVE";
    }

    publishDiagnostics(game, state);
  };

  prototype.resolveAttack = function resolveAttackWithCircuitProtocols(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    defenderGuarding: boolean,
  ): void {
    const game = this as unknown as ProtocolRuntime;
    if (!circuitActive()) {
      baseResolveAttack.call(this, attacker, defender, defenderGuarding);
      return;
    }

    const state = stateFor(this as unknown as object);
    const before = { ...game.trainingProgress };
    baseResolveAttack.call(this, attacker, defender, defenderGuarding);

    if (game.trainingProgress.hits > before.hits && hasProtocol("PRESSURE_STACK")) {
      game.playerComboGraceTicks = Math.max(
        game.playerComboGraceTicks,
        RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.PRESSURE_STACK.value,
      );
      markActivation(state, "PRESSURE_STACK");
      if (game.simulationTicks - state.lastPressureTick >= 45) {
        state.lastPressureTick = game.simulationTicks;
        game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "PRESSURE STACK";
      }
    }

    if (game.trainingProgress.perfectEvades > before.perfectEvades && hasProtocol("PHASE_STEP")) {
      const refresh = RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.PHASE_STEP.value;
      game.playerEvadeCooldown = Math.max(8, game.playerEvadeCooldown - refresh);
      game.playerPerfectEvadeTicks += 4;
      game.playerReversalTicks += 4;
      markActivation(state, "PHASE_STEP");
      game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "PHASE STEP";
    }

    if (game.trainingProgress.punishes > before.punishes && hasProtocol("PUNISH_DRIVE")) {
      state.punishDriveTicks = 90;
      game.playerComboGraceTicks = Math.max(game.playerComboGraceTicks, 50);
      game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "PUNISH DRIVE ARMED";
    }

    if (game.trainingProgress.intercepts > before.intercepts && hasProtocol("INTERCEPT_CORE")) {
      game.playerComboGraceTicks = Math.max(game.playerComboGraceTicks, 44);
      game.p1.visual.root.userData.tpsRivalCircuitProtocolBeat = "INTERCEPT CORE CONFIRM";
    }

    publishDiagnostics(game, state);
  };

  prototype.resetRound = function resetRoundWithCircuitProtocols(): void {
    baseResetRound.call(this);
    const game = this as unknown as ProtocolRuntime;
    const state = stateFor(this as unknown as object);
    state.punishDriveTicks = 0;
    state.activations = {};
    state.lastPressureTick = -9999;
    if (circuitActive()) publishDiagnostics(game, state);
  };
}
