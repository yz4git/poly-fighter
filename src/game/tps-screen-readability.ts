/**
 * Screenshot-reviewed hit composition:
 * place decorative burst spokes outside the duel, while the actual contact
 * marker stays at the physical hit point. Screen-left/red and screen-right/blue
 * accents no longer cover both characters' faces in the same punch exchange.
 * This never changes collision, damage, hitstop, reach or fighter transforms.
 */
import type { HitEvent } from "./types";

export function tpsDecorativeHitLane(event: Pick<HitEvent, "attacker" | "blocked" | "move">): number {
  const sign = event.attacker === "p1" ? -1 : 1;
  if (event.blocked) return sign * .09;
  const magnitude = event.move.cinematicRole
    ? .38
    : event.move.power >= 1.6
      ? .29
      : .19;
  return sign * magnitude;
}

export function tpsComboCameraEnergy(
  comboStage: number,
  closeFactor: number,
): Readonly<{ shoulder: number; back: number; lift: number }> {
  const stage = Math.max(0, Math.min(1, (comboStage - 1) / 3));
  const close = Math.max(0, Math.min(1, closeFactor));
  const energy = stage * close;
  return { shoulder: energy * .23, back: -energy * .17, lift: energy * .055 };
}
