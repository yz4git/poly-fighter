import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveApexStyleForHealth,
  effectiveRivalCircuitStyle,
  resolveRivalCircuitStyleFromLabel,
  rivalCircuitSignaturePlan,
  rivalCircuitTacticForStyle,
} from "../src/game/rival-circuit-ai";
import {
  APEX_BOSS_PHASES,
  apexBossPhaseForHealth,
} from "../src/game/rival-circuit-apex-boss";
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

test("Rival Circuit HUD labels resolve to five distinct AI identities", () => {
  assert.equal(resolveRivalCircuitStyleFromLabel("STAGE 1/5 GLASSLINE · PRESSURE"), "PRESSURE");
  assert.equal(resolveRivalCircuitStyleFromLabel("STAGE 2/5 VECTOR · ANGLE"), "ANGLE");
  assert.equal(resolveRivalCircuitStyleFromLabel("STAGE 3/5 REFLEX · COUNTER"), "COUNTER");
  assert.equal(resolveRivalCircuitStyleFromLabel("STAGE 4/5 LOCKSTEP · STEP HUNTER"), "STEP_HUNTER");
  assert.equal(resolveRivalCircuitStyleFromLabel("STAGE 5/5 APEX-0 · APEX"), "APEX");
  assert.equal(resolveRivalCircuitStyleFromLabel("NORMAL TPS MATCH"), null);
});

test("named rivals own distinct neutral spacing tactics", () => {
  assert.equal(rivalCircuitTacticForStyle("PRESSURE", 0), "PRESSURE");
  assert.equal(rivalCircuitTacticForStyle("ANGLE", 0), "ORBIT");
  assert.equal(rivalCircuitTacticForStyle("COUNTER", 0), "BAIT");
  assert.equal(rivalCircuitTacticForStyle("STEP_HUNTER", 0), "ORBIT");
});

test("signature plans are readable and conditional instead of frame-perfect cheats", () => {
  assert.deepEqual(
    rivalCircuitSignaturePlan({ style: "PRESSURE", simulationTicks: 180, distance: 2.4, playerAttacking: false, playerSideStepping: false }),
    { moveId: "dashKick", intent: "DASH_KICK", label: "BREACH" },
  );
  assert.equal(
    rivalCircuitSignaturePlan({ style: "COUNTER", simulationTicks: 180, distance: 1.5, playerAttacking: false, playerSideStepping: false }),
    null,
  );
  assert.deepEqual(
    rivalCircuitSignaturePlan({ style: "COUNTER", simulationTicks: 180, distance: 1.5, playerAttacking: true, playerSideStepping: false }),
    { moveId: "counter", intent: "COUNTER", label: "ANSWER" },
  );
  assert.equal(
    rivalCircuitSignaturePlan({ style: "STEP_HUNTER", simulationTicks: 180, distance: 1.6, playerAttacking: false, playerSideStepping: false }),
    null,
  );
  assert.ok(
    ["lowKick", "backfist"].includes(
      rivalCircuitSignaturePlan({ style: "STEP_HUNTER", simulationTicks: 180, distance: 1.6, playerAttacking: false, playerSideStepping: true })?.moveId ?? "",
    ),
  );
});

test("APEX keeps its deterministic fallback discipline rotation for isolated policy tests", () => {
  assert.equal(effectiveRivalCircuitStyle("APEX", 0), "PRESSURE");
  assert.equal(effectiveRivalCircuitStyle("APEX", 300), "ANGLE");
  assert.equal(effectiveRivalCircuitStyle("APEX", 600), "COUNTER");
  assert.equal(effectiveRivalCircuitStyle("APEX", 900), "STEP_HUNTER");
  assert.equal(effectiveRivalCircuitStyle("APEX", 1200), "PRESSURE");
});

test("APEX-0 live boss phases are health-gated rather than timer-gated", () => {
  assert.equal(APEX_BOSS_PHASES.length, 3);
  assert.equal(apexBossPhaseForHealth(100).phase, "CALIBRATE");
  assert.equal(apexBossPhaseForHealth(61).phase, "CALIBRATE");
  assert.equal(apexBossPhaseForHealth(60).phase, "ADAPT");
  assert.equal(apexBossPhaseForHealth(31).phase, "ADAPT");
  assert.equal(apexBossPhaseForHealth(30).phase, "ZERO");
  assert.equal(apexBossPhaseForHealth(0).phase, "ZERO");
  assert.equal(effectiveApexStyleForHealth(100), "ANGLE");
  assert.equal(effectiveApexStyleForHealth(60), "COUNTER");
  assert.equal(effectiveApexStyleForHealth(30), "PRESSURE");
});

test("APEX signature routing follows live boss health", () => {
  assert.equal(
    rivalCircuitSignaturePlan({ style: "APEX", simulationTicks: 720, distance: 1.5, playerAttacking: false, playerSideStepping: false, apexHealth: 60 }),
    null,
  );
  assert.deepEqual(
    rivalCircuitSignaturePlan({ style: "APEX", simulationTicks: 720, distance: 1.5, playerAttacking: true, playerSideStepping: false, apexHealth: 60 }),
    { moveId: "counter", intent: "COUNTER", label: "ANSWER" },
  );
  assert.equal(
    rivalCircuitSignaturePlan({ style: "APEX", simulationTicks: 720, distance: 2.4, playerAttacking: false, playerSideStepping: false, apexHealth: 30 })?.moveId,
    "dashKick",
  );
});
