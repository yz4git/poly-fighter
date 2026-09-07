import type { HudSnapshot } from "./types";

export type TpsTrainingStage = 0 | 1 | 2 | 3 | 4 | 5;

export const TPS_TRAINING_STEPS = [
  { title: "ATTACK", detail: "Close distance and land one ATTACK." },
  { title: "STEP", detail: "Use a sideways STEP. Direction matters." },
  { title: "PERFECT STEP", detail: "Read STEP NOW and evade the committed strike." },
  { title: "PUNISH", detail: "Attack the opening. A REVERSAL also clears this lesson." },
  { title: "INTERCEPT", detail: "When READY appears, ATTACK during WINDUP to intercept." },
  { title: "RIVAL READY", detail: "Training complete. Continue sparring or return to title." },
] as const;

function isSignature(message: string): boolean {
  return ["BREAK LINE", "BLUE SHIFT", "INTERCEPT"].some((token) => message.includes(token));
}

function isReversal(message: string): boolean {
  return ["REVERSAL", "RED REVERSAL", "PHANTOM COUNTER"].some((token) => message.includes(token));
}

export function advanceTpsTrainingStage(
  stage: TpsTrainingStage,
  hud: HudSnapshot,
  previousEnemyHealth: number,
): TpsTrainingStage {
  const message = hud.message ?? "";
  const landedHit = hud.p2Health < previousEnemyHealth;
  if (stage === 0 && landedHit) return 1;
  if (stage === 1 && ["SIDE STEP", "PERFECT STEP", "REVERSAL"].some((token) => message.includes(token))) return 2;
  if (stage === 2 && isReversal(message)) return 4;
  if (stage === 2 && message.includes("PERFECT STEP")) return 3;
  if (stage === 3 && (landedHit || isReversal(message))) return 4;
  if (stage === 4 && isSignature(message)) return 5;
  return stage;
}
