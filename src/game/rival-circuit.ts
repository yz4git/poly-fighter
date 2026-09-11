import type { CpuDifficulty } from "./fighter";
import type { HudSnapshot, TpsTrainingProgress } from "./types";

export type RivalCircuitStyle = "PRESSURE" | "ANGLE" | "COUNTER" | "STEP_HUNTER" | "APEX";
export type RivalCircuitGrade = "SS" | "S" | "A" | "B" | "C";
export type RivalCircuitProtocolId =
  | "PRESSURE_STACK"
  | "PHASE_STEP"
  | "PUNISH_DRIVE"
  | "INTERCEPT_CORE"
  | "CLUTCH_VECTOR"
  | "CLEAN_LINE";

export interface RivalCircuitEncounter {
  id: string;
  order: number;
  codename: string;
  title: string;
  fighterId: "red" | "blue";
  difficulty: CpuDifficulty;
  style: RivalCircuitStyle;
  arenaLabel: string;
  rule: string;
  description: string;
}

export interface RivalCircuitProtocol {
  id: RivalCircuitProtocolId;
  name: string;
  kicker: string;
  detail: string;
  metric: keyof TpsTrainingProgress | "health" | "time" | "cleanWin";
  bonusPerUnit: number;
  cap: number;
}

export interface RivalCircuitPerformance {
  score: number;
  grade: RivalCircuitGrade;
  baseScore: number;
  protocolBonus: number;
  healthBonus: number;
  techniqueBonus: number;
}

export const RIVAL_CIRCUIT_ENCOUNTERS: readonly RivalCircuitEncounter[] = Object.freeze([
  {
    id: "glassline-rusher",
    order: 1,
    codename: "GLASSLINE",
    title: "PRESSURE TEST",
    fighterId: "blue",
    difficulty: "EASY",
    style: "PRESSURE",
    arenaLabel: "RING 01",
    rule: "BREAK THE OPENING RUSH",
    description: "A direct opener that rewards spacing, clean ATTACK confirms, and early STEP discipline.",
  },
  {
    id: "angle-hunter",
    order: 2,
    codename: "VECTOR",
    title: "ANGLE HUNTER",
    fighterId: "red",
    difficulty: "NORMAL",
    style: "ANGLE",
    arenaLabel: "RING 01 // OFFSET",
    rule: "WIN THE FLANK",
    description: "A lateral rival that turns neutral into an angle fight. Punish over-committed forward pressure.",
  },
  {
    id: "counter-node",
    order: 3,
    codename: "REFLEX",
    title: "COUNTER NODE",
    fighterId: "blue",
    difficulty: "NORMAL",
    style: "COUNTER",
    arenaLabel: "RING 01 // COLD",
    rule: "DRAW THE RESPONSE",
    description: "A patient rival built around bait-and-answer rhythm. Perfect STEP and PUNISH score heavily here.",
  },
  {
    id: "step-hunter",
    order: 4,
    codename: "LOCKSTEP",
    title: "STEP HUNTER",
    fighterId: "red",
    difficulty: "HARD",
    style: "STEP_HUNTER",
    arenaLabel: "RING 01 // REDLINE",
    rule: "DON'T BECOME PREDICTABLE",
    description: "The circuit starts reading evasive habits. Mix ATTACK timing, intercepts, and retreat routes.",
  },
  {
    id: "apex-proxy",
    order: 5,
    codename: "APEX-0",
    title: "FINAL RIVAL",
    fighterId: "blue",
    difficulty: "HARD",
    style: "APEX",
    arenaLabel: "RING 01 // APEX",
    rule: "PROVE THE WHOLE KIT",
    description: "A provisional boss profile for v0.2. It expects the full ATTACK / STEP / PUNISH / INTERCEPT loop.",
  },
]);

export const RIVAL_CIRCUIT_PROTOCOLS: Readonly<Record<RivalCircuitProtocolId, RivalCircuitProtocol>> = Object.freeze({
  PRESSURE_STACK: Object.freeze({
    id: "PRESSURE_STACK",
    name: "PRESSURE STACK",
    kicker: "ATTACK ROUTE",
    detail: "Turns clean hit volume into circuit score. Built for players who keep the rival under pressure.",
    metric: "hits",
    bonusPerUnit: 1.5,
    cap: 12,
  }),
  PHASE_STEP: Object.freeze({
    id: "PHASE_STEP",
    name: "PHASE STEP",
    kicker: "EVADE ROUTE",
    detail: "Perfect STEP earns extra circuit score. Rewards timing instead of repeated escape movement.",
    metric: "perfectEvades",
    bonusPerUnit: 5,
    cap: 15,
  }),
  PUNISH_DRIVE: Object.freeze({
    id: "PUNISH_DRIVE",
    name: "PUNISH DRIVE",
    kicker: "COUNTER ROUTE",
    detail: "Confirmed PUNISH events receive a large score multiplier after an earned opening.",
    metric: "punishes",
    bonusPerUnit: 5,
    cap: 15,
  }),
  INTERCEPT_CORE: Object.freeze({
    id: "INTERCEPT_CORE",
    name: "INTERCEPT CORE",
    kicker: "READ ROUTE",
    detail: "Meeting WINDUP with ATTACK becomes a premium scoring line.",
    metric: "intercepts",
    bonusPerUnit: 6,
    cap: 18,
  }),
  CLUTCH_VECTOR: Object.freeze({
    id: "CLUTCH_VECTOR",
    name: "CLUTCH VECTOR",
    kicker: "SURVIVAL ROUTE",
    detail: "Remaining health contributes extra score. The protocol favors controlled wins over trades.",
    metric: "health",
    bonusPerUnit: 0.09,
    cap: 9,
  }),
  CLEAN_LINE: Object.freeze({
    id: "CLEAN_LINE",
    name: "CLEAN LINE",
    kicker: "TEMPO ROUTE",
    detail: "Fast, decisive wins earn a compact time bonus without changing combat damage or frame data.",
    metric: "time",
    bonusPerUnit: 0.12,
    cap: 9,
  }),
});

