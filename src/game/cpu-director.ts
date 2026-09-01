import type { InputFrame, FighterState } from "./types";
import { EMPTY_INPUT, cloneInput } from "./types";

export type CpuDifficulty = "EASY" | "NORMAL" | "HARD";

export type CpuIntent =
  | "WAIT"
  | "APPROACH"
  | "RETREAT"
  | "GUARD"
  | "SIDESTEP"
  | "JUMP"
  | "JAB"
  | "STRAIGHT"
  | "BACKFIST"
  | "BODY_BLOW"
  | "POWER"
  | "KICK"
  | "LOW_KICK"
  | "RISING_KICK"
  | "DASH_KICK"
  | "THROW"
  | "COUNTER";

export interface CpuActorSnapshot {
  health: number;
  guardDamage: number;
  state: FighterState;
  moveId: string | null;
  movePower: number;
  isActive: boolean;
  grounded: boolean;
  x: number;
  z: number;
  facing: number;
}

export interface CpuSituation {
  self: CpuActorSnapshot;
  opponent: CpuActorSnapshot;
  distance: number;
}

export interface CpuDecision {
  intent: CpuIntent;
  holdTicks: number;
  telegraphTicks: number;
  reason: string;
  comebackMercy: number;
  pressure: number;
}

export interface CpuInputStep {
  frame: InputFrame;
  ticks: number;
}

type CpuProfile = {
  reaction: number;
  aggression: number;
  adaptation: number;
  breatherAfterHit: number;
  wakeupCourtesy: number;
  telegraph: number;
  cadence: number;
};

const PROFILES: Record<CpuDifficulty, CpuProfile> = {
  EASY: {
    reaction: 0.28,
    aggression: 0.42,
    adaptation: 0.24,
    breatherAfterHit: 34,
    wakeupCourtesy: 30,
    telegraph: 9,
    cadence: 10,
  },
  NORMAL: {
    reaction: 0.52,
    aggression: 0.60,
    adaptation: 0.56,
    breatherAfterHit: 24,
    wakeupCourtesy: 21,
    telegraph: 6,
    cadence: 8,
  },
  HARD: {
    reaction: 0.74,
    aggression: 0.72,
    adaptation: 0.82,
    breatherAfterHit: 16,
    wakeupCourtesy: 14,
    telegraph: 3,
    cadence: 6,
  },
};

const ATTACK_INTENTS = new Set<CpuIntent>([
  "JAB",
  "STRAIGHT",
  "BACKFIST",
  "BODY_BLOW",
  "POWER",
  "KICK",
  "LOW_KICK",
  "RISING_KICK",
  "DASH_KICK",
  "THROW",
  "COUNTER",
]);

const FINISHER_INTENTS = new Set<CpuIntent>(["POWER", "DASH_KICK", "RISING_KICK", "THROW"]);
const RECOVERY_STATES = new Set<FighterState>(["HIT", "BLOCK_STUN", "KNOCKDOWN", "THROW", "WAKEUP"]);

