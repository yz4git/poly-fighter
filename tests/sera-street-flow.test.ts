import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { sampleCombatMotionTimeline, authoredMotionEvents } from "../src/game/combat-motion-timeline";
import { chooseSeraStreetFlowMove, SERA_STREET_FLOW_MOVES, SERA_STREET_FLOW_VERSION } from "../src/game/sera-street-flow";
import { sampleSeraStreetFlowPose, SERA_STREET_FLOW_CLIPS, SERA_STREET_FLOW_POSE_VERSION } from "../src/game/sera-street-flow-choreography";
import { tpsComboLinkWindow } from "../src/game/motion-profile";
import { tpsImpactHeightForMove } from "../src/game/tps-impact-resolution";

const sera=FIGHTER_DEFINITIONS.blue, kairo=FIGHTER_DEFINITIONS.red;
const plan=(overrides: Partial<Parameters<typeof chooseSeraStreetFlowMove>[0]>={})=>
  chooseSeraStreetFlowMove({
    fighter:"SERA",comboStage:0,completedBeats:0,forward:true,back:false,side:false,distance:1.25,
    available:sera.moves,...overrides,
  });

test("user GIF route exists on the actual SERA fighter, and nowhere else",()=>{
  assert.equal(SERA_STREET_FLOW_VERSION,"SERA_GIF_STREET_FLOW_12FRAMES_V1");
  assert.equal(SERA_STREET_FLOW_POSE_VERSION,"SERA_STREET_12_FRAME_IK_V1");
  assert.deepEqual(SERA_STREET_FLOW_MOVES,["streetFlowJab","streetFlowKick","streetFlowPalm"]);
  assert.equal(new Set(Object.values(SERA_STREET_FLOW_CLIPS)).size,3);
  for(const id of SERA_STREET_FLOW_MOVES){
    assert.ok(sera.moves[id],id);
    assert.equal(kairo.moves[id],undefined,"KAIRO's original moves stay untouched");
  }
  assert.equal(plan(),"streetFlowJab");
  assert.equal(plan({fighter:"KAIRO"}),null);
  assert.equal(plan({distance:1.72}),null,"must approach naturally before initiating");
  assert.equal(plan({forward:false}),null,"neutral mash remains unchanged");
  assert.equal(plan({side:true}),null,"side attack retains its original special move");
  assert.equal(plan({back:true}),null,"retreat attack retains its original special move");
  assert.equal(plan({comboStage:1,completedBeats:0}),null,"never bypass first move");
  assert.equal(plan({completedBeats:1,comboStage:1,forward:false}),"streetFlowKick");
  assert.equal(plan({completedBeats:2,comboStage:2,forward:false}),"streetFlowPalm");
  assert.equal(plan({completedBeats:2,comboStage:2,side:true}),null);
  assert.equal(plan({completedBeats:1,comboStage:0}),null,"combo expiration cannot launch a late kick");
  assert.equal(plan({completedBeats:3,comboStage:3}),null,"no free 4th hit");
  assert.equal(plan({completedBeats:1,comboStage:1,distance:2.2}),null,"cannot summon a long-range kick");
  assert.equal(plan({available:{jab:sera.moves.jab}}),null,"missing authored move fails closed");
});

test("three deliberate inputs preserve each actual hitbox, contact and 60Hz clean-hit cancel window",()=>{
  const moves=SERA_STREET_FLOW_MOVES.map(id=>sera.moves[id]);
  assert.deepEqual(moves.map(m=>m.visualContact),["LEFT_FIST","RIGHT_FOOT","RIGHT_FIST"]);
  assert.deepEqual(moves.map(m=>m.hitLevel),["MID","HIGH","MID"]);
  assert.deepEqual(moves.map(m=>m.motionBase),["jab","kick","bodyBlow"]);
  assert.deepEqual(moves.map(tpsImpactHeightForMove),[2.62,2.45,2.34],
    "SERA-specific spark heights follow the authored head-kick/palm silhouettes");
  assert.equal(tpsImpactHeightForMove(kairo.moves.kick),1.80,
    "other fighters retain their original impact presentation");
  assert.ok(moves.every(m=>m.damage>0 && m.reach<2 && m.active>=3));
  assert.ok(moves.every(m=>m.cinematicRole===undefined),"do not hijack air-juggle damage contracts");
  for(let i=0;i<moves.length;i++){
    const move=moves[i];
    const contact=sampleCombatMotionTimeline(move,move.startup,SERA_STREET_FLOW_CLIPS[SERA_STREET_FLOW_MOVES[i]]);
    assert.equal(contact.stage,"ACTIVE");
    assert.equal(contact.phase,.5,"real collision starts at the authored 3D contact pose");
    assert.equal(authoredMotionEvents(SERA_STREET_FLOW_CLIPS[SERA_STREET_FLOW_MOVES[i]]).contact,.5);
    const window=tpsComboLinkWindow(move);
    assert.ok(window.linkStart > move.startup+move.active,"do not bypass follow-through");
    assert.ok(window.linkEnd < move.startup+move.active+move.recovery);
  }
  assert.ok(moves.reduce((sum,m)=>sum+m.startup+m.active+m.recovery,0) < 90,
    "fast grounded action reads as a compact 1.3–1.5s phrase");
});

test("one supplied 12-frame reference becomes three visibly different normalized 3D IK trajectories",()=>{
  const at=(id:typeof SERA_STREET_FLOW_MOVES[number],u:number)=>sampleSeraStreetFlowPose(id,u,.084);
  const ready=at("streetFlowJab",0);
  for(const id of SERA_STREET_FLOW_MOVES){
    assert.deepEqual(at(id,0),at(id,1),"no snapped neutral return between selected moves");
    assert.deepEqual(at(id,-2),at(id,0));
    assert.deepEqual(at(id,2),at(id,1));
    for(const phase of [0,.09,.22,.39,.5,.6,.78,.99,1]){
      const p=at(id,phase);
      const numbers=[p.side,p.forward,p.drop,p.yaw,p.pitch,p.roll,p.chest,p.highGuard,p.spin,
        ...p.leftFoot!,...p.rightFoot!,...p.leftHand!,...p.rightHand!];
      assert.ok(numbers.every(x=>typeof x==="number"&&Number.isFinite(x)),id+" "+phase);
      assert.ok(p.drop!>=-.23 && p.drop!<=.02,"pelvis stays in a feasible athletic stance");
    }
  }
  const jab=at("streetFlowJab",.5);
  const kick=at("streetFlowKick",.5);
  const duck=at("streetFlowPalm",.29);
  const palm=at("streetFlowPalm",.52);
  assert.ok(jab.leftHand![2]>ready.leftHand![2]+.5,"guarded jab strikes forward");
  assert.ok(jab.rightHand![2]<.25,"opposite fist remains in guard");
  assert.ok(kick.rightFoot![1]>.80 && kick.rightFoot![2]>.60,"head-high foot is a real raised IK target");
  assert.ok(kick.leftHand![1]<.70 && kick.rightHand![1]<.70,
    "high kick keeps a compact protecting guard instead of lifting fists overhead");
  assert.equal(kick.leftFoot![1],0,"support foot stays grounded");
  assert.ok(duck.drop!<-.16,"low evasive stance genuinely lowers pelvis");
  assert.ok(duck.leftHand![1]<.35,"guard hand sweeps below waist at low pivot");
  assert.ok(palm.rightHand![2]>.68 && palm.yaw!>.7,"low lunge follows through as powerful open palm");
  assert.ok(palm.drop!>duck.drop!+.10,"palm gets leg-driven upward recovery");
});
