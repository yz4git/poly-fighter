import * as THREE from "three";
import type { FighterVisual } from "./visual";

function applyLegSpread(visual: FighterVisual, strength: number): void {
  const b = visual.rig.bones;
  b.leftThigh.rotation.x += strength;
  b.rightThigh.rotation.x -= strength;
  b.leftShin.rotation.x -= strength * 0.40;
  b.rightShin.rotation.x += strength * 0.40;
  b.leftFoot.rotation.x -= strength * 0.16;
  b.rightFoot.rotation.x += strength * 0.16;
  visual.root.updateMatrixWorld(true);
}

/** Add the fore/aft leg spread visible in SERA's supplied Signature Stance A. */
export function applyV104ReferenceLegStance(visual: FighterVisual): FighterVisual {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0], 3));
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const anchor = new THREE.Mesh(geometry, material);
  anchor.name = "v10-4-reference-leg-stance-anchor";
  anchor.frustumCulled = false;
  anchor.renderOrder = -9999;
  anchor.onBeforeRender = () => {
    const pose = visual.root.userData.v10ReferencePose;
    if (pose === "IDLE") applyLegSpread(visual, 0.115);
    else if (pose === "GUARD") applyLegSpread(visual, 0.100);
    else if (pose === "PUNCH") applyLegSpread(visual, 0.080);
  };
  visual.root.add(anchor);
  visual.root.userData.v10ReferenceLegStance = "SIGNATURE_A_FORE_AFT_SPREAD";
  return visual;
}
