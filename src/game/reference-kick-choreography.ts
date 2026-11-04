import { authoredMotionEvents } from "./combat-motion-timeline";

/**
 * Whole-body kick poses, baked on the target skeleton rather than added over
 * its playing clip. Design references (independent implementation):
 * - clintcan/3d-fighter/tools/build_fight_animations.gd: chamber, hip drive,
 *   support-foot pivot, counterbalancing arm and a distinct retraction.
 * - WolfireGames/overgrowth/Data/Scripts/aschar.as: an explicit planted foot
 *   and swing foot; release the stance only when the next step starts.
 * All distances below are fractions of the measured character height.
 */
export const REFERENCE_KICK_VERSION = "REFERENCE_KICK_CHOREOGRAPHY_V2";
export type KickPoint = readonly [number, number, number];
export type ReferenceKickPose = Readonly<{
  strike: "l" | "r";
  side: number;
  forward: number;
  drop: number;
  yaw: number;
  pitch: number;
  roll: number;
  chest: number;
  pivot: number;
  foot: KickPoint;
  knee: KickPoint;
  rearHand: KickPoint;
  guardHand: KickPoint;
  extension: number;
}>;
type Profile = Readonly<{
  strike: "l" | "r";
  side: number;
  forward: number;
  drop: number;
  yaw: number;
  lean: number;
  pivot: number;
  chamber: KickPoint;
  contact: KickPoint;
  knee: KickPoint;
}>;

const PROFILES: Readonly<Record<string, Profile>> = {
  BF_FrontKick_R: {
    strike: "r", side: -.055, forward: .085, drop: -.027,
    yaw: -.67, lean: -.22, pivot: -.52,
    chamber: [.08, .33, .12], contact: [.015, .65, .59], knee: [.06, .67, .36],
  },
  BF_LowKick_L: {
    strike: "l", side: .062, forward: .070, drop: -.083,
    yaw: .92, lean: .075, pivot: 1.06,
    chamber: [-.18, .23, .03], contact: [-.015, .19, .55], knee: [-.14, .39, .35],
  },
  BF_RisingKick_R: {
    strike: "r", side: -.085, forward: .055, drop: -.058,
    yaw: -1.27, lean: -.36, pivot: -1.45,
    chamber: [.24, .39, -.04], contact: [-.035, .81, .43], knee: [.025, .73, .24],
  },
  BF_DashKick_R: {
    strike: "r", side: -.051, forward: .145, drop: -.018,
    yaw: -.75, lean: -.25, pivot: -.76,
    chamber: [.07, .36, .13], contact: [.015, .81, .50], knee: [.06, .74, .32],
  },
};

export function isReferenceKick(name: string): boolean {
  return Object.hasOwn(PROFILES, name);
}

function mix(a: number, b: number, w: number): number { return a + (b - a) * w; }
function point(a: KickPoint, b: KickPoint, w: number): KickPoint {
  return [mix(a[0], b[0], w), mix(a[1], b[1], w), mix(a[2], b[2], w)];
}
function blend(a: ReferenceKickPose, b: ReferenceKickPose, w: number): ReferenceKickPose {
  return {
    strike: a.strike,
    side: mix(a.side, b.side, w), forward: mix(a.forward, b.forward, w),
    drop: mix(a.drop, b.drop, w), yaw: mix(a.yaw, b.yaw, w),
    pitch: mix(a.pitch, b.pitch, w), roll: mix(a.roll, b.roll, w),
    chest: mix(a.chest, b.chest, w), pivot: mix(a.pivot, b.pivot, w),
    foot: point(a.foot, b.foot, w), knee: point(a.knee, b.knee, w),
    rearHand: point(a.rearHand, b.rearHand, w), guardHand: point(a.guardHand, b.guardHand, w),
    extension: mix(a.extension, b.extension, w),
  };
}

/** Uses the same authored-contact phase as the deterministic moveTick sampler. */
export function sampleReferenceKickChoreography(
  name: string, phase: number, stanceWidth = .103,
): ReferenceKickPose | null {
  const p = PROFILES[name];
  if (!p) return null;
  const { contact, contactExit } = authoredMotionEvents(name);
  const sign = p.strike === "l" ? -1 : 1;
  const neutral: ReferenceKickPose = {
    strike: p.strike, side: 0, forward: 0, drop: 0, yaw: 0,
    pitch: .025, roll: 0, chest: .035, pivot: 0,
    foot: [sign * stanceWidth, 0, p.strike === "l" ? .065 : -.070],
    knee: [sign * (stanceWidth + .02), .27, .22],
    rearHand: p.strike === "r" ? [.083, .756, .125] : [-.088, .735, .172],
    guardHand: p.strike === "r" ? [-.088, .735, .172] : [.083, .756, .125],
    extension: 0,
  };
  const loaded: ReferenceKickPose = {
    ...neutral, side: p.side * .50, forward: -.024, drop: -.055,
    yaw: -p.yaw * .27, roll: sign * .038,
  };
  const chamber: ReferenceKickPose = {
    ...neutral, side: p.side, forward: p.forward * .28, drop: p.drop - .026,
    yaw: p.yaw * .58, pitch: p.lean * .34, roll: sign * .095,
    chest: p.lean * .54, pivot: p.pivot * .55,
    foot: p.chamber, knee: [sign * .13, .64, .28],
    rearHand: [sign * .18, .69, .055], guardHand: [-sign * .10, .81, .16],
  };
  const strike: ReferenceKickPose = {
    ...chamber, forward: p.forward, drop: p.drop, yaw: p.yaw,
    pitch: p.lean * .43, chest: p.lean * .94, roll: sign * .14,
    pivot: p.pivot, foot: p.contact, knee: p.knee,
    rearHand: [sign * .25, .59, -.09], guardHand: [-sign * .11, .82, .17],
    extension: 1,
  };
  const follow: ReferenceKickPose = {
    ...strike, yaw: strike.yaw * 1.10, roll: strike.roll * 1.06,
    foot: [strike.foot[0], strike.foot[1], strike.foot[2] + .035],
  };
  const retracted: ReferenceKickPose = {
    ...chamber, side: p.side * .76, forward: p.forward * .18,
    yaw: p.yaw * .24, pivot: p.pivot * .34,
    rearHand: point(chamber.rearHand, neutral.rearHand, .42),
  };
  const planted = blend(loaded, neutral, .68);
  const keys: readonly (readonly [number, ReferenceKickPose])[] = [
    [0, neutral], [contact * .25, loaded], [contact * .64, chamber],
    [contact, strike], [contactExit, follow],
    [contactExit + (1 - contactExit) * .43, retracted],
    [contactExit + (1 - contactExit) * .78, planted], [1, neutral],
  ];
  const u = Number.isFinite(phase) ? Math.max(0, Math.min(1, phase)) : 0;
  for (let i = 1; i < keys.length; i++) {
    if (u > keys[i][0]) continue;
    const t = (u - keys[i - 1][0]) / Math.max(1e-6, keys[i][0] - keys[i - 1][0]);
    // Zero acceleration at each anatomical landmark; no overshoot below the floor.
    const w = t * t * t * (10 + t * (-15 + t * 6));
    return blend(keys[i - 1][1], keys[i][1], w);
  }
  return neutral;
}
