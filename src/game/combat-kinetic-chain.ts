import { authoredMotionEvents } from "./combat-motion-timeline";

/**
 * Clip-space secondary motion for imported Blender fight animations.
 *
 * The kick's authored hip/knee/ankle trajectory is the primary motion. These
 * profiles add a small support-side COM shift, delayed thoracic counter-rotation
 * and stance-foot pivot *during one-time clip baking*, not per-render IK.
 *
 * The stages follow the SAME contact event used by gameplay, preventing
 * a second independent animation clock from diverging under hitstop.
 */
export type KickKineticPose = Readonly<{
  comSide: number;
  comForward: number;
  comVertical: number;
  torsoYaw: number;
  torsoPitch: number;
  shoulderYaw: number;
  supportPivot: number;
  preparation: number;
  drive: number;
  recovery: number;
}>;

type KickProfile = Readonly<{
  supportSide: -1 | 1;
  power: number;
  pivot: number;
  lean: number;
  reach: number;
}>;

const KICKS: Readonly<Record<string, KickProfile>> = {
  BF_FrontKick_R: { supportSide: -1, power: 0.80, pivot: 0.075, lean: -0.018, reach: 0.95 },
  BF_LowKick_L: { supportSide: 1, power: 1.00, pivot: -0.15, lean: 0.030, reach: 0.9 },
  BF_RisingKick_R: { supportSide: -1, power: 1.10, pivot: 0.11, lean: -0.064, reach: 0.8 },
  BF_DashKick_R: { supportSide: -1, power: 1.24, pivot: 0.095, lean: -0.047, reach: 1.20 },
};

export function isKineticKick(name: string): boolean {
  return Object.hasOwn(KICKS, name);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

function smooth(x: number): number {
  const v = clamp01(x);
  return v * v * (3 - 2 * v);
}

function pulse(t: number, riseStart: number, riseEnd: number, fallStart: number, fallEnd: number): number {
  const rising = smooth((t - riseStart) / Math.max(1e-6, riseEnd - riseStart));
  const falling = 1 - smooth((t - fallStart) / Math.max(1e-6, fallEnd - fallStart));
  return rising * falling;
}

const STILL: KickKineticPose = Object.freeze({
  comSide: 0, comForward: 0, comVertical: 0,
  torsoYaw: 0, torsoPitch: 0, shoulderYaw: 0, supportPivot: 0,
  preparation: 0, drive: 0, recovery: 0,
});

/**
 * Continuous curves vanish at 0 and 1 so transitions keep CM_Ready as their
 * common reference pose. Inputs/outputs are dimensionless clip-space units;
 * COM channels are fractions of the imported model's measured height.
 */
export function sampleKickKineticChain(clipName: string, normalizedPhase: number): KickKineticPose {
  const profile = KICKS[clipName];
  if (!profile) return STILL;
  const u = clamp01(normalizedPhase);
  const { contact, contactExit } = authoredMotionEvents(clipName);
  const preparation = pulse(u, 0.025, Math.max(0.05, contact * 0.25), contact * 0.57, contact * 0.88);
  const drive = pulse(u, contact * 0.50, contact * 0.93, contactExit + 0.012, Math.min(0.90, contactExit + 0.26));
  const recovery = pulse(u, contactExit + 0.012, contactExit + 0.15, 0.83, 0.97);
  const force = profile.power;

  return {
    // Travel very little: the gameplay root still owns movement and reach.
    // Lean onto the support hip as the strike unfolds, then recover the center.
    comSide: profile.supportSide * (0.0025 * preparation + 0.0065 * drive - 0.0015 * recovery) * force,
    comForward: (-0.0035 * preparation + 0.0075 * drive * profile.reach - 0.0025 * recovery) * force,
    comVertical: (-0.0045 * preparation + 0.0018 * drive - 0.0010 * recovery) * force,

    // Preparation winds the thorax against the support hip; impact passes the
    // turn through the upper body; recovery leads the guard back to neutral.
    // Never rotate the pelvis/thigh chain: that would rewrite the authored kick.
    torsoYaw: (-0.050 * preparation + 0.068 * drive - 0.025 * recovery) * force,
    torsoPitch: profile.lean * drive + 0.015 * preparation,
    shoulderYaw: (0.027 * preparation - 0.052 * drive + 0.033 * recovery) * force,
    supportPivot: profile.pivot * drive + profile.pivot * 0.2 * recovery,
    preparation, drive, recovery,
  };
}