export function isAttackIntent(intent: CpuIntent): boolean {
  return ATTACK_INTENTS.has(intent);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function neutralFrame(patch: Partial<InputFrame> = {}): InputFrame {
  return { ...cloneInput(EMPTY_INPUT), ...patch };
}

function directionPatch(facing: number, toward: boolean): Partial<InputFrame> {
  const positive = facing >= 0;
  if (toward) return positive ? { right: true } : { left: true };
  return positive ? { left: true } : { right: true };
}

export function buildCpuInputPlan(decision: CpuDecision, facing: number): CpuInputStep[] {
  const steps: CpuInputStep[] = [];
  const toward = directionPatch(facing, true);
  const away = directionPatch(facing, false);

  const telegraph = (guard = true): void => {
    if (decision.telegraphTicks <= 0) return;
    steps.push({ frame: neutralFrame(guard ? { guard: true } : {}), ticks: decision.telegraphTicks });
    steps.push({ frame: neutralFrame(), ticks: 1 });
  };

  switch (decision.intent) {
    case "WAIT":
      steps.push({ frame: neutralFrame(), ticks: decision.holdTicks });
      break;
    case "APPROACH":
      steps.push({ frame: neutralFrame(toward), ticks: decision.holdTicks });
      break;
    case "RETREAT":
      steps.push({ frame: neutralFrame(away), ticks: decision.holdTicks });
      break;
    case "GUARD":
      steps.push({ frame: neutralFrame({ guard: true }), ticks: decision.holdTicks });
      break;
    case "SIDESTEP":
      steps.push({ frame: neutralFrame({ guard: true, up: true }), ticks: Math.max(3, decision.holdTicks) });
      break;
    case "JUMP":
      steps.push({ frame: neutralFrame({ up: true }), ticks: 1 });
      steps.push({ frame: neutralFrame(), ticks: Math.max(4, decision.holdTicks) });
      break;
    case "JAB":
      steps.push({ frame: neutralFrame({ punch: true }), ticks: 1 });
      break;
    case "STRAIGHT":
      steps.push({ frame: neutralFrame({ ...toward, punch: true }), ticks: 1 });
      break;
    case "BACKFIST":
      steps.push({ frame: neutralFrame({ ...away, punch: true }), ticks: 1 });
      break;
    case "BODY_BLOW":
      steps.push({ frame: neutralFrame({ down: true, punch: true }), ticks: 1 });
      break;
    case "POWER":
      telegraph();
      steps.push({ frame: neutralFrame({ punch: true, kick: true }), ticks: 1 });
      break;
    case "KICK":
      steps.push({ frame: neutralFrame({ kick: true }), ticks: 1 });
      break;
    case "LOW_KICK":
      steps.push({ frame: neutralFrame({ down: true, kick: true }), ticks: 1 });
      break;
    case "RISING_KICK":
      telegraph(false);
      steps.push({ frame: neutralFrame({ up: true, kick: true }), ticks: 1 });
      break;
    case "DASH_KICK":
      telegraph(false);
      steps.push({ frame: neutralFrame(toward), ticks: 2 });
      steps.push({ frame: neutralFrame({ ...toward, kick: true }), ticks: 1 });
      break;
    case "THROW":
      telegraph();
      steps.push({ frame: neutralFrame({ kick: true, guard: true }), ticks: 1 });
      break;
    case "COUNTER":
      telegraph();
      steps.push({ frame: neutralFrame({ punch: true, guard: true }), ticks: 1 });
      break;
  }

  if (isAttackIntent(decision.intent)) steps.push({ frame: neutralFrame(), ticks: 2 });
  return steps;
}

export class CpuFunDirector {
  private seed: number;
  private readonly profile: CpuProfile;
  private lastOpponentHealth = 100;
  private lastSelfHealth = 100;
  private lastOpponentState: FighterState = "IDLE";
  private lastDistance = 99;
  private breatherTicks = 0;
  private wakeupCourtesyTicks = 0;
  private playerAttackHabit = 0;
  private playerGuardHabit = 0;
  private playerCrouchHabit = 0;
  private playerAdvanceHabit = 0;
  private retaliation = 0;
  private pressure = 0;
  private recentAttacks: CpuIntent[] = [];

  constructor(private readonly difficulty: CpuDifficulty = "NORMAL", seed = 17) {
    this.profile = PROFILES[difficulty];
    this.seed = seed;
  }

  private random(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  observe(situation: CpuSituation): void {
    const { self, opponent, distance } = situation;
    const decay = 0.985;
    this.playerAttackHabit = clamp01(this.playerAttackHabit * decay + (opponent.state === "ATTACK" ? 0.025 : 0));
    this.playerGuardHabit = clamp01(this.playerGuardHabit * decay + (opponent.state === "GUARD" ? 0.030 : 0));
    this.playerCrouchHabit = clamp01(this.playerCrouchHabit * decay + (opponent.state === "CROUCH" ? 0.030 : 0));
    const closing = Number.isFinite(this.lastDistance) && distance < this.lastDistance - 0.012;
    this.playerAdvanceHabit = clamp01(this.playerAdvanceHabit * 0.988 + (closing ? 0.020 : 0));

    if (opponent.health < this.lastOpponentHealth - 0.05) {
      this.breatherTicks = Math.max(this.breatherTicks, this.profile.breatherAfterHit);
      this.pressure += 1;
    }
    if (self.health < this.lastSelfHealth - 0.05) {
      this.retaliation = clamp01(this.retaliation + 0.38);
      this.pressure = Math.max(0, this.pressure - 1);
    } else {
      this.retaliation *= 0.992;
    }

    const recovered = RECOVERY_STATES.has(this.lastOpponentState)
      && ["IDLE", "WALK", "CROUCH", "GUARD", "JUMP", "SIDESTEP"].includes(opponent.state);
    if (recovered || opponent.state === "WAKEUP") {
      this.wakeupCourtesyTicks = Math.max(this.wakeupCourtesyTicks, this.profile.wakeupCourtesy);
    }

    if (this.breatherTicks > 0) this.breatherTicks -= 1;
    if (this.wakeupCourtesyTicks > 0) this.wakeupCourtesyTicks -= 1;
    this.lastOpponentHealth = opponent.health;
    this.lastSelfHealth = self.health;
    this.lastOpponentState = opponent.state;
    this.lastDistance = distance;
  }

  private recentPenalty(intent: CpuIntent): number {
    if (!isAttackIntent(intent)) return 1;
    const last = this.recentAttacks.at(-1);
    const previous = this.recentAttacks.at(-2);
    if (last === intent && previous === intent) return 0;
    if (last === intent) return 0.22;
    return this.recentAttacks.includes(intent) ? 0.58 : 1;
  }

  private remember(intent: CpuIntent): void {
    if (isAttackIntent(intent)) {
      this.recentAttacks.push(intent);
      if (this.recentAttacks.length > 5) this.recentAttacks.shift();
      this.pressure += 1;
    } else {
      this.pressure = Math.max(0, this.pressure - 1);
    }
  }

  private chooseWeighted(candidates: Array<[CpuIntent, number]>): CpuIntent {
    const weighted = candidates
      .map(([intent, weight]) => [intent, Math.max(0, weight * this.recentPenalty(intent))] as const)
      .filter(([, weight]) => weight > 0);
    const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) return "WAIT";
    let roll = this.random() * total;
    for (const [intent, weight] of weighted) {
      roll -= weight;
      if (roll <= 0) return intent;
    }
    return weighted.at(-1)?.[0] ?? "WAIT";
  }

  private decision(intent: CpuIntent, reason: string, comebackMercy: number): CpuDecision {
    const heavy = FINISHER_INTENTS.has(intent) || intent === "COUNTER";
    const telegraphTicks = heavy ? this.profile.telegraph : 0;
    const holdTicks = intent === "WAIT"
      ? this.profile.cadence
      : intent === "APPROACH" || intent === "RETREAT"
        ? this.profile.cadence + 2
        : intent === "GUARD" || intent === "SIDESTEP"
          ? Math.max(4, this.profile.cadence - 1)
          : 1;
    this.remember(intent);
    return {
      intent,
      holdTicks,
      telegraphTicks,
      reason,
      comebackMercy,
      pressure: this.pressure,
    };
  }

  decide(situation: CpuSituation): CpuDecision {
    const { self, opponent, distance } = situation;
    const cpuLead = clamp01((self.health - opponent.health) / 48);
    const cpuBehind = clamp01((opponent.health - self.health) / 48);
    const playerCritical = opponent.health <= 28 ? 0.35 : 0;
    const comebackMercy = clamp01(cpuLead * 0.78 + playerCritical);
    const threat = opponent.state === "ATTACK" && opponent.isActive && distance < 2.55;
    const playerRecovering = RECOVERY_STATES.has(opponent.state);

    if (!self.grounded && self.state !== "JUMP") {
      return this.decision("WAIT", "airborne-stability", comebackMercy);
    }

    if (playerRecovering || this.wakeupCourtesyTicks > 0) {
      const intent = distance < 1.75
        ? (this.random() < 0.55 ? "RETREAT" : "GUARD")
        : (this.random() < 0.55 ? "WAIT" : "GUARD");
      return this.decision(intent, "give-player-turn-after-recovery", comebackMercy);
    }

    if (this.breatherTicks > 0 && distance < 2.4) {
      const intent = this.random() < 0.45 ? "RETREAT" : this.random() < 0.72 ? "GUARD" : "WAIT";
      return this.decision(intent, "breathing-room-after-hit", comebackMercy);
    }

    if (threat) {
      const reactionChance = this.profile.reaction * (1 - comebackMercy * 0.42);
      if (this.random() < reactionChance) {
        const counterChance = (0.08 + this.playerAttackHabit * 0.30) * this.profile.adaptation;
        const evadeChance = 0.20 + this.playerAdvanceHabit * 0.18;
        const roll = this.random();
        if (roll < counterChance && this.difficulty !== "EASY") {
          return this.decision("COUNTER", "read-player-attack", comebackMercy);
        }
        if (roll < counterChance + evadeChance) {
          return this.decision("SIDESTEP", "evade-with-readable-answer", comebackMercy);
        }
        return this.decision("GUARD", "respect-player-offense", comebackMercy);
      }
      return this.decision(this.random() < 0.5 ? "WAIT" : "RETREAT", "allow-player-attack-to-land", comebackMercy);
    }

    if (distance > 2.75) {
      // A readable neutral hop keeps long-range footsies visually alive and
      // preserves the old invariant that CPU movement exercises airborne physics.
      // It is deliberately uncommon so it reads as a beat, not bunny-hopping.
      if (this.random() < (this.difficulty === "EASY" ? 0.09 : 0.14)) {
        return this.decision("JUMP", "neutral-hop-to-vary-rhythm", comebackMercy);
      }
      const dashChance = this.profile.aggression * 0.22 * (1 - comebackMercy * 0.72);
      const intent = this.difficulty !== "EASY" && this.random() < dashChance ? "DASH_KICK" : "APPROACH";
      return this.decision(intent, intent === "DASH_KICK" ? "telegraphed-gap-closer" : "close-distance", comebackMercy);
    }

    if (distance > 2.0) {
      const intent = this.chooseWeighted([
        ["APPROACH", 1.25],
        ["WAIT", 0.44 + comebackMercy * 0.8],
        ["GUARD", 0.35],
        ["JUMP", 0.10],
        ["STRAIGHT", 0.58 * this.profile.aggression],
        ["KICK", 0.76 * this.profile.aggression],
        ["LOW_KICK", 0.35 * this.profile.aggression],
        ["DASH_KICK", 0.20 * this.profile.aggression * (1 - comebackMercy * 0.65)],
      ]);
      return this.decision(intent, "mid-range-pacing", comebackMercy);
    }

    const guardRead = this.playerGuardHabit * this.profile.adaptation;
    const crouchRead = this.playerCrouchHabit * this.profile.adaptation;
    const attackRead = this.playerAttackHabit * this.profile.adaptation;
    const pressureBrake = this.pressure >= 3 ? 0.55 : 1;
    const mercyAttackScale = 1 - comebackMercy * 0.58;

    const candidates: Array<[CpuIntent, number]> = [
      ["JAB", 1.25 + comebackMercy * 0.35],
      ["STRAIGHT", 1.00 * pressureBrake],
      ["BACKFIST", (0.78 + attackRead * 0.35) * pressureBrake],
      ["BODY_BLOW", (0.80 + guardRead * 1.45) * pressureBrake],
      ["KICK", 0.92 * pressureBrake],
      ["LOW_KICK", (0.72 + this.playerAdvanceHabit * 0.42) * pressureBrake],
      ["RISING_KICK", (0.24 + crouchRead * 1.35 + cpuBehind * 0.28) * mercyAttackScale],
      ["THROW", (0.20 + guardRead * 1.70) * mercyAttackScale],
      ["COUNTER", (0.18 + attackRead * 1.20 + this.retaliation * 0.42) * (1 - comebackMercy * 0.40)],
      ["POWER", (0.24 + cpuBehind * 0.95 + this.retaliation * 0.55) * mercyAttackScale],
      ["WAIT", 0.42 + comebackMercy * 1.10 + (this.pressure >= 3 ? 0.75 : 0)],
      ["RETREAT", 0.22 + comebackMercy * 0.72 + (this.pressure >= 3 ? 0.50 : 0)],
      ["GUARD", 0.34 + attackRead * 0.48],
      ["SIDESTEP", 0.22 + this.playerAdvanceHabit * 0.42],
    ];

    const intent = this.chooseWeighted(candidates.map(([candidate, weight]) => [
      candidate,
      isAttackIntent(candidate) ? weight * (0.62 + this.profile.aggression * 0.62) : weight,
    ]));

    let reason = "varied-close-range-exchange";
    if (comebackMercy > 0.45 && !isAttackIntent(intent)) reason = "player-comeback-window";
    else if ((intent === "THROW" || intent === "BODY_BLOW") && guardRead > 0.35) reason = "adapt-to-guard-without-spam";
    else if (intent === "RISING_KICK" && crouchRead > 0.35) reason = "adapt-to-crouch";
    else if (intent === "COUNTER" && attackRead > 0.35) reason = "adapt-to-attack-habit";
    else if (intent === "POWER" && cpuBehind > 0.40) reason = "dramatic-cpu-comeback-attempt";
    return this.decision(intent, reason, comebackMercy);
  }
}
