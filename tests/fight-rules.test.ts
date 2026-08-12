import assert from "node:assert/strict";
import test from "node:test";
import { Arena } from "../src/game/arena";
import { CombatSystem } from "../src/game/combat";
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
