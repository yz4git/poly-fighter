import type { MoveDefinition } from "./types";

/**
 * Reference: the user's 12-frame martial-arts GIF, 110 ms/frame.
 *
 * Frames 0–2: compact guard → accelerating short jab
 * Frames 3–5: chamber → head-height side kick → controlled retract
 * Frames 6–10: sink / low traveling evasion → rising open-palm strike
 * Frame 11: settle in guard
 *
 * THREE real hit checks, no automatic combo/teleport/extra hitbox. SERA players
 * deliberately press FORWARD+ATTACK, then tap ATTACK after each clean hit.
 */
export const SERA_STREET_FLOW_VERSION = "SERA_GIF_STREET_FLOW_12FRAMES_V1";
export const SERA_STREET_FLOW_MOVES = [
  "streetFlowJab",
  "streetFlowKick",
  "streetFlowPalm",
] as const;
export type StreetFlowMove = typeof SERA_STREET_FLOW_MOVES[number];

export const SERA_STREET_FLOW_LABELS = [
  "STREET FLOW · GUARD JAB",
  "STREET FLOW · HIGH KICK",
  "STREET FLOW · LOW PALM",
] as const;

/** Append distinct gameplay moves rather than overwrite existing kick/palm
 * moves or make an animated film that deals damage without player actions. */
export function addSeraStreetFlowMoves(
  moves: Readonly<Record<string, MoveDefinition>>,
): Record<string, MoveDefinition> {
  const jab = moves.jab, kick = moves.kick, palm = moves.bodyBlow;
  if (!jab || !kick || !palm) throw new Error("SERA street flow needs standard jab, kick and body palm");
  return {
    ...moves,
    streetFlowJab: {
      ...jab,
      id: "streetFlowJab",
      label: "Street Flow · Guard Jab",
      input: "FORWARD + ATTACK",
      motionBase: "jab",
      motionId: "CM_StreetFlow_Jab",
      startup: 5, active: 3, recovery: 12,
      cancelWindow: 9,
      damage: 5, hitStop: 4,
      reach: 1.33, width: .66,
      knockback: .045,
      visualContact: "LEFT_FIST",
      reactionTarget: "HEAD",
    },
    streetFlowKick: {
      ...kick,
      id: "streetFlowKick",
      label: "Street Flow · High Side Kick",
      input: "CLEAN GUARD JAB + ATTACK",
      motionBase: "kick",
      motionId: "CM_StreetFlow_HighKick",
      startup: 8, active: 5, recovery: 17,
      cancelWindow: 10,
      damage: 8, hitStop: 5,
      reach: 1.78, width: .74, height: 1.58,
      knockback: .07,
      hitLevel: "HIGH",
      visualContact: "RIGHT_FOOT",
      reactionTarget: "HEAD",
    },
    streetFlowPalm: {
      ...palm,
      id: "streetFlowPalm",
      label: "Street Flow · Low Pivot Palm",
      input: "CLEAN HIGH KICK + ATTACK",
      motionBase: "bodyBlow",
      motionId: "CM_StreetFlow_LowPalm",
      startup: 10, active: 5, recovery: 22,
      cancelWindow: 6,
      damage: 12, hitStop: 7,
      reach: 1.53, width: .78,
      knockback: .19, hitStun: 27,
      visualContact: "RIGHT_FIST",
      reactionTarget: "BODY",
    },
  };
}

/** State derives from the existing 60 Hz clean-hit combo stage.
 * Pressing SIDE/BACK intentionally exits the sequence to another move; an
 * already whiffed or blocked strike cannot be force-chained.
 */
export function chooseSeraStreetFlowMove(input: {
  fighter: string;
  comboStage: number;
  completedBeats: number;
  forward: boolean;
  back: boolean;
  side: boolean;
  distance: number;
  available: Readonly<Record<string, MoveDefinition>>;
}): StreetFlowMove | null {
  if (input.fighter !== "SERA"
      || !Number.isFinite(input.distance)
      || input.back || input.side) return null;
  const completed = input.completedBeats;
  if (completed === 0) {
    if (input.comboStage !== 0 || !input.forward
        || input.distance > 1.64 || input.distance < .37) return null;
  } else {
    if ((completed !== 1 && completed !== 2)
        || input.comboStage !== completed
        || input.distance > (completed === 1 ? 1.93 : 1.82)) return null;
  }
  const id = SERA_STREET_FLOW_MOVES[completed];
  return input.available[id] ? id : null;
}
