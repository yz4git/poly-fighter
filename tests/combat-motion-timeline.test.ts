import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { expandedClipName } from "../src/game/expanded-motion-library";
import {
  AUTHORED_MOTION_EVENTS,
  authoredMotionEvents,
  sampleCombatMotionTimeline,
} from "../src/game/combat-motion-timeline";

const CLIP_FOR_MOVE: Readonly<Record<string, string>> = {
  jab: "BF_Jab_L",
  straight: "BF_Cross_R",
  backfist: "BF_Backfist_R",
  bodyBlow: "BF_BodyBlow_L",
  power: "BF_Power_R",
  kick: "BF_FrontKick_R",
  lowKick: "BF_LowKick_L",
  risingKick: "BF_RisingKick_R",
  dashKick: "BF_DashKick_R",
  throw: "CM_Throw",
  counter: "CM_Counter_R",
};

test("authored combat events are finite, ordered and unique to one timeline table", () => {
  assert.ok(Object.keys(AUTHORED_MOTION_EVENTS).length >= 14);
  for (const [clip, event] of Object.entries(AUTHORED_MOTION_EVENTS)) {
    assert.ok(Number.isFinite(event.contact), `${clip}: finite contact`);
    assert.ok(Number.isFinite(event.contactExit), `${clip}: finite contact exit`);
    assert.ok(event.contact >= 0 && event.contact <= 1, `${clip}: contact range`);
    assert.ok(event.contactExit >= event.contact && event.contactExit <= 1, `${clip}: contact exit range`);
  }
});

test("all gameplay attacks share one monotonic tick-driven timeline", () => {
  for (const fighter of Object.values(FIGHTER_DEFINITIONS)) {
    for (const move of Object.values(fighter.moves)) {
      const originalClip = CLIP_FOR_MOVE[move.motionBase ?? move.id];
      const clip = originalClip && move.motionVariant
        ? expandedClipName(originalClip, move.motionVariant)
        : originalClip;
      assert.ok(clip, `${fighter.name}/${move.id}: missing authoritative clip mapping in test`);
      const event = authoredMotionEvents(clip);
      const total = move.startup + move.active + move.recovery;
      let previous = -1;
      for (let tick = 0; tick < total; tick += 0.25) {
        const sample = sampleCombatMotionTimeline(move, tick, clip);
        assert.ok(sample.phase >= previous - 1e-12, `${fighter.name}/${move.id}/${tick}: monotonic`);
        assert.ok(sample.phase >= 0 && sample.phase <= 1, `${fighter.name}/${move.id}/${tick}: phase range`);
        previous = sample.phase;
      }
      const firstActive = sampleCombatMotionTimeline(move, move.startup, clip);
      assert.equal(firstActive.stage, "ACTIVE", `${fighter.name}/${move.id}: first active stage`);
      assert.equal(firstActive.phase, event.contact, `${fighter.name}/${move.id}: gameplay contact alignment`);
      assert.equal(firstActive.contactWeight, 1, `${fighter.name}/${move.id}: contact weight`);
      const final = sampleCombatMotionTimeline(move, total - 1, clip);
      assert.equal(final.stage, "RECOVERY", `${fighter.name}/${move.id}: final stage`);
      assert.equal(final.phase, 1, `${fighter.name}/${move.id}: complete recovery`);
    }
  }
});

test("same gameplay tick always samples the same pose so hitstop cannot advance animation", () => {
  const move = FIGHTER_DEFINITIONS.red.moves.risingKick;
  const clip = "BF_RisingKick_R";
  for (const tick of [0, move.startup - 1, move.startup, move.startup + 1, move.startup + move.active]) {
    const before = sampleCombatMotionTimeline(move, tick, clip);
    const frozen = sampleCombatMotionTimeline(move, tick, clip);
    assert.deepEqual(frozen, before, `tick ${tick}: deterministic freeze`);
  }
});

test("kick and punch attacks use the exact same phase contract", () => {
  const fighter = FIGHTER_DEFINITIONS.red;
  for (const [moveId, clip] of [["straight", "BF_Cross_R"], ["risingKick", "BF_RisingKick_R"]] as const) {
    const move = fighter.moves[moveId];
    const contact = authoredMotionEvents(clip).contact;
    assert.equal(sampleCombatMotionTimeline(move, move.startup, clip).phase, contact);
    assert.equal(sampleCombatMotionTimeline(move, move.startup, clip).stage, "ACTIVE");
  }
});

