/**
 * Per-character full-body stance authored in normalized skeleton coordinates.
 *
 * The old fight system chose only POWER or SPEED, leaving AXION/KAIRO and
 * VANTA/SERA with almost indistinguishable ready, guard and locomotion poses.
 * These values are baked into each fighter's real UBC skinned clips on load:
 * no second render-time mixer, avatar billboard or additional IK every frame.
 *
 * Coordinates are relative to measured character height, not world units.
 * The main striking hand/foot and the 60 Hz collision root stay authoritative.
 */
export const COMBAT_CHARACTER_STANCE_VERSION = "FOUR_FIGHTER_AUTHORED_STANCE_V1";

export type StancePoint = readonly [number, number, number];
export type CharacterStance = Readonly<{
  id: "KAIRO_BOXING" | "SERA_AGILE" | "VANTA_MIRROR" | "AXION_ANCHOR";
  /** Relative to the archetype's original anatomical foot spacing. */
  widthScale: number;
  /** Small neutral pelvis facing offset; authored strikes add their yaw. */
  pelvisYaw: number;
  /** Normalized 3D guard targets, not fake sprites. */
  leftGuard: StancePoint;
  rightGuard: StancePoint;
  /** Per-character body rhythm, on a shared phase-locked gait clock. */
  gaitBounce: number;
  gaitTorsoSwing: number;
  gaitSideLean: number;
  idleBreath: number;
}>;

const STANCES: Readonly<Record<string, CharacterStance>> = Object.freeze({
  KAIRO: {
    id: "KAIRO_BOXING", widthScale: 1.0, pelvisYaw: 0,
    leftGuard: [-.088, .735, .172], rightGuard: [.083, .756, .125],
    gaitBounce: .008, gaitTorsoSwing: .038, gaitSideLean: .032, idleBreath: .0017,
  },
  SERA: {
    id: "SERA_AGILE", widthScale: .94, pelvisYaw: -.045,
    leftGuard: [-.095, .758, .178], rightGuard: [.080, .769, .163],
    gaitBounce: .011, gaitTorsoSwing: .056, gaitSideLean: .050, idleBreath: .0024,
  },
  VANTA: {
    id: "VANTA_MIRROR", widthScale: 1.11, pelvisYaw: -.105,
    leftGuard: [-.114, .770, .116], rightGuard: [.113, .742, .176],
    gaitBounce: .006, gaitTorsoSwing: .067, gaitSideLean: .061, idleBreath: .0012,
  },
  AXION: {
    id: "AXION_ANCHOR", widthScale: 1.13, pelvisYaw: .075,
    leftGuard: [-.106, .744, .145], rightGuard: [.111, .753, .116],
    gaitBounce: .0045, gaitTorsoSwing: .026, gaitSideLean: .018, idleBreath: .0010,
  },
});

export function combatCharacterStance(name: string, archetype: "POWER" | "SPEED"): CharacterStance {
  return STANCES[name.toUpperCase()] ?? STANCES[archetype === "SPEED" ? "SERA" : "KAIRO"];
}
