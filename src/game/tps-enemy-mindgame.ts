import type { CpuDifficulty } from "./cpu-director";
import type { EnemyTactic } from "./tps-enemy-policy";
import type { MoveDefinition } from "./types";

const FEINTABLE_MOVES = new Set(["straight", "backfist", "power", "risingKick"]);

/** A bait is committed before its visible LOAD pose: the CPU must not start an
 * actual strike, then secretly cancel an active hitbox. EASY never uses it.
 * Requiring observed upper-pressure makes the deception a *response*, not a
 * sequence chosen from the player's current button state. */
export function shouldTpsCpuFeint(input: {
  difficulty: CpuDifficulty;
  tactic: EnemyTactic;
  observedMode: string;
  observedSamples: number;
  opponentState: string;
  distance: number;
  moveId: string;
  candidateNumber: number;
  ticksSinceLastFeint: number;
}): boolean {
  if (input.difficulty === "EASY"
    || input.tactic !== "BAIT"
    || input.observedMode !== "UPPER_PATTERN"
    || input.observedSamples < 5
    || !["IDLE", "WALK", "GUARD"].includes(input.opponentState)
    || input.distance < 1.32 || input.distance > 2.28
    || !FEINTABLE_MOVES.has(input.moveId)
    || input.ticksSinceLastFeint < 135) return false;
  // Observable one-in-N pacing. The CPU cannot feint every threat and thus
  // cannot become an unpunishable defensive robot after learning a habit.
  return input.candidateNumber % (input.difficulty === "HARD" ? 3 : 4) === 0;
}

export function tpsCpuFeintRevealTick(totalTelegraphTicks: number): number {
  return Math.max(4, Math.ceil(Math.max(1, totalTelegraphTicks) * 0.46));
}

/** A genuine whiff-punish can ONLY be initiated after all active strike ticks,
 * if the strike never touched this defender, the CPU is actionable and the
 * chosen physical move can START before the player's real recovery ends.
 * The move still spends all existing startup and preview/telegraph frames.
 * No hit is guaranteed, no tracking/snap displacement is granted. */
export function chooseTpsCpuWhiffPunish(input: {
  difficulty: CpuDifficulty;
  opponentState: string;
  opponentMove: Pick<MoveDefinition, "startup" | "active" | "recovery"> | null;
  opponentMoveTick: number;
  opponentHitCpu: boolean;
  opponentHitStop: number;
  distance: number;
  cpuActionable: boolean;
  cpuJab: Pick<MoveDefinition, "startup" | "reach"> | null;
  cpuStraight: Pick<MoveDefinition, "startup" | "reach"> | null;
  jabTelegraphTicks: number;
  straightTelegraphTicks: number;
  cooldownTicks: number;
}): "JAB" | "STRAIGHT" | null {
  if (input.difficulty === "EASY"
    || input.opponentState !== "ATTACK"
    || !input.opponentMove
    || input.opponentHitCpu
    || input.opponentHitStop > 0
    || !input.cpuActionable
    || input.cooldownTicks > 0) return null;

  const move = input.opponentMove;
  const recoveryStart = move.startup + move.active;
  const elapsedRecovery = input.opponentMoveTick - recoveryStart;
  const observedLag = input.difficulty === "HARD" ? 3 : 5;
  const remainingRecovery = move.recovery - elapsedRecovery;
  if (elapsedRecovery < observedLag || remainingRecovery <= 0) return null;

  const candidates = [
    { intent: "JAB" as const, move: input.cpuJab, telegraph: input.jabTelegraphTicks },
    { intent: "STRAIGHT" as const, move: input.cpuStraight, telegraph: input.straightTelegraphTicks },
  ];
  for (const candidate of candidates) {
    if (!candidate.move) continue;
    // Being out of the opponent's previous attack lane is not permission to
    // teleport into our own. Use the existing move's actual reach and startup.
    if (input.distance > candidate.move.reach + .07 || input.distance < .60) continue;
    if (remainingRecovery < candidate.telegraph + candidate.move.startup + 1) continue;
    return candidate.intent;
  }
  return null;
}
