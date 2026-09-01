import test from "node:test";
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
