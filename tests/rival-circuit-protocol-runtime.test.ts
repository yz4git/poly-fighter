import assert from "node:assert/strict";
import test from "node:test";
import {
  RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS,
  rivalCircuitProtocolGameplayText,
  rivalCircuitProtocolIdFromLabel,
} from "../src/game/rival-circuit-protocol-runtime";

const IDS = [
  "PRESSURE_STACK",
  "PHASE_STEP",
  "PUNISH_DRIVE",
  "INTERCEPT_CORE",
  "CLUTCH_VECTOR",
  "CLEAN_LINE",
] as const;

test("every Circuit Protocol now has a gameplay-changing runtime contract", () => {
  assert.deepEqual(Object.keys(RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS).sort(), [...IDS].sort());
  for (const id of IDS) {
    const effect = RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS[id];
    assert.equal(effect.id, id);
    assert.ok(effect.gameplay.length > 24);
    assert.ok(effect.value > 0);
    assert.ok(["TICKS", "DISTANCE", "SCALE"].includes(effect.unit));
    assert.equal(rivalCircuitProtocolGameplayText(id), effect.gameplay);
  }
});

test("reward-card text resolves to the exact installed protocol", () => {
  assert.equal(rivalCircuitProtocolIdFromLabel("ATTACK ROUTE PRESSURE STACK Turns clean hit volume"), "PRESSURE_STACK");
  assert.equal(rivalCircuitProtocolIdFromLabel("EVADE ROUTE / PHASE STEP"), "PHASE_STEP");
  assert.equal(rivalCircuitProtocolIdFromLabel("PUNISH DRIVE"), "PUNISH_DRIVE");
  assert.equal(rivalCircuitProtocolIdFromLabel("INTERCEPT CORE"), "INTERCEPT_CORE");
  assert.equal(rivalCircuitProtocolIdFromLabel("CLUTCH VECTOR"), "CLUTCH_VECTOR");
  assert.equal(rivalCircuitProtocolIdFromLabel("CLEAN LINE"), "CLEAN_LINE");
  assert.equal(rivalCircuitProtocolIdFromLabel("START FIGHT"), null);
});

test("protocol magnitudes stay deliberately bounded", () => {
  assert.equal(RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.PRESSURE_STACK.value, 46);
  assert.ok(RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.PHASE_STEP.value <= 8);
  assert.ok(RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.PUNISH_DRIVE.value <= 0.3);
  assert.ok(RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.INTERCEPT_CORE.value <= 10);
  assert.ok(RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.CLUTCH_VECTOR.value <= 6);
  assert.ok(RIVAL_CIRCUIT_PROTOCOL_RUNTIME_EFFECTS.CLEAN_LINE.value <= 1.1);
});
