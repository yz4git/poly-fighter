import * as THREE from "three";
import { orientBoneForward, solveTwoBoneIK } from "./rig";
import type { FighterVisual, FootSide } from "./visual";

function rootPoint(visual: FighterVisual, point: THREE.Vector3): THREE.Vector3 {
  visual.root.updateMatrixWorld(true);
  return visual.root.localToWorld(point.clone());
}

function solveSoleTo(
  visual: FighterVisual,
  side: FootSide,
  targetLocal: THREE.Vector3,
): void {
  const prefix = side === "left" ? "left" : "right";
  const sideSign = side === "left" ? -1 : 1;
  const scale = visual.root.scale.x;
  const origin = rootPoint(visual, new THREE.Vector3());
  const up = rootPoint(visual, new THREE.Vector3(0, 1, 0)).sub(origin).normalize();
  const forward = rootPoint(visual, new THREE.Vector3(0, 0, 1)).sub(origin).normalize();
  const soleLocal = visual.footContacts[side].soleLocal;

  // The target is the visible boot sole, expressed from the fighter root and
  // then pinned to the simulation floor. This mirrors FighterAnimationController
  // foot planting instead of rotating the leg blindly in bone-local space.
  const soleTarget = rootPoint(visual, targetLocal);
  soleTarget.y = 0;
  const ikTarget = soleTarget.clone()
    .addScaledVector(up, -soleLocal.y * scale)
    .addScaledVector(forward, -soleLocal.z * scale);
  const pole = rootPoint(visual, new THREE.Vector3(sideSign * 0.18, 0.35, 0.08));

  solveTwoBoneIK({
    root: visual.rig.bones[`${prefix}Thigh`],
    mid: visual.rig.bones[`${prefix}Shin`],
    end: visual.rig.bones[`${prefix}Foot`],
    target: ikTarget,
    pole,
  });
  orientBoneForward(visual.rig.bones[`${prefix}Foot`], forward);
}

function applyGroundedSignatureFeet(visual: FighterVisual): void {
  const pose = String(visual.root.userData.v10ReferencePose ?? "");
  if (pose !== "IDLE" && pose !== "GUARD" && pose !== "PUNCH") return;

  const y = visual.layout.ankleY - 0.058;
  const depth = visual.layout.pelvisWidth * 0.34;
  const zScale = pose === "PUNCH" ? 0.86 : pose === "GUARD" ? 0.94 : 1;
  solveSoleTo(visual, "left", new THREE.Vector3(-depth, y, -0.105 * zScale));
  solveSoleTo(visual, "right", new THREE.Vector3(depth, y, 0.145 * zScale));
  visual.root.userData.v10ReferenceFeetPose = `${pose}_GROUNDED_SIGNATURE_A`;
  visual.root.updateMatrixWorld(true);
}

/**
 * Reference stance foot pass. It runs after the upper-body reference anchor,
 * leaves kick/support-leg animation untouched, and solves both visible soles
 * onto y=0 so the wide stance cannot create the floating-leg regression.
 */
export function applyV104GroundedReferenceFeet(visual: FighterVisual): FighterVisual {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0], 3));
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const anchor = new THREE.Mesh(geometry, material);
  anchor.name = "v10-4-grounded-reference-feet-anchor";
  anchor.frustumCulled = false;
  anchor.renderOrder = -9999;
  anchor.onBeforeRender = () => applyGroundedSignatureFeet(visual);
  visual.root.add(anchor);
  visual.root.userData.v10ReferenceFeet = "SIGNATURE_A_GROUNDED_IK";
  return visual;
}
