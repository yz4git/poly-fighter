import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import { PresentationAnimationController } from "../src/game/presentation-animation";
import { prepareTpsFighterVisual, finalizeTpsFighterVisual } from "../src/game/tps-visual-state";
import { createFighterVisual, disposeFighterVisual } from "../src/game/visual";

// Check the direction before finalization: the old pipeline looked correct only
// after its world-space corrections had already run in the side-camera frame.
test("TPS samples and presents every kick in the final opponent-facing frame", () => {
  const fighter = new FighterRuntime("player", FIGHTER_DEFINITIONS.red, false, createFighterVisual(FIGHTER_DEFINITIONS.red, "NORMAL"));
  const opponent = new FighterRuntime("cpu", FIGHTER_DEFINITIONS.blue, true, createFighterVisual(FIGHTER_DEFINITIONS.blue, "NORMAL"));
  fighter.visual.root.userData.quaterniusModelState = "ready";
  try {
    for (const animation of [new FighterAnimationController(), new PresentationAnimationController()]) {
      for (let sector = 0; sector < 8; sector++) {
        const direction = new THREE.Vector3(Math.sin(sector * Math.PI / 4), 0, Math.cos(sector * Math.PI / 4));
        for (const moveId of ["kick", "lowKick", "risingKick", "dashKick"] as const) {
          fighter.resetForRound(0, 0, 1);
          opponent.resetForRound(direction.x * 2, direction.z * 2, -1);
          assert.ok(fighter.beginMove(moveId));
          fighter.moveTick = fighter.currentMove!.startup;
          const forward = prepareTpsFighterVisual({ fighter, opponent, fighterDnaId: "KAIRO", stepDirection: direction });
          const position = fighter.position.clone();
          animation.update(fighter, opponent, 1);
          const renderedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(fighter.visual.root.quaternion);
          assert.ok(renderedForward.distanceTo(direction) < 1e-6, `${moveId}/${sector}: presentation used the wrong yaw`);
          const rotation = fighter.visual.root.quaternion.clone();
          finalizeTpsFighterVisual(fighter, forward);
          assert.ok(rotation.angleTo(fighter.visual.root.quaternion) < 1e-6, `${moveId}/${sector}: yaw changed after presentation`);
          assert.ok(fighter.position.equals(position), "presentation changed simulation position");
        }
      }
    }
  } finally {
    disposeFighterVisual(fighter.visual);
    disposeFighterVisual(opponent.visual);
  }
});
