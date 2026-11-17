import assert from "node:assert/strict";
import test from "node:test";
import {
  isCombatAttackClip, planCombatMotionHandoff,
} from "../src/game/combat-motion-handoff";
import {
  approachLocomotionHeading, combatStride, locomotionBlendAtHeading, stationaryTurnClip,
} from "../src/game/combat-motion-clock";

test("every authored/expanded/SERA/cinematic strike uses the same attack handoff classifier", () => {
  const attacks = [
    "BF_Jab_L", "BF_FrontKick_R", "CM_Counter_L", "CM_Throw",
    "CM_Video_SideKick", "CM_Range_rangeBlitz",
    "CM_StreetFlow_Jab", "CM_StreetFlow_HighKick", "CM_StreetFlow_LowPalm",
    "VM_BF_Cross_R_SNAP", "VM_BF_FrontKick_R_PIVOT",
    "FX_BF_Power_R_RUSH", "FX_BF_DashKick_R_METEOR",
  ];
  for (const clip of attacks) assert.equal(isCombatAttackClip(clip), true, clip);
  const nonAttacks = [
    "", "CM_Ready", "CM_Guard", "CM_Move_BLEND", "CM_Turn_L",
    "BF_HitHeavy", "BF_HitLight_L", "BF_CounterHit_R",
    "CM_Block", "CM_Down", "CM_Wakeup", "CM_Launch",
  ];
  for (const clip of nonAttacks) assert.equal(isCombatAttackClip(clip), false, clip);
});

test("SERA's real three-step combo hands off as attacks, not generic poses", () => {
  const routes = [
    ["CM_Ready", "CM_StreetFlow_Jab", "ATTACK", "ATTACK_ENTRY"],
    ["CM_StreetFlow_Jab", "CM_StreetFlow_HighKick", "ATTACK", "ATTACK_COMBO"],
    ["CM_StreetFlow_HighKick", "CM_StreetFlow_LowPalm", "ATTACK", "ATTACK_COMBO"],
    ["CM_StreetFlow_LowPalm", "CM_Guard", "GUARD", "ATTACK_TO_GUARD"],
    ["CM_StreetFlow_LowPalm", "CM_Ready", "IDLE", "ATTACK_TO_READY"],
    ["CM_StreetFlow_HighKick", "BF_HitHeavy", "HIT", "REACTION_INTERRUPT"],
    ["CM_StreetFlow_Jab", "CM_Block", "BLOCK_STUN", "BLOCK_INTERRUPT"],
    ["VM_BF_FrontKick_R_DRIVE", "FX_BF_RisingKick_R_LIFT", "ATTACK", "ATTACK_COMBO"],
    ["CM_Range_rangeCrescent", "CM_Video_Palm", "ATTACK", "ATTACK_COMBO"],
    ["CM_Throw", "CM_Ready", "IDLE", "ATTACK_TO_READY"],
    ["BF_Jab_L", "CM_Down", "KO", "REACTION_INTERRUPT"],
    ["BF_Cross_R", "CM_Down", "KNOCKDOWN", "REACTION_INTERRUPT"],
    ["BF_RisingKick_R", "CM_Thrown", "THROW", "REACTION_INTERRUPT"],
    ["BF_Power_R", "CM_Down", "RING_OUT", "REACTION_INTERRUPT"],
    ["CM_Down", "CM_Wakeup", "WAKEUP", "LANDING"],
    ["CM_Down", "CM_TechRise", "WAKEUP", "LANDING"],
    ["CM_Down", "CM_QuickRise", "KNOCKDOWN", "LANDING"],
    ["CM_Down", "CM_TechRoll_L", "KNOCKDOWN", "LANDING"],
    ["CM_Down", "CM_TechRoll_R", "KNOCKDOWN", "LANDING"],
    ["CM_Block", "CM_Guard", "GUARD", "BLOCK_RECOVERY"],
  ] as const;
  for (const [from, to, state, mode] of routes) {
    const decision = planCombatMotionHandoff(from, to, state);
    assert.equal(decision.mode, mode, from + " -> " + to);
    assert.ok(decision.duration > 0 && decision.duration <= .12);
    assert.ok(decision.velocityCarry >= 0 && decision.velocityCarry <= 1);
  }
});

test("analogue stride stays continuous through 22.5 and 67.5 degree blend boundaries", () => {
  for (const speed of [false, true]) {
    let prior = combatStride(speed, 0);
    for (let degrees = 1; degrees <= 90; degrees++) {
      const lateral = Math.sin(degrees * Math.PI / 180);
      const stride = combatStride(speed, lateral);
      assert.ok(Number.isFinite(stride) && stride > 0 && stride <= .30);
      assert.ok(Math.abs(stride - prior) < .009,
        `no gait acceleration step at ${degrees}° for speed=${speed}: ${prior} -> ${stride}`);
      assert.ok(Math.abs(stride - combatStride(speed, -lateral)) < 1e-10,
        "left and right have the same step frequency");
      prior = stride;
    }
  }
  const before = locomotionBlendAtHeading(67.49 * Math.PI / 180);
  const after = locomotionBlendAtHeading(67.51 * Math.PI / 180);
  assert.ok(before.firstWeight >= 0 && after.firstWeight >= 0);
  assert.ok(Math.abs(before.secondWeight - after.secondWeight) < .002,
    "the visual blend stays continuous at the same gait-sector boundary");
});

test("heading changes at finite speed and idle turns have hysteresis without reversed poses", () => {
  let heading: number | null = 0;
  for (let i = 0; i < 12; i++) {
    const next = approachLocomotionHeading(heading, 1, -1, 1 / 60);
    assert.ok(Math.abs(next - heading!) <= 9 / 60 + 1e-8);
    heading = next;
  }
  assert.equal(stationaryTurnClip(.48, "CM_Ready"), "CM_Ready");
  assert.equal(stationaryTurnClip(.56, "CM_Ready"), "CM_Turn_R");
  assert.equal(stationaryTurnClip(.31, "CM_Turn_R"), "CM_Turn_R");
  assert.equal(stationaryTurnClip(.24, "CM_Turn_R"), "CM_Ready");
  assert.equal(stationaryTurnClip(-.47, "CM_Turn_R"), "CM_Ready",
    "no temporary turn in the wrong direction");
  assert.equal(stationaryTurnClip(-.84, "CM_Turn_R"), "CM_Turn_L");
  assert.equal(stationaryTurnClip(Number.NaN, "CM_Turn_L"), "CM_Ready");
});
