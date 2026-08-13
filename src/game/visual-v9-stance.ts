import type { FighterVisual } from "./visual";

/**
 * Deforms SERA from the old straight mannequin bind into a readable fighting
 * stance.  These are persistent bone translations, not per-frame camera hacks:
 * the same skinned character keeps them from every viewing angle, while V4 IK
 * can still rotate the same joints for attacks and guards.
 */
export function applyV9AuthoredStance(visual: FighterVisual): FighterVisual {
  const bones = visual.rig.bones;

  // Put the two shoulders on slightly different depth planes.  The fight
  // camera no longer collapses both arms into the torso in a side-on view.
  bones.leftShoulder.position.z = -0.018;
  bones.rightShoulder.position.z = 0.026;

  // Bend the arms forward in the canonical +Z fight direction.  Segment
  // lengths stay close to the original rig, so the analytical two-bone solver
  // remains stable while the idle silhouette gains clear negative space.
  bones.leftForearm.position.set(-0.020, -0.135, 0.092);
  bones.rightForearm.position.set(0.020, -0.112, 0.126);
  bones.leftHand.position.set(-0.008, -0.082, 0.112);
  bones.rightHand.position.set(0.008, -0.060, 0.128);

  // Stagger the legs fore/aft and introduce a shallow knee bend.  Positive Z
  // is always "toward opponent" before fighterRootQuaternion maps the model to
  // either side of the arena, so this mirrors correctly for P1 and P2.
  bones.leftThigh.position.z = -0.045;
  bones.rightThigh.position.z = 0.050;
  bones.leftShin.position.set(0, -0.268, -0.040);
  bones.rightShin.position.set(0, -0.258, 0.052);
  bones.leftFoot.position.set(0, -0.242, -0.034);
  bones.rightFoot.position.set(0, -0.242, 0.040);

  visual.root.userData.authoredNeutralStance = "V9";
  visual.root.updateMatrixWorld(true);
  return visual;
}
