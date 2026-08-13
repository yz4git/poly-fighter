import type { FighterVisual } from "./visual";

/**
 * Deforms SERA from the old straight mannequin bind into a readable fighting
 * stance. These are persistent bone translations, not per-frame camera hacks:
 * the same skinned character keeps them from every viewing angle, while V4 IK
 * can still rotate the same joints for attacks and guards.
 */
export function applyV9AuthoredStance(visual: FighterVisual): FighterVisual {
  const bones = visual.rig.bones;

  // Put the two shoulders on different depth planes. The fight camera no
  // longer collapses both arms into the torso in a side-on view.
  bones.leftShoulder.position.z = -0.018;
  bones.rightShoulder.position.z = 0.026;

  // Bend the arms toward canonical +Z. Existing attack/guard IK can still
  // solve these joints because no camera-specific transform is introduced.
  bones.leftForearm.position.set(-0.020, -0.135, 0.092);
  bones.rightForearm.position.set(0.020, -0.112, 0.126);
  bones.leftHand.position.set(-0.008, -0.082, 0.112);
  bones.rightHand.position.set(0.008, -0.060, 0.128);

  // Stagger at the hip only. Earlier V9 iterations also displaced shin/foot
  // joints in depth; that lengthened the two-bone chains enough for one planted
  // sole to become unreachable. Keeping the lower-leg chains vertical retains
  // a >20 cm screen-axis stagger while preserving the proven foot-plant solve.
  bones.leftThigh.position.z = -0.045;
  bones.rightThigh.position.z = 0.050;
  bones.leftShin.position.set(0, -0.282, 0);
  bones.rightShin.position.set(0, -0.282, 0);
  bones.leftFoot.position.set(0, -0.258, 0);
  bones.rightFoot.position.set(0, -0.258, 0);

  visual.root.userData.authoredNeutralStance = "V9";
  visual.root.updateMatrixWorld(true);
  return visual;
}
