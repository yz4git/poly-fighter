import assert from "node:assert/strict";
import test from "node:test";
import { Arena } from "../src/game/arena";
import { CombatSystem } from "../src/game/combat";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  CpuController,
  FighterController,
  FighterRuntime,
  FIGHTER_MAX_HEIGHT,
} from "../src/game/fighter";
import { EffectsManager } from "../src/game/effects";
import { FixedStepClock } from "../src/game/fixed";
import { RoundManager } from "../src/game/round";
import { EMPTY_INPUT, type FighterState, type InputFrame } from "../src/game/types";

const DT = 1 / 60;
const input = (patch: Partial<InputFrame>): InputFrame => ({ ...EMPTY_INPUT, ...patch });

function makeFighters(): { p1: FighterRuntime; p2: FighterRuntime } {
  const p1 = new FighterRuntime("p1", FIGHTER_DEFINITIONS.red);
  const p2 = new FighterRuntime("p2", FIGHTER_DEFINITIONS.blue, true);
  p1.resetForRound(-2.15, 0, 1);
  p2.resetForRound(2.15, 0, -1);
  return { p1, p2 };
}

function assertFinite(fighter: FighterRuntime): void {
  assert.equal(fighter.validateInvariants(), true, fighter.invariantError ?? "fighter invariant failed");
  assert.ok(fighter.position.y <= FIGHTER_MAX_HEIGHT);
}

function applyRingOut(arena: Arena, fighter: FighterRuntime): void {
  if (fighter.state === "KO" || fighter.state === "RING_OUT" || !arena.isOut(fighter.position)) return;
  fighter.state = "RING_OUT";
  fighter.grounded = false;
  fighter.velocity.set(fighter.facing * 2.6, 3.6, fighter.velocity.z);
}

test("normal jump with direction input follows a finite airborne arc and lands", () => {
  const { p1, p2 } = makeFighters();
  const controller = new FighterController();
  let maxY = 0;
  let minimumVerticalVelocity = 0;
  let landingTick = -1;

  for (let tick = 0; tick < 360; tick += 1) {
    controller.update(p1, p2, tick === 0 ? input({ up: true, right: true }) : input({ right: true }), DT);
    maxY = Math.max(maxY, p1.position.y);
    minimumVerticalVelocity = Math.min(minimumVerticalVelocity, p1.velocity.y);
    assertFinite(p1);
    if (tick > 0 && p1.grounded && landingTick < 0) landingTick = tick;
  }

  assert.ok(maxY > 0, "the jump must leave the ground");
  assert.ok(minimumVerticalVelocity < 0, "gravity must reverse vertical velocity");
  assert.ok(landingTick > 0 && landingTick < 120, `jump did not land in time: ${landingTick}`);
  assert.equal(p1.position.y, 0);
  assert.equal(p1.velocity.y, 0);
  assert.equal(p1.grounded, true);
}
);

test("CPU airborne actions produce a finite jump arc that lands before later actions may jump again", () => {
  const { p1, p2 } = makeFighters();
  const cpu = new CpuController("NORMAL");
  const controller = new FighterController();
  let maxY = 0;
  let jumpSeen = false;
  let landed = false;

  for (let tick = 0; tick < 600; tick += 1) {
    const next = cpu.update(p2, p1);
    jumpSeen ||= next.up;
    controller.update(p2, p1, next, DT);
    maxY = Math.max(maxY, p2.position.y);
    assertFinite(p2);
    if (jumpSeen && p2.grounded) landed = true;
  }

  assert.equal(jumpSeen, true);
  assert.equal(landed, true);
  assert.ok(maxY > 0 && maxY < FIGHTER_MAX_HEIGHT);
}
);

