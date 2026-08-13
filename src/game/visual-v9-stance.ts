import type { FighterVisual } from "./visual";

/**
 * Persistent bind-space stance for SERA. The deployed V9 screenshot showed
 * that technically separate limbs were still too close in the actual fight
 * camera. V9.1 opens the silhouette more aggressively while preserving the
 * same rig, segment lengths, IK solver, and view-independent 3D character.
 */
export function applyV9AuthoredStance(visual: FighterVisual): FighterVisual {
  const bones = visual.rig.bones;

  // Three-quarter upper-body construction: shoulders live on different depth
  // planes and the spine advances slightly toward the opponent. These are bone
  // translations, not camera-facing rotations or billboards.
  bones.leftShoulder.position.z = -0.040;
  bones.rightShoulder.position.z = 0.052;
  bones.spineLower.position.z = -0.006;
  bones.spineUpper.position.z = 0.010;
  bones.chest.position.z = 0.018;
  bones.neck.position.z = 0.012;
  bones.head.position.z = 0.010;

  // Asymmetric ready guard. One hand sits higher and closer to the face while
  // the other remains lower/forward, matching the negative spaces in the
  // original fighting reference instead of forming a vertical mannequin.
  bones.leftForearm.position.set(-0.022, -0.126, 0.112);
  bones.leftHand.position.set(-0.010, -0.066, 0.136);
  bones.rightForearm.position.set(0.022, -0.086, 0.146);
  bones.rightHand.position.set(0.010, -0.046, 0.104);

  // Increase fore/aft leg stagger. The lower-leg chains remain purely vertical
  // so analytical IK and the proven sole-ground offset stay unchanged.
  bones.leftThigh.position.z = -0.102;
  bones.rightThigh.position.z = 0.112;
  bones.leftShin.position.set(0, -0.282, 0);
  bones.rightShin.position.set(0, -0.282, 0);
  bones.leftFoot.position.set(0, -0.258, 0);
  bones.rightFoot.position.set(0, -0.258, 0);

  visual.footContacts.left.homeLocal.z = -0.102;
  visual.footContacts.right.homeLocal.z = 0.112;
  visual.root.userData.authoredNeutralStance = "V9.1";
  visual.root.updateMatrixWorld(true);
  return visual;
}
