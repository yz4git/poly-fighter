import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import {
  chooseTpsNeutralMashMove, TPS_MASH_BUFFER_TICKS,
  TPS_MASH_PHRASE_COUNT, tpsCanBufferMashTap,
} from "../src/game/tps-mash-variety";
import { tpsComboLinkWindow } from "../src/game/motion-profile";

for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
  test(`neutral button mashing discovers eight distinct 3-hit phrases for ${definition.name}`, () => {
    const moves: string[] = [];
    const bases: string[] = [];
    let previous: string | null = null;
    for (let count = 0; count < 24; count++) {
      const choice = chooseTpsNeutralMashMove({
        phrase: Math.floor(count / 3), stage: count % 3, distance: 1.15,
        lastBase: previous, available: definition.moves,
      });
      assert.ok(definition.moves[choice.id], `${count}: every attack exists`);
      assert.equal(choice.phrase, Math.floor(count / 3) % TPS_MASH_PHRASE_COUNT);
      assert.notEqual(choice.base, previous, `${count}: no identical silhouette in succession`);
      moves.push(choice.id); bases.push(choice.base); previous=choice.base;
    }
    assert.deepEqual(moves.slice(0, 3), ["jab", "straight", "power"],
      "original first combo remains the same");
    for (const name of ["backfist","bodyBlow","kick","lowKick","risingKick","dashKick","counter","power","straight","jab"]) {
      assert.ok(bases.includes(name), `${name} reachable without touching stick`);
    }
    assert.ok(new Set(moves).size >= 13, "neutral taps expose authored variations, not just 3 repeated strikes");
    assert.ok(new Set(bases).size >= 10, "not merely cosmetic variants of one base move");
  });
}

test("distance favors actual leg/driving strikes but does not invent hit detection", () => {
  const available = FIGHTER_DEFINITIONS.red.moves;
  for (let count=0;count<36;count++) {
    const result=chooseTpsNeutralMashMove({
      phrase:count,stage:count%3,distance:1.92,available,
    });
    assert.ok(["kick","lowKick","dashKick","risingKick"].includes(result.base),`${count}: far strike`);
    assert.ok(available[result.id].reach < 3,"no infinite range even when mashing");
  }
  const fallback=chooseTpsNeutralMashMove({
    phrase:5,stage:2,distance:1.15,available:{jab:available.jab},
  });
  assert.equal(fallback.id,"jab","small or custom move sets never select missing attacks");
});

test("a 4-frame rapid mash gets a new opener after each complete whiff, even without landing hits",()=>{
  const available=FIGHTER_DEFINITIONS.red.moves;
  const moves=[] as string[];
  let previous: string | null = null;
  for(let opener=0;opener<12;opener++){
    const choice=chooseTpsNeutralMashMove({phrase:opener,stage:0,distance:1.15,lastBase:previous,available});
    moves.push(choice.base);previous=choice.base;
  }
  assert.equal(moves[0],"jab");
  assert.equal(moves[1],"backfist");
  assert.equal(moves[2],"kick");
  assert.ok(new Set(moves).size>=7, "visible variety even against evasive enemies");
  assert.ok(moves.includes("risingKick"), "the video spinning kick appears in no-direction mash play");
  assert.ok(moves.includes("dashKick"), "dash kick can appear without a direction button");
});

test("mash prebuffer helps fast iPhone taps but does not bypass cancel window or hit confirmation",()=>{
  const move=FIGHTER_DEFINITIONS.red.moves.straight;
  const link=tpsComboLinkWindow(move);
  assert.ok(TPS_MASH_BUFFER_TICKS>=15 && TPS_MASH_BUFFER_TICKS<=24);
  assert.equal(tpsCanBufferMashTap(move,0),false,"very early unrelated input is not queued");
  assert.equal(tpsCanBufferMashTap(move,move.startup-3),true);
  assert.equal(tpsCanBufferMashTap(move,move.startup),true);
  assert.equal(tpsCanBufferMashTap(move,link.queueStart),true);
  assert.equal(tpsCanBufferMashTap(move,link.linkStart),true);
  assert.equal(tpsCanBufferMashTap(move,move.startup+move.active+move.recovery),false);
});
