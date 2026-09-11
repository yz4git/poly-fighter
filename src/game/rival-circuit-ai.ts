import type { CpuDecision, CpuIntent } from "./cpu-director";
import type { CpuDifficulty, FighterRuntime } from "./fighter";
import type { RivalCircuitStyle } from "./rival-circuit";
import { TpsFightGame } from "./tps-game";

type EnemyTactic = "PRESSURE" | "ORBIT" | "BAIT";
type EnemyPersona = "BRAWLER" | "SKIRMISHER";

type RivalRuntime = {
  p1: FighterRuntime;
  p2: FighterRuntime;
  difficulty: CpuDifficulty;
  simulationTicks: number;
  enemyCooldown: number;
  enemyOpeningGraceTicks: number;
  enemyTactic: EnemyTactic;
  enemyTacticTicks: number;
  enemyOrbitSign: number;
  enemyPersona: EnemyPersona;
  enemyDirectorDecision: CpuDecision | null;
  enemyDirectorPendingMove: string | null;
  enemyDirectorTelegraphTicks: number;
  enemyDirectorTelegraphTotalTicks: number;
  playerEvadeTicks: number;
  playerEvadeSign: number;
  playerStepSideWeight: number;
  setCombatBeat(label: string, ticks?: number): void;
};

type RivalAiState = {
  lastSignatureTick: number;
  lastPhase: RivalCircuitStyle | null;
  scheduledSignatures: number;
};

export interface RivalCircuitSignatureInput {
  style: RivalCircuitStyle;
  simulationTicks: number;
  distance: number;
  playerAttacking: boolean;
  playerSideStepping: boolean;
  apexHealth?: number;
}

export interface RivalCircuitSignaturePlan {
  moveId: string;
  intent: CpuIntent;
  label: string;
}

const APEX_PHASE_TICKS = 300;
const APEX_PHASES: readonly RivalCircuitStyle[] = Object.freeze([
  "PRESSURE",
  "ANGLE",
  "COUNTER",
  "STEP_HUNTER",
]);
const runtimeStates = new WeakMap<object, RivalAiState>();
let installed = false;

const MOVE_INTENTS: Readonly<Record<string, CpuIntent>> = Object.freeze({
  jab: "JAB",
  straight: "STRAIGHT",
  backfist: "BACKFIST",
  bodyBlow: "BODY_BLOW",
  kick: "KICK",
  lowKick: "LOW_KICK",
  risingKick: "RISING_KICK",
  dashKick: "DASH_KICK",
  counter: "COUNTER",
});

function runtimeState(game: object): RivalAiState {
  let state = runtimeStates.get(game);
  if (state) return state;
  state = { lastSignatureTick: -9999, lastPhase: null, scheduledSignatures: 0 };
  runtimeStates.set(game, state);
  return state;
}

export function resolveRivalCircuitStyleFromLabel(label: string): RivalCircuitStyle | null {
  const upper = label.toUpperCase();
  if (upper.includes("APEX-0") || upper.includes("FINAL RIVAL")) return "APEX";
  if (upper.includes("LOCKSTEP") || upper.includes("STEP HUNTER")) return "STEP_HUNTER";
  if (upper.includes("REFLEX") || upper.includes("COUNTER NODE")) return "COUNTER";
  if (upper.includes("VECTOR") || upper.includes("ANGLE HUNTER")) return "ANGLE";
  if (upper.includes("GLASSLINE") || upper.includes("PRESSURE TEST")) return "PRESSURE";
  return null;
}

export function effectiveRivalCircuitStyle(
  style: RivalCircuitStyle,
  simulationTicks: number,
): RivalCircuitStyle {
  if (style !== "APEX") return style;
  const slot = Math.floor(Math.max(0, simulationTicks) / APEX_PHASE_TICKS) % APEX_PHASES.length;
  return APEX_PHASES[slot] ?? "PRESSURE";
}

export function effectiveApexStyleForHealth(health: number): RivalCircuitStyle {
  const value = Math.max(0, Math.min(100, health));
  if (value >= 61) return "ANGLE";
  if (value >= 31) return "COUNTER";
  return "PRESSURE";
}

function tacticForEffectiveStyle(effective: RivalCircuitStyle): EnemyTactic {
  if (effective === "PRESSURE") return "PRESSURE";
  if (effective === "COUNTER") return "BAIT";
  return "ORBIT";
}

