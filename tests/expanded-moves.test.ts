import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PLAYABLE_FIGHTERS } from "../src/game/playable-fighters";
import {
  EXPANDED_MOVE_BASES,
  MOVE_VARIANTS,
  expandMoveSet,
  expandedMoveId,
  expandedContextMove,
} from "../src/game/move-expansion";
import {
  EXPANDED_MOTION_VERSION,
  expandedClipName,
  sourceOfExpandedClip,
  bakeExpandedMotionClip,
  buildExpandedMotionLibrary,
  selectExpandedClip,
} from "../src/game/expanded-motion-library";
import { authoredMotionEvents, sampleCombatMotionTimeline } from "../src/game/combat-motion-timeline";
import { isCombatAttackClip, planCombatMotionHandoff } from "../src/game/combat-motion-handoff";

test("all four characters have 51 unique available techniques and retain the original eleven", () => {
  const allIds = new Set<string>();
  assert.equal(PLAYABLE_FIGHTERS.length, 4);
  assert.equal(EXPANDED_MOVE_BASES.length, 10);
  for (const fighter of PLAYABLE_FIGHTERS) {
    const ids = Object.keys(fighter.moves);
    assert.equal(ids.length, 51, `${fighter.name} must have 11 original + 40 expanded moves`);
    for (const base of [...EXPANDED_MOVE_BASES, "throw"]) assert.ok(fighter.moves[base], base);
    for (const base of EXPANDED_MOVE_BASES) {
      for (const variant of MOVE_VARIANTS) {
        const id = expandedMoveId(base, variant), move = fighter.moves[id];
        assert.ok(move, `${fighter.name} missing ${id}`);
        assert.equal(move.id, id);
        assert.equal(move.motionBase, base);
        assert.equal(move.motionVariant, variant);
        assert.equal(move.visualContact, fighter.moves[base].visualContact);
        assert.equal(move.hitLevel, fighter.moves[base].hitLevel);
        assert.equal(move.animation, fighter.moves[base].animation);
        assert.ok(move.label !== fighter.moves[base].label);
        assert.ok(move.startup >= 3 && move.recovery >= 7);
        assert.ok(move.damage > 0 && move.damage <= 30);
        assert.ok(move.reach > .8 && move.reach <= 2.13);
        allIds.add(`${fighter.id}/${id}`);
      }
    }
    assert.ok(fighter.moves.jabSnap.startup < fighter.moves.jab.startup);
    assert.ok(fighter.moves.jabCrush.damage > fighter.moves.jab.damage);
    assert.ok(fighter.moves.straightDrive.reach > fighter.moves.straight.reach);
    assert.ok(fighter.moves.kickPivot.width > fighter.moves.kick.width);
    assert.equal(fighter.moves.lowKickCrush.hitLevel, "LOW");
    assert.equal(fighter.moves.risingKickSnap.launcher, true);
    assert.equal(fighter.moves.dashKickDrive.knockdown, true);
  }
  assert.equal(allIds.size, 160);
});

test("TPS attack cycling and directional overrides expose every extra style without changing signatures", () => {
  const moves = PLAYABLE_FIGHTERS[0].moves;
  const choose = (moveCount: number, forwardAxis = 0, sideAxis = 0, preserveSignature = false) =>
    expandedContextMove({ baseId: "kick", moveCount, forwardAxis, sideAxis, preserveSignature, available: moves });
  assert.equal(choose(0), "kick");
  assert.equal(choose(1), "kickSnap");
  assert.equal(choose(2), "kickDrive");
  assert.equal(choose(3), "kickPivot");
  assert.equal(choose(4), "kickCrush");
  assert.equal(choose(5), "kick");
  assert.equal(choose(0, 1), "kickDrive");
  assert.equal(choose(0, -1), "kickCrush");
  assert.equal(choose(0, 0, -1), "kickPivot");
  assert.equal(choose(1, 1, 1, true), "kick");
  assert.equal(expandedContextMove({ baseId: "throw", moveCount: 1, available: moves }), "throw");
  assert.equal(expandedContextMove({ baseId: "kick", moveCount: 1, available: { kick: moves.kick } }), "kick");
  assert.equal(Object.keys(expandMoveSet({ jab: moves.jab })).length, 5);
});

