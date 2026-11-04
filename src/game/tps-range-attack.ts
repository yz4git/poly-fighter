import type { MoveDefinition } from "./types";

/**
 * Three actual spatial gap closers. ATTACK selects these only beyond the
 * ordinary punch/kick contact band. The gap is crossed physically in the
 * 60Hz simulation; no teleport, instant projectile hit or new input button.
 */
export const TPS_RANGE_ATTACK_IDS = ["rangeBlitz", "rangeCrescent", "rangeComet"] as const;
export type TpsRangeAttackId = typeof TPS_RANGE_ATTACK_IDS[number];
export const TPS_AUTO_RANGE_THRESHOLD = 2.10;
export const TPS_LONG_RANGE_THRESHOLD = 3.65;
export const TPS_RANGE_STOP_DISTANCE = 1.54;

const LABELS: Readonly<Record<string, readonly [string, string, string]>> = {
  KAIRO: ["Forge Breakthrough", "Crimson Wheel", "Meteor Pursuit"],
  SERA: ["Prism Flash Step", "Sonic Crescent", "Azure Comet"],
  VANTA: ["Null Vector Thrust", "Eclipse Scythe", "Shadow Meteor"],
  AXION: ["Mass Driver Step", "Gravity Wheel", "Orbit Crusher"],
};

function rangeMove(
  source: MoveDefinition,
  id: TpsRangeAttackId,
  label: string,
  changes: Partial<MoveDefinition>,
): MoveDefinition {
  return {
    ...source,
    ...changes,
    id,
    label,
    input: "AUTO: DISTANT RIVAL + ATTACK",
    motionBase: source.motionBase ?? source.id,
    motionVariant: undefined,
    cinematicRole: undefined,
  };
}

/** Add three wholly new moves per fighter, without changing their old moves. */
export function addTpsRangeTechniques(
  moves: Record<string, MoveDefinition>,
  fighterName: string,
): Record<string, MoveDefinition> {
  const [blitz, crescent, comet] = LABELS[fighterName] ?? LABELS.KAIRO;
  const heavy = fighterName === "AXION" ? 1.1 : fighterName === "SERA" ? .9 : 1;
  const startup = fighterName === "SERA" ? -2 : fighterName === "AXION" ? 2 : 0;
  return {
    ...moves,
    rangeBlitz: rangeMove(moves.straight, "rangeBlitz", blitz, {
      startup: 18 + startup, active: 5, recovery: 19 + Math.max(0, startup),
      damage: Math.round(11 * heavy), guardDamage: 4, hitStun: 25,
      blockStun: 11, knockback: .13, hitStop: 6,
      reach: 1.78, width: .78, tracking: .56,
      power: 1.25, knockdown: false, launcher: false,
      visualContact: "RIGHT_FIST", reactionTarget: "HEAD", hitLevel: "MID",
    }),
    rangeCrescent: rangeMove(moves.kick, "rangeCrescent", crescent, {
      startup: 22 + startup, active: 6, recovery: 23,
      damage: Math.round(12 * heavy), guardDamage: 5, hitStun: 26,
      blockStun: 12, knockback: .17, hitStop: 7,
      reach: 1.92, width: .92, tracking: .50,
      power: 1.43, knockdown: false, launcher: false,
      visualContact: "RIGHT_FOOT", reactionTarget: "BODY", hitLevel: "MID",
    }),
    rangeComet: rangeMove(moves.dashKick, "rangeComet", comet, {
      startup: 29 + startup, active: 7, recovery: 29,
      damage: Math.round(16 * heavy), guardDamage: 7, hitStun: 28,
      blockStun: 13, knockback: .22, hitStop: 8,
      reach: 1.99, width: .98, tracking: .46,
      power: 1.73, knockdown: true, launcher: false,
      visualContact: "RIGHT_FOOT", reactionTarget: "BODY", hitLevel: "MID",
    }),
  };
}

export function isTpsRangeAttack(id: string | null | undefined): id is TpsRangeAttackId {
  return id === "rangeBlitz" || id === "rangeCrescent" || id === "rangeComet";
}

/**
 * A single ATTACK tap chooses a gap closer before neutral mash or normal
 * distance routing. Two middle-distance styles alternate; a genuinely distant
 * opponent calls for a longer, more punishable airborne-looking strike.
 */
export function chooseTpsRangeAttack(input: {
  distance: number;
  attackerGrounded: boolean;
  defenderGrounded: boolean;
  sequence: number;
}): TpsRangeAttackId | null {
  if (!Number.isFinite(input.distance) || input.distance <= TPS_AUTO_RANGE_THRESHOLD
    || !input.attackerGrounded || !input.defenderGrounded) return null;
  if (input.distance > TPS_LONG_RANGE_THRESHOLD) return "rangeComet";
  return Math.abs(Math.floor(input.sequence)) % 2 === 0 ? "rangeBlitz" : "rangeCrescent";
}

export type TpsRangeAdvanceInput = Readonly<{
  moveId: string | null;
  moveTick: number;
  startup: number;
  distance: number;
  /** Signed distance in the committed (never instantly homing) attack lane. */
  longitudinal: number;
  lateral: number;
  hitStop: number;
  connected: boolean;
}>;

/**
 * Metres of real root travel on ONE fixed simulation tick. Never adjust the
 * hitbox; geometry resolution still requires correct distance, facing and lane.
 * A lateral step completely off the committed line defeats the approach.
 */
export function tpsRangeAdvance(input: TpsRangeAdvanceInput): number {
  if (!isTpsRangeAttack(input.moveId)
    || input.hitStop > 0 || input.connected
    || input.moveTick < 0 || input.moveTick >= input.startup
    || !Number.isFinite(input.distance) || !Number.isFinite(input.longitudinal)
    || !Number.isFinite(input.lateral) || input.longitudinal < .65
    || input.lateral > 1.24) return 0;

  const remaining = input.longitudinal - TPS_RANGE_STOP_DISTANCE;
  if (remaining <= 0) return 0;

  const u = input.moveTick / Math.max(1, input.startup);
  // Animated windup -> acceleration -> plant. Capped displacement is always
  // continuous and independent of the browser render frame rate.
  const launch = Math.min(1, .56 + u * 2.9);
  const brake = u > .80 ? Math.max(.35, (1 - u) / .20) : 1;
  const speed = input.moveId === "rangeComet" ? .255
    : input.moveId === "rangeCrescent" ? .211 : .204;
  return Math.max(0, Math.min(remaining, speed * launch * brake));
}
