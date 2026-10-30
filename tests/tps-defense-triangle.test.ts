import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  canTpsGuardThrow, resolveTpsGuard, shouldHoldTpsGuard, tpsCpuReadLowGuard,
  tpsGuardFrameAdvantage, tpsPunishWindowTicks,
} from "../src/game/tps-defense-triangle";
import { computeTpsHitResolution } from "../src/game/tps-impact-resolution";
import { fighterDnaForName } from "../src/game/fighter-dna";
import { buildTpsHudSnapshot } from "../src/game/tps-hud-snapshot";

test("STEP after evasion can be held to guard; releasing STEP restores neutral", () => {
  assert.equal(shouldHoldTpsGuard({heldStep:true,evadeTicks:4,actionable:true}),false);
  assert.equal(shouldHoldTpsGuard({heldStep:true,evadeTicks:0,actionable:true}),true);
  assert.equal(shouldHoldTpsGuard({heldStep:false,evadeTicks:0,actionable:true}),false);
  assert.equal(shouldHoldTpsGuard({heldStep:true,evadeTicks:0,actionable:false}),false);
});

test("standing and low guard are genuinely different choices; throws always win over guard", () => {
  for(const [level,standing,low] of [
    ["HIGH","BLOCK","DUCK"],
    ["MID","BLOCK","HIT"],
    ["LOW","HIT","BLOCK"],
    ["THROW","HIT","HIT"],
  ] as const) {
    assert.equal(resolveTpsGuard(level,true,false),standing);
    assert.equal(resolveTpsGuard(level,true,true),low);
    assert.equal(resolveTpsGuard(level,false,false),"HIT");
  }
});

test("mobile STEP+ATTACK throw requires nearby grounded enemy, not a global magnet", () => {
  assert.equal(canTpsGuardThrow({guarding:true,attackPressed:true,distance:1.18,opponentGrounded:true}),true);
  assert.equal(canTpsGuardThrow({guarding:true,attackPressed:true,distance:1.6,opponentGrounded:true}),false);
  assert.equal(canTpsGuardThrow({guarding:false,attackPressed:true,distance:1.0,opponentGrounded:true}),false);
  assert.equal(canTpsGuardThrow({guarding:true,attackPressed:true,distance:1.1,opponentGrounded:false}),false);
  assert.equal(canTpsGuardThrow({guarding:true,attackPressed:false,distance:1.1,opponentGrounded:true}),false);
});

test("block resolution honors chosen guard level, rather than blocking every strike", () => {
  const fighter=FIGHTER_DEFINITIONS.red;
  const dna=fighterDnaForName(fighter.name);
  for (const [move,stand,low] of [
    [fighter.moves.jab,true,false],
    [fighter.moves.kick,true,false],
    [fighter.moves.lowKick,false,true],
    [fighter.moves.throw,false,false],
  ] as const) {
    const apply = (defenderCrouching:boolean) => computeTpsHitResolution({
      move, defenderHealth:80,defenderGuarding:true,defenderCrouching,
      defenderWasAttacking:false,interceptStrike:false,reversalStrike:false,
      playerDna:dna,simulationTicks:12,attackerIsPlayer:true,
    });
    assert.equal(apply(false).blocked,stand,`${move.id}: standing guard`);
    assert.equal(apply(true).blocked,low,`${move.id}: low guard`);
  }
});

test("unsafe attacks expose short real frame punishment, fast safe attacks do not", () => {
  const move=FIGHTER_DEFINITIONS.red.moves.powerRush;
  const advantage=tpsGuardFrameAdvantage(move,move.startup);
  assert.ok(advantage>=5);
  assert.equal(tpsPunishWindowTicks(advantage),Math.min(24,advantage+2));
  assert.equal(tpsPunishWindowTicks(4),0);
  assert.equal(tpsPunishWindowTicks(-12),0);
  assert.equal(tpsGuardFrameAdvantage({...move,startup:5,active:2,recovery:7,blockStun:14},5),-5);
});

test("HUD communicates defensive choice and punish cue without adding a button", () => {
  const base = {
    trainingProgress:{hits:0,sideSteps:0,perfectEvades:0,punishes:0,intercepts:0},
    enemyThreat:{windup:false,incoming:false},
    finishPending:false,finished:false,
    playerReversalTicks:0,playerPerfectEvadeTicks:0,playerEvadeTicks:0,
    playerStepSideWeight:0,playerFlankWindowTicks:0,playerComboStage:0,
    combatBeatTicks:0,combatBeatLabel:null,enemyOpeningGraceTicks:0,
    p1State:"GUARD" as const,p2State:"ATTACK" as const,p1MoveId:null,
    fightDistance:1.3,strikeRange:2.12,timerTicks:1200,p1Health:80,p2Health:70,
    resultWinner:null,p1Name:"KAIRO",p2Name:"SERA",
  };
  assert.match(buildTpsHudSnapshot({...base,playerGuardCrouching:false}).message,/LOW VULNERABLE/);
  assert.match(buildTpsHudSnapshot({...base,playerGuardCrouching:true}).message,/MID VULNERABLE/);
  const punish=buildTpsHudSnapshot({...base,p1State:"IDLE",playerGuardPunishTicks:11});
  assert.equal(punish.tpsCue,"PUNISH");
  assert.match(punish.message,/PUNISH NOW/);
});

test("CPU low-guard reads require visual windup and are limited by difficulty", () => {
  const slowLow = FIGHTER_DEFINITIONS.red.moves.cycloneSweep;
  const probe = (difficulty:"EASY"|"NORMAL"|"HARD",attackTick:number,exchangeTick=0) =>
    tpsCpuReadLowGuard({defenderGuarding:true,move:slowLow,attackTick,difficulty,exchangeTick});
  assert.equal(probe("EASY",slowLow.startup),false);
  assert.equal(probe("HARD",0),false);
  assert.equal(probe("HARD",slowLow.startup),true);
  assert.equal(probe("NORMAL",0),false);
  assert.equal(probe("NORMAL",slowLow.startup,0),true);
  assert.equal(probe("NORMAL",slowLow.startup,90),false);
  assert.equal(tpsCpuReadLowGuard({defenderGuarding:false,move:slowLow,attackTick:99,difficulty:"HARD",exchangeTick:0}),false);
  assert.equal(tpsCpuReadLowGuard({defenderGuarding:true,move:FIGHTER_DEFINITIONS.red.moves.jab,attackTick:99,difficulty:"HARD",exchangeTick:0}),false);
});
