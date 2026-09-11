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
    arenaLabel: "RING 01 // GLASSLINE",
    rule: "CLEAR LINE // BREAK THE OPENING RUSH",
    description: "The baseline ring. Read the direct opener with standard footing, clean ATTACK confirms, and disciplined STEP timing.",
  },
  {
    id: "angle-hunter",
    order: 2,
    codename: "VECTOR",
    title: "ANGLE HUNTER",
    fighterId: "red",
    difficulty: "NORMAL",
    style: "ANGLE",
    arenaLabel: "RING 02 // OFFSET",
    rule: "OFFSET FLOW // WIN THE FLANK",
    description: "Ordinary grounded movement is 8% faster for both fighters, turning neutral into a quicker angle fight while STEP keeps its authored timing.",
  },
  {
    id: "counter-node",
    order: 3,
    codename: "REFLEX",
    title: "COUNTER NODE",
    fighterId: "blue",
    difficulty: "NORMAL",
    style: "COUNTER",
    arenaLabel: "RING 03 // COLD",
    rule: "COLD FOOTING // DRAW THE RESPONSE",
    description: "Ordinary grounded movement is 8% slower for both fighters, making spacing more deliberate while STEP remains fully responsive.",
  },
  {
    id: "step-hunter",
    order: 4,
    codename: "LOCKSTEP",
    title: "STEP HUNTER",
    fighterId: "red",
    difficulty: "HARD",
    style: "STEP_HUNTER",
    arenaLabel: "RING 04 // REDLINE",
    rule: "REDLINE CONTRACT // DON'T BECOME PREDICTABLE",
    description: "The playable ring contracts gradually as the fight runs long. Both fighters share the same boundary, so late neutral becomes a close-range read test.",
  },
  {
    id: "apex-proxy",
    order: 5,
    codename: "APEX-0",
    title: "FINAL RIVAL",
    fighterId: "blue",
    difficulty: "HARD",
    style: "APEX",
    arenaLabel: "RING 05 // APEX",
    rule: "APEX CONVERGENCE // PROVE THE WHOLE KIT",
    description: "APEX-0 closes the ring at each health phase. CALIBRATE, ADAPT, and ZERO progressively compress the arena without changing damage or telegraph fairness.",
  },
]);

export const RIVAL_CIRCUIT_PROTOCOLS: Readonly<Record<RivalCircuitProtocolId, RivalCircuitProtocol>> = Object.freeze({
  PRESSURE_STACK: Object.freeze({
    id: "PRESSURE_STACK",
    name: "PRESSURE STACK",
    kicker: "ATTACK ROUTE",
    detail: "Confirmed hits keep your combo route alive longer, making deliberate pressure chains easier to sustain.",
    metric: "hits",
    bonusPerUnit: 1.5,
    cap: 12,
  }),
  PHASE_STEP: Object.freeze({
    id: "PHASE_STEP",
    name: "PHASE STEP",
    kicker: "EVADE ROUTE",
    detail: "Perfect STEP refreshes STEP sooner and extends the earned reversal timing. Precision creates mobility.",
    metric: "perfectEvades",
    bonusPerUnit: 5,
    cap: 15,
  }),
  PUNISH_DRIVE: Object.freeze({
    id: "PUNISH_DRIVE",
    name: "PUNISH DRIVE",
    kicker: "COUNTER ROUTE",
    detail: "A confirmed reversal arms one short pursuit drive, letting the next ATTACK stay on a retreating rival.",
    metric: "punishes",
    bonusPerUnit: 5,
    cap: 15,
  }),
  INTERCEPT_CORE: Object.freeze({
    id: "INTERCEPT_CORE",
    name: "INTERCEPT CORE",
    kicker: "READ ROUTE",
    detail: "WINDUP reads stay intercept-valid longer, and a successful intercept preserves your follow-up route.",
    metric: "intercepts",
    bonusPerUnit: 6,
    cap: 18,
  }),
  CLUTCH_VECTOR: Object.freeze({
    id: "CLUTCH_VECTOR",
    name: "CLUTCH VECTOR",
    kicker: "SURVIVAL ROUTE",
    detail: "At critical health, committed STEP actions cool down sooner so survival comes from movement, not armor.",
    metric: "health",
    bonusPerUnit: 0.09,
    cap: 9,
  }),
  CLEAN_LINE: Object.freeze({
    id: "CLEAN_LINE",
    name: "CLEAN LINE",
    kicker: "TEMPO ROUTE",
    detail: "While health stays high, ordinary grounded movement gains extra tempo for cleaner spacing and initiative.",
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

  const score = clamp(Math.round(baseScore + healthBonus + techniqueBonus + protocolBonus), 0, 100);
  return {
    score,
    grade: rivalCircuitGradeForScore(score),
    baseScore,
    protocolBonus: Math.round(protocolBonus),
    healthBonus: Math.round(healthBonus),
    techniqueBonus: Math.round(techniqueBonus),
  };
}

export function rivalCircuitProtocolOffers(
  stageIndex: number,
  owned: readonly RivalCircuitProtocolId[],
): RivalCircuitProtocol[] {
  const preferred = OFFER_ROTATION[Math.max(0, Math.min(OFFER_ROTATION.length - 1, stageIndex))] ?? OFFER_ROTATION[0];
  const unusedPreferred = preferred.filter((id) => !owned.includes(id));
  const fallback = (Object.keys(RIVAL_CIRCUIT_PROTOCOLS) as RivalCircuitProtocolId[]).filter((id) => !owned.includes(id));
  const ids = [...unusedPreferred, ...fallback.filter((id) => !unusedPreferred.includes(id))].slice(0, 3);
  return ids.map((id) => RIVAL_CIRCUIT_PROTOCOLS[id]);
}

export function rivalCircuitRunGrade(score: number, wins: number): RivalCircuitGrade {
  if (wins <= 0) return "C";
  const average = score / Math.max(1, wins);
  const completionBonus = wins >= RIVAL_CIRCUIT_ENCOUNTERS.length ? 4 : 0;
  return rivalCircuitGradeForScore(clamp(Math.round(average + completionBonus), 0, 100));
}
