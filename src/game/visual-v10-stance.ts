import type { FighterVisual } from "./visual";

/**
 * Conservative depth separation for the reconstructed SERA mesh.
 *
 * V9.1 moved forearms/hands a long way in bind space to force a readable
 * silhouette. That was acceptable for the authored V9 topology but it exposes
 * every imperfect V10 skin weight as a giant stretched polygon. V10.1 keeps
 * the proven rig/contact dimensions while only adding small depth offsets.
 * Combat IK remains responsible for actual guard/punch/kick poses.
 */
export function applyV10SafeStance(visual: FighterVisual): FighterVisual {
  const bones = visual.rig.bones;
  const layout = visual.layout;

  bones.leftShoulder.position.z = -0.016;
  bones.rightShoulder.position.z = 0.020;
  bones.spineLower.position.z = -0.003;
  bones.spineUpper.position.z = 0.004;
  bones.chest.position.z = 0.007;
  bones.neck.position.z = 0.004;
  bones.head.position.z = 0.004;

  // Preserve the original segment lengths. Only a modest depth stagger is
  // introduced; no large Y/Z translations are baked into the forearm chain.
  bones.leftForearm.position.set(-0.020, layout.elbowY - layout.shoulderY, 0.026);
  bones.rightForearm.position.set(0.020, layout.elbowY - layout.shoulderY, 0.034);
  bones.leftHand.position.set(-0.008, layout.wristY - layout.elbowY, 0.028);
  bones.rightHand.position.set(0.008, layout.wristY - layout.elbowY, 0.032);

  bones.leftThigh.position.z = -0.055;
  bones.rightThigh.position.z = 0.060;
  bones.leftShin.position.set(0, layout.kneeY - layout.hipsY, 0);
  bones.rightShin.position.set(0, layout.kneeY - layout.hipsY, 0);
  bones.leftFoot.position.set(0, layout.ankleY - layout.kneeY, 0);
  bones.rightFoot.position.set(0, layout.ankleY - layout.kneeY, 0);

  visual.footContacts.left.homeLocal.z = -0.055;
  visual.footContacts.right.homeLocal.z = 0.060;
  visual.root.userData.authoredNeutralStance = "V10.1_SAFE";
  visual.root.updateMatrixWorld(true);
  return visual;
}
