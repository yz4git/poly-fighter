import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  evaluateTpsStrikeGeometry,
  turnTpsCommittedAttackAim,
  tpsAttackWindupAdvance,
  tpsCanConfirmCombo,
  chooseTpsOpeningStrike,
  TPS_ATTACK_AIM_TURN_PER_TICK,
} from "../src/game/tps-fight-fundamentals";
import { minimumTpsEnemyTelegraphTicks } from "../src/game/tps-enemy-policy";

const moves = FIGHTER_DEFINITIONS.red.moves;

function strike(moveId: string, x: number, z = 0, fx = 1, fz = 0) {
  return evaluateTpsStrikeGeometry({
    move: moves[moveId], attackerX: 0, attackerZ: 0,
    defenderX: x, defenderZ: z, forwardX: fx, forwardZ: fz,
  });
}

test("fundamental striking game: hit, whiff, and sidestep have distinct spatial outcomes", () => {
  const jab = moves.jab;
  assert.equal(strike("jab", jab.reach + .10).connected, true, "well-spaced jab hits");
  assert.equal(strike("jab", jab.reach + .35).connected, false, "jab beyond authored reach must whiff");
  assert.equal(strike("jab", 1.22, 1.08).connected, false, "moving outside the attack lane causes an actual whiff");
  assert.equal(strike("jab", 1.22, .18).connected, true, "small movement is not invincible");
  assert.equal(strike("jab", -.5, 0).connected, false, "strikes do not hit through the back");
  assert.ok(strike("kick", 1.6).reach > strike("jab", 1.6).reach, "kick trades speed for spacing");
  assert.equal(strike("throw", moves.throw.reach + .19).connected, false, "throw must be point blank");
  assert.equal(strike("throw", moves.throw.reach + .10).connected, true);
  assert.ok(strike("straight", 1.4, .82).connected, "a wider straight tolerates small lateral errors");
});

test("attack windup is a small commitment, not an automatic pursuit system", () => {
  const jab = moves.jab;
  assert.equal(tpsAttackWindupAdvance(jab, jab.reach + 1.0), 0);
  assert.equal(tpsAttackWindupAdvance(jab, jab.reach), 0);
  const near = tpsAttackWindupAdvance(jab, jab.reach + .28);
  assert.ok(near > 0 && near < .04, "normal attack moves only a small fraction of a meter");
  const power = tpsAttackWindupAdvance(moves.power, moves.power.reach + .22);
  assert.ok(power > near, "heavy attacks may put more weight behind the drive");
  assert.equal(tpsAttackWindupAdvance(jab, Number.NaN), 0);
});

test("committed attacks can track slightly without snapping toward dodging opponents", () => {
  const first = turnTpsCommittedAttackAim(1, 0, 0, 1);
  assert.ok(Math.atan2(first.z, first.x) > 0);
  assert.ok(Math.atan2(first.z, first.x) <= TPS_ATTACK_AIM_TURN_PER_TICK + 1e-8);
  let x = 1, z = 0;
  for (let tick = 0; tick < 60; tick++) {
    const aim = turnTpsCommittedAttackAim(x, z, -1, 0);
    assert.ok(Math.abs(Math.atan2(aim.x * z - aim.z * x, aim.x * x + aim.z * z)) <= TPS_ATTACK_AIM_TURN_PER_TICK + 1e-8);
    x = aim.x; z = aim.z;
  }
  assert.ok(Math.hypot(x, z) > .999);
});

test("combo continuation requires genuine unblocked contact", () => {
  assert.equal(tpsCanConfirmCombo(false, false), false);
  assert.equal(tpsCanConfirmCombo(false, true), false);
  assert.equal(tpsCanConfirmCombo(true, false), false);
  assert.equal(tpsCanConfirmCombo(true, true), true);
});

test("direction held with the existing ATTACK button selects intentional neutral strikes", () => {
  const f = (distance: number, forward = false, back = false, lateral = false) =>
    chooseTpsOpeningStrike({ distance, forward, back, lateral });
  assert.deepEqual(f(1.42), { moveId: "jab", route: "CLOSE_A" });
  assert.deepEqual(f(1.42, true), { moveId: "straight", route: "CLOSE_A" });
  assert.deepEqual(f(1.42, false, true), { moveId: "backfist", route: "CLOSE_B" });
  assert.deepEqual(f(1.42, false, false, true), { moveId: "bodyBlow", route: "CLOSE_B" });
  assert.deepEqual(f(1.85), { moveId: "kick", route: "FAR" });
  assert.deepEqual(f(1.85, false, true), { moveId: "lowKick", route: "FAR" });
  assert.deepEqual(f(1.85, false, false, true), { moveId: "lowKick", route: "FAR" });
  for (const move of ["jab", "straight", "backfist", "bodyBlow", "kick", "lowKick"])
    assert.ok(moves[move], `${move}: existing move retained, no additional combat system`);
});

test("CPU normal/light attacks begin promptly, heavy attacks remain readable", () => {
  for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
    const light = minimumTpsEnemyTelegraphTicks(difficulty, "jab");
    const heavy = minimumTpsEnemyTelegraphTicks(difficulty, "power");
    assert.ok(light >= 8 && light <= 16);
    assert.ok(heavy > light);
    assert.ok(heavy - light >= 6);
  }
  assert.ok(minimumTpsEnemyTelegraphTicks("EASY", "jab") >
    minimumTpsEnemyTelegraphTicks("HARD", "jab"));
});
