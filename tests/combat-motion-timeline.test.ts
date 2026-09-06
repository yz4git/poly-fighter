import assert from "node:assert/strict";
import test from "node:test";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
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
      const clip = CLIP_FOR_MOVE[move.id];
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
