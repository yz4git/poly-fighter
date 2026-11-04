import type { MoveDefinition } from "./types";

export const CINEMATIC_TECHNIQUES = ["skyBreaker", "airChase", "airCarry", "airPivot", "meteorSlam", "cycloneSweep", "powerRush"] as const;
export type CinematicTechnique = typeof CINEMATIC_TECHNIQUES[number];

const NAMES: Record<string, Record<CinematicTechnique, string>> = {
  KAIRO: {
    skyBreaker: "Crimson Skybreaker", airChase: "Forge Aerial Barrage",
    airCarry: "Crimson Wall Drive", airPivot: "Forge Axis Break",
    meteorSlam: "Meteor Anvil", cycloneSweep: "Iron Cyclone", powerRush: "Terminal Overdrive",
  },
  SERA: {
    skyBreaker: "Prism Ascension", airChase: "Sonic Air Waltz",
    airCarry: "Prism Pursuit", airPivot: "Sonic Sidewind",
    meteorSlam: "Azure Comet Drop", cycloneSweep: "Blue Ribbon Spiral", powerRush: "Photon Rush",
  },
  VANTA: {
    skyBreaker: "Void Uplift", airChase: "Shadow Cross Spiral",
    airCarry: "Void Wall Chase", airPivot: "Eclipse Redirect",
    meteorSlam: "Null Gravity Crash", cycloneSweep: "Eclipse Scythe", powerRush: "Dark Matter Burst",
  },
  AXION: {
    skyBreaker: "Gravity Pillar", airChase: "Orbit Hammer",
    airCarry: "Gravity Ram", airPivot: "Orbit Switch",
    meteorSlam: "Event Horizon Fall", cycloneSweep: "Tectonic Halo", powerRush: "Mass Driver",
  },
};

function role(
  source: MoveDefinition,
  roleName: CinematicTechnique,
  name: string,
  overrides: Partial<MoveDefinition>,
): MoveDefinition {
  return {
    ...source, ...overrides,
    id: roleName,
    label: name,
    input: roleName === "skyBreaker" ? "COMBO + FORWARD + ATTACK"
      : roleName === "airChase" ? "AIRBORNE RIVAL + ATTACK"
      : roleName === "airCarry" ? "FORWARD + AIR ATTACK"
      : roleName === "airPivot" ? "SIDE + AIR ATTACK"
      : roleName === "meteorSlam" ? "BACK + AIR ATTACK / AIR COMBO FINISH"
      : roleName === "cycloneSweep" ? "SIDE + ATTACK"
      : "COMBO + BACK + ATTACK",
    motionBase: source.motionBase ?? source.id,
    motionVariant: undefined,
    cinematicRole: roleName,
  };
}

