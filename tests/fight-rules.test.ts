import assert from "node:assert/strict";
import test from "node:test";
import { Arena } from "../src/game/arena";
import { CombatSystem, resolveFighterPushboxes } from "../src/game/combat";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterRuntime } from "../src/game/fighter";
import { EMPTY_INPUT } from "../src/game/types";

function fighters() {
  const p1 = new FighterRuntime("p1", FIGHTER_DEFINITIONS.red);
  const p2 = new FighterRuntime("p2", FIGHTER_DEFINITIONS.blue);
  p1.resetForRound(-1, 0, 1);
  p2.resetForRound(0, 0, -1);
  return { p1, p2 };
}

function activate(fighter: FighterRuntime, moveId: string): void {
  assert.equal(fighter.beginMove(moveId), true);
  const move = fighter.currentMove;
  assert.ok(move);
  for (let index = 0; index < move.startup; index += 1) fighter.advanceAttack();
  assert.equal(fighter.isActive(), true);
}

test("mid attack damages a standing defender and emits frame data", () => {
  const { p1, p2 } = fighters();
  const combat = new CombatSystem();
  activate(p1, "jab");
  const event = combat.resolve(p1, p2);
  assert.ok(event);
  assert.equal(event.blocked, false);
  assert.equal(p2.health, 94);
  assert.equal(p2.state, "HIT");
});

test("standing guard blocks mid, while a low guard blocks low", () => {
  const { p1, p2 } = fighters();
  const combat = new CombatSystem();
  p2.setInput({ ...EMPTY_INPUT, guard: true });
  activate(p1, "jab");
  const blocked = combat.resolve(p1, p2);
  assert.ok(blocked?.blocked);
  assert.equal(p2.health, 100);

  p1.resetForRound(-1, 0, 1);
  p2.resetForRound(0, 0, -1);
  p2.setInput({ ...EMPTY_INPUT, guard: true, down: true });
  activate(p1, "lowKick");
  const lowBlocked = combat.resolve(p1, p2);
  assert.ok(lowBlocked?.blocked);
  assert.equal(p2.health, 100);
});

test("throw escape is accepted inside the throw window", () => {
  const { p1, p2 } = fighters();
  const combat = new CombatSystem();
  p2.setInput({ ...EMPTY_INPUT, guard: true, punch: true });
  activate(p1, "throw");
  const event = combat.resolve(p1, p2);
  assert.equal(event?.throwEscape, true);
  assert.equal(p2.health, 100);
});

test("standing pushboxes recover even exact close-range root overlap without changing vertical position", () => {
  const { p1, p2 } = fighters();
  p1.position.set(0, 0, 0);
  p2.position.set(0, 0, 0);
  const before = Math.hypot(p2.position.x - p1.position.x, p2.position.z - p1.position.z);

  for (let index = 0; index < 8; index += 1) resolveFighterPushboxes(p1, p2);

  const after = Math.hypot(p2.position.x - p1.position.x, p2.position.z - p1.position.z);
  assert.ok(after > before, `expected separation to grow: ${before} -> ${after}`);
  assert.ok(after >= 0.899, `expected KAIRO/SERA push radius sum, got ${after}`);
  assert.equal(p1.position.y, 0);
  assert.equal(p2.position.y, 0);
});

test("combat pass runs pushbox separation once per tick and freezes it during hitstop", () => {
  const { p1, p2 } = fighters();
  const combat = new CombatSystem();
  p1.position.set(-0.1, 0, 0);
  p2.position.set(0.1, 0, 0);

  combat.resolve(p1, p2);
  const afterFirstPass = p2.position.x - p1.position.x;
  combat.resolve(p2, p1);
  assert.equal(p2.position.x - p1.position.x, afterFirstPass);

  p1.hitStop = 3;
  p2.hitStop = 3;
  const frozenP1 = p1.position.clone();
  const frozenP2 = p2.position.clone();
  combat.resolve(p1, p2);
  assert.deepEqual(p1.position.toArray(), frozenP1.toArray());
  assert.deepEqual(p2.position.toArray(), frozenP2.toArray());
});

test("damage can cause KO and arena bounds expose ring out", () => {
  const { p1, p2 } = fighters();
  p2.receiveDamage(100, 20, 0.2, 1, false, 5);
  assert.equal(p2.health, 0);
  assert.equal(p2.state, "KO");
  const arena = new Arena();
  p1.position.set(arena.bounds.x + 0.1, 0, 0);
  assert.equal(arena.isOut(p1.position), true);
  arena.dispose();
});
