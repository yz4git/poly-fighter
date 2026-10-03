export type TpsMatchDramaPhase =
  | "OPENING"
  | "NEUTRAL"
  | "PRESSURE"
  | "COMEBACK"
  | "CLUTCH"
  | "FINISH";

export type TpsMatchDramaResult = {
  phase: TpsMatchDramaPhase;
  intensity: number;
  beatLabel: string | null;
  beatTicks: number;
};

export function computeTpsMatchDrama(input: {
  previousPhase: TpsMatchDramaPhase;
  timerTicks: number;
  p1Health: number;
  p2Health: number;
  playerComboStage: number;
  playerPerfectEvadeTicks: number;
  combatBeatTicks: number;
}): TpsMatchDramaResult {
  const healthGap = Math.abs(input.p1Health - input.p2Health);
  const bothLow = input.p1Health <= 32 && input.p2Health <= 32;
  const someoneCritical = Math.min(input.p1Health, input.p2Health) <= 16;
  const comebackState = healthGap >= 24 && Math.min(input.p1Health, input.p2Health) <= 42;
  const pressureState = input.playerComboStage >= 2
    || input.playerPerfectEvadeTicks > 0
    || input.combatBeatTicks > 0
    || healthGap >= 34;

  const phase: TpsMatchDramaPhase = input.timerTicks > 93 * 60
    ? "OPENING"
    : someoneCritical
      ? "FINISH"
      : bothLow
        ? "CLUTCH"
        : comebackState
          ? "COMEBACK"
          : pressureState
            ? "PRESSURE"
            : "NEUTRAL";

  const intensity = phase === "FINISH"
    ? 0.96
    : phase === "CLUTCH"
      ? 0.84
      : phase === "COMEBACK"
        ? 0.66
        : phase === "PRESSURE"
          ? 0.48
          : phase === "NEUTRAL" ? 0.28 : 0.14;

  let beatLabel: string | null = null;
  let beatTicks = 0;
  if (input.previousPhase !== phase) {
    if (phase === "CLUTCH") {
      beatLabel = "CLUTCH";
      beatTicks = 30;
    } else if (phase === "FINISH") {
      beatLabel = "FINAL STAND";
      beatTicks = 30;
    } else if (phase === "COMEBACK") {
      beatLabel = "MOMENTUM SHIFT";
      beatTicks = 26;
    }
  }

  return { phase, intensity, beatLabel, beatTicks };
}
