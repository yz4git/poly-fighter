import { isAttackIntent, type CpuActorSnapshot, type CpuDecision, type CpuIntent } from "./cpu-director";
import type { CpuDifficulty, FighterRuntime } from "./fighter";

export type EnemyTactic = "PRESSURE" | "ORBIT" | "BAIT";
export type EnemyPersona = "BRAWLER" | "SKIRMISHER";
export type EnemyAdaptation = "NEUTRAL" | "ANTI_STEP" | "ANTI_RUSH" | "CUT_RETREAT" | "MIRROR_LEFT" | "MIRROR_RIGHT" | "HUNT_INTERCEPT";

const TPS_REACTABLE_TELEGRAPH_TICKS: Readonly<Record<CpuDifficulty, number>> = Object.freeze({
  EASY: 22,
  NORMAL: 18,
  HARD: 15,
});

const TPS_REACTIVE_STEP_WINDOW_TICKS: Readonly<Record<CpuDifficulty, number>> = Object.freeze({
  EASY: 14,
  NORMAL: 12,
  HARD: 10,
});

const TPS_HEAVY_TELEGRAPH_BONUS_TICKS = 5;
const TPS_HEAVY_TELEGRAPH_MOVES = new Set(["power", "risingKick", "dashKick", "throw", "counter"]);

const TPS_CPU_ATTACK_MOVES: Partial<Record<CpuIntent, string>> = {
  JAB: "jab",
  STRAIGHT: "straight",
  BACKFIST: "backfist",
  BODY_BLOW: "bodyBlow",
  POWER: "power",
  KICK: "kick",
  LOW_KICK: "lowKick",
  RISING_KICK: "risingKick",
  DASH_KICK: "dashKick",
  THROW: "throw",
  COUNTER: "counter",
};

export function tpsCpuActorSnapshot(fighter: FighterRuntime): CpuActorSnapshot {
  return {
    health: fighter.health,
    guardDamage: fighter.guardDamage,
    state: fighter.state,
    moveId: fighter.currentMove?.id ?? null,
    movePower: fighter.currentMove?.power ?? 0,
    isActive: fighter.isActive(),
    grounded: fighter.grounded,
    x: fighter.position.x,
    z: fighter.position.z,
    facing: fighter.facing,
  };
}

export function tpsCpuAttackMove(intent: CpuIntent): string | null {
  return TPS_CPU_ATTACK_MOVES[intent] ?? null;
}

export function minimumTpsEnemyTelegraphTicks(difficulty: CpuDifficulty, moveId: string): number {
  const baseTicks = TPS_REACTABLE_TELEGRAPH_TICKS[difficulty];
  return baseTicks + (TPS_HEAVY_TELEGRAPH_MOVES.has(moveId) ? TPS_HEAVY_TELEGRAPH_BONUS_TICKS : 0);
}

export function tpsEnemyReactionWindowTicks(difficulty: CpuDifficulty): number {
  return TPS_REACTIVE_STEP_WINDOW_TICKS[difficulty];
}

export type TpsEnemyHabitSamples = {
  attacks: number;
  steps: number;
  retreats: number;
  leftSteps: number;
  rightSteps: number;
  intercepts: number;
  reversals: number;
};

