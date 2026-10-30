/**
 * Hand-authored 3D choreography study of the user's ten-second reference video.
 * This is NOT motion capture or inferred 3D tracking: deliberately readable
 * game-ready poses, normalized to each fighter's calibrated skeleton height.
 *
 * Reference beats (source-video seconds):
 * 0-0.7 guarded ready; 0.8-1.5 straight punch / opposite-hand guard;
 * 2.7-3.4 extended palm/deflection; 4.4-5.2 chamber -> thrust kick;
 * 5.3-7.3 pivot / rotating high kick; 7.5-8.5 finish punch and reset.
 * Preserve one attack per actual game move: never auto-hit through an animation.
 */
export const VIDEO_CHOREOGRAPHY_VERSION = "VIDEO_REFERENCE_CHOREOGRAPHY_V1" as const;
export const VIDEO_STRIKE_CLIPS = {
  jab: "CM_Video_Jab",
  backfist: "CM_Video_Palm",
  kick: "CM_Video_SideKick",
  risingKick: "CM_Video_SpinKick",
} as const;

export type VideoStrike = keyof typeof VIDEO_STRIKE_CLIPS;
export type VideoPoint = [number, number, number];
export type VideoBodyPose = {
  side?: number; forward?: number; drop?: number; yaw?: number;
  pitch?: number; roll?: number; chest?: number; highGuard?: number;
  leftFoot?: VideoPoint; rightFoot?: VideoPoint;
  leftHand?: VideoPoint; rightHand?: VideoPoint;
  /** Visual-only pivot of the skeletal pelvis; never rotates collision/hitboxes. */
  spin?: number;
};
type VideoKey = Readonly<{ t: number; pose: VideoBodyPose }>;
const PI2 = Math.PI * 2;

const KEYS: Record<VideoStrike, readonly VideoKey[]> = {
  jab: [
    { t: 0, pose: { highGuard: .8 } },
    { t: .20, pose: { drop: -.045, side: -.018, forward: -.018, yaw: -.20,
      rightHand: [.083,.80,.12], leftHand: [-.095,.79,.10], highGuard: 1 } },
    { t: .40, pose: { forward: -.014, side: .038, drop: -.025, yaw: .16, chest: .09,
      rightHand: [.077,.81,.13], leftHand: [-.070,.75,.33], highGuard: .86 } },
    { t: .50, pose: { forward: -.046, drop: -.031, side: .078, yaw: .43,
      chest: .14, pitch: -.08, leftHand: [-.045,.76,.66],
      rightHand: [.070,.79,.11], highGuard: .9 } },
    { t: .64, pose: { forward: -.026, side: .054, yaw: .26, chest: .09, leftHand: [-.048,.75,.51],
      rightHand: [.077,.80,.14], highGuard: .85 } },
    { t: .84, pose: { forward: .011, yaw: .07, leftHand: [-.090,.78,.15], highGuard: .9 } },
    { t: 1, pose: { highGuard: .83, leftHand: [-.095,.76,.16] } },
  ],
  backfist: [
    { t: 0, pose: { highGuard: .8 } },
    { t: .21, pose: { drop: -.06, side: .04, yaw: -.48, chest: .13,
      leftHand: [-.08,.81,.14], rightHand: [.14,.72,.06], highGuard: 1 } },
    { t: .39, pose: { drop: -.025, side: -.015, yaw: .20, roll: -.08,
      rightHand: [.10,.76,.28], leftHand: [-.085,.82,.14] } },
    { t: .50, pose: { forward: .054, drop: -.027, yaw: .68, roll: -.15,
      chest: .12, rightHand: [.24,.77,.55], leftHand: [-.105,.79,.12], highGuard: .80 } },
    { t: .66, pose: { forward: .043, yaw: .62, roll: -.09, rightHand: [.30,.76,.48],
      leftHand: [-.10,.79,.12] } },
    { t: .85, pose: { drop: -.023, yaw: .20, rightHand: [.12,.77,.19],
      leftHand: [-.09,.80,.12] } },
    { t: 1, pose: { highGuard: .84 } },
  ],
  kick: [
    { t: 0, pose: { highGuard: .80 } },
    { t: .19, pose: { drop: -.075, side: -.035, forward: -.016, yaw: -.38,
      pitch: .15, chest: .12, highGuard: .92,
      rightFoot: [.075,.18,.16], rightHand: [.12,.81,.13], leftHand: [-.10,.79,.12] } },
    { t: .37, pose: { drop: -.065, side: -.064, yaw: -.60, pitch: .24,
      roll: -.17, rightFoot: [.08,.36,.25],
      rightHand: [.17,.79,.10], leftHand: [-.12,.82,.19] } },
    { t: .50, pose: { drop: -.048, side: -.084, yaw: -.78, pitch: .30,
      roll: -.24, chest: .12, rightFoot: [.14,.53,.58], leftFoot: [-.10,0,.05],
      leftHand: [-.16,.80,.16], rightHand: [.15,.77,.06] } },
    { t: .66, pose: { drop: -.053, side: -.06, yaw: -.67, pitch: .24,
      roll: -.18, rightFoot: [.12,.50,.52], leftHand: [-.15,.79,.14] } },
    { t: .81, pose: { drop: -.065, yaw: -.28, pitch: .15, rightFoot: [.065,.22,.22],
      highGuard: .86 } },
    { t: 1, pose: { highGuard: .85 } },
  ],
  risingKick: [
    { t: 0, pose: { highGuard: .80 } },
    { t: .14, pose: { drop: -.09, side: -.05, forward: -.025, yaw: -.30,
      pitch: .18, leftHand: [-.10,.77,.14], rightHand: [.12,.81,.17], highGuard: .85 } },
    { t: .30, pose: { drop: -.11, side: -.06, forward: .022, yaw: -.55,
      pitch: .27, roll: -.11, spin: -Math.PI*.85,
      rightFoot: [.095,.29,.15], leftFoot: [-.11,0,.03],
      leftHand: [-.16,.77,.14], rightHand: [.14,.76,.07] } },
    { t: .42, pose: { drop: -.10, side: -.085, forward: .045, yaw: -.33,
      pitch: .20, roll: -.18, spin: -Math.PI*1.66,
      rightFoot: [.13,.51,.39], leftFoot: [-.12,0,.03],
      leftHand: [-.21,.75,.10], rightHand: [.17,.73,.06] } },
    { t: .50, pose: { drop: -.07, side: -.085, forward: .065,
      yaw: .12, pitch: .22, roll: -.30, spin: -PI2,
      rightFoot: [.15,.72,.57], leftFoot: [-.12,0,.04],
      leftHand: [-.20,.80,.08], rightHand: [.19,.75,.05] } },
    { t: .64, pose: { drop: -.07, side: -.06, yaw: .12, roll: -.22, spin: -PI2,
      pitch: .19, rightFoot: [.14,.66,.48],
      rightHand: [.17,.77,.06], leftHand: [-.17,.79,.11] } },
    { t: .82, pose: { drop: -.055, yaw: -.06, pitch: .10, spin: -PI2,
      rightFoot: [.07,.23,.18], highGuard: .76 } },
    { t: 1, pose: { highGuard: .86, spin: -PI2 } },
  ],
};

