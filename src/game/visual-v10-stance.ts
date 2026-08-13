import type { FighterVisual } from "./visual";

/**
 * Bind-safe V10.4 stance marker.
 *
 * Reference pose shaping belongs in FighterAnimationController where the real
 * gameplay state and move are known. Keeping this layer marker-only prevents
 * a second IK pass from re-solving already planted feet or the active attack
 * limb after the deterministic animation has finished.
 */
export function applyV10SafeStance(visual: FighterVisual): FighterVisual {
  visual.root.userData.bindSafeStance = "V10.4_EXACT_BIND_TRANSLATIONS";
  visual.root.userData.v10CombatPoseReference = "IDLE_GUARD_PUNCH_KICK_SIGNATURE_A_B";
  visual.root.userData.v10ReferencePoseController = "FIGHTER_ANIMATION_STATE_AWARE";
  visual.root.updateMatrixWorld(true);
  return visual;
}
