import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import { rivalCircuitArenaForStage, rivalCircuitStageFromLabel, type RivalCircuitArenaId } from "./rival-circuit-arena";
import { TpsFightGame } from "./tps-game";
import type { InputFrame } from "./types";

export type RivalCircuitArenaRule = "BASELINE" | "MOBILITY" | "ANCHOR" | "CONTRACT" | "BOSS_CONTRACT";

export interface RivalCircuitArenaTacticProfile {
  stage: number;
  arenaId: RivalCircuitArenaId;
  rule: RivalCircuitArenaRule;
  label: string;
  walkScale: number;
}

const BASE_PLAYABLE_RADIUS = 6.08;
const REDLINE_MIN_PLAYABLE_RADIUS = 5.32;
const REDLINE_CONTRACT_TICKS = 54 * 60;
const APEX_PHASE_RADII = Object.freeze({
  CALIBRATE: 5.86,
  ADAPT: 5.56,
  ZERO: 5.24,
});

export const RIVAL_CIRCUIT_ARENA_TACTICS: readonly RivalCircuitArenaTacticProfile[] = Object.freeze([
  Object.freeze({ stage: 1, arenaId: "GLASSLINE", rule: "BASELINE", label: "CLEAR LINE", walkScale: 1 }),
  Object.freeze({ stage: 2, arenaId: "OFFSET", rule: "MOBILITY", label: "OFFSET FLOW", walkScale: 1.08 }),
  Object.freeze({ stage: 3, arenaId: "COLD", rule: "ANCHOR", label: "COLD FOOTING", walkScale: 0.92 }),
  Object.freeze({ stage: 4, arenaId: "REDLINE", rule: "CONTRACT", label: "REDLINE CONTRACT", walkScale: 1 }),
  Object.freeze({ stage: 5, arenaId: "APEX", rule: "BOSS_CONTRACT", label: "APEX CONVERGENCE", walkScale: 1 }),
]);

export function rivalCircuitArenaTacticForStage(stage: number): RivalCircuitArenaTacticProfile {
  const safe = Math.max(1, Math.min(RIVAL_CIRCUIT_ARENA_TACTICS.length, Math.floor(stage || 1)));
  return RIVAL_CIRCUIT_ARENA_TACTICS[safe - 1] ?? RIVAL_CIRCUIT_ARENA_TACTICS[0];
}

export function rivalCircuitArenaPlayableRadius(
  stage: number,
  simulationTicks: number,
  bossHealth: number,
): number {
  if (stage === 4) {
    const progress = THREE.MathUtils.clamp(simulationTicks / REDLINE_CONTRACT_TICKS, 0, 1);
    return THREE.MathUtils.lerp(BASE_PLAYABLE_RADIUS, REDLINE_MIN_PLAYABLE_RADIUS, progress);
  }
  if (stage === 5) {
    if (bossHealth <= 30) return APEX_PHASE_RADII.ZERO;
    if (bossHealth <= 60) return APEX_PHASE_RADII.ADAPT;
    return APEX_PHASE_RADII.CALIBRATE;
  }
  return BASE_PLAYABLE_RADIUS;
}

type TacticRuntime = {
  p1: FighterRuntime;
  p2: FighterRuntime;
  scene: THREE.Scene;
  simulationTicks: number;
  setCombatBeat(label: string, ticks?: number): void;
};

type TacticState = {
  stage: number;
  profile: RivalCircuitArenaTacticProfile;
  boundary: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  boundaryGeometry: THREE.TorusGeometry;
  boundaryMaterial: THREE.MeshBasicMaterial;
  lastRadius: number;
  redlineBeat: number;
  apexHealthBand: number;
};

const states = new WeakMap<object, TacticState>();
let installed = false;

function stageFromDom(): number {
  if (typeof document === "undefined") return 0;
  const strip = document.querySelector<HTMLElement>(".circuit-run-strip");
  return rivalCircuitStageFromLabel(strip?.textContent ?? "") ?? 0;
}

function createState(game: TacticRuntime, stage: number): TacticState {
  const profile = rivalCircuitArenaTacticForStage(stage);
  const arena = rivalCircuitArenaForStage(stage);
  const boundaryGeometry = new THREE.TorusGeometry(1, 0.026, 6, 96);
  const boundaryMaterial = new THREE.MeshBasicMaterial({
    color: arena.accent,
    transparent: true,
    opacity: profile.rule === "BASELINE" ? 0.12 : profile.rule === "MOBILITY" || profile.rule === "ANCHOR" ? 0.24 : 0.72,
    depthWrite: false,
  });
  const boundary = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
  boundary.name = "rival-circuit-tactical-boundary";
  boundary.rotation.x = Math.PI / 2;
  boundary.position.y = 0.045;
  game.scene.add(boundary);
  const state: TacticState = {
    stage,
    profile,
    boundary,
    boundaryGeometry,
    boundaryMaterial,
    lastRadius: BASE_PLAYABLE_RADIUS,
    redlineBeat: 0,
    apexHealthBand: 0,
  };
  states.set(game as unknown as object, state);
  return state;
}

function ensureState(game: TacticRuntime): TacticState | null {
  const stage = stageFromDom();
  if (stage <= 0) return null;
  const existing = states.get(game as unknown as object);
  if (!existing) return createState(game, stage);
  if (existing.stage === stage) return existing;

  existing.stage = stage;
  existing.profile = rivalCircuitArenaTacticForStage(stage);
  const arena = rivalCircuitArenaForStage(stage);
  existing.boundaryMaterial.color.set(arena.accent);
  existing.boundaryMaterial.opacity = existing.profile.rule === "BASELINE"
    ? 0.12
    : existing.profile.rule === "MOBILITY" || existing.profile.rule === "ANCHOR" ? 0.24 : 0.72;
  existing.redlineBeat = 0;
  existing.apexHealthBand = 0;
  return existing;
}

