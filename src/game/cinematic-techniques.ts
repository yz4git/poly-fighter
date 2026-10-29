import type { MoveDefinition } from "./types";

export const CINEMATIC_TECHNIQUES = ["skyBreaker", "airChase", "meteorSlam", "cycloneSweep", "powerRush"] as const;
export type CinematicTechnique = typeof CINEMATIC_TECHNIQUES[number];

const NAMES: Record<string, Record<CinematicTechnique, string>> = {
  KAIRO: {
    skyBreaker: "Crimson Skybreaker", airChase: "Forge Aerial Barrage",
    meteorSlam: "Meteor Anvil", cycloneSweep: "Iron Cyclone", powerRush: "Terminal Overdrive",
  },
  SERA: {
    skyBreaker: "Prism Ascension", airChase: "Sonic Air Waltz",
    meteorSlam: "Azure Comet Drop", cycloneSweep: "Blue Ribbon Spiral", powerRush: "Photon Rush",
  },
  VANTA: {
    skyBreaker: "Void Uplift", airChase: "Shadow Cross Spiral",
    meteorSlam: "Null Gravity Crash", cycloneSweep: "Eclipse Scythe", powerRush: "Dark Matter Burst",
  },
  AXION: {
    skyBreaker: "Gravity Pillar", airChase: "Orbit Hammer",
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
      : roleName === "meteorSlam" ? "AIR COMBO FINISH + ATTACK"
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
    return input.airHits >= 2 ? "meteorSlam" : "airChase";
  }
  if (input.comboStage >= 1 && input.forwardAxis > .5 && input.distance <= 1.95) return "skyBreaker";
  if (input.comboStage >= 2 && input.forwardAxis < -.5 && input.distance <= 1.94) return "powerRush";
  if (input.comboStage === 0 && Math.abs(input.sideAxis) > .5 && input.distance <= 1.85) return "cycloneSweep";
  return null;
}