export function rivalCircuitTacticForStyle(
  style: RivalCircuitStyle,
  simulationTicks: number,
): EnemyTactic {
  return tacticForEffectiveStyle(effectiveRivalCircuitStyle(style, simulationTicks));
}

export function rivalCircuitSignaturePlan(input: RivalCircuitSignatureInput): RivalCircuitSignaturePlan | null {
  const effective = input.style === "APEX" && input.apexHealth !== undefined
    ? effectiveApexStyleForHealth(input.apexHealth)
    : effectiveRivalCircuitStyle(input.style, input.simulationTicks);
  const slot = Math.floor(Math.max(0, input.simulationTicks) / 90);

  if (effective === "PRESSURE") {
    const moveId = input.distance > 2.05
      ? "dashKick"
      : slot % 2 === 0 ? "straight" : "bodyBlow";
    return { moveId, intent: MOVE_INTENTS[moveId], label: input.distance > 2.05 ? "BREACH" : "PRESSURE" };
  }

  if (effective === "ANGLE") {
    const moveId = input.distance > 2.15
      ? "kick"
      : slot % 2 === 0 ? "backfist" : "lowKick";
    return { moveId, intent: MOVE_INTENTS[moveId], label: "ANGLE CUT" };
  }

  if (effective === "COUNTER") {
    if (!input.playerAttacking) return null;
    return { moveId: "counter", intent: "COUNTER", label: "ANSWER" };
  }

  if (effective === "STEP_HUNTER") {
    if (!input.playerSideStepping) return null;
    const moveId = slot % 2 === 0 ? "lowKick" : "backfist";
    return { moveId, intent: MOVE_INTENTS[moveId], label: "STEP READ" };
  }

  return null;
}

function circuitStyleFromDom(): RivalCircuitStyle | null {
  if (typeof document === "undefined") return null;
  const strip = document.querySelector<HTMLElement>(".circuit-run-strip");
  return resolveRivalCircuitStyleFromLabel(strip?.textContent ?? "");
}

function publishDomDiagnostics(
  style: RivalCircuitStyle | null,
  effective: RivalCircuitStyle | null,
  tactic: EnemyTactic | null,
  scheduledSignatures = 0,
): void {
  if (typeof document === "undefined") return;
  if (!style || !effective || !tactic) {
    delete document.body.dataset.rivalCircuitAiPolicy;
    delete document.body.dataset.rivalCircuitAiStyle;
    delete document.body.dataset.rivalCircuitAiPhase;
    delete document.body.dataset.rivalCircuitAiTactic;
    delete document.body.dataset.rivalCircuitAiSignatures;
    return;
  }
  document.body.dataset.rivalCircuitAiPolicy = "RIVAL_CIRCUIT_V1";
  document.body.dataset.rivalCircuitAiStyle = style;
  document.body.dataset.rivalCircuitAiPhase = effective;
  document.body.dataset.rivalCircuitAiTactic = tactic;
  document.body.dataset.rivalCircuitAiSignatures = String(scheduledSignatures);
}

function telegraphTicksFor(game: RivalRuntime, moveId: string): number {
  const base = game.difficulty === "EASY" ? 24 : game.difficulty === "HARD" ? 17 : 20;
  return base + (["dashKick", "counter", "risingKick"].includes(moveId) ? 5 : 0);
}

function signatureInterval(style: RivalCircuitStyle): number {
  if (style === "COUNTER") return 178;
  if (style === "STEP_HUNTER") return 154;
  if (style === "ANGLE") return 164;
  return 138;
}

function applyStyleIdentity(game: RivalRuntime, style: RivalCircuitStyle, state: RivalAiState): RivalCircuitStyle {
  const effective = style === "APEX"
    ? effectiveApexStyleForHealth(game.p2.health)
    : effectiveRivalCircuitStyle(style, game.simulationTicks);
  const tactic = tacticForEffectiveStyle(effective);
  const data = game.p2.visual.root.userData;

  game.enemyTactic = tactic;
  game.enemyTacticTicks = Math.max(game.enemyTacticTicks, 12);
  game.enemyPersona = effective === "PRESSURE" ? "BRAWLER" : "SKIRMISHER";

  if (effective === "ANGLE") {
    game.enemyOrbitSign = Math.floor(game.simulationTicks / 150) % 2 === 0 ? 1 : -1;
  } else if (effective === "STEP_HUNTER" && game.playerEvadeSign !== 0) {
    game.enemyOrbitSign = -game.playerEvadeSign;
  }

  data.tpsRivalCircuitAiPolicy = "RIVAL_CIRCUIT_V1";
  data.tpsRivalCircuitStyle = style;
  data.tpsRivalCircuitPhase = effective;
  data.tpsRivalCircuitTactic = tactic;
  data.tpsRivalCircuitScheduledSignatures = state.scheduledSignatures;

  if (style === "APEX") {
    data.tpsApexAiHealthPhase = effective;
    if (state.lastPhase !== effective) {
      state.lastPhase = effective;
      game.setCombatBeat(`APEX: ${effective.replace("_", " ")}`, 32);
    }
  }
  return effective;
}

