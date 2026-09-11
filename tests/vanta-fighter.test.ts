import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { fighterDnaForName, resolveContextAttack } from "../src/game/fighter-dna";
import { registerVantaCircuitRival } from "../src/game/fighter-vanta-circuit";
import {
  registerVantaFighter,
  VANTA_FIGHTER_DEFINITION,
  VANTA_FIGHTER_ID,
} from "../src/game/fighter-vanta";
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

test("VANTA registers as a third fighter without replacing KAIRO or SERA", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;
  const vanta = registerVantaFighter();

  assert.equal(FIGHTER_DEFINITIONS.red, kairo);
  assert.equal(FIGHTER_DEFINITIONS.blue, sera);
  assert.equal(FIGHTER_DEFINITIONS[VANTA_FIGHTER_ID], vanta);
  assert.equal(vanta, VANTA_FIGHTER_DEFINITION);
  assert.equal(vanta.name, "VANTA");
  assert.equal(vanta.callsign, "THE NULL MIRROR");
  assert.equal(vanta.colors.primary, 0x6f45d7);
  assert.equal(vanta.colors.accent, 0xd7aa45);
});

test("VANTA keeps the complete audited move vocabulary with counter-control tuning", () => {
  const vanta = registerVantaFighter();
  for (const moveId of REQUIRED_MOVES) assert.ok(vanta.moves[moveId], `missing ${moveId}`);
  assert.equal(vanta.moves.counter.label, "Null Counter");
  assert.equal(vanta.moves.counter.startup, 5);
  assert.ok(vanta.moves.straight.reach > FIGHTER_DEFINITIONS.blue.moves.straight.reach);
  assert.ok(vanta.moves.dashKick.reach <= 2);
  assert.ok(vanta.moves.power.damage < 25);
});

test("VANTA DNA rewards earned reads instead of raw pressure", () => {
  const dna = fighterDnaForName("VANTA");
  assert.equal(dna.id, "VANTA");
  assert.ok(dna.interceptDamageScale > 1.1);
  assert.ok(dna.reversalDamageScale > 1.1);
  assert.ok(dna.comboPressureScale < 1);

  const base = {
    fighterName: "VANTA",
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
    { moveId: "straight", beat: "NULL CHECK", signature: "NULL CHECK" },
  );
  assert.deepEqual(
    resolveContextAttack({ ...base, reversalOpen: true }),
    { moveId: "counter", beat: "MIRROR BREAK", signature: "MIRROR BREAK" },
  );
  assert.equal(
    resolveContextAttack({ ...base, distance: 2.1, comboStage: 2 }).moveId,
    "dashKick",
  );
});

test("Rival Circuit Stage 3 becomes VANTA while preserving the COUNTER identity contract", () => {
  const beforeLength = RIVAL_CIRCUIT_ENCOUNTERS.length;
  const encounter = registerVantaCircuitRival();
  assert.equal(RIVAL_CIRCUIT_ENCOUNTERS.length, beforeLength);
  assert.equal(beforeLength, 5);
  assert.equal(encounter.order, 3);
  assert.equal(encounter.codename, "REFLEX");
  assert.equal(encounter.title, "COUNTER NODE");
  assert.equal(encounter.style, "COUNTER");
  assert.equal(encounter.fighterId, VANTA_FIGHTER_ID);
  assert.match(encounter.rule, /NULL MIRROR/);
  assert.match(encounter.description, /VANTA/);
});
