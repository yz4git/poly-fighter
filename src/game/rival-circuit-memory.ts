import type { HudSnapshot } from "./types";

export type RivalCircuitMemoryRead =
  | "NONE"
  | "RUSH"
  | "STEP"
  | "PUNISH"
  | "INTERCEPT"
  | "BALANCED";

export interface RivalCircuitMemory {
  fights: number;
  hits: number;
  sideSteps: number;
  perfectEvades: number;
  punishes: number;
  intercepts: number;
  activeSeconds: number;
  read: RivalCircuitMemoryRead;
  confidence: number;
}

export const EMPTY_RIVAL_CIRCUIT_MEMORY: RivalCircuitMemory = Object.freeze({
  fights: 0,
  hits: 0,
  sideSteps: 0,
  perfectEvades: 0,
  punishes: 0,
  intercepts: 0,
  activeSeconds: 0,
  read: "NONE",
  confidence: 0,
});

export const RIVAL_MEMORY_LABELS: Readonly<Record<RivalCircuitMemoryRead, string>> = Object.freeze({
  NONE: "NO READ",
  RUSH: "ATTACK LOOP",
  STEP: "STEP HABIT",
  PUNISH: "PUNISH HABIT",
  INTERCEPT: "INTERCEPT HABIT",
  BALANCED: "MIXED PATTERN",
});

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function classifyRivalCircuitMemory(memory: Omit<RivalCircuitMemory, "read" | "confidence">): Pick<RivalCircuitMemory, "read" | "confidence"> {
  if (memory.fights <= 0) return { read: "NONE", confidence: 0 };

  const durationScale = Math.max(1, memory.activeSeconds / 18);
  const scores: Array<[Exclude<RivalCircuitMemoryRead, "NONE" | "BALANCED">, number]> = [
    ["RUSH", memory.hits / durationScale],
    ["STEP", (memory.sideSteps * 1.15 + memory.perfectEvades * 2.2) / durationScale],
    ["PUNISH", (memory.punishes * 3.25) / durationScale],
    ["INTERCEPT", (memory.intercepts * 3.5) / durationScale],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const first = scores[0] ?? ["RUSH", 0];
  const second = scores[1] ?? ["STEP", 0];
  const totalSignal = scores.reduce((sum, entry) => sum + entry[1], 0);

  if (totalSignal < 1.4 || first[1] < 0.9) return { read: "BALANCED", confidence: 0.32 };
  const separation = (first[1] - second[1]) / Math.max(0.001, first[1]);
  if (separation < 0.18) return { read: "BALANCED", confidence: clamp01(0.34 + separation) };
  return {
    read: first[0],
    confidence: clamp01(0.48 + separation * 0.52 + Math.min(0.12, memory.fights * 0.025)),
  };
}

export function updateRivalCircuitMemory(
  current: RivalCircuitMemory,
  hud: HudSnapshot | null,
): RivalCircuitMemory {
  if (!hud) return current;
  const training = hud.tpsTraining;
  const nextBase = {
    fights: current.fights + 1,
    hits: current.hits + (training?.hits ?? 0),
    sideSteps: current.sideSteps + (training?.sideSteps ?? 0),
    perfectEvades: current.perfectEvades + (training?.perfectEvades ?? 0),
    punishes: current.punishes + (training?.punishes ?? 0),
    intercepts: current.intercepts + (training?.intercepts ?? 0),
    activeSeconds: current.activeSeconds + Math.max(8, 99 - Math.max(0, Math.min(99, hud.timer))),
  };
  return { ...nextBase, ...classifyRivalCircuitMemory(nextBase) };
}

export function rivalMemorySignatureIntervalScale(read: RivalCircuitMemoryRead, effectiveStyle: string): number {
  if (read === "RUSH") return effectiveStyle === "COUNTER" ? 0.86 : 0.96;
  if (read === "STEP") return effectiveStyle === "STEP_HUNTER" ? 0.84 : 1.02;
  if (read === "PUNISH") return 1.1;
  if (read === "INTERCEPT") return 1.14;
  return 1;
}

export function publishRivalCircuitMemoryToDom(memory: RivalCircuitMemory | null): void {
  if (typeof document === "undefined") return;
  if (!memory) {
    delete document.body.dataset.rivalCircuitMemoryPolicy;
    delete document.body.dataset.rivalCircuitMemoryRead;
    delete document.body.dataset.rivalCircuitMemoryConfidence;
    delete document.body.dataset.rivalCircuitMemoryFights;
    return;
  }
  document.body.dataset.rivalCircuitMemoryPolicy = "RIVAL_MEMORY_V1";
  document.body.dataset.rivalCircuitMemoryRead = memory.read;
  document.body.dataset.rivalCircuitMemoryConfidence = memory.confidence.toFixed(3);
  document.body.dataset.rivalCircuitMemoryFights = String(memory.fights);
}

export function readRivalCircuitMemoryFromDom(): { read: RivalCircuitMemoryRead; confidence: number; fights: number } {
  if (typeof document === "undefined") return { read: "NONE", confidence: 0, fights: 0 };
  if (document.body.dataset.rivalCircuitMemoryPolicy !== "RIVAL_MEMORY_V1") {
    return { read: "NONE", confidence: 0, fights: 0 };
  }
  const candidate = document.body.dataset.rivalCircuitMemoryRead as RivalCircuitMemoryRead | undefined;
  const read: RivalCircuitMemoryRead = candidate && candidate in RIVAL_MEMORY_LABELS ? candidate : "NONE";
  return {
    read,
    confidence: clamp01(Number(document.body.dataset.rivalCircuitMemoryConfidence ?? "0") || 0),
    fights: Math.max(0, Number(document.body.dataset.rivalCircuitMemoryFights ?? "0") || 0),
  };
}
