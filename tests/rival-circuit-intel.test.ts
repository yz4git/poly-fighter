import assert from "node:assert/strict";
import test from "node:test";
import { buildRivalCircuitIntel } from "../src/game/rival-circuit-intel";

test("Rival Intel starts clean before the Circuit has learned a habit", () => {
  const intel = buildRivalCircuitIntel({ read: "NONE", confidence: 0, fights: 0 });
  assert.equal(intel.readLabel, "NO READ");
  assert.equal(intel.confidencePercent, 0);
  assert.equal(intel.protocolCount, 0);
  assert.equal(intel.combatLabel, "READ NONE // P0");
});

test("Rival Intel exposes a learned read and installed Protocol count compactly", () => {
  const intel = buildRivalCircuitIntel(
    { read: "RUSH", confidence: 0.724, fights: 2 },
    ["PHASE_STEP", "INTERCEPT_CORE"],
  );
  assert.equal(intel.readLabel, "ATTACK LOOP");
  assert.equal(intel.confidencePercent, 72);
  assert.equal(intel.fights, 2);
  assert.deepEqual(intel.protocolNames, ["PHASE STEP", "INTERCEPT CORE"]);
  assert.equal(intel.protocolCount, 2);
  assert.equal(intel.combatLabel, "READ ATTACK LOOP 72% // P2");
});

test("Rival Intel clamps noisy confidence values for player-facing UI", () => {
  assert.equal(buildRivalCircuitIntel({ read: "STEP", confidence: 1.8, fights: 1 }).confidencePercent, 100);
  assert.equal(buildRivalCircuitIntel({ read: "BALANCED", confidence: -0.4, fights: 1 }).confidencePercent, 0);
});
