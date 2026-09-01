from pathlib import Path
import re

root = Path('.')

cpu_director = r'''import type { InputFrame, FighterState } from "./types";
import { EMPTY_INPUT, cloneInput } from "./types";

export type CpuDifficulty = "EASY" | "NORMAL" | "HARD";

export type CpuIntent =
  | "WAIT"
  | "APPROACH"
  | "RETREAT"
  | "GUARD"
  | "SIDESTEP"
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
      const dashChance = this.profile.aggression * 0.22 * (1 - comebackMercy * 0.72);
      const intent = this.difficulty !== "EASY" && this.random() < dashChance ? "DASH_KICK" : "APPROACH";
      return this.decision(intent, intent === "DASH_KICK" ? "telegraphed-gap-closer" : "close-distance", comebackMercy);
    }

    if (distance > 2.0) {
      const intent = this.chooseWeighted([
        ["APPROACH", 1.25],
        ["WAIT", 0.44 + comebackMercy * 0.8],
        ["GUARD", 0.35],
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
'''
(root / 'src/game/cpu-director.ts').write_text(cpu_director)

fighter_path = root / 'src/game/fighter.ts'
fighter = fighter_path.read_text()
import_line = 'import { CpuFunDirector, buildCpuInputPlan, type CpuInputStep, type CpuSituation } from "./cpu-director";\n'
if import_line not in fighter:
    anchor = 'import { EMPTY_INPUT, cloneInput } from "./types";\n'
    fighter = fighter.replace(anchor, anchor + import_line)

new_cpu = r'''export type CpuDifficulty = "EASY" | "NORMAL" | "HARD";

export class CpuController {
  private readonly director: CpuFunDirector;
  private plan: CpuInputStep[] = [];
  private stepTicks = 0;
  private step: CpuInputStep | null = null;

  constructor(private readonly difficulty: CpuDifficulty = "NORMAL") {
    this.director = new CpuFunDirector(difficulty, 17);
  }

  private situation(fighter: FighterRuntime, opponent: FighterRuntime): CpuSituation {
    const snapshot = (subject: FighterRuntime, other: FighterRuntime) => ({
      health: subject.health,
      guardDamage: subject.guardDamage,
      state: subject.state,
      moveId: subject.currentMove?.id ?? null,
      movePower: subject.currentMove?.power ?? 0,
      isActive: subject.isActive(),
      grounded: subject.grounded,
      x: subject.position.x,
      z: subject.position.z,
      facing: other.position.x >= subject.position.x ? 1 : -1,
    });
    return {
      self: snapshot(fighter, opponent),
      opponent: snapshot(opponent, fighter),
      distance: opponent.position.distanceTo(fighter.position),
    };
  }

  private nextPlanFrame(): InputFrame {
    if (!this.step || this.stepTicks <= 0) {
      this.step = this.plan.shift() ?? null;
      this.stepTicks = this.step?.ticks ?? 0;
    }
    if (!this.step) return cloneInput(EMPTY_INPUT);
    this.stepTicks -= 1;
    const frame = cloneInput(this.step.frame);
    if (this.stepTicks <= 0) this.step = null;
    return frame;
  }

  private clearPlan(): void {
    this.plan = [];
    this.step = null;
    this.stepTicks = 0;
  }

  update(fighter: FighterRuntime, opponent: FighterRuntime): InputFrame {
    const situation = this.situation(fighter, opponent);
    this.director.observe(situation);
    fighter.visual.root.userData.cpuDirectorVersion = "FUN_DIRECTOR_V1";
    fighter.visual.root.userData.cpuDirectorDifficulty = this.difficulty;

    if (!fighter.canAct()) {
      this.clearPlan();
      return cloneInput(EMPTY_INPUT);
    }

    if (!this.step && this.plan.length === 0) {
      const decision = this.director.decide(situation);
      const facing = opponent.position.x >= fighter.position.x ? 1 : -1;
      this.plan = buildCpuInputPlan(decision, facing);
      fighter.visual.root.userData.cpuDirectorIntent = decision.intent;
      fighter.visual.root.userData.cpuDirectorReason = decision.reason;
      fighter.visual.root.userData.cpuDirectorComebackMercy = decision.comebackMercy;
      fighter.visual.root.userData.cpuDirectorPressure = decision.pressure;
    }

    return this.nextPlanFrame();
  }
}'''
pattern = re.compile(r'export type CpuDifficulty = "EASY" \| "NORMAL" \| "HARD";\n\nexport class CpuController \{.*?\n\}', re.S)
if not pattern.search(fighter):
    raise SystemExit('CpuController block not found')