const OFFER_ROTATION: readonly RivalCircuitProtocolId[][] = Object.freeze([
  ["PRESSURE_STACK", "PHASE_STEP", "PUNISH_DRIVE"],
  ["INTERCEPT_CORE", "CLUTCH_VECTOR", "CLEAN_LINE"],
  ["PUNISH_DRIVE", "INTERCEPT_CORE", "PRESSURE_STACK"],
  ["PHASE_STEP", "CLEAN_LINE", "CLUTCH_VECTOR"],
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function metricValue(protocol: RivalCircuitProtocol, hud: HudSnapshot): number {
  const training = hud.tpsTraining ?? { hits: 0, sideSteps: 0, perfectEvades: 0, punishes: 0, intercepts: 0 };
  if (protocol.metric === "health") return hud.p1Health;
  if (protocol.metric === "time") return hud.timer;
  if (protocol.metric === "cleanWin") return hud.p1Health >= 70 ? 1 : 0;
  return training[protocol.metric];
}

export function rivalCircuitGradeForScore(score: number): RivalCircuitGrade {
  if (score >= 92) return "SS";
  if (score >= 82) return "S";
  if (score >= 70) return "A";
  if (score >= 58) return "B";
  return "C";
}

export function scoreRivalCircuitPerformance(
  hud: HudSnapshot | null,
  winner: "p1" | "p2" | "draw",
  protocols: readonly RivalCircuitProtocolId[] = [],
): RivalCircuitPerformance {
  if (!hud) {
    return { score: winner === "p1" ? 45 : 0, grade: "C", baseScore: winner === "p1" ? 45 : 0, protocolBonus: 0, healthBonus: 0, techniqueBonus: 0 };
  }

  const training = hud.tpsTraining ?? { hits: 0, sideSteps: 0, perfectEvades: 0, punishes: 0, intercepts: 0 };
  const baseScore = winner === "p1" ? 38 : winner === "draw" ? 10 : 0;
  const healthBonus = winner === "p1" ? hud.p1Health * 0.22 : 0;
  const techniqueBonus = winner === "p1"
    ? Math.min(18, training.hits * 2.5)
      + Math.min(12, training.perfectEvades * 5)
      + Math.min(12, training.punishes * 4.5)
      + Math.min(10, training.intercepts * 5)
      + Math.min(6, training.sideSteps * 0.75)
    : 0;

  let protocolBonus = 0;
  if (winner === "p1") {
    for (const id of protocols) {
      const protocol = RIVAL_CIRCUIT_PROTOCOLS[id];
      if (!protocol) continue;
      protocolBonus += Math.min(protocol.cap, metricValue(protocol, hud) * protocol.bonusPerUnit);
    }
  }

  const score = Math.round(clamp(baseScore + healthBonus + techniqueBonus + protocolBonus, 0, 100));
  return {
    score,
    grade: rivalCircuitGradeForScore(score),
    baseScore,
    protocolBonus: Math.round(protocolBonus * 10) / 10,
    healthBonus: Math.round(healthBonus * 10) / 10,
    techniqueBonus: Math.round(techniqueBonus * 10) / 10,
  };
}

export function rivalCircuitProtocolOffers(
  stage: number,
  owned: readonly RivalCircuitProtocolId[],
): RivalCircuitProtocol[] {
  const ownedSet = new Set(owned);
  const primary = OFFER_ROTATION[Math.max(0, stage) % OFFER_ROTATION.length] ?? OFFER_ROTATION[0];
  const fallback = Object.keys(RIVAL_CIRCUIT_PROTOCOLS) as RivalCircuitProtocolId[];
  const ordered = [...primary, ...fallback];
  const unique = ordered.filter((id, index) => ordered.indexOf(id) === index && !ownedSet.has(id));
  return unique.slice(0, 3).map((id) => RIVAL_CIRCUIT_PROTOCOLS[id]);
}

export function rivalCircuitRunGrade(totalScore: number, fightsWon: number): RivalCircuitGrade {
  if (fightsWon <= 0) return "C";
  return rivalCircuitGradeForScore(totalScore / fightsWon);
}
