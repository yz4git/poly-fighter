import assert from "node:assert/strict";
import test from "node:test";
import {
  RIVAL_CIRCUIT_ENCOUNTERS,
  rivalCircuitGradeForScore,
  rivalCircuitProtocolOffers,
  rivalCircuitRunGrade,
  scoreRivalCircuitPerformance,
} from "../src/game/rival-circuit";
import type { HudSnapshot } from "../src/game/types";

function hud(overrides: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    phase: "MATCH",
    round: 1,
    timer: 48,
    p1Health: 82,
    p2Health: 0,
    p1Wins: 1,
    p2Wins: 0,
    p1Name: "KAIRO",
    p2Name: "SERA",
    message: "KO",
    p1State: "IDLE",
    p2State: "KO",
    tpsTraining: { hits: 5, sideSteps: 3, perfectEvades: 1, punishes: 1, intercepts: 1 },
    tpsCue: "NONE",
    ...overrides,
  };
}

test("Rival Circuit ships a deterministic five-fight vertical slice", () => {
  assert.equal(RIVAL_CIRCUIT_ENCOUNTERS.length, 5);
  assert.deepEqual(RIVAL_CIRCUIT_ENCOUNTERS.map((encounter) => encounter.order), [1, 2, 3, 4, 5]);
  assert.equal(RIVAL_CIRCUIT_ENCOUNTERS.at(-1)?.style, "APEX");
  assert.equal(RIVAL_CIRCUIT_ENCOUNTERS.at(-1)?.difficulty, "HARD");
});

test("style score rewards real TPS combat counters", () => {
  const clean = scoreRivalCircuitPerformance(hud(), "p1");
  const flat = scoreRivalCircuitPerformance(hud({
    p1Health: 25,
    timer: 12,
    tpsTraining: { hits: 1, sideSteps: 0, perfectEvades: 0, punishes: 0, intercepts: 0 },
  }), "p1");
  assert.ok(clean.score > flat.score);
  assert.ok(clean.techniqueBonus > flat.techniqueBonus);
});

test("protocols amplify their intended scoring route without exceeding 100", () => {
  const base = scoreRivalCircuitPerformance(hud(), "p1");
  const boosted = scoreRivalCircuitPerformance(hud(), "p1", ["PUNISH_DRIVE", "INTERCEPT_CORE"]);
  assert.ok(boosted.protocolBonus > 0);
  assert.ok(boosted.score >= base.score);
  assert.ok(boosted.score <= 100);
});

test("protocol offers avoid already-owned upgrades", () => {
  const offers = rivalCircuitProtocolOffers(0, ["PRESSURE_STACK"]);
  assert.equal(offers.length, 3);
  assert.ok(offers.every((offer) => offer.id !== "PRESSURE_STACK"));
  assert.equal(new Set(offers.map((offer) => offer.id)).size, offers.length);
});

test("grade thresholds are stable for match and run summaries", () => {
  assert.equal(rivalCircuitGradeForScore(92), "SS");
  assert.equal(rivalCircuitGradeForScore(82), "S");
  assert.equal(rivalCircuitGradeForScore(70), "A");
  assert.equal(rivalCircuitGradeForScore(58), "B");
  assert.equal(rivalCircuitGradeForScore(57), "C");
  assert.equal(rivalCircuitRunGrade(410, 5), "S");
});
