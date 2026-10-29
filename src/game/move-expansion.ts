import type { MoveDefinition } from "./types";

/**
 * Forty combat-distinct extensions for each fighter. No new touch buttons:
 * TPS ATTACK selects a stance/direction variant, and neutral chains cycle them.
 */
export const MOVE_VARIANTS = ["SNAP", "DRIVE", "PIVOT", "CRUSH"] as const;
export type MoveVariant = typeof MOVE_VARIANTS[number];
export const EXPANDED_MOVE_BASES = [
  "jab", "straight", "backfist", "bodyBlow", "power",
  "kick", "lowKick", "risingKick", "dashKick", "counter",
] as const;

const LABELS: Readonly<Record<MoveVariant, string>> = {
  SNAP: "Flash",
  DRIVE: "Drive",
  PIVOT: "Angle",
  CRUSH: "Breaker",
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Stable IDs/animation metadata mean every fighter retains its original kit. */
export function expandedMoveId(base: string, variant: MoveVariant): string {
  return `${base}${variant.charAt(0)}${variant.slice(1).toLowerCase()}`;
}

export function expandMoveSet(original: Record<string, MoveDefinition>): Record<string, MoveDefinition> {
  const moves = { ...original };
  for (const baseId of EXPANDED_MOVE_BASES) {
    const base = original[baseId];
    if (!base) continue;
    for (const variant of MOVE_VARIANTS) {
      const id = expandedMoveId(baseId, variant);
      const snap = variant === "SNAP", drive = variant === "DRIVE";
      const pivot = variant === "PIVOT", crush = variant === "CRUSH";
      const tuned: MoveDefinition = {
        ...base,
        id,
        label: `${base.label} · ${LABELS[variant]}`,
        input: `${base.input} [${LABELS[variant]}]`,
        motionBase: baseId,
        motionVariant: variant,
        startup: clamp(base.startup + (snap ? -2 : drive ? 2 : pivot ? 1 : 4), 3, 28),
        active: clamp(base.active + (pivot ? 1 : 0), 2, 9),
        recovery: clamp(base.recovery + (snap ? -2 : drive ? 2 : pivot ? 0 : 4), 7, 36),
        damage: clamp(Math.round(base.damage * (snap ? .82 : drive ? 1.12 : pivot ? .97 : 1.22)), 3, 30),
        guardDamage: clamp(base.guardDamage + (crush ? 3 : drive ? 1 : 0), 0, 19),
        hitStun: clamp(base.hitStun + (drive ? 2 : crush ? 3 : 0), 10, 42),
        blockStun: clamp(base.blockStun + (crush ? 2 : 0), 6, 22),
        knockback: clamp(base.knockback * (snap ? .84 : drive ? 1.15 : pivot ? .92 : 1.2), .06, .42),
        hitStop: clamp(base.hitStop + (crush ? 2 : 0), 3, 12),
        reach: clamp(base.reach * (snap ? .96 : drive ? 1.06 : pivot ? 1.0 : .98), .9, 2.13),
        width: clamp(base.width * (pivot ? 1.15 : snap ? .95 : 1), .35, 1.16),
        tracking: clamp(base.tracking + (pivot ? .06 : crush ? -.12 : 0), .25, .8),
        cancelWindow: clamp(base.cancelWindow + (snap ? 2 : crush ? -2 : 0), 2, 11),
        power: base.power * (snap ? .9 : drive ? 1.08 : pivot ? .97 : 1.16),
      };
      moves[id] = tuned;
    }
  }
  return moves;
}

export function isMoveVariant(value: unknown): value is MoveVariant {
  return typeof value === "string" && (MOVE_VARIANTS as readonly string[]).includes(value);
}

/**
 * Default opening/combos remain readable. Repeated neutral ATTACK taps also
 * discover variants; directional ATTACK lets players intentionally pick them.
 */
export function expandedContextMove(input: {
  baseId: string;
  moveCount: number;
  forwardAxis?: number;
  sideAxis?: number;
  available: Readonly<Record<string, MoveDefinition>>;
  preserveSignature?: boolean;
}): string {
  const { baseId, available } = input;
  if (input.preserveSignature || !(EXPANDED_MOVE_BASES as readonly string[]).includes(baseId)) return baseId;
  let variant: MoveVariant | null = null;
  if ((input.forwardAxis ?? 0) > 0) variant = "DRIVE";
  else if ((input.forwardAxis ?? 0) < 0) variant = "CRUSH";
  else if ((input.sideAxis ?? 0) !== 0) variant = "PIVOT";
  else if (input.moveCount > 0) {
    const cycle = input.moveCount % 5;
    variant = cycle === 1 ? "SNAP" : cycle === 2 ? "DRIVE" : cycle === 3 ? "PIVOT" : cycle === 4 ? "CRUSH" : null;
  }
  const id = variant ? expandedMoveId(baseId, variant) : baseId;
  return available[id] ? id : baseId;
}
