import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { expandMoveSet } from "../src/game/move-expansion";
import { tpsClosePunchFamily } from "../src/game/tps-close-punch-lane";
import {
  TPS_PUNCH_SILHOUETTE_VERSION,
  tpsPunchSilhouettePose,
} from "../src/game/tps-punch-silhouette";

const moves = expandMoveSet(FIGHTER_DEFINITIONS.red.moves);

function pose(id: string, tick: number) {
  const move = moves[id];
  assert.ok(move, id);
  return tpsPunchSilhouettePose({
    family: tpsClosePunchFamily(move), tick,
    startup: move.startup, active: move.active, recovery: move.recovery,
    contactSide: move.visualContact === "LEFT_FIST" ? -1 : 1,
  });
}

test("punch silhouette variants are authored from the move family, not a generic punch", () => {
  assert.equal(TPS_PUNCH_SILHOUETTE_VERSION, "AUTHORED_UPPER_BODY_ARC_V1");
  for (const family of ["jab", "straight", "bodyBlow"]) {
    const base = moves[family];
    const reference = pose(family, base.startup);
    assert.ok(reference.factor > .99);
    assert.ok(Math.abs(reference.spineYaw) > .04);
    for (const suffix of ["Snap", "Drive", "Pivot", "Crush"]) {
      const move = moves[family + suffix];
      assert.equal(tpsClosePunchFamily(move), family);
      assert.ok(pose(move.id, move.startup).factor > .99);
    }
  }
  const jab = pose("jab", moves.jab.startup);
  const cross = pose("straight", moves.straight.startup);
  const body = pose("bodyBlow", moves.bodyBlow.startup);
  assert.ok(jab.spineYaw < 0 && cross.spineYaw > 0,
    "lead and rear punches rotate toward different impact lanes");
  assert.ok(Math.abs(cross.spineYaw) > Math.abs(jab.spineYaw) + .02,
    "rear cross has noticeably more torsion than compact jab");
  assert.ok(body.spinePitch > 0 && cross.spinePitch < 0,
    "body blow drops the line rather than cloning a high straight");
});

test("start, end, non-punch, airborne and invalid inputs never add phantom upper-body pose", () => {
  for (const family of ["jab", "straight", "bodyBlow"]) {
    const move = moves[family];
    assert.equal(pose(family, 0).factor, 0, "first startup tick preserves the incoming stance");
    assert.equal(pose(family, move.startup + move.active + Math.max(9, move.recovery)).factor, 0);
  }
  for (const id of ["power", "kick", "lowKick", "risingKick", "throw", "backfist"]) {
    assert.equal(pose(id, moves[id].startup).factor, 0, id + " keeps its existing authored choreography");
  }
  for (const overrides of [
    {family:null}, {family:"kick"}, {tick:Infinity}, {startup:0},
    {active:0}, {recovery:-1},
  ]) {
    const result = tpsPunchSilhouettePose({
      family:"jab",tick:5,startup:5,active:3,recovery:10,
      contactSide:-1,...overrides,
    });
    assert.equal(result.factor,0,JSON.stringify(overrides));
  }
});

test("body arc is bounded and monotone through recovery; a hitstop repeats exactly", () => {
  for (const family of ["jab","straight","bodyBlow"]) {
    const move = moves[family];
    const values = Array.from({length:move.startup+move.active+move.recovery+2},
      (_,tick)=>pose(family,tick));
    const firstContact = pose(family,move.startup);
    assert.deepEqual(firstContact,pose(family,move.startup), "deterministic 60Hz hitstop");
    assert.ok(values.every(x => x.factor>=0 && x.factor<=1));
    assert.ok(values.every(x => [
      x.spineYaw,x.spinePitch,x.strikePitch,x.coverPitch,x.strikeRoll,x.coverRoll,
    ].every(v=>Number.isFinite(v) && Math.abs(v)<.11)));
    const delta=Math.max(...values.slice(1).map((x,i)=>
      Math.abs(x.spineYaw-values[i].spineYaw)));
    assert.ok(delta<.05,family+" torso turn is too abrupt: "+delta);
    const recovering=values.slice(move.startup+move.active);
    assert.ok(recovering.every((x,i)=>i===0 || x.factor<=recovering[i-1].factor+1e-8),
      family+" must settle, not bounce into the next action");
    assert.equal(values.at(-1)?.factor,0);
  }
});