test("CPU simulations remain finite for EASY, NORMAL, and HARD over 30 seconds", () => {
  for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
    const { p1, p2 } = makeFighters();
    const p1Controller = new FighterController();
    const p2Controller = new FighterController();
    const p1Cpu = new CpuController(difficulty);
    const p2Cpu = new CpuController(difficulty);
    const combat = new CombatSystem();
    const arena = new Arena();
    const observedStates = new Set<FighterState>();

    for (let tick = 0; tick < 1_800; tick += 1) {
      if (p1.state !== "KO" && p1.state !== "RING_OUT") p1Controller.update(p1, p2, p1Cpu.update(p1, p2), DT);
      if (p2.state !== "KO" && p2.state !== "RING_OUT") p2Controller.update(p2, p1, p2Cpu.update(p2, p1), DT);
      combat.resolve(p1, p2);
      combat.resolve(p2, p1);
      applyRingOut(arena, p1);
      applyRingOut(arena, p2);
      assertFinite(p1);
      assertFinite(p2);
      observedStates.add(p1.state);
      observedStates.add(p2.state);

      if (p1.health <= 0 || p2.health <= 0 || p1.state === "RING_OUT" || p2.state === "RING_OUT") {
        p1.resetForRound(-2.15, 0, 1);
        p2.resetForRound(2.15, 0, -1);
      }
    }

    assert.ok(observedStates.has("JUMP"), `${difficulty} should be able to jump`);
    assert.ok(observedStates.size >= 4, `${difficulty} simulation became unresponsive`);
    arena.dispose();
  }
});

test("knockdown follows gravity, lands, and wakes up", () => {
  const { p1, p2 } = makeFighters();
  p2.receiveDamage(20, 30, 0.5, p1.facing, true, 0);
  let maxY = 0;
  let minimumVerticalVelocity = 0;
  for (let tick = 0; tick < 240; tick += 1) {
    p2.updatePhysics(DT);
    maxY = Math.max(maxY, p2.position.y);
    minimumVerticalVelocity = Math.min(minimumVerticalVelocity, p2.velocity.y);
    assertFinite(p2);
  }
  assert.ok(maxY > 0);
  assert.ok(minimumVerticalVelocity < 0);
  assert.equal(p2.position.y, 0);
  assert.equal(p2.grounded, true);
  assert.equal(p2.state, "IDLE");
});

test("throw follows gravity, lands, and returns to playable state", () => {
  const { p1, p2 } = makeFighters();
  p2.receiveThrow(18, 0.45, p1.facing, 0);
  for (let tick = 0; tick < 240; tick += 1) {
    p2.updatePhysics(DT);
    assertFinite(p2);
  }
  assert.equal(p2.position.y, 0);
  assert.equal(p2.grounded, true);
  assert.equal(p2.state, "IDLE");
});

test("KO keeps KO state after its finite launch and ends the round", () => {
  const { p1, p2 } = makeFighters();
  p2.receiveDamage(100, 30, 0.45, p1.facing, false, 0);
  for (let tick = 0; tick < 240; tick += 1) {
    p2.updatePhysics(DT);
    assertFinite(p2);
  }
  assert.equal(p2.state, "KO");
  assert.equal(p2.position.y, 0);
  assert.equal(p2.grounded, true);

  const round = new RoundManager();
  round.phase = "FIGHT";
  round.phaseTicks = 0;
  const result = round.tick(p1, p2);
  assert.equal(result?.winner, p1);
  assert.equal(round.phase, "ROUND_END");
  for (let tick = 0; tick < 121; tick += 1) round.tick(p1, p2);
  assert.equal(round.finishRound(result?.winner ?? null), "NEXT_ROUND");
});

test("best-of-three reaches RESULT after two round wins", () => {
  const { p1 } = makeFighters();
  const round = new RoundManager();
  assert.equal(round.finishRound(p1), "NEXT_ROUND");
  assert.equal(p1.wins, 1);
  assert.equal(round.round, 2);
  assert.equal(round.phase, "INTRO");
  assert.equal(round.finishRound(p1), "MATCH_RESULT");
  assert.equal(p1.wins, 2);
  assert.equal(round.phase, "RESULT");
  assert.equal(round.message, "PLAYER 1 WINS");
});

