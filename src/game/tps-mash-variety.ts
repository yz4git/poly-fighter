import type { MoveDefinition } from "./types";
import { expandedMoveId, type MoveVariant } from "./move-expansion";

/**
 * A freeform ATTACK-only rhythm, not a random auto-combo. Every fresh
 * neutral opener advances the phrase, even after a whiff; confirmed hits
 * continue within the same three-move phrase. Each new phrase changes
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
  ["risingKick", "counter", "dashKick"],  // turning kick -> counter -> drive
  ["dashKick", "kick", "power"],        // dash entry -> side kick -> impact
] as const;
export const TPS_MASH_PHRASE_COUNT = NEUTRAL_MASH_PHRASES.length;
export const TPS_MASH_BUFFER_TICKS = 20;

/** Only real contact may be classified as BLOCK or CLEAN. A dodge/spacing
 * whiff stays a full-recovery event, never a free hit-confirmed link. */
export type TpsMashOutcome = "CLEAN" | "BLOCK" | "WHIFF";
export type TpsMashResponse = "PHRASE" | "LOW_SWITCH" | "BODY_SWITCH" | "REACH_SWITCH";
export type TpsBufferedBranch = "FORWARD" | "BACK" | "SIDE" | "NEUTRAL";

export function tpsMashContactOutcome(contact: boolean, cleanHit: boolean): TpsMashOutcome {
  return !contact ? "WHIFF" : cleanHit ? "CLEAN" : "BLOCK";
}

/** The stick direction at the ATTACK *tap* owns the next branch.
 * A later released or changed thumb position cannot silently turn a buffered
 * SIDE/BACK combo into neutral mash, including on phrase 2 and beyond. */
export function tpsBufferedMashDirection(input: {
  forward: boolean; back: boolean; left: boolean; right: boolean;
  queuedBranch?: TpsBufferedBranch;
}): Readonly<{ forward: boolean; back: boolean; lateral: boolean }> {
  if (input.queuedBranch) return {
    forward: input.queuedBranch === "FORWARD",
    back: input.queuedBranch === "BACK",
    lateral: input.queuedBranch === "SIDE",
  };
  return { forward: input.forward, back: input.back, lateral: input.left || input.right };
}

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
  phrase: number;
  stage: number;
  distance: number;
  lastBase?: string | null;
  lastOutcome?: TpsMashOutcome | null;
  available: Readonly<Record<string, MoveDefinition>>;
}): { id: string; base: string; phrase: number; response: TpsMashResponse } {
  const phrase = Math.max(0, Math.floor(input.phrase)) % NEUTRAL_MASH_PHRASES.length;
  const stage = Math.max(0, Math.min(2, Math.floor(input.stage)));
  const group = NEUTRAL_MASH_PHRASES[phrase];
  let base: string = group[stage];
  let response: TpsMashResponse = "PHRASE";

  // React to the *previous real strike*, but never invent a hit-confirm. If a
  // standing guard ate the last attack, mix in a low sweep; if the defender
  // already blocked a low, change to the body instead of repeating the same
  // low. A whiff calls for a longer-reaching authored move, not fake homing.
  // Only the next neutral opener may adapt: established 2nd/3rd hit routes,
  // directed strings, PERFECT counters and the first classic phrase are kept.
  if (stage === 0 && phrase > 0 && input.distance <= 1.72) {
    if (input.lastOutcome === "BLOCK") {
      const candidate = input.lastBase === "lowKick" ? "bodyBlow" : "lowKick";
      if (candidate !== input.lastBase && input.available[candidate]) {
        base = candidate;
        response = candidate === "lowKick" ? "LOW_SWITCH" : "BODY_SWITCH";
      }
    } else if (input.lastOutcome === "WHIFF" && input.distance >= 1.34) {
      // At true point-blank range a miss likely came from a lateral STEP,
      // not lack of reach. Preserve the full eight-phrase vocabulary instead
      // of collapsing 4-frame mash play into two repeated punches.
      // Only a *spaced* miss warrants selecting an existing longer kick.
      const candidate = "kick";
      const fallback = "lowKick";
      const selected = candidate !== input.lastBase && input.available[candidate]
        ? candidate : fallback !== input.lastBase && input.available[fallback] ? fallback : null;
      if (selected) {
        base = selected;
        response = "REACH_SWITCH";
      }
    }
  }

  // A far opponent calls for an actual leg or committed driving technique;
  // it never gives a short jab a fabricated hitbox or teleports into range.
  if (input.distance > 1.72) {
    const far = ["kick", "lowKick", "dashKick", "risingKick"] as const;
    const choice = far[(phrase + stage) % far.length];
    if (input.available[choice]) base = choice;
  }
  // If interrupted between phrases, do not repeat the same silhouette.
  if (base === input.lastBase && phrase > 0) {
    response = "PHRASE";
    const alternatives = stage === 2
      ? ["risingKick", "dashKick", "power", "backfist"]
      : ["bodyBlow", "kick", "straight", "lowKick"];
    base = alternatives.find(id => id !== base && !!input.available[id]) ?? base;
  }
  if (!input.available[base]) {
    response = "PHRASE";
    base = input.available.jab ? "jab" : Object.keys(input.available)[0] ?? base;
  }

  // The video-based basic clips stay accessible. Every other phrase can use
  // existing SNAP / PIVOT / DRIVE skeletal variants for recognizable changes.
  const variants: MoveVariant[] = ["SNAP", "PIVOT", "DRIVE", "CRUSH"];
  const shouldVariant = phrase > 1 && stage > 0 && phrase % 2 === 0
    && base !== "risingKick";
  const variantId = shouldVariant ? expandedMoveId(base, variants[(phrase + stage) % variants.length]) : null;
  return { id: variantId && input.available[variantId] ? variantId : base, base, phrase, response };
}
