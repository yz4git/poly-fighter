import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PLAYABLE_FIGHTERS } from "../src/game/playable-fighters";
import {
  CINEMATIC_TECHNIQUES, addCinematicTechniques, chooseCinematicTechnique,
} from "../src/game/cinematic-techniques";
import {
  canCinematicStrikeAirborne,
  maxTpsComboStage,
  nextTpsAirCombo,
  tickTpsAirCombo,
  tpsAirComboDamage,
  TPS_AIR_COMBO_DURATION_TICKS,
} from "../src/game/tps-air-combo";
import {
  bakeCinematicClip, cinematicClipName, createCinematicMotionLibrary,
  CINEMATIC_CLIP_SOURCES,
} from "../src/game/cinematic-motion-library";
import { authoredMotionEvents, sampleCombatMotionTimeline } from "../src/game/combat-motion-timeline";
import { isCombatAttackClip } from "../src/game/combat-motion-handoff";
import { sourceOfExpandedClip } from "../src/game/expanded-motion-library";
import { tpsImpactHeightForMove } from "../src/game/tps-impact-resolution";

test("four fighters retain 51 regular techniques plus five distinct named specials", () => {
  assert.equal(PLAYABLE_FIGHTERS.length, 4);
  const allSpecials = new Set<string>();
  for (const fighter of PLAYABLE_FIGHTERS) {
    assert.equal(Object.keys(fighter.moves).length, 56, fighter.name);
    for (const id of CINEMATIC_TECHNIQUES) {
      const move = fighter.moves[id];
      assert.ok(move, `${fighter.name}: ${id}`);
      assert.equal(move.cinematicRole, id);
      assert.ok(move.label.length > 4);
      assert.ok(move.active > 0 && move.recovery > 0 && move.hitStop > 0);
      assert.ok(move.width > .5 && move.reach > 1.2);
      allSpecials.add(move.label);
    }
    assert.equal(fighter.moves.skyBreaker.launcher, true);
    assert.equal(fighter.moves.skyBreaker.knockdown, false);
    assert.equal(fighter.moves.cycloneSweep.hitLevel, "LOW");
    assert.equal(fighter.moves.cycloneSweep.knockdown, true);
    assert.equal(fighter.moves.meteorSlam.knockdown, true);
  }
  assert.equal(allSpecials.size, 20);
  assert.equal(addCinematicTechniques({ ...PLAYABLE_FIGHTERS[0].moves }, "KAIRO").powerRush.id, "powerRush");
});

test("manual direction, clean chain and actual height select launch / chase / slam", () => {
  const c = (overrides: Partial<Parameters<typeof chooseCinematicTechnique>[0]> = {}) =>
    chooseCinematicTechnique({
      comboStage: 0, forwardAxis: 0, sideAxis: 0, distance: 1.5,
      opponentAirborne: false, airHits: 0, hasJuggle: false, signaturePriority: false,
      ...overrides,
    });
  assert.equal(c(), null);
  assert.equal(c({ comboStage: 1, forwardAxis: 1 }), "skyBreaker");
  assert.equal(c({ comboStage: 2, forwardAxis: -1 }), "powerRush");
  assert.equal(c({ sideAxis: 1 }), "cycloneSweep");
  assert.equal(c({ sideAxis: -1 }), "cycloneSweep");
  assert.equal(c({ comboStage: 1, forwardAxis: 1, distance: 2.2 }), null);
  assert.equal(c({ comboStage: 2, forwardAxis: 1, signaturePriority: true }), null);
  assert.equal(c({ comboStage: 2, opponentAirborne: true, hasJuggle: true, airHits: 1 }), "airChase");
  assert.equal(c({ comboStage: 3, opponentAirborne: true, hasJuggle: true, airHits: 2 }), "airChase");
  assert.equal(c({ comboStage: 4, opponentAirborne: true, hasJuggle: true, airHits: 3 }), "meteorSlam");
});

