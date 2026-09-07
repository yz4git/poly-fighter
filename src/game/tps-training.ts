import type { HudSnapshot, TpsTrainingProgress } from "./types";

export type TpsTrainingStage = 0 | 1 | 2 | 3 | 4 | 5;

export const EMPTY_TPS_TRAINING: Readonly<TpsTrainingProgress> = Object.freeze({
  hits: 0, sideSteps: 0, perfectEvades: 0, punishes: 0, intercepts: 0,
});

export const TPS_TRAINING_STEPS = [
  { title: "ATTACK", detail: "近づいて ATTACK を当てる。" },
  { title: "STEP", detail: "左右に方向入力しながら STEP。" },
  { title: "PERFECT STEP", detail: "相手の攻撃に合わせて横 STEP で回避。" },
  { title: "PUNISH", detail: "回避後に ATTACK を当てて反撃。STEP 中の先行入力も可能。" },
  { title: "INTERCEPT", detail: "WINDUP の予告中に ATTACK を当てて迎撃。" },
  { title: "RIVAL READY", detail: "全課題クリア。そのまま練習を続けられます。" },
] as const;

// Counters come from resolved simulation events. HUD headlines may persist,
// change for drama, or name an attack that has not connected yet.
export function advanceTpsTrainingStage(
  stage: TpsTrainingStage,
  hud: HudSnapshot,
  previous: Readonly<TpsTrainingProgress>,
): TpsTrainingStage {
  const current = hud.tpsTraining;
  if (!current || stage === 5) return stage;
  const key = (["hits", "sideSteps", "perfectEvades", "punishes", "intercepts"] as const)[stage];
  return current[key] > previous[key] ? (stage + 1) as TpsTrainingStage : stage;
}
