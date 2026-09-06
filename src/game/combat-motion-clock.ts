export const COMBAT_MOTION_VERSION = "COMBAT_MOTION_V8_TIMELINE";

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function smoothMotion(value: number): number {
  const u = clamp01(value);
  return u * u * u * (10 + u * (-15 + u * 6));
}

export const LOCOMOTION_DIRECTIONS = ["F", "FR", "R", "BR", "B", "BL", "L", "FL"] as const;
export type LocomotionDirection = typeof LOCOMOTION_DIRECTIONS[number];

/** Short lateral steps keep the feet separated inside the narrower speed stance. */
export function combatStride(speed: boolean, lateral: number): number {
  return Math.min(.30, (speed ? .16 : .20) / Math.max(.001, Math.abs(lateral)));
}

export function locomotionDirection(x: number, z: number): LocomotionDirection {
  const sector = Math.round(Math.atan2(x, z) / (Math.PI / 4));
  return LOCOMOTION_DIRECTIONS[(sector + 8) % 8];
}

/** The stance part is linear: world travel exactly cancels the planted foot. */
export function combatFootCycle(phase: number): { travel: number; lift: number; planted: boolean; roll: number } {
  const u = ((phase % 1) + 1) % 1;
  const stance = .62;
  if (u < stance) {
    const t = u / stance;
    return { travel: .5 - t, lift: 0, planted: true, roll: .08 * smoothMotion((t - .82) / .18) };
  }
  const t = (u - stance) / (1 - stance);
  return { travel: -.5 + smoothMotion(t), lift: Math.sin(Math.PI * t) ** 2, planted: false, roll: -.10 * Math.sin(Math.PI * t) };
}
