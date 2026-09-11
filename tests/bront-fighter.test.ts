import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { fighterDnaForName, resolveContextAttack } from "../src/game/fighter-dna";
import { registerBrontCircuitRival } from "../src/game/fighter-bront-circuit";
import {
  BRONT_FIGHTER_DEFINITION,
  BRONT_FIGHTER_ID,
  registerBrontFighter,
} from "../src/game/fighter-bront";
import {
  PLAYABLE_FIGHTERS,
  playableFighterDefinition,
  playableFighterSelectedClass,
} from "../src/game/playable-fighters";
import { RIVAL_CIRCUIT_ENCOUNTERS } from "../src/game/rival-circuit";

const REQUIRED_MOVES = [
  "jab", "straight", "backfist", "bodyBlow", "power", "kick",
  "lowKick", "risingKick", "dashKick", "throw", "counter",
] as const;

test("BRONT registers as the fourth fighter without replacing legacy definitions", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;
  const bront = registerBrontFighter();
  assert.equal(FIGHTER_DEFINITIONS.red, kairo);
  assert.equal(FIGHTER_DEFINITIONS.blue, sera);
  assert.equal(FIGHTER_DEFINITIONS[BRONT_FIGHTER_ID], bront);
  assert.equal(bront, BRONT_FIGHTER_DEFINITION);
  assert.equal(bront.name, "BRONT");
  assert.equal(bront.callsign, "THE GRAVITY FIST");
  assert.equal(bront.archetype, "POWER");
});

test("BRONT is playable in both slots and owns the amber selection state", () => {
  assert.equal(PLAYABLE_FIGHTERS.length, 4);
  assert.equal(PLAYABLE_FIGHTERS.at(-1)?.name, "BRONT");
  assert.equal(playableFighterDefinition(BRONT_FIGHTER_ID).name, "BRONT");
  assert.equal(playableFighterSelectedClass(BRONT_FIGHTER_ID, true, "P1"), "selected-amber");
  assert.equal(playableFighterSelectedClass(BRONT_FIGHTER_ID, true, "P2"), "selected-amber");
});

test("BRONT move table is complete and materially heavier than the baseline", () => {
  const bront = registerBrontFighter();
  for (const moveId of REQUIRED_MOVES) assert.ok(bront.moves[moveId], `missing ${moveId}`);
  assert.equal(bront.moves.power.label, "Mass Driver");
  assert.ok(bront.moves.power.startup >= 18);
  assert.ok(bront.moves.power.damage > FIGHTER_DEFINITIONS.red.moves.power.damage);
  assert.ok(bront.moves.power.guardDamage > FIGHTER_DEFINITIONS.red.moves.power.guardDamage);
  assert.ok(bront.moves.power.knockback > FIGHTER_DEFINITIONS.red.moves.power.knockback);
  assert.ok(bront.moves.dashKick.reach <= 2);
});

test("BRONT Fighter DNA trades mobility for wall and impact control", () => {
  const dna = fighterDnaForName("BRONT");
  assert.equal(dna.id, "BRONT");
  assert.ok(dna.moveSpeedScale < 1);
  assert.ok(dna.stepSpeedScale < 1);
  assert.ok(dna.stepCooldownScale > 1);

  const base = {
    fighterName: "BRONT",
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
  assert.deepEqual(resolveContextAttack({ ...base, interceptOpen: true }), { moveId: "bodyBlow", beat: "LOAD CHECK", signature: "LOAD CHECK" });
  assert.equal(resolveContextAttack({ ...base, defenderNearWall: true, comboStage: 2 }).moveId, "power");
  assert.equal(resolveContextAttack({ ...base, distance: 1.4, comboStage: 2 }).moveId, "power");
});

test("Rival Circuit Stage 4 becomes BRONT without changing the five-fight run", () => {
  const beforeLength = RIVAL_CIRCUIT_ENCOUNTERS.length;
  const encounter = registerBrontCircuitRival();
  assert.equal(beforeLength, 5);
  assert.equal(RIVAL_CIRCUIT_ENCOUNTERS.length, 5);
  assert.equal(encounter.order, 4);
  assert.equal(encounter.codename, "LOCKSTEP");
  assert.equal(encounter.style, "STEP_HUNTER");
  assert.equal(encounter.fighterId, BRONT_FIGHTER_ID);
  assert.match(encounter.rule, /GRAVITY LOCK/);
  assert.match(encounter.description, /BRONT/);
});
