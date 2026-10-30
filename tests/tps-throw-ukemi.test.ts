import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  TPS_THROW_TECH_REACTION_TICKS, TPS_UKEMI_ROLL_TICKS,
  TPS_UKEMI_TOTAL_DISTANCE, canBufferTpsThrowTech,
  canResolveTpsThrowTech, canStartTpsUkemi, tpsUkemiMovePerFrame,
} from "../src/game/tps-throw-ukemi";

const moves = FIGHTER_DEFINITIONS.red.moves;

test("throw escapes must answer a committed, nearby, telegraphed grab", () => {
  const check = (patch: Partial<Parameters<typeof canBufferTpsThrowTech>[0]>={}) =>
    canBufferTpsThrowTech({
      attackPressed:true,playerState:"GUARD",enemyState:"ATTACK",
      enemyMove:moves.throw,enemyMoveTick:moves.throw.startup-3,distance:1.15,...patch,
    });
  assert.equal(check(),true);
  assert.equal(check({attackPressed:false}),false);
  assert.equal(check({enemyMove:moves.jab}),false);
  assert.equal(check({enemyState:"IDLE"}),false);
  assert.equal(check({distance:1.82}),false);
  assert.equal(check({playerState:"HIT"}),false);
  assert.equal(check({playerState:"ATTACK"}),false);
  assert.equal(check({enemyMoveTick:moves.throw.startup+moves.throw.active+1}),false);
  assert.equal(canResolveTpsThrowTech(moves.throw,TPS_THROW_TECH_REACTION_TICKS,"GUARD"),true);
  assert.equal(canResolveTpsThrowTech(moves.throw,0,"GUARD"),false);
  assert.equal(canResolveTpsThrowTech(moves.throw,5,"HIT"),false);
  assert.equal(canResolveTpsThrowTech(moves.straight,5,"GUARD"),false);
});

test("ukemi uses grounded directional STEP after knockdown, never a free invulnerable escape", () => {
  const check = (patch: Partial<Parameters<typeof canStartTpsUkemi>[0]>={}) =>
    canStartTpsUkemi({stepPressed:true,state:"KNOCKDOWN",grounded:true,
      knockdownTicks:32,forwardAxis:0,sideAxis:1,alreadyRolling:false,...patch});
  assert.equal(check(),true);
  assert.equal(check({sideAxis:0,forwardAxis:-1}),true);
  assert.equal(check({sideAxis:0,forwardAxis:1}),false);
  assert.equal(check({grounded:false}),false);
  assert.equal(check({state:"WAKEUP"}),false);
  assert.equal(check({knockdownTicks:55}),false);
  assert.equal(check({knockdownTicks:9}),false);
  assert.equal(check({stepPressed:false}),false);
  assert.equal(check({alreadyRolling:true}),false);
  assert.equal(TPS_UKEMI_ROLL_TICKS*tpsUkemiMovePerFrame(),TPS_UKEMI_TOTAL_DISTANCE);
});
