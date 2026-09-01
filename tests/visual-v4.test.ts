import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CombatSystem } from "../src/game/combat";
import { FIGHTER_DEFINITIONS } from "../src/game/definitions";
import { FighterAnimationController, FighterRuntime } from "../src/game/fighter";
import { fighterRootQuaternion, jointAngle, solveTwoBoneIK } from "../src/game/rig";
import { getVisualContactPoint, createFighterVisual, disposeFighterVisual } from "../src/game/visual";

function makePair(fighterX: number, opponentX: number): { fighter: FighterRuntime; opponent: FighterRuntime } {
  const fighter = new FighterRuntime("fighter", FIGHTER_DEFINITIONS.red);
  const opponent = new FighterRuntime("opponent", FIGHTER_DEFINITIONS.blue, true);
  const facing = opponentX >= fighterX ? 1 : -1;
  fighter.resetForRound(fighterX, 0, facing);
  opponent.resetForRound(opponentX, 0, -facing);
  return { fighter, opponent };
}

test("V4 punch and kick contact the same side as the deterministic hitbox", () => {
  const animation = new FighterAnimationController();
  const combat = new CombatSystem();
  for (const [fighterX, opponentX] of [[-2, 2], [2, -2]]) {
    for (const moveId of ["jab", "kick"] as const) {
      const { fighter, opponent } = makePair(fighterX, opponentX);
      fighter.beginMove(moveId);
      fighter.moveTick = moveId === "jab" ? 6 : 11;
      animation.update(fighter, opponent, 0);
      const contactPoint = fighter.currentMove?.visualContact;
      assert.ok(contactPoint && contactPoint !== "BODY", `${moveId} must declare an authored contact point`);
      const contact = getVisualContactPoint(fighter.visual, contactPoint);
      const hitbox = combat.hitboxes.getHitbox(fighter, fighter.currentMove!);
      const toOpponent = Math.sign(opponent.position.x - fighter.position.x);
      assert.ok((contact.x - fighter.position.x) * toOpponent > 0.25, `${moveId} must extend toward the opponent`);
      assert.ok(contact.distanceTo(new THREE.Vector3(hitbox.centerX, hitbox.centerY, hitbox.centerZ)) < 0.08, `${moveId} visual contact must track the hitbox`);
      fighter.visual.root.quaternion.copy(fighterRootQuaternion(fighter.facing));
    }
  }
});

test("two-bone IK keeps elbow and knee on a stable pole side", () => {
  const visual = createFighterVisual(FIGHTER_DEFINITIONS.red, "LOW");
  visual.root.updateMatrixWorld(true);
  for (const [rootName, midName, endName, pole] of [
    ["rightUpperArm", "rightForearm", "rightHand", new THREE.Vector3(0.24, -0.18, 0.14)],
    ["rightThigh", "rightShin", "rightFoot", new THREE.Vector3(0.22, 0.04, 0.18)],
  ] as const) {
    const root = visual.rig.bones[rootName];
    const mid = visual.rig.bones[midName];
    const end = visual.rig.bones[endName];
    const origin = root.getWorldPosition(new THREE.Vector3());
    const target = origin.clone().add(new THREE.Vector3(0.26, -0.52, 0.12));
    const result = solveTwoBoneIK({ root, mid, end, target, pole });
    assert.ok(result.reachable);
    assert.ok(result.endPosition.distanceTo(result.target) < 0.0001);
    const a = root.getWorldPosition(new THREE.Vector3());
    const b = mid.getWorldPosition(new THREE.Vector3());
    const c = end.getWorldPosition(new THREE.Vector3());
    const angle = jointAngle(a, b, c);
    assert.ok(angle > 0.03 && angle < Math.PI * 0.99);
  }
  disposeFighterVisual(visual);
});

test("facing roots map model +Z to both fight directions", () => {
  const plus = new THREE.Vector3(0, 0, 1).applyQuaternion(fighterRootQuaternion(1));
  const minus = new THREE.Vector3(0, 0, 1).applyQuaternion(fighterRootQuaternion(-1));
  assert.ok(plus.distanceTo(new THREE.Vector3(1, 0, 0)) < 0.0001);
  assert.ok(minus.distanceTo(new THREE.Vector3(-1, 0, 0)) < 0.0001);
});

test("V4 clothing meshes are attached to the rig instead of the world root", () => {
  for (const definition of Object.values(FIGHTER_DEFINITIONS)) {
    const visual = createFighterVisual(definition, "NORMAL");
    assert.ok(visual.clothingAttachments.length >= 4);
    assert.ok(visual.clothingAttachments.every((attachment) => attachment.mesh.parent?.type === "Bone"));
    disposeFighterVisual(visual);
  }
});
