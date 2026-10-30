import type { MoveDefinition } from "./types";
import { expandedMoveId, type MoveVariant } from "./move-expansion";

/**
 * A freeform ATTACK-only rhythm, not a random auto-combo. Every successful
 * button-driven strike advances the sequence; each three-move phrase changes
 * the lead, body target and finish. Normal directed combos and the first
 * familiar jab → straight → power sequence remain untouched.
 *
 * Existing hit/guard/whiff checks, stage caps, and honest reach apply.
 */
const NEUTRAL_MASH_PHRASES = [
  ["jab", "straight", "power"],        // original entry / regression baseline
  ["backfist", "bodyBlow", "risingKick"], // palm -> body -> spinning high kick
  ["kick", "straight", "dashKick"],     // chambered kick -> straight -> rush
  ["bodyBlow", "lowKick", "backfist"],  // change levels and finish palm
  ["straight", "backfist", "power"],    // direct -> turning hand -> heavy
  ["lowKick", "kick", "risingKick"],    // low -> side kick -> high
  ["jab", "counter", "dashKick"],      // quick hands -> counter -> drive
  ["backfist", "kick", "power"],        // palm -> side kick -> impact
] as const;
export const TPS_MASH_PHRASE_COUNT = NEUTRAL_MASH_PHRASES.length;
export const TPS_MASH_BUFFER_TICKS = 20;

/** A buffered mash never cancels startup/active frames by itself.
 * A clean hit still gates the authored combo link; misses require full
 * attack recovery before the next move can start.
 */
export function tpsCanBufferMashTap(move: Pick<MoveDefinition,"startup" | "active" | "recovery">,
  moveTick: number): boolean {
  const earliest = Math.max(0, move.startup - 3);
  const last = move.startup + move.active + move.recovery - 2;
  return moveTick >= earliest && moveTick <= last;
}

export function chooseTpsNeutralMashMove(input: {
  count: number;
  stage: number;
  distance: number;
  lastBase?: string | null;
  available: Readonly<Record<string, MoveDefinition>>;
}): { id: string; base: string; phrase: number } {
  const count = Math.max(0, Math.floor(input.count));
  const phrase = Math.floor(count / 3) % NEUTRAL_MASH_PHRASES.length;
  const stage = Math.max(0, Math.min(2, Math.floor(input.stage)));
  const group = NEUTRAL_MASH_PHRASES[phrase];
  let base: string = group[stage];

  // A far opponent calls for an actual leg or committed driving technique;
  // it never gives a short jab a fabricated hitbox or teleports into range.
  if (input.distance > 1.72) {
    const far = ["kick", "lowKick", "dashKick", "risingKick"] as const;
    const choice = far[(phrase + stage) % far.length];
    if (input.available[choice]) base = choice;
  }
  // If interrupted between phrases, do not repeat the same silhouette.
  if (base === input.lastBase && phrase > 0) {
    const alternatives = stage === 2
      ? ["risingKick", "dashKick", "power", "backfist"]
      : ["bodyBlow", "kick", "straight", "lowKick"];
    base = alternatives.find(id => id !== base && !!input.available[id]) ?? base;
  }
  if (!input.available[base]) base = input.available.jab ? "jab" : Object.keys(input.available)[0] ?? base;

  // The video-based basic clips stay accessible. Every other phrase can use
  // existing SNAP / PIVOT / DRIVE skeletal variants for recognizable changes.
  const variants: MoveVariant[] = ["SNAP", "PIVOT", "DRIVE", "CRUSH"];
  const shouldVariant = phrase > 1 && stage > 0 && phrase % 2 === 0
    && base !== "risingKick";
  const variantId = shouldVariant ? expandedMoveId(base, variants[(phrase + stage) % variants.length]) : null;
  return { id: variantId && input.available[variantId] ? variantId : base, base, phrase };
}
