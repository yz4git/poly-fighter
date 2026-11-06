import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PLAYABLE_FIGHTERS } from "../src/game/playable-fighters";
import { sampleCombatMotionTimeline } from "../src/game/combat-motion-timeline";
import { isCombatAttackClip, planCombatMotionHandoff } from "../src/game/combat-motion-handoff";
import {
  TPS_AUTO_RANGE_THRESHOLD, TPS_LONG_RANGE_THRESHOLD, TPS_RANGE_ATTACK_IDS,
  TPS_RANGE_STOP_DISTANCE, chooseTpsRangeAttack, isTpsRangeAttack, tpsRangeAdvance,
} from "../src/game/tps-range-attack";
import { evaluateTpsStrikeGeometry, tpsCanConfirmCombo } from "../src/game/tps-fight-fundamentals";
import { TPS_MASH_BUFFER_TICKS, tpsCanBufferMashTap } from "../src/game/tps-mash-variety";
import {
  TPS_RANGE_CHOREOGRAPHY_VERSION, TPS_RANGE_CLIP_SOURCES,
  tpsRangeClipName, bakeTpsRangeClip, createTpsRangeMotionLibrary,
  tpsRangePoseEnvelope,
} from "../src/game/tps-range-motion";

const choose = (distance: number, sequence = 0, attackerGrounded = true, defenderGrounded = true) =>
  chooseTpsRangeAttack({ distance, sequence, attackerGrounded, defenderGrounded });

test("ATTACK at actual out-of-range distance picks three distinct closers, not a whiffing jab", () => {
  assert.equal(choose(1), null);
  assert.equal(choose(TPS_AUTO_RANGE_THRESHOLD), null);
  assert.equal(choose(2.35), "rangeBlitz");
  assert.equal(choose(2.35, 1), "rangeCrescent");
  assert.equal(choose(3.5, 2), "rangeBlitz");
  assert.equal(choose(TPS_LONG_RANGE_THRESHOLD + .01, 0), "rangeComet");
  assert.equal(choose(7.1, 3), "rangeComet");
  assert.equal(choose(NaN), null);
  assert.equal(choose(Infinity), null);
  assert.equal(choose(3, 0, false, true), null, "airborne attacker cannot auto-charge");
  assert.equal(choose(3, 0, true, false), null, "aerial juggle keeps its own move selection");
  assert.equal(TPS_RANGE_ATTACK_IDS.length, 3);
  for (const fighter of PLAYABLE_FIGHTERS) {
    assert.equal(Object.keys(fighter.moves).length, 61);
    const names = new Set<string>();
    for (const id of TPS_RANGE_ATTACK_IDS) {
      const move = fighter.moves[id];
      assert.ok(move, fighter.name + " missing " + id);
      assert.equal(move.id, id);
      assert.ok(move.startup >= 14 && move.recovery >= 19, "gap closers must be punishable");
      assert.ok(move.damage >= 9 && move.damage <= 18);
      assert.ok(move.reach < 2.1, "no fake long-distance hitbox");
      assert.ok(move.hitLevel !== "THROW");
      assert.equal(move.motionVariant, undefined);
      assert.equal(move.cinematicRole, undefined);
      assert.ok(move.label.length > 8);
      names.add(move.label);
    }
    assert.equal(names.size, 3, fighter.name + " needs three separate attacks");
  }
});

test("honest 60Hz advance stops at contact, freezes during hitstop and misses a sidestep", () => {
  for (const [id, initial] of [
    ["rangeBlitz", 2.5],
    ["rangeCrescent", 3.45],
    ["rangeComet", 5.6],
    ["rangeComet", 8.0],
  ] as const) {
    const move = PLAYABLE_FIGHTERS[0].moves[id];
    let distance = initial;
    let travelled = 0;
    const first = tpsRangeAdvance({ moveId: id, moveTick: 0, startup: move.startup, distance, longitudinal: distance, lateral: 0, hitStop: 0, connected: false });
    assert.ok(first > 0 && first < .3);
    for (let tick = 0; tick < move.startup; tick += 1) {
      const step = tpsRangeAdvance({
        moveId: id, moveTick: tick, startup: move.startup, distance,
        longitudinal: distance, lateral: 0, hitStop: 0, connected: false,
      });
      assert.ok(step >= 0 && step < .3, id + " travel must be bounded");
      assert.ok(step <= Math.max(0, distance - TPS_RANGE_STOP_DISTANCE) + 1e-8, id + " cannot cross opponent");
      distance -= step;
      travelled += step;
    }
    assert.ok(travelled > .32 && distance < initial - .32, id + " must actually move");
    assert.ok(distance >= TPS_RANGE_STOP_DISTANCE - 1e-9, id + " must not teleport through target");
    assert.equal(tpsRangeAdvance({
      moveId: id, moveTick: move.startup, startup: move.startup,
      distance: 5, longitudinal: 5, lateral: 0, hitStop: 0, connected: false,
    }), 0, "active contact must not keep gliding through the defender");
  }
  const input = { moveId: "rangeCrescent", moveTick: 4, startup: 22, distance: 3.5, longitudinal: 3.5, lateral: .2, hitStop: 0, connected: false };
  assert.ok(tpsRangeAdvance(input) > 0);
  assert.equal(tpsRangeAdvance({ ...input, lateral: 1.30 }), 0, "side step beats committed line");
  assert.equal(tpsRangeAdvance({ ...input, longitudinal: -.2 }), 0, "no backwards root warp");
  assert.equal(tpsRangeAdvance({ ...input, hitStop: 6 }), 0, "hitstop freezes root advance");
  assert.equal(tpsRangeAdvance({ ...input, connected: true }), 0, "confirmed hit stops approach");
  assert.equal(tpsRangeAdvance({ ...input, moveId: "jab" }), 0, "ordinary punches are unaffected");
  assert.equal(isTpsRangeAttack("rangeBlitz"), true);
  assert.equal(isTpsRangeAttack("rangeComet"), true);
  assert.equal(isTpsRangeAttack("dashKick"), false);
});