function tryScheduleSignature(
  game: RivalRuntime,
  style: RivalCircuitStyle,
  effective: RivalCircuitStyle,
  state: RivalAiState,
): void {
  if (game.enemyOpeningGraceTicks > 0) return;
  if (game.enemyCooldown > 0 || game.enemyDirectorPendingMove || game.enemyDirectorTelegraphTicks > 0) return;
  if (!game.p2.canAct()) return;

  const interval = style === "APEX" ? (effective === "PRESSURE" ? 108 : 126) : signatureInterval(effective);
  if (game.simulationTicks - state.lastSignatureTick < interval) return;

  const distance = Math.hypot(
    game.p1.position.x - game.p2.position.x,
    game.p1.position.z - game.p2.position.z,
  );
  const playerSideStepping = game.playerEvadeTicks > 0 && game.playerStepSideWeight > 0.45;
  const plan = rivalCircuitSignaturePlan({
    style,
    simulationTicks: game.simulationTicks,
    distance,
    playerAttacking: game.p1.state === "ATTACK",
    playerSideStepping,
    apexHealth: style === "APEX" ? game.p2.health : undefined,
  });
  if (!plan || !game.p2.definition.moves[plan.moveId]) return;

  const telegraphTicks = telegraphTicksFor(game, plan.moveId);
  const decision: CpuDecision = {
    intent: plan.intent,
    holdTicks: 2,
    telegraphTicks,
    reason: `rival-circuit-${effective.toLowerCase()}-${plan.label.toLowerCase().replaceAll(" ", "-")}`,
    comebackMercy: 0,
    pressure: effective === "PRESSURE" ? 0.94 : effective === "ANGLE" ? 0.58 : 0.72,
  };

  game.enemyDirectorDecision = decision;
  game.enemyDirectorPendingMove = plan.moveId;
  game.enemyDirectorTelegraphTicks = telegraphTicks;
  game.enemyDirectorTelegraphTotalTicks = telegraphTicks;
  state.lastSignatureTick = game.simulationTicks;
  state.scheduledSignatures += 1;

  const data = game.p2.visual.root.userData;
  data.tpsRivalCircuitSignature = plan.label;
  data.tpsRivalCircuitSignatureMove = plan.moveId;
  data.tpsRivalCircuitSignatureTelegraphTicks = telegraphTicks;
  data.tpsRivalCircuitScheduledSignatures = state.scheduledSignatures;
  game.setCombatBeat(style === "APEX" ? `APEX-0: ${plan.label}` : `RIVAL: ${plan.label}`, 24);
}

export function installRivalCircuitAiRuntime(): void {
  if (installed) return;
  installed = true;

  const prototype = TpsFightGame.prototype as unknown as { updateEnemy(): void };
  const baseUpdateEnemy = prototype.updateEnemy;
  prototype.updateEnemy = function updateEnemyWithRivalCircuitIdentity(): void {
    const game = this as unknown as RivalRuntime;
    const style = circuitStyleFromDom();
    if (!style) {
      publishDomDiagnostics(null, null, null);
      baseUpdateEnemy.call(this);
      return;
    }

    const state = runtimeState(this as unknown as object);
    const effective = applyStyleIdentity(game, style, state);
    tryScheduleSignature(game, style, effective, state);
    baseUpdateEnemy.call(this);

    const data = game.p2.visual.root.userData;
    data.tpsRivalCircuitAiPolicy = "RIVAL_CIRCUIT_V1";
    data.tpsRivalCircuitStyle = style;
    data.tpsRivalCircuitPhase = effective;
    data.tpsRivalCircuitTactic = game.enemyTactic;
    data.tpsRivalCircuitScheduledSignatures = state.scheduledSignatures;
    publishDomDiagnostics(style, effective, game.enemyTactic, state.scheduledSignatures);
  };
}
