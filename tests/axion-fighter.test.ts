import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { fighterDnaForName, resolveContextAttack } from "../src/game/fighter-dna";
import { registerAxionCircuitRival } from "../src/game/fighter-axion-circuit";
import {
  AXION_FIGHTER_DEFINITION,
  AXION_FIGHTER_ID,
  registerAxionFighter,
} from "../src/game/fighter-axion";
import {
  PLAYABLE_FIGHTERS,
  playableFighterDefinition,
  playableFighterSelectedClass,
} from "../src/game/playable-fighters";
import { RIVAL_CIRCUIT_ENCOUNTERS } from "../src/game/rival-circuit";

const REQUIRED_MOVES = [
  "jab",
  "straight",
  "backfist",
  "bodyBlow",
  "power",
  "kick",
  "lowKick",
  "risingKick",
  "dashKick",
  "throw",
  "counter",
] as const;

test("AXION registers as the fourth fighter without replacing the existing roster", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;
  const axion = registerAxionFighter();
  assert.equal(FIGHTER_DEFINITIONS.red, kairo);
  assert.equal(FIGHTER_DEFINITIONS.blue, sera);
  assert.equal(FIGHTER_DEFINITIONS[AXION_FIGHTER_ID], axion);
  assert.equal(axion, AXION_FIGHTER_DEFINITION);
  assert.equal(axion.name, "AXION");
  assert.equal(axion.callsign, "THE GRAVITY WARDEN");
  assert.equal(axion.archetype, "POWER");
});

test("playable roster exposes four stable identities including AXION", () => {
  assert.deepEqual(PLAYABLE_FIGHTERS.map((fighter) => fighter.name), ["KAIRO", "SERA", "VANTA", "AXION"]);
  assert.equal(playableFighterDefinition(AXION_FIGHTER_ID).name, "AXION");
  assert.equal(playableFighterSelectedClass(AXION_FIGHTER_ID, true, "P1"), "selected-amber");
  assert.equal(playableFighterSelectedClass(AXION_FIGHTER_ID, true, "P2"), "selected-amber");
});

test("AXION keeps the full move vocabulary with deliberate heavy spacing tuning", () => {
  const axion = registerAxionFighter();
  for (const moveId of REQUIRED_MOVES) assert.ok(axion.moves[moveId], `missing ${moveId}`);
  assert.equal(axion.moves.power.label, "Event Horizon");
  assert.ok(axion.moves.power.startup > FIGHTER_DEFINITIONS.red.moves.power.startup);
  assert.ok(axion.moves.power.guardDamage > FIGHTER_DEFINITIONS.red.moves.power.guardDamage);
  assert.ok(axion.moves.straight.reach > FIGHTER_DEFINITIONS.red.moves.straight.reach);
  assert.ok(axion.moves.dashKick.reach <= 2);
  assert.ok(axion.moves.power.damage <= 25);
});

test("AXION DNA is slower but applies the strongest sustained pressure contract", () => {
  const dna = fighterDnaForName("AXION");
  assert.equal(dna.id, "AXION");
  assert.ok(dna.moveSpeedScale < 1);
  assert.ok(dna.stepSpeedScale < 1);
  assert.ok(dna.stepCooldownScale > 1);
  assert.ok(dna.comboPressureScale > fighterDnaForName("KAIRO").comboPressureScale);

  const base = {
    fighterName: "AXION",
    distance: 1.4,
    comboStage: 0,
    flankOpen: false,
    reversalOpen: false,
    interceptOpen: false,
    defenderAttacking: false,
    defenderNearWall: false,
    selfHealth: 70,
    defenderHealth: 70,
  };
  assert.deepEqual(
    resolveContextAttack({ ...base, interceptOpen: true }),
    { moveId: "straight", beat: "MASS CHECK", signature: "MASS CHECK" },
  );
  assert.equal(resolveContextAttack({ ...base, defenderNearWall: true, comboStage: 0 }).moveId, "straight");
  assert.equal(resolveContextAttack({ ...base, defenderNearWall: true, comboStage: 1 }).moveId, "power");
  assert.equal(resolveContextAttack({ ...base, distance: 2.1, comboStage: 2 }).moveId, "dashKick");
});

test("Rival Circuit Stage 4 becomes AXION while preserving STEP_HUNTER fairness", () => {
  const beforeLength = RIVAL_CIRCUIT_ENCOUNTERS.length;
  const encounter = registerAxionCircuitRival();
  assert.equal(RIVAL_CIRCUIT_ENCOUNTERS.length, beforeLength);
  assert.equal(beforeLength, 5);
  assert.equal(encounter.order, 4);
  assert.equal(encounter.codename, "LOCKSTEP");
  assert.equal(encounter.style, "STEP_HUNTER");
  assert.equal(encounter.fighterId, AXION_FIGHTER_ID);
  assert.match(encounter.rule, /GRAVITY WARDEN/);
  assert.match(encounter.description, /AXION/);
  assert.match(encounter.description, /slower movement/i);
});
