import type { FighterRuntime } from "./fighter";
import {
  EMPTY_RIVAL_CIRCUIT_MEMORY,
  classifyRivalCircuitMemory,
  publishRivalCircuitMemoryToDom,
  type RivalCircuitMemory,
} from "./rival-circuit-memory";
import { TpsFightGame } from "./tps-game";
import type { TpsTrainingProgress } from "./types";

type CircuitMemoryRuntime = {
  p2: FighterRuntime;
  trainingProgress: TpsTrainingProgress;
  timerTicks: number;
  resultWinner: "p1" | "p2" | "draw" | null;
};

type RuntimeState = {
  stage: number;
  committed: boolean;
};

type MemoryListener = (memory: RivalCircuitMemory) => void;

const runtimeStates = new WeakMap<object, RuntimeState>();
const memoryListeners = new Set<MemoryListener>();
let installed = false;
let runMemory: RivalCircuitMemory = { ...EMPTY_RIVAL_CIRCUIT_MEMORY };
let lastCommittedStage = 0;

export function rivalCircuitStageFromLabel(label: string): number {
  const match = label.toUpperCase().match(/CIRCUIT\s+(\d+)\s*\/\s*5/);
  const value = Number(match?.[1] ?? 0);
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : 0;
}

export function mergeRivalCircuitMemoryProgress(
  current: RivalCircuitMemory,
  progress: Partial<TpsTrainingProgress>,
  activeSeconds: number,
): RivalCircuitMemory {
  const nextBase = {
    fights: current.fights + 1,
    hits: current.hits + Math.max(0, progress.hits ?? 0),
    sideSteps: current.sideSteps + Math.max(0, progress.sideSteps ?? 0),
    perfectEvades: current.perfectEvades + Math.max(0, progress.perfectEvades ?? 0),
    punishes: current.punishes + Math.max(0, progress.punishes ?? 0),
    intercepts: current.intercepts + Math.max(0, progress.intercepts ?? 0),
    activeSeconds: current.activeSeconds + Math.max(8, activeSeconds),
  };
  return { ...nextBase, ...classifyRivalCircuitMemory(nextBase) };
}

function cloneRunMemory(): RivalCircuitMemory {
  return { ...runMemory };
}

function notifyMemoryListeners(): void {
  const snapshot = cloneRunMemory();
  for (const listener of memoryListeners) listener({ ...snapshot });
}

export function getRivalCircuitRunMemorySnapshot(): RivalCircuitMemory {
  return cloneRunMemory();
}

export function subscribeRivalCircuitRunMemory(listener: MemoryListener): () => void {
  memoryListeners.add(listener);
  listener(cloneRunMemory());
  return () => memoryListeners.delete(listener);
}

export function resetRivalCircuitRunMemory(): void {
  runMemory = { ...EMPTY_RIVAL_CIRCUIT_MEMORY };
  lastCommittedStage = 0;
  publishRivalCircuitMemoryToDom(runMemory);
  notifyMemoryListeners();
}

function circuitStageFromDom(): number {
  if (typeof document === "undefined") return 0;
  const strip = document.querySelector<HTMLElement>(".circuit-run-strip");
  return rivalCircuitStageFromLabel(strip?.textContent ?? "");
}

function runtimeState(game: object): RuntimeState {
  let state = runtimeStates.get(game);
  if (state) return state;
  state = { stage: 0, committed: false };
  runtimeStates.set(game, state);
  return state;
}

function publishForStage(game: CircuitMemoryRuntime, state: RuntimeState, stage: number): void {
  if (state.stage === 0) {
    state.stage = stage;
    // Any new Stage 1 after a completed Circuit fight marks a new run. This is
    // deliberately run-local: Rival Memory does not leak between separate runs
    // or into normal START FIGHT.
    if (stage === 1 && lastCommittedStage > 0) resetRivalCircuitRunMemory();
  }
  publishRivalCircuitMemoryToDom(runMemory);
  const data = game.p2.visual.root.userData;
  data.tpsRivalCircuitMemoryPolicy = "RIVAL_MEMORY_V1";
  data.tpsRivalCircuitMemoryRead = runMemory.read;
  data.tpsRivalCircuitMemoryConfidence = runMemory.confidence;
  data.tpsRivalCircuitMemoryFights = runMemory.fights;
}

function commitFight(game: CircuitMemoryRuntime, state: RuntimeState): void {
  if (state.committed || state.stage <= 0 || game.resultWinner === null) return;
  state.committed = true;
  const elapsedSeconds = 99 - Math.max(0, Math.min(99, Math.ceil(game.timerTicks / 60)));
  runMemory = mergeRivalCircuitMemoryProgress(runMemory, game.trainingProgress, elapsedSeconds);
  lastCommittedStage = state.stage;
  publishRivalCircuitMemoryToDom(runMemory);
  notifyMemoryListeners();
}

export function installRivalCircuitMemoryRuntime(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype as unknown as {
    updateEnemy(): void;
    destroy(): void;
  };
  const baseUpdateEnemy = prototype.updateEnemy;
  const baseDestroy = prototype.destroy;

  prototype.updateEnemy = function updateEnemyWithRunMemory(): void {
    const game = this as unknown as CircuitMemoryRuntime;
    const stage = circuitStageFromDom();
    if (stage <= 0) {
      publishRivalCircuitMemoryToDom(null);
      baseUpdateEnemy.call(this);
      return;
    }
    const state = runtimeState(this as unknown as object);
    publishForStage(game, state, stage);
    baseUpdateEnemy.call(this);
  };

  prototype.destroy = function destroyWithRunMemory(): void {
    const game = this as unknown as CircuitMemoryRuntime;
    const state = runtimeState(this as unknown as object);
    commitFight(game, state);
    runtimeStates.delete(this as unknown as object);
    publishRivalCircuitMemoryToDom(null);
    baseDestroy.call(this);
  };
}
