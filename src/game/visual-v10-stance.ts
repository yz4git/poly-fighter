import type { FighterVisual } from "./visual";

/**
 * Bind-safe stance marker for the reconstructed SERA mesh.
 *
 * The V10.3 presentation converts source triangles into the bind-local space
 * of their owning bones. Joint translations therefore stay exactly at the rig
 * values used to calculate skeleton inverses; all visible movement comes from
 * the existing rotation/IK animation path.
 */
export function applyV10SafeStance(visual: FighterVisual): FighterVisual {
  visual.root.userData.bindSafeStance = "V10.3_EXACT_BIND_TRANSLATIONS";
  visual.root.updateMatrixWorld(true);
  return visual;
}