function smooth(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t*t*(3-2*t);
}
function blendNumber(a: number | undefined, b: number | undefined, baseline: number, t: number): number {
  return (a ?? baseline) * (1 - t) + (b ?? baseline) * t;
}

/** Pure frame sampler. The contact pose always lands on 0.50 of each clip. */
export function sampleVideoChoreography(move: VideoStrike, phase: number, width: number): VideoBodyPose {
  const safeWidth = Number.isFinite(width) ? Math.max(.04, Math.min(.15, width)) : .09;
  const defaults: VideoBodyPose = {
    side: 0, forward: 0, drop: 0, yaw: 0, pitch: .025, roll: 0, chest: .035,
    highGuard: .7, spin: 0,
    leftFoot: [-safeWidth,0,.065], rightFoot: [safeWidth,0,-.070],
    leftHand: [-.088,.735,.172], rightHand: [.083,.756,.125],
  };
  const keys = KEYS[move], u = Math.max(0, Math.min(1, Number.isFinite(phase) ? phase : 0));
  let a = keys[0], b = keys[keys.length-1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i].t) { a = keys[i-1]; b = keys[i]; break; }
  }
  const w = smooth((u - a.t) / Math.max(.00001, b.t - a.t));
  const result: VideoBodyPose = {};
  for (const k of ["side","forward","drop","yaw","pitch","roll","chest","highGuard","spin"] as const) {
    result[k] = blendNumber(a.pose[k],b.pose[k],defaults[k]!,w);
  }
  for (const k of ["leftFoot","rightFoot","leftHand","rightHand"] as const) {
    result[k] = [0,1,2].map(i => blendNumber(a.pose[k]?.[i],b.pose[k]?.[i],defaults[k]![i],w)) as VideoPoint;
  }
  return result;
}
