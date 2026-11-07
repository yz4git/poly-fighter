import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { chooseTpsCpuWhiffPunish, shouldTpsCpuFeint, tpsCpuFeintRevealTick } from "../src/game/tps-enemy-mindgame";
import { minimumTpsEnemyTelegraphTicks } from "../src/game/tps-enemy-policy";

const attacks = FIGHTER_DEFINITIONS.red.moves;
const feint = {
  difficulty: "NORMAL" as const, tactic: "BAIT" as const,
  observedMode: "UPPER_PATTERN", observedSamples: 8,
  opponentState: "IDLE", distance: 1.65, moveId: "power",
  candidateNumber: 4, ticksSinceLastFeint: 160,
};

test("feints require earned visible history and predictable gaps; EASY never mind-reads", () => {
  assert.equal(shouldTpsCpuFeint(feint), true);
  assert.equal(shouldTpsCpuFeint({...feint, difficulty:"HARD", candidateNumber:3}), true);
  for (const option of [
    {difficulty:"EASY" as const}, {tactic:"PRESSURE" as const},
    {observedMode:"UNSEEN"}, {observedSamples:4},
    {opponentState:"ATTACK"}, {distance:3.1}, {distance:.95},
    {moveId:"throw"}, {candidateNumber:3}, {ticksSinceLastFeint:60},
  ]) assert.equal(shouldTpsCpuFeint({...feint,...option}), false, JSON.stringify(option));
  assert.equal(shouldTpsCpuFeint({...feint, candidateNumber:8}),true,"later feints are not permanently disabled");
  assert.equal(tpsCpuFeintRevealTick(12),6,"LOAD is visibly held before cancelling");
  assert.equal(tpsCpuFeintRevealTick(9),5,"HARD telegraphs also stay readable");
});

const whiff = {
  difficulty: "NORMAL" as const, opponentState: "ATTACK",
  opponentMove: attacks.power, opponentMoveTick: attacks.power.startup + attacks.power.active + 5,
  opponentHitCpu: false, opponentHitStop: 0, distance: 1.10,
  cpuActionable: true, cpuJab: attacks.jab, cpuStraight: attacks.straight,
  jabTelegraphTicks:minimumTpsEnemyTelegraphTicks("NORMAL","jab"),
  straightTelegraphTicks:minimumTpsEnemyTelegraphTicks("NORMAL","straight"),
  cooldownTicks: 0,
};

test("whiff punish respects contact evidence, visible active frames, recovery and real reach", () => {
  assert.equal(chooseTpsCpuWhiffPunish(whiff),"JAB");
  assert.equal(chooseTpsCpuWhiffPunish({...whiff,distance:1.47}),null,
    "NORMAL must decline a straight when 12f telegraph + 8f startup exceeds 20f recovery");
  assert.equal(chooseTpsCpuWhiffPunish({...whiff,difficulty:"HARD",distance:1.47,
    opponentMoveTick:attacks.power.startup + attacks.power.active + 3,
    jabTelegraphTicks:minimumTpsEnemyTelegraphTicks("HARD","jab"),
    straightTelegraphTicks:minimumTpsEnemyTelegraphTicks("HARD","straight")}),"STRAIGHT",
    "HARD can spend its shorter 9f telegraph and still strike within the same honest recovery");
  for (const option of [
    {difficulty:"EASY" as const}, {opponentState:"IDLE"},
    {opponentHitCpu:true}, {opponentHitStop:3}, {cpuActionable:false},
    {cooldownTicks:22}, {distance:2.5}, {distance:.2},
    {opponentMove:null}, {opponentMoveTick:attacks.power.startup + attacks.power.active},
    {opponentMoveTick:attacks.power.startup + attacks.power.active + attacks.power.recovery - 2},
  ]) assert.equal(chooseTpsCpuWhiffPunish({...whiff,...option}), null, JSON.stringify(option));
  assert.equal(chooseTpsCpuWhiffPunish({...whiff,opponentMove:attacks.jab,
    opponentMoveTick:attacks.jab.startup+attacks.jab.active+5}),null,
    "short-recovery punches do not grant unearned instant punishment");
  assert.equal(chooseTpsCpuWhiffPunish({...whiff,difficulty:"HARD",distance:1.47,
    opponentMoveTick:attacks.power.startup + attacks.power.active + 3,
    jabTelegraphTicks:minimumTpsEnemyTelegraphTicks("HARD","jab"),
    straightTelegraphTicks:minimumTpsEnemyTelegraphTicks("HARD","straight"),
    cpuStraight:null}),null,
    "no fallback to invisible reach or a teleport");
});

test("HARD notices a genuine long-recovery miss earlier, without guaranteed damage", () => {
  const tick = attacks.power.startup + attacks.power.active + 3;
  assert.equal(chooseTpsCpuWhiffPunish({...whiff,difficulty:"NORMAL",opponentMoveTick:tick}),null);
  assert.equal(chooseTpsCpuWhiffPunish({...whiff,difficulty:"HARD",opponentMoveTick:tick,
    jabTelegraphTicks:minimumTpsEnemyTelegraphTicks("HARD","jab"),
    straightTelegraphTicks:minimumTpsEnemyTelegraphTicks("HARD","straight")}),"JAB");
});


test("player can read a real feint using the existing neutral ATTACK key only", async () => {
  const { shouldTpsPlayerPunishFeint, tpsFeintPunishAdvance,
    TPS_FEINT_READ_TICKS, TPS_FEINT_PUNISH_MAX_TRAVEL } =
    await import("../src/game/tps-feint-counterplay");
  const valid = {
    readTicks: TPS_FEINT_READ_TICKS, distance: 1.67,
    playerCanAct:true,playerGrounded:true,defenderGrounded:true,
    playerComboStage:0,directedTap:false,availableStraight:true,
  };
  assert.equal(shouldTpsPlayerPunishFeint(valid),true);
  for(const change of [
    {readTicks:0},{readTicks:10},{distance:2.1},{distance:.1},
    {playerCanAct:false},{playerGrounded:false},{defenderGrounded:false},
    {playerComboStage:1},{directedTap:true},{availableStraight:false},
  ]) assert.equal(shouldTpsPlayerPunishFeint({...valid,...change}),false,JSON.stringify(change));
  const move = {attackMove:"straight",moveTick:0,startup:8,
    hitStop:0,connected:false,longitudinal:1.75,lateral:0,travelTotal:0};
  assert.ok(tpsFeintPunishAdvance(move)>.02);
  let travel=0;
  for(let tick=0;tick<8;tick++){
    travel+=tpsFeintPunishAdvance({...move,moveTick:tick,travelTotal:travel});
  }
  assert.ok(travel>.16 && travel<=TPS_FEINT_PUNISH_MAX_TRAVEL,
    `animated startup travel was ${travel}`);
  for(const change of [
    {attackMove:"jab"},{moveTick:8},{hitStop:2},{connected:true},
    {longitudinal:-1},{lateral:1.35},{travelTotal:.35},
    {longitudinal:1.25},
  ]) assert.equal(tpsFeintPunishAdvance({...move,...change}),0,JSON.stringify(change));
});
