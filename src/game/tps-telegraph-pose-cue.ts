/** Render-only, deterministic, camera-readable silhouettes for a real attack
 * windup versus a committed-to-fake one. Both start from the SAME guard coil.
 *
 * After ~25% of the already-published telegraph, the real strike plants and
 * loads forward; a fake transfers weight laterally toward its actual exit.
 * Never changes FighterRuntime, buttons, collision or invulnerability.
 */
export type TpsTelegraphPosePhase =
  | "NONE" | "COIL" | "STRIKE_PREP" | "FEINT_PREP" | "FEINT_EXIT";

export type TpsTelegraphPoseCue = Readonly<{
  phase: TpsTelegraphPosePhase;
  intensity: number;
  anticipation: number;
  side: -1 | 1;
  hostX: number;
  hostY: number;
  hostZ: number;
  pitch: number;
  yaw: number;
  roll: number;
  spinePitch: number;
  spineYaw: number;
  leftArmPitch: number;
  rightArmPitch: number;
  leftThighRoll: number;
  rightThighRoll: number;
}>;

const zero = (side: -1 | 1): TpsTelegraphPoseCue => ({
  phase: "NONE", intensity: 0, anticipation: 0, side,
  hostX: 0, hostY: 0, hostZ: 0, pitch: 0, yaw: 0, roll: 0,
  spinePitch: 0, spineYaw: 0, leftArmPitch: 0,
  rightArmPitch: 0, leftThighRoll: 0, rightThighRoll: 0,
});

function smooth(value: number): number {
  const u = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return u * u * (3 - 2 * u);
}

export function tpsTelegraphPoseCue(input: {
  phase: string;
  telegraphProgress: number;
  plannedFeint: boolean;
  moveId: string | null;
  orbitSign: number;
  feintReadTicks: number;
  feintReadTotalTicks?: number;
}): TpsTelegraphPoseCue {
  const side: -1 | 1 = input.orbitSign < 0 ? -1 : 1;
  const empty = zero(side);
  const reading = input.phase === "FEINT" && input.feintReadTicks > 0;
  if (reading) {
    const total = Math.max(1, input.feintReadTotalTicks ?? 36);
    const elapsed = Math.max(0, total - input.feintReadTicks);
    // Body leans into the REAL lateral exit, then plants and straightens.
    const release = 1 - smooth(elapsed / 17);
    if (release <= 1e-4) return empty;
    return {
      ...empty, phase: "FEINT_EXIT", intensity: release,
      anticipation: release, hostX: side * .044 * release,
      hostY: -.012 * release, hostZ: -.010 * release,
      pitch: .012 * release, yaw: side * .168 * release,
      roll: -side * .137 * release,
      spinePitch: .052 * release, spineYaw: side * .108 * release,
      leftArmPitch: .050 * release, rightArmPitch: -.034 * release,
      leftThighRoll: -side * .078 * release,
      rightThighRoll: side * .085 * release,
    };
  }
  const windup = (input.phase === "LOAD" || input.phase === "REACT")
    && Boolean(input.moveId) && Number.isFinite(input.telegraphProgress);
  if (!windup || input.telegraphProgress <= 0) return empty;

  const progress = Math.max(0, Math.min(1, input.telegraphProgress));
  const shared = smooth(progress / .24);
  // No premature hidden cue: from 0 to .24 BOTH alternatives are identical.
  const split = smooth((progress - .24) / .27);
  const feint = input.plannedFeint;
  const anticipation = split;
  if (split === 0) {
    // Strictly identical local-bone values (including +0 / -0) during the
    // shared coil: no misleading frame-zero clue from the model or telemetry.
    return {
      ...empty, phase: "COIL", intensity: shared * .32, anticipation: 0,
      hostY: -.014 * shared,
      pitch: -.035 * shared,
      yaw: side * .026 * shared,
      spinePitch: -.025 * shared,
      leftArmPitch: -.025 * shared,
      rightArmPitch: -.025 * shared,
    };
  }
  return {
    phase: split < 1e-4 ? "COIL" : feint ? "FEINT_PREP" : "STRIKE_PREP",
    intensity: Math.max(shared * .32, anticipation),
    anticipation,
    side,
    // Local-space body offsets only, applied to the imported 3D rig.
    hostX: side * (feint ? .039 * split : .003 * split),
    hostY: -.014 * shared - (feint ? .006 : .003) * split,
    hostZ: feint ? -.012 * split : .024 * split,
    pitch: -.035 * shared + (feint ? .050 : -.090) * split,
    yaw: side * (.026 * shared + (feint ? .135 : .014) * split),
    roll: -side * (feint ? .116 : .010) * split,
    spinePitch: -.025 * shared + (feint ? .078 : -.070) * split,
    spineYaw: side * (feint ? .112 : .025) * split,
    leftArmPitch: -.025 * shared + (feint ? .053 : -.064) * split,
    rightArmPitch: -.025 * shared + (feint ? -.042 : -.112) * split,
    leftThighRoll: feint ? -side * .080 * split : .010 * split,
    rightThighRoll: feint ? side * .087 * split : -.010 * split,
  };
}
