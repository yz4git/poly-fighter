import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { tpsComboCameraEnergy, tpsDecorativeHitLane } from "../src/game/tps-screen-readability";
import { TpsCinematicImpactSpectacle } from "../src/game/tps-cinematic-impact-spectacle";
import type { HitEvent, MoveDefinition } from "../src/game/types";

const event = (attacker: "p1" | "p2", extras: Partial<HitEvent> = {}): HitEvent => ({
  attacker,
  defender: attacker === "p1" ? "p2" : "p1",
  blocked: false,
  counter: false,
  throwEscape: false,
  damage: 18,
  move: { id: "power", power: 1.75, cinematicRole: "powerRush" } as MoveDefinition,
  position: { x: 0, y: 1.7, z: 0 },
  ...extras,
});

test("screen-space spokes move outward and are understated when guarded", () => {
  assert.equal(tpsDecorativeHitLane(event("p1")), -.38);
  assert.equal(tpsDecorativeHitLane(event("p2")), .38);
  assert.equal(tpsDecorativeHitLane(event("p1", { blocked: true })), -.09);
  assert.equal(tpsDecorativeHitLane(event("p2", { blocked: true })), .09);
  assert.equal(tpsDecorativeHitLane(event("p1", { move: { power: 1.7 } as MoveDefinition })), -.29);
  assert.equal(tpsDecorativeHitLane(event("p1", { move: { power: 1.1 } as MoveDefinition })), -.19);
});

test("actual world-space VFX ribbon pivots away from the center contact, not the hit target", () => {
  const parent = new THREE.Group();
  const vfx = new TpsCinematicImpactSpectacle(parent);
  const camera = new THREE.PerspectiveCamera(49, 2, .1, 100);
  camera.position.set(0, 3, 7);
  camera.lookAt(0, 1, 0);
  const hit = event("p1");
  vfx.hit(hit, camera, 3, 2);
  const first = vfx.group.children.find(x => x.name === "tps-cinematic-shards-0")!;
  const expectedDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  assert.ok(first.position.dot(expectedDirection) < -.25, "decorative burst must stay off player/defender faces");
  assert.equal(vfx.group.userData.tpsDecorativeImpactLane, -.38);
  vfx.dispose();
});

test("camera escalation occurs only at close range after an earned linked combo", () => {
  assert.deepEqual(tpsComboCameraEnergy(0, 1), { shoulder: 0, back: 0, lift: 0 });
  assert.deepEqual(tpsComboCameraEnergy(3, 0), { shoulder: 0, back: 0, lift: 0 });
  const early = tpsComboCameraEnergy(2, 1);
  const late = tpsComboCameraEnergy(4, 1);
  assert.ok(late.shoulder > early.shoulder && late.shoulder <= .23);
  assert.ok(late.back < early.back && late.back >= -.17);
  assert.ok(late.lift > early.lift && late.lift <= .055);
  for (const x of Object.values(tpsComboCameraEnergy(99, 99))) assert.ok(Number.isFinite(x));
});
