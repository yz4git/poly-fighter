import type { TpsWinner } from "./tps-finish-flow";
import type { FighterState, HudSnapshot, TpsTrainingProgress } from "./types";

export type TpsHudSnapshotInput = {
  trainingProgress: TpsTrainingProgress;
  enemyThreat: { windup: boolean; incoming: boolean };
  finishPending: boolean;
  finished: boolean;
  playerReversalTicks: number;
  playerPerfectEvadeTicks: number;
  playerEvadeTicks: number;
  playerStepSideWeight: number;
  playerFlankWindowTicks: number;
  playerComboStage: number;
  combatBeatTicks: number;
  combatBeatLabel: string | null;
  enemyOpeningGraceTicks: number;
  p1State: FighterState;
  p2State: FighterState;
  p1MoveId: string | null;
  fightDistance: number;
  strikeRange: number;
  timerTicks: number;
  p1Health: number;
  p2Health: number;
  resultWinner: TpsWinner | null;
  p1Name: string;
  p2Name: string;
};

export function buildTpsHudSnapshot(input: TpsHudSnapshotInput): HudSnapshot {
  const tpsCue: NonNullable<HudSnapshot["tpsCue"]> = input.finishPending || input.finished
    ? "NONE"
    : input.enemyThreat.incoming
      ? "INCOMING"
      : input.playerReversalTicks > 0 || input.playerPerfectEvadeTicks > 0
        ? "PUNISH"
        : input.enemyThreat.windup
          ? "WINDUP"
          : input.fightDistance < input.strikeRange ? "RANGE" : "NONE";

  const message = input.finished
    ? "BATTLE COMPLETE"
    : input.combatBeatTicks > 0 && input.combatBeatLabel
      ? input.combatBeatLabel
      : input.finishPending
        ? "KO"
        : input.p1State === "ATTACK" && input.p1MoveId === "dashKick"
          ? "DASH ATTACK"
          : input.playerPerfectEvadeTicks > 0
            ? "PERFECT STEP"
            : input.playerEvadeTicks > 0 && input.playerStepSideWeight > 0.45
              ? "SIDE STEP"
              : input.playerFlankWindowTicks > 0 && input.playerStepSideWeight > 0.45
                ? "FLANK OPEN"
                : input.p1State === "ATTACK" && input.playerComboStage > 1
                  ? `COMBO ${input.playerComboStage}`
                  : input.enemyOpeningGraceTicks > 0
                    ? "READ THE TARGET"
                    : input.enemyThreat.windup
                      ? "WINDUP"
                      : input.enemyThreat.incoming
                        ? "INCOMING"
                        : input.fightDistance < input.strikeRange
                          ? "STRIKE RANGE"
                          : "TARGET LOCKED";

  return {
    phase: "MATCH",
    tpsTraining: { ...input.trainingProgress },
    tpsCue,
    round: 1,
    timer: Math.ceil(input.timerTicks / 60),
    p1Health: input.p1Health,
    p2Health: input.p2Health,
    p1Wins: input.finished && input.resultWinner === "p1" ? 1 : 0,
    p2Wins: input.finished && input.resultWinner === "p2" ? 1 : 0,
    p1Name: input.p1Name,
    p2Name: input.p2Name,
    message,
    p1State: input.p1State,
    p2State: input.p2State,
  };
}