fighter = pattern.sub(new_cpu, fighter, count=1)
fighter_path.write_text(fighter)

test = r'''import test from "node:test";
import assert from "node:assert/strict";
import { CommandParser, InputBuffer } from "../src/game/input";
import {
  CpuFunDirector,
  buildCpuInputPlan,
  isAttackIntent,
  type CpuDecision,
  type CpuIntent,
  type CpuSituation,
} from "../src/game/cpu-director";
import { EMPTY_INPUT, cloneInput } from "../src/game/types";

function decision(intent: CpuIntent): CpuDecision {
  return { intent, holdTicks: 6, telegraphTicks: 0, reason: "test", comebackMercy: 0, pressure: 0 };
}

function commandFor(intent: CpuIntent): string | null {
  const buffer = new InputBuffer();
  let previous = cloneInput(EMPTY_INPUT);
  for (const step of buildCpuInputPlan(decision(intent), 1)) {
    for (let tick = 0; tick < step.ticks; tick += 1) {
      const frame = cloneInput(step.frame);
      buffer.push(frame);
      const buttonPressed = (frame.punch && !previous.punch) || (frame.kick && !previous.kick);
      if (buttonPressed) return CommandParser.parse(frame, buffer, 1);
      previous = frame;
    }
  }
  return null;
}

const commandCases: Array<[CpuIntent, string]> = [
  ["JAB", "PUNCH"],
  ["STRAIGHT", "STRAIGHT"],
  ["BACKFIST", "BACKFIST"],
  ["BODY_BLOW", "BODY_BLOW"],
  ["POWER", "POWER"],
  ["KICK", "KICK"],
  ["LOW_KICK", "LOW_KICK"],
  ["RISING_KICK", "RISING_KICK"],
  ["DASH_KICK", "DASH_KICK"],
  ["THROW", "THROW"],
  ["COUNTER", "COUNTER"],
];

test("CPU input plans execute the intended command parser moves", () => {
  for (const [intent, expected] of commandCases) assert.equal(commandFor(intent), expected, intent);
});

function situation(overrides: Partial<CpuSituation> = {}): CpuSituation {
  const base: CpuSituation = {
    self: { health: 100, guardDamage: 0, state: "IDLE", moveId: null, movePower: 0, isActive: false, grounded: true, x: 0, z: 0, facing: 1 },
    opponent: { health: 100, guardDamage: 0, state: "IDLE", moveId: null, movePower: 0, isActive: false, grounded: true, x: 1.5, z: 0, facing: -1 },
    distance: 1.5,
  };
  return {
    ...base,
    ...overrides,
    self: { ...base.self, ...(overrides.self ?? {}) },
    opponent: { ...base.opponent, ...(overrides.opponent ?? {}) },
  };
}

test("CPU deliberately gives breathing room after landing a hit", () => {
  const cpu = new CpuFunDirector("NORMAL", 17);
  cpu.observe(situation());
  cpu.observe(situation({ opponent: { ...situation().opponent, health: 90 } }));
  const next = cpu.decide(situation({ opponent: { ...situation().opponent, health: 90 } }));
  assert.equal(isAttackIntent(next.intent), false);
  assert.equal(next.reason, "breathing-room-after-hit");
});

test("CPU never meaties a waking player by default", () => {
  for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
    const cpu = new CpuFunDirector(difficulty, 41);
    const state = situation({ opponent: { ...situation().opponent, state: "WAKEUP" } });
    cpu.observe(state);
    const next = cpu.decide(state);
    assert.equal(isAttackIntent(next.intent), false, difficulty);
    assert.equal(next.reason, "give-player-turn-after-recovery");
  }
});

test("hard CPU reacts to active threats more often than easy CPU", () => {
  const sample = (difficulty: "EASY" | "HARD") => {
    let defensive = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const cpu = new CpuFunDirector(difficulty, seed);
      const state = situation({ opponent: { ...situation().opponent, state: "ATTACK", moveId: "jab", movePower: 0.7, isActive: true } });
      cpu.observe(state);
      const intent = cpu.decide(state).intent;
      if (["GUARD", "SIDESTEP", "COUNTER"].includes(intent)) defensive += 1;
    }
    return defensive;
  };
  assert.ok(sample("HARD") > sample("EASY") + 25);
});

test("large CPU lead creates more player comeback space than CPU deficit", () => {
  const countFinishers = (selfHealth: number, opponentHealth: number) => {
    const cpu = new CpuFunDirector("NORMAL", 73);
    let finishers = 0;
    let pauses = 0;
    for (let i = 0; i < 100; i += 1) {
      const state = situation({ self: { ...situation().self, health: selfHealth }, opponent: { ...situation().opponent, health: opponentHealth } });
      cpu.observe(state);
      const next = cpu.decide(state).intent;
      if (["POWER", "DASH_KICK", "RISING_KICK", "THROW"].includes(next)) finishers += 1;
      if (["WAIT", "RETREAT", "GUARD", "SIDESTEP"].includes(next)) pauses += 1;
    }
    return { finishers, pauses };
  };
  const leading = countFinishers(100, 22);
  const losing = countFinishers(28, 100);
  assert.ok(leading.finishers < losing.finishers);
  assert.ok(leading.pauses > losing.pauses);
});

test("close-range offense stays varied instead of repeating one move", () => {
  const cpu = new CpuFunDirector("NORMAL", 991);
  const attacks: CpuIntent[] = [];
  for (let i = 0; i < 80; i += 1) {
    const state = situation();
    cpu.observe(state);
    const intent = cpu.decide(state).intent;
    if (isAttackIntent(intent)) attacks.push(intent);
  }
  assert.ok(new Set(attacks).size >= 6);
  for (let i = 2; i < attacks.length; i += 1) {
    assert.equal(attacks[i] === attacks[i - 1] && attacks[i - 1] === attacks[i - 2], false);
  }
});

test("CPU learns sustained guard and increases guard-breaking choices", () => {
  const cpu = new CpuFunDirector("NORMAL", 121);
  const guarded = situation({ opponent: { ...situation().opponent, state: "GUARD" } });
  for (let i = 0; i < 90; i += 1) cpu.observe(guarded);
  let guardBreakers = 0;
  for (let i = 0; i < 60; i += 1) {
    cpu.observe(guarded);
    const intent = cpu.decide(guarded).intent;
    if (intent === "THROW" || intent === "BODY_BLOW") guardBreakers += 1;
  }
  assert.ok(guardBreakers >= 12, `guard breakers=${guardBreakers}`);
});
'''
(root / 'tests/cpu-director.test.ts').write_text(test)

package_path = root / 'package.json'
package_text = package_path.read_text()
for key in ['test:rules', 'test:rules:tps']:
    marker = 'tests/motion-expansion.test.ts'
    if 'tests/cpu-director.test.ts' not in package_text:
        package_text = package_text.replace(marker, marker + ' tests/cpu-director.test.ts', 1)
# The first replacement only affects test:rules. Add to TPS separately if needed.
needle = 'tests/tps-graphics.test.ts tests/motion-expansion.test.ts"'
if needle in package_text:
    package_text = package_text.replace(needle, 'tests/tps-graphics.test.ts tests/motion-expansion.test.ts tests/cpu-director.test.ts"')
package_path.write_text(package_text)