const clip = (name: string) => {
  const times = [0, .18, .5, .74, 1];
  const q = times.flatMap(() => [0, 0, 0, 1]);
  return new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack("pelvis.quaternion", times, q),
    new THREE.QuaternionKeyframeTrack("spine_03.quaternion", times, q),
    new THREE.QuaternionKeyframeTrack("upperarm_r.quaternion", times, q),
    new THREE.QuaternionKeyframeTrack("thigh_r.quaternion", times, q),
    new THREE.QuaternionKeyframeTrack("foot_l.quaternion", times, q),
    new THREE.VectorKeyframeTrack("pelvis.position", times, times.flatMap(() => [0, .9, 0])),
  ]);
};

test("each range strike plays a real authored three-beat full-body animation", () => {
  assert.equal(TPS_RANGE_CHOREOGRAPHY_VERSION, "THREE_RANGE_ATTACKS_V1");
  assert.equal(tpsRangePoseEnvelope(0), 0);
  assert.equal(tpsRangePoseEnvelope(1), 0);
  assert.ok(tpsRangePoseEnvelope(.18) < 0, "anticipation must pull backward");
  assert.ok(tpsRangePoseEnvelope(.5) > .9, "hit should have a large hero pose");
  const sources = new Map(Object.values(TPS_RANGE_CLIP_SOURCES).map(name => [name, clip(name)]));
  const generated = createTpsRangeMotionLibrary(sources, "SERA");
  assert.equal(generated.size, 3);
  for (const id of TPS_RANGE_ATTACK_IDS) {
    const authored = bakeTpsRangeClip(sources.get(TPS_RANGE_CLIP_SOURCES[id])!, id, "SERA");
    assert.equal(authored.name, tpsRangeClipName(id));
    assert.ok(isCombatAttackClip(authored.name), "must receive proper combat inertial handoff");
    assert.equal(planCombatMotionHandoff("CM_Ready", authored.name, "ATTACK").mode, "ATTACK_ENTRY");
    assert.deepEqual([...authored.tracks[4].values], [...sources.get(TPS_RANGE_CLIP_SOURCES[id])!.tracks[4].values], "support foot is unchanged");
    const spine = authored.tracks[1];
    assert.deepEqual([...spine.values.slice(0, 4)], [0, 0, 0, 1]);
    assert.deepEqual([...spine.values.slice(-4)], [0, 0, 0, 1]);
    assert.notDeepEqual([...spine.values.slice(8, 12)], [0, 0, 0, 1], "contact is physically posed");
    assert.notDeepEqual([...spine.values.slice(4, 8)], [0, 0, 0, 1], "windup is visibly opposed");
    for (const track of authored.tracks) for (const n of track.values) assert.ok(Number.isFinite(n));
    const move = PLAYABLE_FIGHTERS[0].moves[id];
    const sampled = sampleCombatMotionTimeline(move, move.startup, authored.name);
    assert.equal(sampled.stage, "ACTIVE");
    assert.equal(sampled.phase, .5, "contact is timed to the actual attack window");
  }
});


test("rangeComet whiff requires real lateral departure before active contact; a late tap remains buffered until full recovery", () => {
  const move = PLAYABLE_FIGHTERS[0].moves.rangeComet;
  const total = move.startup + move.active + move.recovery;
  const tapTick = total - Math.min(8, Math.max(3, move.recovery - 2));
  assert.ok(move.recovery > TPS_MASH_BUFFER_TICKS,
    "early recovery taps cannot be expected to survive the entire long comet recovery");
  assert.ok(total - tapTick < TPS_MASH_BUFFER_TICKS,
    "late recovery tap must remain valid until the first strike actually ends");
  assert.equal(tpsCanBufferMashTap(move, tapTick), true);
  assert.equal(tpsCanConfirmCombo(false, false), false);

  const opponent = { x: 0, z: -2.1 };
  const attacker = { x: 0, z: 3.1 };
  let sideSteps = 0;
  let travel = 0;
  for (let tick = 0; tick < move.startup; tick += 1) {
    if (tick >= Math.max(1, move.startup - 17) && sideSteps < 16) {
      opponent.x += .11;
      sideSteps++;
    }
    const dx = opponent.x - attacker.x, dz = opponent.z - attacker.z;
    const advance = tpsRangeAdvance({
      moveId: move.id, moveTick: tick, startup: move.startup,
      distance: Math.hypot(dx,dz), longitudinal: -dz, lateral: Math.abs(dx),
      hitStop: 0, connected: false,
    });
    attacker.z -= advance;
    travel += advance;
  }
  const geometry = evaluateTpsStrikeGeometry({
    move, attackerX: attacker.x, attackerZ: attacker.z,
    defenderX: opponent.x, defenderZ: opponent.z, forwardX: 0, forwardZ: -1,
  });
  assert.equal(sideSteps, 16);
  assert.ok(travel > .5, "range attack actually advances before the sidestep");
  assert.ok(geometry.lateral > geometry.halfWidth, "defender has physically left the committed strike lane");
  assert.equal(geometry.connected, false, "a late sidestep makes the real range attack whiff");
  assert.ok(Math.hypot(opponent.x - attacker.x, opponent.z - attacker.z) > TPS_AUTO_RANGE_THRESHOLD,
    "a new, different gap-closing opener is available after full recovery");
});