test("ring out is one terminal result, blocks further combat, and resets the next round", () => {
  const { p1, p2 } = makeFighters();
  const arena = new Arena();
  const combat = new CombatSystem();
  p1.position.x = arena.bounds.x + 0.2;
  p1.state = "RING_OUT";
  p1.grounded = false;
  p1.velocity.set(1, 3.6, 0);

  const round = new RoundManager();
  round.phase = "FIGHT";
  const result = round.tick(p1, p2);
  assert.equal(result?.winner, p2);
  assert.equal(result?.ringOut, true);
  assert.equal(round.phase, "ROUND_END");
  assert.equal(combat.resolve(p2, p1), null);
  for (let tick = 0; tick < 121; tick += 1) round.tick(p1, p2);
  assert.equal(round.finishRound(result?.winner ?? null), "NEXT_ROUND");
  p1.resetForRound(-2.15, 0, 1);
  p2.resetForRound(2.15, 0, -1);
  assert.deepEqual(p1.position.toArray(), [-2.15, 0, 0]);
  assert.deepEqual(p2.position.toArray(), [2.15, 0, 0]);
  arena.dispose();
});

test("INTRO gates combat while ROUND_END keeps passive physics alive", () => {
  const { p1, p2 } = makeFighters();
  const beforeP1 = p1.position.clone();
  const beforeP2 = p2.position.clone();
  const round = new RoundManager();
  const controller = new FighterController();
  const cpu = new CpuController("NORMAL");
  round.start();

  for (let tick = 0; tick < 91; tick += 1) {
    if (round.canSimulateCombat()) controller.update(p2, p1, cpu.update(p2, p1), DT);
    round.tick(p1, p2);
  }
  assert.equal(round.phase, "FIGHT");
  assert.deepEqual(p1.position.toArray(), beforeP1.toArray());
  assert.deepEqual(p2.position.toArray(), beforeP2.toArray());

  p2.receiveDamage(100, 20, 0.2, 1, false, 0);
  round.phase = "ROUND_END";
  const roundEndPosition = p2.position.clone();
  const roundEndHealth = p1.health;
  const roundEndState = p2.state;
  const roundEndVelocity = p2.velocity.clone();
  const roundEndController = new FighterController();
  for (let tick = 0; tick < 60; tick += 1) {
    assert.equal(round.canSimulateCombat(), false);
    assert.equal(round.canSimulatePassive(), true);
    roundEndController.updatePassive(p2, DT);
    round.tick(p1, p2);
  }
  assert.notDeepEqual(p2.position.toArray(), roundEndPosition.toArray());
  assert.notEqual(p2.velocity.y, roundEndVelocity.y);
  assert.equal(p1.health, roundEndHealth);
  assert.equal(p2.state, roundEndState);
  for (let tick = 0; tick < 180; tick += 1) roundEndController.updatePassive(p2, DT);
  assert.equal(p2.grounded, true);
  assert.equal(p2.position.y, 0);
  assert.equal(p2.state, "KO");
});

test("ROUND_END ring-out trajectory continues without a second result", () => {
  const { p1, p2 } = makeFighters();
  const round = new RoundManager();
  const controller = new FighterController();
  p1.position.x = 4.2;
  p1.state = "RING_OUT";
  p1.grounded = false;
  p1.velocity.set(2.6, 3.6, 0);
  round.phase = "FIGHT";
  const result = round.tick(p1, p2);
  assert.equal(result?.winner, p2);
  const startX = p1.position.x;
  for (let tick = 0; tick < 120; tick += 1) {
    controller.updatePassive(p1, DT);
    round.tick(p1, p2);
  }
  assert.ok(p1.position.x > startX);
  assert.equal(round.phase, "ROUND_END");
  assert.equal(p1.state, "RING_OUT");
  assertFinite(p1);
});

