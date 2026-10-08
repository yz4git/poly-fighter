import * as THREE from "three";
import type { FighterRuntime } from "./fighter";
import type { FighterDnaId } from "./fighter-dna";

const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);

function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(1, 0, 0);
}

export function prepareTpsFighterVisual(input: {
  fighter: FighterRuntime;
  opponent: FighterRuntime;
  fighterDnaId: FighterDnaId;
  stepDirection: THREE.Vector3;
}): THREE.Vector3 {
  const { fighter, opponent, fighterDnaId, stepDirection } = input;
  fighter.facing = opponent.position.x >= fighter.position.x ? 1 : -1;
  const data = fighter.visual.root.userData;
  const committed = fighter.state === "ATTACK"
    ? data.tpsCommittedAttackForward
    : null;
  const forward = Array.isArray(committed) && committed.length >= 3
    && committed.every((value: unknown) => typeof value === "number" && Number.isFinite(value))
    ? new THREE.Vector3(committed[0], 0, committed[2]).normalize()
    : horizontalDirection(fighter.position, opponent.position);

  data.combatTps = true;
  data.tpsFighterDna = fighterDnaId;
  data.combatMotionForward = forward.toArray();

  if (fighter.state === "SIDESTEP") {
    const side = stepDirection.x * forward.z - stepDirection.z * forward.x;
    const along = stepDirection.dot(forward);
    data.combatStepDirection = Math.abs(side) > Math.abs(along)
      ? side < 0 ? "L" : "R"
      : along < 0 ? "B" : "F";
  }

  return forward;
}

export function finalizeTpsFighterVisual(
  fighter: FighterRuntime,
  forward: THREE.Vector3,
): void {
  // The shared 1v1 attack aura reads as a translucent slab in shoulder-view TPS.
  fighter.visual.aura.visible = false;
  fighter.visual.root.quaternion.setFromUnitVectors(MODEL_FORWARD, forward);
  fighter.visual.root.updateMatrixWorld(true);
}