/** Five distinct, named choreography families for every playable fighter. */
export function addCinematicTechniques(
  moves: Record<string, MoveDefinition>,
  fighterName: string,
): Record<string, MoveDefinition> {
  const labels = NAMES[fighterName] ?? NAMES.KAIRO;
  const heavy = fighterName === "AXION" ? 1.1 : fighterName === "SERA" ? .91 : 1;
  const fast = fighterName === "SERA" ? -2 : fighterName === "AXION" ? 2 : 0;
  return {
    ...moves,
    skyBreaker: role(moves.risingKick, "skyBreaker", labels.skyBreaker, {
      startup: 10 + fast, active: 5, recovery: 11,
      damage: Math.round(13 * heavy), hitStun: 56, blockStun: 11,
      knockback: .08, reach: 1.74, width: .83, hitStop: 7,
      launcher: true, knockdown: false, power: 1.65,
      visualContact: "RIGHT_FOOT",
    }),
    airChase: role(moves.kick, "airChase", labels.airChase, {
      startup: 6 + Math.max(-1, fast), active: 5, recovery: 10,
      damage: Math.round(8 * heavy), hitStun: 52, blockStun: 9,
      knockback: .06, reach: 2.02, width: .90, hitStop: 5,
      launcher: false, knockdown: false, power: 1.22,
      visualContact: "RIGHT_FOOT",
    }),
    // Same fixed-tick contact and real reach rules as regular strikes. These
    // follow-ups earn different spatial outcomes, not guaranteed free hits.
    airCarry: role(moves.kick, "airCarry", labels.airCarry, {
      startup: 6 + Math.max(-1, fast), active: 5, recovery: 11,
      damage: Math.round(8 * heavy), hitStun: 52, blockStun: 9,
      knockback: .10, reach: 2.12, width: .90, hitStop: 5,
      launcher: false, knockdown: false, power: 1.30,
      visualContact: "RIGHT_FOOT",
    }),
    airPivot: role(moves.risingKick, "airPivot", labels.airPivot, {
      startup: 7 + Math.max(-1, fast), active: 5, recovery: 11,
      damage: Math.round(8 * heavy), hitStun: 53, blockStun: 9,
      knockback: .08, reach: 2.08, width: .99, hitStop: 6,
      launcher: false, knockdown: false, power: 1.38,
      visualContact: "RIGHT_FOOT",
    }),
    meteorSlam: role(moves.dashKick, "meteorSlam", labels.meteorSlam, {
      startup: 9 + fast, active: 6, recovery: 24,
      damage: Math.round(18 * heavy), hitStun: 62, blockStun: 16,
      knockback: .24, reach: 2.04, width: .95, hitStop: 11,
      launcher: false, knockdown: true, power: 2.25,
      visualContact: "RIGHT_FOOT",
    }),
    cycloneSweep: role(moves.lowKick, "cycloneSweep", labels.cycloneSweep, {
      startup: 12 + fast, active: 7, recovery: 22,
      damage: Math.round(13 * heavy), hitStun: 25, blockStun: 13,
      knockback: .16, reach: 1.84, width: 1.17, hitStop: 8,
      launcher: false, knockdown: true, power: 1.5,
      visualContact: "LEFT_FOOT",
    }),
    powerRush: role(moves.power, "powerRush", labels.powerRush, {
      startup: 14 + fast, active: 6, recovery: 28,
      damage: Math.round(24 * heavy), guardDamage: 14, hitStun: 35, blockStun: 19,
      knockback: .35, reach: 1.94, width: .98, hitStop: 12,
      launcher: false, knockdown: true, power: 2.6,
      visualContact: "RIGHT_FIST",
    }),
  };
}

export function chooseCinematicTechnique(input: {
  comboStage: number;
  forwardAxis: number;
  sideAxis: number;
  distance: number;
  opponentAirborne: boolean;
  airHits: number;
  hasJuggle: boolean;
  signaturePriority: boolean;
}): CinematicTechnique | null {
  if (input.signaturePriority) return null;
  if (input.hasJuggle && input.opponentAirborne && input.distance <= 2.30) {
    // The finisher must be deliberate: at least one airborne re-hit landed.
    // Neutral keeps the classic barrage. Forward carries toward the wall,
    // lateral redirects the rival, and BACK chooses an early damage ender.
    // A third confirmed airborne hit must end the chain to prevent loops.
    if (input.airHits >= 3 || (input.airHits >= 2 && input.forwardAxis < -.5)) return "meteorSlam";
    if (Math.abs(input.sideAxis) > .5) return "airPivot";
    if (input.forwardAxis > .5) return "airCarry";
    return "airChase";
  }
  if (input.comboStage >= 1 && input.forwardAxis > .5 && input.distance <= 1.95) return "skyBreaker";
  if (input.comboStage >= 2 && input.forwardAxis < -.5 && input.distance <= 1.94) return "powerRush";
  if (input.comboStage === 0 && Math.abs(input.sideAxis) > .5 && input.distance <= 1.85) return "cycloneSweep";
  return null;
}

/** A buffered touch tap preserves its directional intent even if the finger
 * leaves the virtual stick before the authored cancel window opens. */
export function cinematicAxesForBufferedTap(input: {
  forwardAxis: number;
  sideAxis: number;
  queuedBranch?: "FORWARD" | "BACK" | "SIDE" | "NEUTRAL";
  queuedSideSign?: number;
}): { forwardAxis: number; sideAxis: number } {
  if (input.queuedBranch === "FORWARD") return { forwardAxis: 1, sideAxis: 0 };
  if (input.queuedBranch === "BACK") return { forwardAxis: -1, sideAxis: 0 };
  if (input.queuedBranch === "SIDE") return { forwardAxis: 0, sideAxis: input.queuedSideSign === -1 ? -1 : 1 };
  if (input.queuedBranch === "NEUTRAL") return { forwardAxis: 0, sideAxis: 0 };
  return { forwardAxis: input.forwardAxis, sideAxis: input.sideAxis };
}
