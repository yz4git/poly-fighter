import assert from "node:assert/strict";
import test from "node:test";
import {
  RIVAL_CIRCUIT_ARENA_TACTICS,
  rivalCircuitArenaPlayableRadius,
  rivalCircuitArenaTacticForStage,
} from "../src/game/rival-circuit-arena-tactics";

test("five Rival Circuit arenas expose five deterministic tactical identities", () => {
  assert.equal(RIVAL_CIRCUIT_ARENA_TACTICS.length, 5);
  assert.deepEqual(
    RIVAL_CIRCUIT_ARENA_TACTICS.map((profile) => profile.rule),
    ["BASELINE", "MOBILITY", "ANCHOR", "CONTRACT", "BOSS_CONTRACT"],
  );
  assert.equal(rivalCircuitArenaTacticForStage(2).walkScale, 1.08);
  assert.equal(rivalCircuitArenaTacticForStage(3).walkScale, 0.92);
  assert.equal(rivalCircuitArenaTacticForStage(1).walkScale, 1);
});

test("OFFSET and COLD only alter ordinary walk tempo while keeping the shared arena size", () => {
  assert.equal(rivalCircuitArenaPlayableRadius(2, 0, 100), 6.08);
  assert.equal(rivalCircuitArenaPlayableRadius(3, 5000, 10), 6.08);
  assert.ok(rivalCircuitArenaTacticForStage(2).walkScale > 1);
  assert.ok(rivalCircuitArenaTacticForStage(3).walkScale < 1);
});

test("REDLINE contracts gradually but stays bounded", () => {
  const opening = rivalCircuitArenaPlayableRadius(4, 0, 100);
  const middle = rivalCircuitArenaPlayableRadius(4, 27 * 60, 100);
  const final = rivalCircuitArenaPlayableRadius(4, 54 * 60, 100);
  const overtime = rivalCircuitArenaPlayableRadius(4, 99 * 60, 100);
  assert.equal(opening, 6.08);
  assert.ok(middle < opening && middle > final);
  assert.equal(final, 5.32);
  assert.equal(overtime, 5.32);
});

test("APEX convergence follows the same health gates as the boss phases", () => {
  assert.equal(rivalCircuitArenaPlayableRadius(5, 0, 100), 5.86);
  assert.equal(rivalCircuitArenaPlayableRadius(5, 0, 61), 5.86);
  assert.equal(rivalCircuitArenaPlayableRadius(5, 0, 60), 5.56);
  assert.equal(rivalCircuitArenaPlayableRadius(5, 0, 31), 5.56);
  assert.equal(rivalCircuitArenaPlayableRadius(5, 0, 30), 5.24);
  assert.equal(rivalCircuitArenaPlayableRadius(5, 0, 1), 5.24);
});
