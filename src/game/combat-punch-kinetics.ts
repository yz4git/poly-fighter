import { authoredMotionEvents } from "./combat-motion-timeline";

/** Additive full-body mechanics for imported punches; evaluated once when baking clips. */
export type PunchKineticPose = Readonly<{
  comSide: number;
  comForward: number;
  comVertical: number;
  pelvisYaw: number;
  torsoYaw: number;
  torsoPitch: number;
  chestRoll: number;
  strikeClavicleYaw: number;
  guardClavicleYaw: number;
  headCounterYaw: number;
  stancePivot: number;
  guardRetention: number;
  contactLock: number;
  preparation: number;
  drive: number;
  recovery: number;
}>;

type PunchProfile = Readonly<{
  side: "l" | "r";
  torque: number;
  forward: number;
  crouch: number;
  pitch: number;
  pivot: number;
  backfist?: boolean;
}>;

const PUNCHES: Readonly<Record<string, PunchProfile>> = {
  BF_Jab_L:      { side: "l", torque: 0.48, forward: 0.60, crouch: .001, pitch: .004, pivot: .015 },
  BF_Cross_R:    { side: "r", torque: 1.00, forward: 1.00, crouch: .006, pitch: .018, pivot: .100 },
  BF_BodyBlow_L: { side: "l", torque: 0.82, forward: 0.65, crouch: .020, pitch: .056, pivot: .065 },
  BF_BodyBlow_R: { side: "r", torque: 0.82, forward: 0.65, crouch: .020, pitch: .056, pivot: .065 },
  BF_Backfist_R: { side: "r", torque: 0.93, forward: 0.50, crouch: .003, pitch: -.025, pivot: -.115, backfist: true },
  BF_Backfist_L: { side: "l", torque: 0.93, forward: 0.50, crouch: .003, pitch: -.025, pivot: -.115, backfist: true },
  BF_Power_R:    { side: "r", torque: 1.27, forward: 1.15, crouch: .016, pitch: .035, pivot: .135 },
  BF_Counter_R:  { side: "r", torque: 0.95, forward: 0.68, crouch: .009, pitch: .019, pivot: .075 },
};

const NEUTRAL: PunchKineticPose = Object.freeze({
  comSide: 0, comForward: 0, comVertical: 0, pelvisYaw: 0,
  torsoYaw: 0, torsoPitch: 0, chestRoll: 0,
  strikeClavicleYaw: 0, guardClavicleYaw: 0, headCounterYaw: 0,
  stancePivot: 0, guardRetention: 0, contactLock: 0,
  preparation: 0, drive: 0, recovery: 0,
});

function smooth01(value: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return t * t * (3 - 2 * t);
}

function envelope(u: number, a: number, b: number, c: number, d: number): number {
  return smooth01((u - a) / Math.max(1e-6, b - a))
    * (1 - smooth01((u - c) / Math.max(1e-6, d - c)));
}

export function isKineticPunch(name: string): boolean {
  return Object.hasOwn(PUNCHES, name);
}

export function punchStrikeSide(name: string): "l" | "r" | null {
  return PUNCHES[name]?.side ?? null;
}

/**
 * Discrete hitboxes and animation share authoredMotionEvents(). Curves are
 * continuous, with zero offsets on the first and last sample of every clip.
 * Distances are fractions of model height; angular channels are in radians.
 */
export function samplePunchKineticChain(name: string, normalizedPhase: number): PunchKineticPose {
  const profile = PUNCHES[name];
  if (!profile) return NEUTRAL;
  const u = Math.max(0, Math.min(1, Number.isFinite(normalizedPhase) ? normalizedPhase : 0));
  const { contact, contactExit } = authoredMotionEvents(name);
  const prep = envelope(u, .015, Math.max(.045, contact * .23), contact * .55, contact * .87);
  const drive = envelope(u, contact * .43, contact * .97, contactExit + .03, Math.min(.87, contactExit + .24));
  const recover = envelope(u, contactExit + .015, contactExit + .16, .82, .985);
  const side = profile.side === "l" ? -1 : 1;
  const direction = profile.backfist ? -1 : 1;
  const torque = profile.torque;
  const windup = -.034 * prep * torque;
  const release = .074 * drive * torque;
  const recoil = -.022 * recover * torque;
  const rotation = (windup + release + recoil) * direction * side;

  return {
    comSide: side * (-.0032 * prep + .0052 * drive - .0016 * recover) * torque,
    comForward: profile.forward * (-.003 * prep + .009 * drive - .002 * recover),
    comVertical: -profile.crouch * (.45 * prep + .80 * drive + .25 * recover),
    pelvisYaw: rotation * .30,
    torsoYaw: rotation * .70,
    torsoPitch: profile.pitch * drive + .010 * prep - .010 * recover,
    chestRoll: side * (.011 * prep - .022 * drive + .006 * recover) * torque,
    strikeClavicleYaw: side * direction * (.015 * prep + .036 * drive - .014 * recover) * torque,
    guardClavicleYaw: -side * direction * (.018 * prep + .032 * drive - .023 * recover) * torque,
    headCounterYaw: -rotation * .43,
    stancePivot: side * profile.pivot * drive,
    guardRetention: .75 * drive + .30 * prep + .45 * recover,
    contactLock: .5 * prep + .90 * drive + .38 * recover,
    preparation: prep, drive, recovery: recover,
  };
}
