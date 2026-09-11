import assert from "node:assert/strict";
import test from "node:test";
import {
  RIVAL_CIRCUIT_ARENAS,
  rivalCircuitArenaForStage,
  rivalCircuitStageFromLabel,
} from "../src/game/rival-circuit-arena";

test("Rival Circuit ships five visually distinct arena profiles", () => {
  assert.equal(RIVAL_CIRCUIT_ARENAS.length, 5);
  assert.deepEqual(RIVAL_CIRCUIT_ARENAS.map((arena) => arena.stage), [1, 2, 3, 4, 5]);
  assert.equal(new Set(RIVAL_CIRCUIT_ARENAS.map((arena) => arena.id)).size, 5);
  assert.equal(new Set(RIVAL_CIRCUIT_ARENAS.map((arena) => arena.accent)).size, 5);
  assert.equal(rivalCircuitArenaForStage(1).id, "GLASSLINE");
  assert.equal(rivalCircuitArenaForStage(5).id, "APEX");
});

test("Circuit stage detection follows the live HUD label and rejects normal fights", () => {
  assert.equal(rivalCircuitStageFromLabel("CIRCUIT 1/5 GLASSLINE PRESSURE // SCORE 0"), 1);
  assert.equal(rivalCircuitStageFromLabel("Circuit 4 / 5 LOCKSTEP"), 4);
  assert.equal(rivalCircuitStageFromLabel("TARGET LOCKED"), null);
  assert.equal(rivalCircuitStageFromLabel("CIRCUIT 9/5"), null);
});

test("out of range arena requests stay inside the authored route", () => {
  assert.equal(rivalCircuitArenaForStage(0).stage, 1);
  assert.equal(rivalCircuitArenaForStage(99).stage, 5);
});
