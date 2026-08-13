import * as THREE from "three";
import type { FighterVisual } from "./visual";

function nearNeutralArms(visual: FighterVisual): boolean {
  const bones = visual.rig.bones;
  const rotations = [
    bones.leftUpperArm.rotation,
    bones.rightUpperArm.rotation,
    bones.leftForearm.rotation,
    bones.rightForearm.rotation,
  ];
  return rotations.every((rotation) =>
    Math.abs(rotation.x) < 0.18
    && Math.abs(rotation.y) < 0.18
    && Math.abs(rotation.z) < 0.22,
  );
}

function applyIdleGuard(visual: FighterVisual): void {
  const bones = visual.rig.bones;

  // The turnaround reconstruction is naturally readable from FRONT/SIDE, but
  // the fighting camera sees the character almost entirely in profile.  The
  // legacy neutral pose leaves both arms hanging on the same screen-space
  // line.  Use rotations only (never joint translations) to create a compact
  // martial-arts guard while keeping the imported bind pose valid.
  bones.spineUpper.rotation.y += 0.055;
  bones.chest.rotation.y -= 0.035;

  bones.leftUpperArm.rotation.x = -0.56;
  bones.leftUpperArm.rotation.z = 0.14;
  bones.leftForearm.rotation.x = -1.02;
  bones.leftForearm.rotation.z = -0.08;

  bones.rightUpperArm.rotation.x = -0.82;
  bones.rightUpperArm.rotation.z = -0.12;
  bones.rightForearm.rotation.x = -1.16;
  bones.rightForearm.rotation.z = 0.08;

  bones.leftHand.rotation.x = 0.14;
  bones.rightHand.rotation.x = 0.10;
}

function installReferenceColorMaterial(visual: FighterVisual): void {
  if (visual.root.userData.reconstructionAssetState !== "ready") return;
  if (visual.bodyMesh.userData.v10ColorMaterial === "REFERENCE_VERTEX_COLOR") return;

  const hasVertexColor = Boolean(visual.bodyMesh.geometry.getAttribute("color"));
  if (!hasVertexColor) return;

  const oldMaterial = visual.bodyMesh.material;
  visual.bodyMesh.material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
  });
  if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
  else oldMaterial.dispose();
  visual.bodyMesh.userData.v10ColorMaterial = "REFERENCE_VERTEX_COLOR";
  visual.root.userData.colorPipeline = "V10.2_UNLIT_REFERENCE_VERTEX_COLOR";
}

/**
 * V10.2 presentation polish that is deliberately separated from the GLB
 * reconstruction and from deterministic combat rules.
 *
 * - preserves the quantized colors baked from the supplied turnaround instead
 *   of washing them out under the arena's intentionally strong lighting;
 * - widens the neutral foot homes along MODEL_FORWARD so the side-on camera can
 *   read two legs rather than one superimposed column;
 * - adds a rotation-only idle guard immediately before rendering when the arm
 *   chain is otherwise neutral. Combat/guard/attack IK is left untouched.
 */
export function applyV10RuntimePolish(visual: FighterVisual): FighterVisual {
  visual.footContacts.left.homeLocal.z = -0.090;
  visual.footContacts.right.homeLocal.z = 0.100;
  visual.root.userData.authoredNeutralStance = "V10.2_BIND_SAFE_GUARD";

  const previousBeforeRender = visual.bodyMesh.onBeforeRender;
  visual.bodyMesh.onBeforeRender = function onBeforeRender(...args): void {
    installReferenceColorMaterial(visual);
    if (nearNeutralArms(visual)) {
      applyIdleGuard(visual);
      visual.root.updateMatrixWorld(true);
      visual.rig.skeleton.update();
    }
    previousBeforeRender?.apply(this, args);
  };

  return visual;
}