test("sakurai-style punch windup appears immediately without moving the gameplay contact frame", () => {
  const light = FIGHTER_DEFINITIONS.red.moves.jab;
  const heavy = FIGHTER_DEFINITIONS.red.moves.power;
  const lightClip = "BF_Jab_L";
  const heavyClip = "BF_Power_R";
  const firstJab = sampleCombatMotionTimeline(light, 0, lightClip);
  const firstPower = sampleCombatMotionTimeline(heavy, 0, heavyClip);
  assert.equal(firstJab.phase, 0, "fast jab begins at its original authored pose");
  assert.ok(firstPower.phase > 0.04, "slow heavy punch immediately assumes a readable windup silhouette");
  assert.ok(firstPower.phase < authoredMotionEvents(heavyClip).contact * 0.13,
    "anticipation must not skip the whole committed startup");
  for (const [move, clip] of [[light, lightClip], [heavy, heavyClip]] as const) {
    const firstActive = sampleCombatMotionTimeline(move, move.startup, clip);
    assert.equal(firstActive.stage, "ACTIVE");
    assert.equal(firstActive.phase, authoredMotionEvents(clip).contact,
      "the hitbox's first active tick remains the EXACT strike-contact pose");
  }
});

test("heavy attack swing visibly overtravels and holds its end pose before recovery", () => {
  const heavy = FIGHTER_DEFINITIONS.red.moves.power;
  const jab = FIGHTER_DEFINITIONS.red.moves.jab;
  const heavyEvent = authoredMotionEvents("BF_Power_R");
  const jabEvent = authoredMotionEvents("BF_Jab_L");
  assert.ok(heavyEvent.contactExit - heavyEvent.contact > jabEvent.contactExit - jabEvent.contact,
    "power strike receives more authored follow-through travel than a jab");
  const heavyLastActive = sampleCombatMotionTimeline(heavy,
    heavy.startup + heavy.active - 1, "BF_Power_R");
  assert.equal(heavyLastActive.phase, heavyEvent.contactExit);
  assert.equal(heavyLastActive.contactWeight, 1);
  const earlyRecovery = sampleCombatMotionTimeline(heavy,
    heavy.startup + heavy.active, "BF_Power_R");
  assert.equal(earlyRecovery.stage, "RECOVERY");
  assert.equal(earlyRecovery.phase, heavyEvent.contactExit,
    "the first recovery frame preserves the fully extended follow-through");
  const midway = sampleCombatMotionTimeline(heavy,
    heavy.startup + heavy.active + heavy.recovery * 0.5, "BF_Power_R");
  assert.ok(midway.phase > heavyEvent.contactExit && midway.phase < 1);
  const final = sampleCombatMotionTimeline(heavy,
    heavy.startup + heavy.active + heavy.recovery - 1, "BF_Power_R");
  assert.equal(final.phase, 1, "authored stance returns by the original recovery end");
});

test("expanded punch and kick variants inherit their motion family silhouette beats", () => {
  for (const [id, clip] of [["power", "BF_Power_R"], ["risingKick", "BF_RisingKick_R"],
    ["straight", "BF_Cross_R"]] as const) {
    const move = FIGHTER_DEFINITIONS.red.moves[id];
    const derived = expandedClipName(clip, "SNAP");
    const first = sampleCombatMotionTimeline(move, 0, derived);
    const event = authoredMotionEvents(clip);
    assert.ok(first.phase > 0);
    assert.deepEqual(authoredMotionEvents(derived), event);
    assert.equal(sampleCombatMotionTimeline(move, move.startup, derived).phase, event.contact);
  }
});

test("the shipped video-reference and range clips receive the same authored beat identity", () => {
  const cases = [
    ["CM_Video_Jab", "LIGHT"],
    ["CM_Video_Palm", "PUNCH"],
    ["CM_Video_SideKick", "KICK"],
    ["CM_Video_SpinKick", "HEAVY"],
    ["CM_Range_rangeBlitz", "PUNCH"],
    ["CM_Range_rangeCrescent", "KICK"],
    ["CM_Range_rangeComet", "HEAVY"],
  ] as const;
  for (const [clip, family] of cases) {
    const event = authoredMotionEvents(clip);
    assert.equal(event.contact, 0.5);
    assert.ok(event.contactExit >= event.contact);
    if (family === "LIGHT") {
      assert.equal(event.anticipation, 0);
      assert.equal(event.followHold, 0);
    } else {
      assert.ok(event.anticipation > 0, clip);
      assert.ok(event.followHold > 0, clip);
    }
  }
  assert.ok(authoredMotionEvents("CM_Video_SpinKick").contactExit >
    authoredMotionEvents("CM_Video_Jab").contactExit);
});