function fakeClip(): THREE.AnimationClip {
  const times = [0, .25, .5, .75, 1];
  const quat = times.flatMap(() => [0, 0, 0, 1]);
  const foot = times.flatMap(() => [0, 0, 0, 1]);
  return new THREE.AnimationClip("BF_FrontKick_R", 1, [
    new THREE.QuaternionKeyframeTrack("spine_03.quaternion", times, quat),
    new THREE.QuaternionKeyframeTrack("thigh_r.quaternion", times, quat),
    new THREE.QuaternionKeyframeTrack("foot_l.quaternion", times, foot),
    new THREE.VectorKeyframeTrack("pelvis.position", times, times.flatMap(() => [0, .7, 0])),
  ]);
}

test("variant clips have real pose differences but keep identical neutral endpoints and support foot", () => {
  const source = fakeClip();
  assert.equal(EXPANDED_MOTION_VERSION, "COMBAT_VARIANT_CLIPS_V1");
  for (const style of MOVE_VARIANTS) {
    const variant = bakeExpandedMotionClip(source, style);
    assert.equal(variant.name, expandedClipName(source.name, style));
    assert.equal(variant.duration, source.duration);
    assert.equal(sourceOfExpandedClip(variant.name), source.name);
    const baseUpper = source.tracks[0], newUpper = variant.tracks[0];
    assert.deepEqual([...newUpper.values.slice(0, 4)], [...baseUpper.values.slice(0, 4)]);
    assert.deepEqual([...newUpper.values.slice(-4)], [...baseUpper.values.slice(-4)]);
    assert.notDeepEqual([...newUpper.values.slice(8, 12)], [...baseUpper.values.slice(8, 12)], "midpose must differ");
    const baseSupport = source.tracks[2], support = variant.tracks[2];
    assert.deepEqual([...support.values], [...baseSupport.values], "support sole remains authored");
    for (let i = 0; i < newUpper.values.length; i += 4) {
      const q = new THREE.Quaternion().fromArray(newUpper.values, i);
      assert.ok(Math.abs(q.length() - 1) < 1e-6, "rotations stay unit quaternions");
    }
  }
  const library = buildExpandedMotionLibrary(new Map([[source.name, source]]));
  assert.equal(library.size, 4);
  assert.ok(library.has("VM_BF_FrontKick_R_CRUSH"));
  assert.equal(selectExpandedClip(source.name, "CRUSH", name => library.has(name)), "VM_BF_FrontKick_R_CRUSH");
  assert.equal(selectExpandedClip(source.name, "CRUSH", () => false), source.name);
});

test("each generated clip inherits exact combat contact phases, remains attack-tagged and preserves hit timing", () => {
  const moves = PLAYABLE_FIGHTERS[0].moves;
  for (const variant of MOVE_VARIANTS) {
    const clip = expandedClipName("BF_FrontKick_R", variant);
    assert.deepEqual(authoredMotionEvents(clip), authoredMotionEvents("BF_FrontKick_R"));
    assert.equal(isCombatAttackClip(clip), true);
    assert.equal(planCombatMotionHandoff("BF_Jab_L", clip, "ATTACK").mode, "ATTACK_COMBO");
    const move = moves[expandedMoveId("kick", variant)];
    const sample = sampleCombatMotionTimeline(move, move.startup, clip);
    assert.equal(sample.stage, "ACTIVE");
    assert.equal(sample.phase, authoredMotionEvents("BF_FrontKick_R").contact);
  }
  assert.equal(isCombatAttackClip("VM_CM_Counter_L_PIVOT"), true, "counter clips are attack handoffs");
});
