import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { authoredMotionEvents, sampleCombatMotionTimeline } from "../src/game/combat-motion-timeline";
import {
  VIDEO_CHOREOGRAPHY_VERSION, VIDEO_STRIKE_CLIPS,
  sampleVideoChoreography,
  type VideoStrike,
} from "../src/game/video-demo-choreography";

test("reference video choreography: four distinguishable game-ready clips", () => {
  assert.equal(VIDEO_CHOREOGRAPHY_VERSION, "VIDEO_REFERENCE_CHOREOGRAPHY_V1");
  assert.equal(new Set(Object.values(VIDEO_STRIKE_CLIPS)).size,4);
  for (const name of Object.keys(VIDEO_STRIKE_CLIPS) as VideoStrike[]) {
    const start=sampleVideoChoreography(name,0,.09);
    const contact=sampleVideoChoreography(name,.5,.09);
    const finish=sampleVideoChoreography(name,1,.09);
    assert.ok((start.highGuard ?? 0)>.7, name+": starts in real defensive stance");
    assert.ok((finish.highGuard ?? 0)>.8, name+": returns hand guard");
    for(const phase of [0,.12,.24,.43,.5,.66,.92,1]) {
      const p=sampleVideoChoreography(name,phase,.09);
      for(const v of [p.side,p.forward,p.drop,p.yaw,p.pitch,p.roll,p.chest,p.highGuard,p.spin,
        ...p.leftFoot!,...p.rightFoot!,...p.leftHand!,...p.rightHand!]) {
        assert.ok(Number.isFinite(v),name+": finite skeleton pose");
      }
    }
    assert.equal(authoredMotionEvents(VIDEO_STRIKE_CLIPS[name]).contact,.5);
    const original=FIGHTER_DEFINITIONS.red.moves[name];
    const sample=sampleCombatMotionTimeline(original,original.startup,VIDEO_STRIKE_CLIPS[name]);
    assert.equal(sample.stage,"ACTIVE");
    assert.equal(sample.phase,.5,name+": first active frame is authored contact");
  }
});

test("video punch & palm contact are distinct and lead with opposite arms",()=>{
  const straight=sampleVideoChoreography("jab",.5,.09);
  const palm=sampleVideoChoreography("backfist",.5,.09);
  const neutral=sampleVideoChoreography("jab",0,.09);
  assert.ok(straight.leftHand![2] > neutral.leftHand![2]+.35);
  assert.ok(straight.rightHand![2] < straight.leftHand![2]-.3);
  assert.ok(palm.rightHand![2] > neutral.rightHand![2]+.3);
  assert.ok(palm.leftHand![2] < palm.rightHand![2]-.25);
  assert.ok(Math.abs(palm.yaw!) > Math.abs(straight.yaw!),"palm requires deeper hip turn");
});

test("side thrust and rotating high kick have different chamber/contact/pivot",()=>{
  const kickLoad=sampleVideoChoreography("kick",.37,.09);
  const side=sampleVideoChoreography("kick",.5,.09);
  const spinLoad=sampleVideoChoreography("risingKick",.30,.09);
  const spinning=sampleVideoChoreography("risingKick",.5,.09);
  assert.ok(kickLoad.rightFoot![1] > .33,"side kick chambers knee before release");
  assert.ok(side.rightFoot![2] > kickLoad.rightFoot![2]+.25,"side kick actually extends");
  assert.ok(side.leftFoot![1] === 0,"support remains on ground");
  assert.ok(spinning.rightFoot![1] > side.rightFoot![1]+.15,"turning kick strikes higher");
  assert.ok(Math.abs(spinLoad.spin!) > Math.PI*0.7,"spin pre-rotates before impact");
  assert.ok(Math.abs(spinning.spin!+Math.PI*2)<1e-4,"completes pivot at impact");
  assert.ok(Math.abs(sampleVideoChoreography("risingKick",1,.09).spin!+Math.PI*2)<1e-4,
    "settle at an equivalent neutral heading, without a snap back");
});

test("normalized source phase is bounded, height-safe and deterministic",()=>{
  const a=sampleVideoChoreography("kick",.4,-100);
  const b=sampleVideoChoreography("kick",.4,.04);
  assert.deepEqual(a,b);
  assert.deepEqual(sampleVideoChoreography("jab",-1,.09),sampleVideoChoreography("jab",0,.09));
  assert.deepEqual(sampleVideoChoreography("jab",2,.09),sampleVideoChoreography("jab",1,.09));
  assert.deepEqual(sampleVideoChoreography("jab",NaN,.09),sampleVideoChoreography("jab",0,.09));
});
