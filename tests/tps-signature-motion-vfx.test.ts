import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FighterRuntime } from "../src/game/fighter";
import { PLAYABLE_FIGHTERS } from "../src/game/playable-fighters";
import {
  isSignatureMotionTrailWindow,
  signatureMotionTrailWidth,
  TpsSignatureMotionVfx,
} from "../src/game/tps-signature-motion-vfx";
import type { HitEvent } from "../src/game/types";

function fighters(): [FighterRuntime, FighterRuntime] {
  const p1 = new FighterRuntime("p1", PLAYABLE_FIGHTERS[0]);
  const p2 = new FighterRuntime("p2", PLAYABLE_FIGHTERS[1], true);
  p1.resetForRound(-1.2, 0, 1);
  p2.resetForRound(1.2, 0, -1);
  return [p1, p2];
}

function meteorEvent(): HitEvent {
  return {
    attacker: "p1",
    defender: "p2",
    move: PLAYABLE_FIGHTERS[0].moves.meteorSlam,
    blocked: false,
    counter: false,
    throwEscape: false,
    damage: 18,
    position: { x: 0, y: 1.6, z: 0 },
  };
}

test("signature ribbons are activated only during genuine authored attack frames", () => {
  const move = PLAYABLE_FIGHTERS[0].moves.skyBreaker;
  assert.equal(signatureMotionTrailWidth(undefined), 0);
  assert.equal(signatureMotionTrailWidth("meteorSlam") > signatureMotionTrailWidth("airChase"), true);
  assert.equal(isSignatureMotionTrailWindow(null, 12), false);
  assert.equal(isSignatureMotionTrailWindow(move, 0), false);
  assert.equal(isSignatureMotionTrailWindow(move, move.startup), true);
  assert.equal(isSignatureMotionTrailWindow(move, move.startup + move.active + 3), true);
  assert.equal(isSignatureMotionTrailWindow(move, move.startup + move.active + 4), false);
  assert.equal(isSignatureMotionTrailWindow(PLAYABLE_FIGHTERS[0].moves.jab, 12), false);
});

test("pooled striking ribbons track a moving contact limb, fade, and reset without new meshes", () => {
  const group = new THREE.Group();
  const vfx = new TpsSignatureMotionVfx(group);
  const camera = new THREE.PerspectiveCamera(49, 16 / 9, .1, 100);
  camera.position.set(-1.2, 2.3, 6);
  const [p1, p2] = fighters();
  assert.equal(vfx.group.children.length, 7);
  const pooled = [...vfx.group.children];
  assert.equal(p1.beginMove("skyBreaker"), true);

  for (let i = 0; i < 7; i += 1) {
    p1.moveTick = p1.currentMove!.startup - 4 + i;
    p1.visual.root.position.set(-1.2 + i * .11, .01 + i * .045, i * .035);
    vfx.update(p1, p2, camera, 1 / 60);
  }

  assert.ok(Number(vfx.group.userData.tpsTrailSamples0) >= 2);
  assert.equal(vfx.group.userData.tpsTrailVisible0, true);
  assert.equal(vfx.group.userData.tpsTrailVisible1, false);
  for (const mesh of pooled.slice(0, 4) as THREE.Mesh[]) {
    if (!mesh.visible) continue;
    const vertices = mesh.geometry.attributes.position.array as Float32Array;
    assert.ok(Array.from(vertices).every(Number.isFinite));
    assert.ok(mesh.geometry.drawRange.count > 0);
  }

  // After an authored attack ends, the remaining tail dissolves; it does not
  // create an unbounded stamp or chase the next opponent invisibly.
  p1.state = "IDLE";
  p1.currentMove = null;
  vfx.update(p1, p2, camera, .3);
  assert.equal(vfx.group.userData.tpsTrailVisible0, false);
  assert.deepEqual(vfx.group.children, pooled);
  vfx.reset();
  assert.equal(vfx.group.userData.tpsTrailSamples0, 0);
  vfx.dispose();
  assert.equal(group.children.length, 0);
});

test("meteor fracture occurs once on actual landing, never on airborne hit or guard", () => {
  const group = new THREE.Group();
  const vfx = new TpsSignatureMotionVfx(group);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-1, 2, 5);
  const [p1, p2] = fighters();
  const event = meteorEvent();

  p2.position.y = 1.6;
  p2.grounded = false;
  vfx.hit(event);
  assert.equal(vfx.group.userData.tpsMeteorPending, true);
  assert.equal(vfx.update(p1, p2, camera, 1 / 60), false);
  assert.equal(vfx.group.userData.tpsMeteorLandingCount ?? 0, 0);

  p2.position.y = 0;
  p2.grounded = true;
  assert.equal(vfx.update(p1, p2, camera, 1 / 60), true);
  assert.equal(vfx.update(p1, p2, camera, 1 / 60), false);
  assert.equal(vfx.group.userData.tpsMeteorLandingCount, 1);
  assert.equal(vfx.group.children.filter(child => child.name.includes("meteor") && child.visible).length, 3);

  vfx.update(p1, p2, camera, .6);
  assert.equal(vfx.group.children.filter(child => child.name.includes("meteor") && child.visible).length, 0);
  vfx.reset();
  vfx.hit({ ...event, blocked: true });
  assert.equal(vfx.group.userData.tpsMeteorPending, false);
  vfx.dispose();
  assert.equal(group.children.length, 0);
});

test("an unlanded meteor expires without a false floor fracture", () => {
  const group = new THREE.Group();
  const vfx = new TpsSignatureMotionVfx(group);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 5);
  const [p1, p2] = fighters();
  p2.position.y = 2.4;
  p2.grounded = false;
  vfx.hit(meteorEvent());
  assert.equal(vfx.update(p1, p2, camera, 1.55), false);
  assert.equal(vfx.group.userData.tpsMeteorPending, false);
  assert.equal(vfx.group.userData.tpsMeteorLandingCount ?? 0, 0);
  vfx.dispose();
});
