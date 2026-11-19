/**
 * Anatomical knee-pole steering for the already baked eight-direction walk.
 *
 * A fixed outward knee pole leaves the knee pointing to the side while the
 * stance foot travels forward or sideways. This moves the bend plane along
 * the moving foot's *existing* target; no world-root translation, stride
 * length, contact beat, IK solver, or rendering-time pass is changed.
 *
 * Coordinates are measured in fighter-body-height units. The pole is a
 * directional IK hint, not a foot position or an authored knee position.
 */
export const COMBAT_GAIT_KNEE_POLE_VERSION = "COMBAT_GAIT_KNEE_POLE_V1";
export type CombatGaitPoint = readonly [number, number, number];

export function combatGaitKneePole(
  side: "l" | "r",
  movingFoot: CombatGaitPoint,
  restFoot: CombatGaitPoint,
  stanceWidth: number,
): [number, number, number] {
  const sign = side === "l" ? -1 : 1;
  // Even at the full half-stride, the pole retains the anatomical outward
  // bend direction instead of swinging across the body's sagittal plane.
  const x = sign * (stanceWidth + .02)
    + (movingFoot[0] - restFoot[0]) * .56;
  const z = .22 + (movingFoot[2] - restFoot[2]) * .38;
  return [x, .27, z];
}