test("air chains require connected hits, have decay/limits and reject impossible high strikes", () => {
  const moves = PLAYABLE_FIGHTERS[0].moves;
  assert.equal(maxTpsComboStage(null), 3);
  const launched = nextTpsAirCombo(moves.skyBreaker, null, "p1", "p2")!;
  assert.equal(launched.hits, 1);
  assert.equal(launched.remainingTicks, TPS_AIR_COMBO_DURATION_TICKS);
  assert.equal(maxTpsComboStage(launched), 5);
  assert.equal(canCinematicStrikeAirborne(moves.jab, launched, "p1", "p2", 1.2), false);
  assert.equal(canCinematicStrikeAirborne(moves.airChase, launched, "p1", "p2", 1.2), true);
  assert.equal(canCinematicStrikeAirborne(moves.airChase, launched, "p2", "p1", 1.2), false);
  assert.equal(canCinematicStrikeAirborne(moves.airChase, launched, "p1", "p2", 3.8), false);
  assert.equal(canCinematicStrikeAirborne(moves.meteorSlam, launched, "p1", "p2", 1.2), false);
  assert.equal(canCinematicStrikeAirborne(moves.meteorSlam, launched, "p1", "p2", 0), false);
  assert.equal(canCinematicStrikeAirborne(moves.airChase, null, "p1", "p2", 0), false);
  const second = nextTpsAirCombo(moves.airChase, launched, "p1", "p2")!;
  const third = nextTpsAirCombo(moves.airChase, second, "p1", "p2")!;
  assert.equal(third.hits, 3);
  assert.ok(tpsAirComboDamage(8, moves.airChase, third) < tpsAirComboDamage(8, moves.airChase, launched));
  assert.equal(canCinematicStrikeAirborne(moves.meteorSlam, third, "p1", "p2", 1.8), true);
  assert.equal(canCinematicStrikeAirborne(moves.airChase, third, "p1", "p2", 1.8), false);
  assert.equal(nextTpsAirCombo(moves.meteorSlam, third, "p1", "p2"), null);
  assert.equal(tickTpsAirCombo(third, true, 72), null);
  assert.equal(tickTpsAirCombo(third, false, 0), null);
  assert.equal(tickTpsAirCombo({ ...third, remainingTicks: 1 }, false, 72), null);
  assert.equal(tickTpsAirCombo(third, false, 72)?.remainingTicks, TPS_AIR_COMBO_DURATION_TICKS - 1);
});

function poseClip(name: string): THREE.AnimationClip {
  const times = [0, .20, .45, .70, 1];
  const identity = times.flatMap(() => [0, 0, 0, 1]);
  return new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack("pelvis.quaternion", times, identity),
    new THREE.QuaternionKeyframeTrack("spine_03.quaternion", times, identity),
    new THREE.QuaternionKeyframeTrack("thigh_r.quaternion", times, identity),
    new THREE.QuaternionKeyframeTrack("foot_l.quaternion", times, identity),
    new THREE.VectorKeyframeTrack("pelvis.position", times, times.flatMap(() => [0, .7, 0])),
  ]);
}

test("all five signature choreographies visibly change midposes while retaining contacts and planted foot", () => {
  const originals = new Map(Object.values(CINEMATIC_CLIP_SOURCES).map(name => [name, poseClip(name)]));
  const generated = createCinematicMotionLibrary(originals);
  assert.equal(generated.size, 5);
  for (const role of CINEMATIC_TECHNIQUES) {
    const source = originals.get(CINEMATIC_CLIP_SOURCES[role])!;
    const clip = bakeCinematicClip(source, role);
    assert.equal(clip.name, cinematicClipName(role));
    assert.equal(sourceOfExpandedClip(clip.name), source.name);
    assert.equal(isCombatAttackClip(clip.name), true);
    assert.deepEqual(authoredMotionEvents(clip.name), authoredMotionEvents(source.name));
    assert.deepEqual([...clip.tracks[3].values], [...source.tracks[3].values], "planted sole remains unchanged");
    assert.deepEqual([...clip.tracks[1].values.slice(0, 4)], [...source.tracks[1].values.slice(0, 4)]);
    assert.deepEqual([...clip.tracks[1].values.slice(-4)], [...source.tracks[1].values.slice(-4)]);
    assert.notDeepEqual([...clip.tracks[1].values.slice(8, 12)], [...source.tracks[1].values.slice(8, 12)]);
    for (const track of clip.tracks) {
      if (!track.name.endsWith(".quaternion")) continue;
      for (let i = 0; i < track.values.length; i += 4) {
        const q = new THREE.Quaternion().fromArray(track.values, i);
        assert.ok(Math.abs(q.length() - 1) < 1e-6, "normalized keyframes only");
      }
    }
    const move = PLAYABLE_FIGHTERS[0].moves[role];
    assert.equal(sampleCombatMotionTimeline(move, move.startup, clip.name).phase, authoredMotionEvents(clip.name).contact);
    assert.ok(tpsImpactHeightForMove(move) > .5);
  }
});