function disposeState(game: object): void {
  const state = states.get(game);
  if (!state) return;
  state.boundary.removeFromParent();
  state.boundaryGeometry.dispose();
  state.boundaryMaterial.dispose();
  states.delete(game);
}

function scaleWalkDelta(fighter: FighterRuntime, before: THREE.Vector3, scale: number): void {
  if (fighter.state !== "WALK" || Math.abs(scale - 1) < 1e-6) return;
  fighter.position.x = before.x + (fighter.position.x - before.x) * scale;
  fighter.position.z = before.z + (fighter.position.z - before.z) * scale;
}

function clampFighter(fighter: FighterRuntime, radius: number): void {
  const radial = Math.hypot(fighter.position.x, fighter.position.z);
  if (radial <= radius || radial <= 1e-6) return;
  const scale = radius / radial;
  fighter.position.x *= scale;
  fighter.position.z *= scale;
}

function publishDiagnostics(game: TacticRuntime, state: TacticState, radius: number): void {
  const boundaryRadius = radius + 0.72;
  state.boundary.scale.set(boundaryRadius, boundaryRadius, 1);
  state.lastRadius = radius;
  const active = state.profile.rule === "CONTRACT" || state.profile.rule === "BOSS_CONTRACT";
  const pulse = active ? 0.70 + Math.sin(game.simulationTicks * 0.055) * 0.16 : state.boundaryMaterial.opacity;
  state.boundaryMaterial.opacity = active ? THREE.MathUtils.clamp(pulse, 0.46, 0.88) : state.boundaryMaterial.opacity;

  if (typeof document === "undefined") return;
  document.body.dataset.rivalCircuitArenaRule = state.profile.rule;
  document.body.dataset.rivalCircuitArenaRuleLabel = state.profile.label;
  document.body.dataset.rivalCircuitArenaWalkScale = state.profile.walkScale.toFixed(2);
  document.body.dataset.rivalCircuitArenaPlayableRadius = radius.toFixed(2);
}

function updatePressureBeats(game: TacticRuntime, state: TacticState, radius: number): void {
  if (state.profile.rule === "CONTRACT") {
    const nextBeat = radius <= 5.42 ? 3 : radius <= 5.67 ? 2 : radius <= 5.92 ? 1 : 0;
    if (nextBeat > state.redlineBeat) {
      state.redlineBeat = nextBeat;
      game.setCombatBeat(nextBeat === 3 ? "REDLINE // FINAL RING" : `REDLINE // CONTRACT ${nextBeat}`, 28);
    }
  } else if (state.profile.rule === "BOSS_CONTRACT") {
    const nextBand = game.p2.health <= 30 ? 3 : game.p2.health <= 60 ? 2 : 1;
    if (state.apexHealthBand > 0 && nextBand > state.apexHealthBand) {
      game.setCombatBeat(nextBand === 3 ? "APEX // ZERO RING" : "APEX // CONVERGENCE", 34);
    }
    state.apexHealthBand = nextBand;
  }
}

function clearDiagnostics(): void {
  if (typeof document === "undefined") return;
  delete document.body.dataset.rivalCircuitArenaRule;
  delete document.body.dataset.rivalCircuitArenaRuleLabel;
  delete document.body.dataset.rivalCircuitArenaWalkScale;
  delete document.body.dataset.rivalCircuitArenaPlayableRadius;
}

export function installRivalCircuitArenaTactics(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype as unknown as {
    updatePlayer(input: InputFrame): void;
    updateEnemy(): void;
    resetRound(): void;
    destroy(): void;
  };
  const baseUpdatePlayer = prototype.updatePlayer;
  const baseUpdateEnemy = prototype.updateEnemy;
  const baseResetRound = prototype.resetRound;
  const baseDestroy = prototype.destroy;

  prototype.updatePlayer = function updatePlayerWithArenaTactics(input: InputFrame): void {
    const game = this as unknown as TacticRuntime;
    const state = ensureState(game);
    if (!state) {
      clearDiagnostics();
      baseUpdatePlayer.call(this, input);
      return;
    }
    const before = game.p1.position.clone();
    baseUpdatePlayer.call(this, input);
    scaleWalkDelta(game.p1, before, state.profile.walkScale);
  };

  prototype.updateEnemy = function updateEnemyWithArenaTactics(): void {
    const game = this as unknown as TacticRuntime;
    const state = ensureState(game);
    if (!state) {
      clearDiagnostics();
      baseUpdateEnemy.call(this);
      return;
    }
    const before = game.p2.position.clone();
    baseUpdateEnemy.call(this);
    scaleWalkDelta(game.p2, before, state.profile.walkScale);
    const radius = rivalCircuitArenaPlayableRadius(state.stage, game.simulationTicks, game.p2.health);
    clampFighter(game.p1, radius);
    clampFighter(game.p2, radius);
    updatePressureBeats(game, state, radius);
    publishDiagnostics(game, state, radius);
  };

  prototype.resetRound = function resetRoundWithArenaTactics(): void {
    baseResetRound.call(this);
    const game = this as unknown as TacticRuntime;
    const state = ensureState(game);
    if (!state) return;
    state.redlineBeat = 0;
    state.apexHealthBand = 0;
    const radius = rivalCircuitArenaPlayableRadius(state.stage, game.simulationTicks, game.p2.health);
    clampFighter(game.p1, radius);
    clampFighter(game.p2, radius);
    publishDiagnostics(game, state, radius);
  };

  prototype.destroy = function destroyWithArenaTactics(): void {
    disposeState(this as unknown as object);
    clearDiagnostics();
    baseDestroy.call(this);
  };
}
