import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { authoredMotionEvents, sampleCombatMotionTimeline } from "../src/game/combat-motion-timeline";
import {
  VIDEO_CHOREOGRAPHY_VERSION, VIDEO_STRIKE_CLIPS,
  sampleHeroVideoChoreography, sampleVideoChoreography,
  type VideoStrike,
} from "../src/game/video-demo-choreography";

test("reference video choreography: four distinguishable game-ready clips", () => {
  assert.equal(VIDEO_CHOREOGRAPHY_VERSION, "VIDEO_REFERENCE_CHOREOGRAPHY_V3");
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


test("hero animations use more visible windup, longer strike extension and distinct per-fighter identity", () => {
  const jabLoad = sampleVideoChoreography("jab", .20, .09);
  const jabImpact = sampleVideoChoreography("jab", .5, .09);
  const jabOver = sampleVideoChoreography("jab", .57, .09);
  assert.ok(jabLoad.forward! < 0 && jabLoad.yaw! < -.30, "visible whole-body jab recoil");
  assert.ok(jabImpact.forward! > .06 && jabImpact.leftHand![2] > .70);
  assert.ok(jabOver.leftHand![2] > jabImpact.leftHand![2], "follows through after the hit");
  const palmLoad = sampleVideoChoreography("backfist", .21, .09);
  const palm = sampleVideoChoreography("backfist", .5, .09);
  assert.ok(palmLoad.yaw! < -.70 && palm.yaw! > .9, "backfist rotates from deep opposite windup");
  const kickLoad = sampleVideoChoreography("kick", .37, .09);
  const kick = sampleVideoChoreography("kick", .5, .09);
  assert.ok(kickLoad.rightFoot![1] >= .42 && kick.rightFoot![1] >= .60);
  assert.ok(kick.rightFoot![2] >= .65 && kick.leftFoot![1] === 0);
  const spin = sampleVideoChoreography("risingKick", .5, .09);
  assert.ok(spin.rightFoot![1] > .8);
  for (const [name, move] of [["KAIRO", "jab"], ["SERA", "kick"], ["VANTA", "backfist"], ["AXION", "risingKick"]] as const) {
    const original = sampleVideoChoreography(move, .5, .09);
    const hero = sampleHeroVideoChoreography(move, .5, .09, name);
    assert.notDeepEqual(hero, original, name + " should possess their own contact silhouette");
    assert.deepEqual(sampleHeroVideoChoreography(move, 0, .09, name), sampleVideoChoreography(move, 0, .09), "common guard entry");
    assert.deepEqual(sampleHeroVideoChoreography(move, 1, .09, name), sampleVideoChoreography(move, 1, .09), "no return snap");
    for (const u of [.15, .3, .5, .7, .9]) {
      const pose = sampleHeroVideoChoreography(move, u, .09, name);
      const values = [pose.side!, pose.forward!, pose.drop!, pose.yaw!, pose.pitch!, pose.roll!, ...pose.leftFoot!, ...pose.rightFoot!, ...pose.leftHand!, ...pose.rightHand!];
      assert.ok(values.every(Number.isFinite), name + " nonfinite pose at phase " + u);
    }
  }
});


test("backfist contact keeps an upright torso without flattening the striking hand or hip turn", () => {
  const neutral = sampleVideoChoreography("backfist", 0, .09);
  const impact = sampleVideoChoreography("backfist", .50, .09);
  const follow = sampleVideoChoreography("backfist", .58, .09);
  const kairo = sampleHeroVideoChoreography("backfist", .50, .09, "KAIRO");
  assert.ok(impact.yaw! >= .95, "distinct rotated palm strike retains its hip drive");
  assert.ok(impact.chest! <= .12, "thorax is no longer bent into the fist path");
  assert.ok(Math.abs(impact.roll!) <= .16, "pelvis no longer dives sideways at contact");
  assert.ok(kairo.chest! < .14, "POWER fighter receives heavy impact without extra neck fold");
  assert.ok(kairo.forward! > impact.forward!, "KAIRO retains a genuine forward weight shift");
  assert.deepEqual(kairo.rightHand, impact.rightHand, "the authored glove path must never be relaxed");
  assert.ok(impact.rightHand![2] > neutral.rightHand![2] + .45, "the actual palm reaches forward");
  assert.ok(follow.rightHand![0] > impact.rightHand![0], "palm follows through across center");
  for (const phase of [.40,.45,.50,.55,.58,.65]) {
    const a = sampleHeroVideoChoreography("backfist", phase, .09, "KAIRO");
    const b = sampleHeroVideoChoreography("backfist", phase + .01, .09, "KAIRO");
    assert.ok(Math.abs(a.chest! - b.chest!) < .027, "torso pitch interpolation must remain smooth");
    assert.ok(Math.abs(a.roll! - b.roll!) < .035, "waist return must remain smooth");
  }
  assert.deepEqual(sampleHeroVideoChoreography("backfist", 0, .09, "KAIRO"), neutral);
  assert.deepEqual(sampleHeroVideoChoreography("backfist", 1, .09, "KAIRO"), sampleVideoChoreography("backfist", 1, .09));
});

test("side kick's grounded shoulder counterbalance does not pitch head first at target", () => {
  const base = sampleVideoChoreography("kick", .5, .09);
  const sera = sampleHeroVideoChoreography("kick", .5, .09, "SERA");
  assert.ok(base.yaw! < -1.0, "rotated planted hip still powers the kick");
  assert.ok(base.pitch! <= .12 && base.chest! <= .08, "raised leg must not force chest into a forward fold");
  assert.ok(Math.abs(base.roll!) <= .12, "kick support hip must not take upper body into a side dive");
  assert.deepEqual(base.rightFoot, [.16,.61,.68], "the heel contact target stays exactly authored");
  assert.deepEqual(base.leftFoot, [-.10,0,.05], "the planted support leg retains its target");
  assert.ok(sera.rightFoot![1] > base.rightFoot![1], "SERA still earns a higher, agile kick");
  assert.ok(sera.roll! < base.roll!, "SERA retains its lateral accent");
  for (const t of [.28,.39,.50,.58,.70,.81]) {
    const first = sampleVideoChoreography("kick", t, .09);
    const second = sampleVideoChoreography("kick", t+.01, .09);
    assert.ok(Math.abs(first.pitch! - second.pitch!) < .032, "kick pitch changes smoothly");
    assert.ok(Math.abs(first.roll! - second.roll!) < .035, "kick roll changes smoothly");
  }
});
