import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  TpsCinematicImpactSpectacle,
  cinematicImpactStyle,
} from "../src/game/tps-cinematic-impact-spectacle";
import type { HitEvent, MoveDefinition } from "../src/game/types";

function makeEvent(overrides: Partial<HitEvent> = {}): HitEvent {
  return {
    attacker: "p1",
    defender: "p2",
    move: { id: "powerRush", cinematicRole: "powerRush" } as MoveDefinition,
    blocked: false,
    counter: false,
    throwEscape: false,
    damage: 24,
    position: { x: 0, y: 1.35, z: 0 },
    ...overrides,
  };
}

test("block flashes stay subdued and do not trigger arena shockwaves", () => {
  const style = cinematicImpactStyle(3, true, true, true, 6, false);
  assert.equal(style.shards, 1);
  assert.equal(style.groundWaves, 0);
  assert.ok(style.opacity < 0.20);
});

test("heavy, counter, signature and combo streaks build a visible crescendo", () => {
  const light = cinematicImpactStyle(1, false, false, false, 1, false);
  const heavy = cinematicImpactStyle(3, false, false, false, 1, false);
  const combo = cinematicImpactStyle(2, false, false, false, 4, false);
  const signature = cinematicImpactStyle(3, false, false, true, 4, false);
  const counter = cinematicImpactStyle(3, false, true, false, 1, false);
  assert.equal(light.groundWaves, 0);
  assert.ok(heavy.opacity > light.opacity);
  assert.ok(heavy.scale > light.scale);
  assert.equal(combo.shards, 2);
  assert.equal(combo.groundWaves, 1);
  assert.equal(signature.groundWaves, 2);
  assert.ok(counter.opacity > heavy.opacity);
  assert.ok(signature.opacity <= 0.47);
});

test("finishing burst keeps character silhouettes visible", () => {
  const normal = cinematicImpactStyle(3, false, true, true, 5, false);
  const finishing = cinematicImpactStyle(3, false, true, true, 5, true);
  assert.equal(finishing.shards, 1);
  assert.equal(finishing.groundWaves, 1);
  assert.ok(finishing.opacity < normal.opacity);
});

test("pooled spectacle fades, resets and disposes without GPU allocations per hit", () => {
  const parent = new THREE.Group();
  const spectacle = new TpsCinematicImpactSpectacle(parent);
  const camera = new THREE.PerspectiveCamera(49, 16 / 9, 0.1, 100);
  camera.position.set(0, 2.2, 6);
  camera.lookAt(0, 1.3, 0);
  const pooledChildren = [...spectacle.group.children];
  assert.equal(pooledChildren.length, 6);

  spectacle.hit(makeEvent(), camera, 3, 4);
  assert.equal(spectacle.group.userData.tpsCinematicShardLayers, 2);
  assert.equal(spectacle.group.userData.tpsCinematicGroundWaves, 2);
  assert.equal(spectacle.group.userData.tpsCinematicHitStreak, 4);
  assert.equal(pooledChildren.filter((object) => object.visible).length, 4);

  spectacle.hit(makeEvent({ blocked: true }), camera, 1, 0);
  assert.equal(spectacle.group.userData.tpsCinematicShardLayers, 1);
  assert.equal(spectacle.group.userData.tpsCinematicGroundWaves, 0);
  assert.equal(pooledChildren.filter((object) => object.visible).length, 1);
  assert.deepEqual(spectacle.group.children, pooledChildren);

  spectacle.update(1);
  assert.equal(pooledChildren.filter((object) => object.visible).length, 0);
  spectacle.hit(makeEvent(), camera, 3, 3);
  spectacle.reset();
  assert.equal(spectacle.group.userData.tpsCinematicHitStreak, 0);
  assert.equal(pooledChildren.filter((object) => object.visible).length, 0);
  spectacle.dispose();
  assert.equal(parent.children.length, 0);
});

import { tpsCinematicCameraShot } from "../src/game/tps-hype";

test("directional juggle and counter hero shots are bounded and do not trigger on guard", () => {
  assert.equal(tpsCinematicCameraShot("skyBreaker", false, true), null);
  assert.equal(tpsCinematicCameraShot(undefined, false, false), null);
  for (const role of ["skyBreaker", "airCarry", "airPivot", "meteorSlam", "powerRush"] as const) {
    const shot = tpsCinematicCameraShot(role, false, false);
    assert.ok(shot);
    assert.ok(shot.seconds >= .2 && shot.seconds <= .4);
    assert.ok(Math.abs(shot.lateral) <= .2);
    assert.ok(Math.abs(shot.lift) <= .1);
    assert.ok(shot.aim < .3);
  }
  assert.equal(tpsCinematicCameraShot(undefined, true, false)?.name, "COUNTER");
});