test("fixed-step outcomes stay aligned across 30, 60, and 120 render fps", () => {
  const simulate = (renderFps: number) => {
    const { p1, p2 } = makeFighters();
    const controller = new FighterController();
    const clock = new FixedStepClock();
    let steps = 0;
    for (let frame = 0; frame < renderFps * 2; frame += 1) {
      clock.advance(1 / renderFps, () => {
        controller.update(p1, p2, steps === 0 ? input({ up: true, right: true }) : input({ right: true }), DT);
        steps += 1;
      });
    }
    return { steps, x: p1.position.x, y: p1.position.y, health: p1.health, state: p1.state };
  };
  const results = [30, 60, 120].map(simulate);
  assert.deepEqual(results.map((result) => result.steps), [120, 120, 120]);
  assert.ok(Math.max(...results.map((result) => result.x)) - Math.min(...results.map((result) => result.x)) < 0.001);
  assert.ok(Math.max(...results.map((result) => result.y)) - Math.min(...results.map((result) => result.y)) < 0.001);
  assert.deepEqual(results.map((result) => result.health), [100, 100, 100]);
  assert.deepEqual(results.map((result) => result.state), ["WALK", "WALK", "WALK"]);
});

test("arena floor uses shared instanced resources", () => {
  const arena = new Arena();
  const stats = arena.resourceStats();
  assert.equal(stats.floorInstanceMeshes, 5);
  assert.ok(stats.trackedResources < 60);
  assert.equal(arena.group.getObjectsByProperty("isInstancedMesh", true).length, 5);
  arena.dispose();
});

test("impact effects keep a bounded material pool over thousands of hits", () => {
  const effects = new EffectsManager();
  const move = FIGHTER_DEFINITIONS.red.moves.jab;
  assert.ok(move);
  const event = {
    attacker: "p1",
    defender: "p2",
    move,
    blocked: false,
    counter: false,
    throwEscape: false,
    damage: move.damage,
    position: { x: 0, y: 1.2, z: 0 },
  };
  for (let index = 0; index < 2_000; index += 1) {
    effects.hit(event);
    effects.update(0.5);
  }
  const stats = effects.resourceStats();
  assert.ok(stats.fragmentMaterials <= 5);
  assert.equal(stats.flashMaterials, 10);
  assert.equal(stats.geometries, 2);
  effects.dispose();
});

test("CPU versus CPU survives 10,000 fixed ticks with finite runtime state", () => {
  const { p1, p2 } = makeFighters();
  const p1Controller = new FighterController();
  const p2Controller = new FighterController();
  const p1Cpu = new CpuController("NORMAL");
  const p2Cpu = new CpuController("HARD");
  const combat = new CombatSystem();
  const arena = new Arena();
  const round = new RoundManager();
  round.start();
  let outcome: { winner: FighterRuntime | null; ringOut: boolean } | null = null;
  const observedStates = new Set<FighterState>();
  let completedRounds = 0;

  for (let tick = 0; tick < 10_000; tick += 1) {
    if (round.canSimulateCombat()) {
      p1Controller.update(p1, p2, p1Cpu.update(p1, p2), DT);
      p2Controller.update(p2, p1, p2Cpu.update(p2, p1), DT);
      combat.resolve(p1, p2);
      combat.resolve(p2, p1);
      applyRingOut(arena, p1);
      applyRingOut(arena, p2);
    }
    const result = round.tick(p1, p2);
    if (result) outcome = result;
    if (round.phase === "ROUND_END" && round.phaseTicks > 120 && outcome) {
      const next = round.finishRound(outcome.winner);
      completedRounds += 1;
      outcome = null;
      if (next === "MATCH_RESULT") {
        p1.wins = 0;
        p2.wins = 0;
        round.start();
      }
      p1.resetForRound(-2.15, 0, 1);
      p2.resetForRound(2.15, 0, -1);
    }
    assertFinite(p1);
    assertFinite(p2);
    observedStates.add(p1.state);
    observedStates.add(p2.state);
  }

  assert.ok(completedRounds >= 2);
  assert.ok(observedStates.size >= 5);
  arena.dispose();
});
