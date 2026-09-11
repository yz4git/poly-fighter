import { FIGHTER_DEFINITIONS } from "./definitions";
import type { FighterDefinition, MoveDefinition } from "./types";

export const VANTA_FIGHTER_ID = "violet" as const;

function tuned(
  source: MoveDefinition,
  overrides: Partial<MoveDefinition> & Pick<MoveDefinition, "label">,
): MoveDefinition {
  return { ...source, ...overrides };
}

const red = FIGHTER_DEFINITIONS.red;
const blue = FIGHTER_DEFINITIONS.blue;

const vantaMoves: Record<string, MoveDefinition> = {
  jab: tuned(blue.moves.jab, {
    label: "Null Tap",
    startup: 5,
    recovery: 10,
    damage: 6,
    reach: 1.30,
    power: 0.72,
  }),
  straight: tuned(red.moves.straight, {
    label: "Axis Pierce",
    startup: 7,
    recovery: 14,
    damage: 10,
    hitStun: 21,
    reach: 1.64,
    width: 0.66,
    power: 1.02,
  }),
  backfist: tuned(blue.moves.backfist, {
    label: "Mirror Rake",
    startup: 9,
    recovery: 17,
    damage: 12,
    reach: 1.50,
    power: 1.18,
  }),
  bodyBlow: tuned(red.moves.bodyBlow, {
    label: "Void Palm",
    startup: 8,
    recovery: 16,
    damage: 11,
    hitStun: 24,
    reach: 1.38,
    power: 1.18,
  }),
  power: tuned(blue.moves.power, {
    label: "Black Prism Collapse",
    startup: 16,
    active: 7,
    recovery: 24,
    damage: 22,
    guardDamage: 12,
    hitStun: 33,
    blockStun: 18,
    knockback: 0.27,
    reach: 1.76,
    width: 0.90,
    power: 2.12,
  }),
  kick: tuned(blue.moves.kick, {
    label: "Null Arc",
    startup: 8,
    recovery: 15,
    damage: 8,
    reach: 1.58,
    power: 0.98,
  }),
  lowKick: tuned(blue.moves.lowKick, {
    label: "Shadow Sweep",
    startup: 7,
    recovery: 13,
    damage: 8,
    reach: 1.58,
    width: 0.74,
    power: 0.92,
  }),
  risingKick: tuned(blue.moves.risingKick, {
    label: "Zero Lift",
    startup: 11,
    recovery: 21,
    damage: 15,
    hitStun: 29,
    reach: 1.50,
    power: 1.40,
  }),
  dashKick: tuned(red.moves.dashKick, {
    label: "Vanta Vector",
    startup: 12,
    recovery: 21,
    damage: 17,
    hitStun: 28,
    knockback: 0.21,
    reach: 1.92,
    width: 0.84,
    power: 1.62,
  }),
  throw: tuned(blue.moves.throw, {
    label: "Mirror Drop",
    startup: 5,
    recovery: 22,
    damage: 19,
    hitStun: 39,
    knockback: 0.34,
    power: 1.86,
  }),
  counter: tuned(blue.moves.counter, {
    label: "Null Counter",
    startup: 5,
    active: 6,
    recovery: 17,
    damage: 13,
    hitStun: 28,
    reach: 1.40,
    power: 1.42,
  }),
};

export const VANTA_FIGHTER_DEFINITION: FighterDefinition = Object.freeze({
  id: VANTA_FIGHTER_ID,
  name: "VANTA",
  callsign: "THE NULL MIRROR",
  // VANTA keeps the audited SPEED locomotion family while her Fighter DNA and
  // move table create a slower, read-heavy counter-control identity.
  archetype: "SPEED",
  colors: {
    primary: 0x6f45d7,
    secondary: 0x08070d,
    accent: 0xd7aa45,
    skin: 0xd9aa91,
    hair: 0x171020,
    glow: 0xb88cff,
  },
  body: {
    height: 1,
    shoulderWidth: 0.96,
    clavicleWidth: 1.0,
    chestWidth: 0.91,
    chestDepth: 0.51,
    waistWidth: 0.59,
    pelvisWidth: 0.82,
    hipWidth: 0.78,
    armLength: 0.96,
    upperArmMass: 0.98,
    forearmMass: 0.96,
    legLength: 1.25,
    thighMass: 0.98,
    calfMass: 0.94,
    neckLength: 0.26,
    muscle: 1.0,
    headWidth: 0.9,
    headDepth: 0.84,
    jawWidth: 0.8,
    cheekWidth: 0.88,
    browDepth: 1.03,
    noseLength: 0.99,
    handScale: 1.0,
    footScale: 1.06,
  },
  moves: vantaMoves,
});

export function registerVantaFighter(): FighterDefinition {
  FIGHTER_DEFINITIONS[VANTA_FIGHTER_ID] = VANTA_FIGHTER_DEFINITION;
  return VANTA_FIGHTER_DEFINITION;
}