export function reviewTpsEnemyHabits(
  current: EnemyAdaptation,
  samples: TpsEnemyHabitSamples,
): {
  adaptation: EnemyAdaptation;
  readLabel: string | null;
  samples: TpsEnemyHabitSamples;
} {
  const actionSamples = samples.attacks + samples.steps;
  const movementSamples = actionSamples + samples.retreats;
  const stepBiasSamples = samples.leftSteps + samples.rightSteps;
  let adaptation = current;

  if (movementSamples >= 5) {
    const stepRatio = samples.steps / Math.max(1, actionSamples);
    const attackRatio = samples.attacks / Math.max(1, actionSamples);
    const retreatRatio = samples.retreats / Math.max(1, movementSamples);
    const sideBias = stepBiasSamples > 0
      ? (samples.rightSteps - samples.leftSteps) / stepBiasSamples
      : 0;

    adaptation = samples.intercepts >= 2
      ? "HUNT_INTERCEPT"
      : retreatRatio >= 0.38
        ? "CUT_RETREAT"
        : stepRatio >= 0.52 && Math.abs(sideBias) >= 0.55
          ? sideBias > 0 ? "MIRROR_RIGHT" : "MIRROR_LEFT"
          : stepRatio >= 0.58
            ? "ANTI_STEP"
            : attackRatio >= 0.62 ? "ANTI_RUSH" : "NEUTRAL";
  }

  const readLabel = current !== adaptation && adaptation !== "NEUTRAL"
    ? adaptation === "ANTI_STEP" ? "ANTI STEP"
      : adaptation === "ANTI_RUSH" ? "ANTI RUSH"
        : adaptation === "CUT_RETREAT" ? "CUT OFF"
          : adaptation === "HUNT_INTERCEPT" ? "HUNT INTERCEPT"
            : adaptation === "MIRROR_LEFT" ? "CUT LEFT"
              : "CUT RIGHT"
    : null;

  return {
    adaptation,
    readLabel,
    samples: {
      attacks: Math.floor(samples.attacks * 0.45),
      steps: Math.floor(samples.steps * 0.45),
      retreats: Math.floor(samples.retreats * 0.40),
      leftSteps: Math.floor(samples.leftSteps * 0.40),
      rightSteps: Math.floor(samples.rightSteps * 0.40),
      intercepts: Math.floor(samples.intercepts * 0.35),
      reversals: Math.floor(samples.reversals * 0.35),
    },
  };
}

export function adaptTpsCpuDecision(
  initialDecision: CpuDecision,
  context: {
    persona: EnemyPersona;
    adaptation: EnemyAdaptation;
    liveDistance: number;
    simulationTicks: number;
  },
): CpuDecision {
  let decision = initialDecision;

  // TPS is a grounded lock-on mode. Translate the shared neutral hop into an
  // orbital beat rather than introducing camera-hostile bunny hopping.
  if (decision.intent === "JUMP") {
    decision = { ...decision, intent: "SIDESTEP", reason: `${decision.reason}-as-orbit` };
  }

  if (context.persona === "BRAWLER" && decision.intent === "RETREAT" && context.liveDistance > 1.65) {
    decision = { ...decision, intent: "APPROACH", reason: `${decision.reason}-brawler-pressure` };
  } else if (context.persona === "SKIRMISHER" && decision.intent === "APPROACH" && context.liveDistance < 1.85) {
    decision = { ...decision, intent: "SIDESTEP", reason: `${decision.reason}-skirmisher-angle` };
  }

  if (
    context.adaptation === "HUNT_INTERCEPT"
    && isAttackIntent(decision.intent)
    && decision.telegraphTicks > 0
    && context.simulationTicks % 4 === 0
  ) {
    decision = {
      ...decision,
      intent: "WAIT",
      holdTicks: Math.max(2, decision.holdTicks),
      telegraphTicks: 0,
      reason: "adapt-hunt-intercept-feint",
    };
  } else if (
    context.adaptation === "ANTI_STEP"
    && isAttackIntent(decision.intent)
    && context.simulationTicks % 3 === 0
  ) {
    decision = {
      ...decision,
      intent: "COUNTER",
      telegraphTicks: Math.max(4, decision.telegraphTicks),
      reason: "adapt-anti-step-counter",
    };
  } else if (context.adaptation === "ANTI_RUSH" && decision.intent === "WAIT" && context.liveDistance < 2.0) {
    decision = { ...decision, intent: "RETREAT", reason: "adapt-anti-rush-reset" };
  } else if (
    context.adaptation === "CUT_RETREAT"
    && ["WAIT", "RETREAT"].includes(decision.intent)
    && context.liveDistance > 1.25
  ) {
    decision = { ...decision, intent: "APPROACH", reason: "adapt-cut-retreat-lane" };
  } else if (
    ["MIRROR_LEFT", "MIRROR_RIGHT"].includes(context.adaptation)
    && decision.intent === "WAIT"
  ) {
    decision = { ...decision, intent: "SIDESTEP", reason: "adapt-directional-cut" };
  }

  return decision;
}
