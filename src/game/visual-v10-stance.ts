import type { FighterVisual } from "./visual";

/**
 * Bind-safe stance marker for the reconstructed SERA mesh.
 *
 * A skinned asset must be bound against the exact same joint translations
 * used to calculate the skeleton inverses. V9.1 deliberately translated
 * forearm/hand/thigh joints to manufacture screen-space separation; doing that
 * to an imported continuous surface pulls whole chunks away from their bind
 * locations. V10.1 therefore leaves every bind translation untouched and lets
 * FighterAnimationController create motion with rotations/IK only.
 */
export function applyV10SafeStance(visual: FighterVisual): FighterVisual {
  visual.root.userData.authoredNeutralStance = "V10.1_BIND_SAFE";
  visual.root.updateMatrixWorld(true);
  return visual;
}
