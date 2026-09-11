import { FIGHTER_DEFINITIONS } from "./definitions";
import type { FighterDefinition, MoveDefinition } from "./types";

export const ROOK_FIGHTER_ID = "amber" as const;

function tuned(
  source: MoveDefinition,
  overrides: Partial<MoveDefinition> & Pick<MoveDefinition, "label">,
): MoveDefinition {
  return { ...source, ...overrides };
}

const red = FIGHTER_DEFINITIONS.red;
const blue = FIGHTER_DEFINITIONS.blue;

const rookMoves: Record<string, MoveDefinition> = {
  jab: tuned(red.moves.jab, {
    label: "Anchor Check",
    startup: 6,
    recovery: 11,
    damage: 7,
    reach: 1.25,
    power: 0.80,
  }),
  straight: tuned(red.moves.straight, {
    label: "Ram Line",
    startup: 9,
    recovery: 16,
    damage: 12,
    hitStun: 23,
    reach: 1.60,
    width: 0.74,
    power: 1.22,
  }),
  backfist: tuned(red.moves.backfist, {
    label: "Bulkhead Hook",
    startup: 11,
    recovery: 19,
    damage: 15,
    hitStun: 26,
    reach: 1.48,
    power: 1.36,
  }),
  bodyBlow: tuned(red.moves.bodyBlow, {
    label: "Hull Breaker",
    startup: 8,
    recovery: 17,
    damage: 13,
    guardDamage: 6,
    blockStun: 13,
    hitStun: 25,
    reach: 1.36,
    power: 1.34,
  }),
  power: tuned(red.moves.power, {
    label: "Gravity Hammer",
    startup: 18,
    active: 7,
    recovery: 27,
    damage: 23,
    guardDamage: 15,
    hitStun: 35,
    blockStun: 20,
    knockback: 0.30,
    reach: 1.70,
    width: 0.94,
    power: 2.18,
  }),
  kick: tuned(red.moves.kick, {
    label: "Piston Kick",
    startup: 10,
    recovery: 18,
    damage: 10,
    reach: 1.54,
    width: 0.76,
    power: 1.08,
  }),
  lowKick: tuned(red.moves.lowKick, {
    label: "Anchor Sweep",
    startup: 9,
    recovery: 15,
    damage: 9,
    reach: 1.52,
    width: 0.78,
    power: 1.00,
  }),
  risingKick: tuned(red.moves.risingKick, {
    label: "Jack Lift",
    startup: 13,
    recovery: 23,
    damage: 16,
    hitStun: 31,
    reach: 1.46,
    power: 1.48,
  }),
  dashKick: tuned(red.moves.dashKick, {
    label: "Siege Drive",
    startup: 14,
    recovery: 23,
    damage: 18,
    hitStun: 29,
    knockback: 0.24,
    reach: 1.84,
    width: 0.92,
    power: 1.74,
  }),
  throw: tuned(red.moves.throw, {
    label: "Deadweight Drop",
    startup: 5,
    recovery: 24,
    damage: 22,
    hitStun: 42,
    knockback: 0.38,
    reach: 1.10,
    width: 0.74,
    power: 2.02,
  }),
  counter: tuned(blue.moves.counter, {
    label: "Brace Counter",
    startup: 7,
    active: 5,
    recovery: 19,
    damage: 14,
    hitStun: 28,
    reach: 1.36,
    power: 1.42,
  }),
};

export const ROOK_FIGHTER_DEFINITION: FighterDefinition = Object.freeze({
  id: ROOK_FIGHTER_ID,
  name: "ROOK",
  callsign: "THE GRAVITY FRAME",
  archetype: "POWER",
  colors: {
    primary: 0xd4772d,
    secondary: 0x111319,
    accent: 0xe7c46c,
    skin: 0xc89276,
    hair: 0x17191d,
    glow: 0xff9f43,
  },
  body: {
    height: 1.04,
    shoulderWidth: 1.13,
    clavicleWidth: 1.18,
    chestWidth: 1.08,
    chestDepth: 0.60,
    waistWidth: 0.70,
    pelvisWidth: 0.90,
    hipWidth: 0.84,
    armLength: 0.93,
    upperArmMass: 1.24,
    forearmMass: 1.28,
    legLength: 1.16,
    thighMass: 1.22,
    calfMass: 1.16,
    neckLength: 0.24,
    muscle: 1.22,
    headWidth: 0.94,
    headDepth: 0.90,
    jawWidth: 0.88,
    cheekWidth: 0.92,
    browDepth: 1.10,
    noseLength: 1.02,
    handScale: 1.15,
    footScale: 1.18,
  },
  moves: rookMoves,
});

export function registerRookFighter(): FighterDefinition {
  FIGHTER_DEFINITIONS[ROOK_FIGHTER_ID] = ROOK_FIGHTER_DEFINITION;
  return ROOK_FIGHTER_DEFINITION;
}
