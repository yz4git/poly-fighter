import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { fighterDnaForName, resolveContextAttack } from "../src/game/fighter-dna";
import {
  registerRookFighter,
  ROOK_FIGHTER_DEFINITION,
  ROOK_FIGHTER_ID,
} from "../src/game/fighter-rook";
import { VANTA_FIGHTER_DEFINITION } from "../src/game/fighter-vanta";
import {
  PLAYABLE_FIGHTERS,
  playableFighterDefinition,
  playableFighterSelectedClass,
} from "../src/game/playable-fighters";

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

const BASE_SITUATION = {
  fighterName: "ROOK",
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

test("ROOK registers as a fourth fighter without replacing the existing roster", () => {
  const kairo = FIGHTER_DEFINITIONS.red;
  const sera = FIGHTER_DEFINITIONS.blue;
  const vanta = VANTA_FIGHTER_DEFINITION;
  const rook = registerRookFighter();

  assert.equal(FIGHTER_DEFINITIONS.red, kairo);
  assert.equal(FIGHTER_DEFINITIONS.blue, sera);
  assert.equal(FIGHTER_DEFINITIONS.violet, vanta);
  assert.equal(FIGHTER_DEFINITIONS[ROOK_FIGHTER_ID], rook);
  assert.equal(rook, ROOK_FIGHTER_DEFINITION);
  assert.equal(rook.name, "ROOK");
  assert.equal(rook.callsign, "THE GRAVITY FRAME");
  assert.equal(rook.colors.primary, 0xd4772d);
  assert.equal(rook.colors.accent, 0xe7c46c);
});

test("ROOK keeps the complete move vocabulary with breaker tuning", () => {
  const rook = registerRookFighter();
  for (const moveId of REQUIRED_MOVES) assert.ok(rook.moves[moveId], `missing ${moveId}`);

  assert.ok(rook.moves.bodyBlow.guardDamage >= 6);
  assert.ok(rook.moves.throw.damage > FIGHTER_DEFINITIONS.red.moves.throw.damage);
  assert.ok(rook.moves.power.guardDamage > FIGHTER_DEFINITIONS.red.moves.power.guardDamage);
  assert.ok(rook.moves.dashKick.reach <= 1.9);
});

test("ROOK DNA trades mobility for close-range breaker reads", () => {
  const dna = fighterDnaForName("ROOK");
  assert.equal(dna.id, "ROOK");
  assert.ok(dna.moveSpeedScale < 1);
  assert.ok(dna.stepSpeedScale < 1);
  assert.ok(dna.comboPressureScale < 1);

  assert.deepEqual(
    resolveContextAttack({ ...BASE_SITUATION, interceptOpen: true }),
    { moveId: "bodyBlow", beat: "ANCHOR CHECK", signature: "ANCHOR CHECK" },
  );
  assert.deepEqual(
    resolveContextAttack({ ...BASE_SITUATION, comboStage: 1, defenderNearWall: true }),
    { moveId: "throw", beat: "GRAVITY PRESSURE", signature: null },
  );
  assert.deepEqual(
    resolveContextAttack({ ...BASE_SITUATION, selfHealth: 20, defenderHealth: 28 }),
    { moveId: "power", beat: "GRAVITY HAMMER", signature: "GRAVITY HAMMER" },
  );
});

test("playable roster exposes ROOK with a dedicated amber selected state", () => {
  assert.equal(PLAYABLE_FIGHTERS.length, 4);
  assert.ok(PLAYABLE_FIGHTERS.some((fighter) => fighter.id === ROOK_FIGHTER_ID && fighter.name === "ROOK"));
  assert.equal(playableFighterDefinition(ROOK_FIGHTER_ID), ROOK_FIGHTER_DEFINITION);
  assert.equal(playableFighterSelectedClass(ROOK_FIGHTER_ID, true, "P1"), "selected-amber");
  assert.equal(playableFighterSelectedClass(ROOK_FIGHTER_ID, true, "P2"), "selected-amber");
}
);
