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
export const VIDEO_CHOREOGRAPHY_VERSION = "VIDEO_REFERENCE_CHOREOGRAPHY_V3" as const;
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
    { t: .20, pose: { drop: -.065, side: -.025, forward: -.036, yaw: -.38, pitch: .08, roll: .09,
      rightHand: [.083,.80,.12], leftHand: [-.095,.79,.10], highGuard: 1 } },
    { t: .40, pose: { forward: .025, side: .055, drop: -.044, yaw: .29, chest: .15, pitch: -.06,
      rightHand: [.077,.81,.13], leftHand: [-.084,.79,.39], highGuard: .86 } },
    { t: .50, pose: { forward: .085, drop: -.032, side: .085, yaw: .63,
      chest: .22, pitch: -.14, roll: -.10, leftHand: [-.035,.76,.74],
      rightHand: [.12,.80,.035], highGuard: .9 } },
    { t: .57, pose: { forward: .067, side: .09, yaw: .58, chest: .18, pitch: -.11,
      leftHand: [-.025,.75,.78], rightHand: [.12,.80,.04], highGuard: .88 } },
    { t: .68, pose: { forward: .026, side: .056, yaw: .32, chest: .12, leftHand: [-.048,.75,.51],
      rightHand: [.077,.80,.14], highGuard: .85 } },
    { t: .84, pose: { forward: .011, yaw: .07, leftHand: [-.090,.78,.15], highGuard: .9 } },
    { t: 1, pose: { highGuard: .83, leftHand: [-.095,.76,.16] } },
  ],
  backfist: [
    { t: 0, pose: { highGuard: .8 } },
    { t: .21, pose: { drop: -.09, side: .055, forward: -.035, yaw: -.76, roll: .11, chest: .18,
      leftHand: [-.08,.81,.14], rightHand: [.14,.72,.06], highGuard: 1 } },
    { t: .39, pose: { drop: -.05, side: -.045, forward: .035, yaw: .28, roll: -.11,
      rightHand: [.10,.76,.28], leftHand: [-.085,.82,.14] } },
    // Preserve the 3D palm strike's hand extension and large hip turn, but
    // prevent simultaneous forward chest fold + lateral waist roll at contact.
    // The former combination placed the neck beyond the approved torso cone
    // in the real TPS WebGL skeleton audit. Hip turn supplies the power; the
    // thorax stays tall enough to distinguish a palm from a diving tackle.
    { t: .50, pose: { forward: .105, drop: -.04, yaw: .99, roll: -.15,
      chest: .105, rightHand: [.34,.79,.64], leftHand: [-.16,.84,.045], highGuard: .80 } },
    { t: .58, pose: { forward: .11, drop: -.045, yaw: 1.02, roll: -.14,
      rightHand: [.40,.76,.60], leftHand: [-.16,.84,.05], highGuard: .75 } },
    { t: .70, pose: { forward: .063, yaw: .68, roll: -.16, rightHand: [.31,.76,.45],
      leftHand: [-.10,.79,.12] } },
    { t: .85, pose: { drop: -.023, yaw: .20, rightHand: [.12,.77,.19],
      leftHand: [-.09,.80,.12] } },
    { t: 1, pose: { highGuard: .84 } },
  ],
  kick: [
    { t: 0, pose: { highGuard: .80 } },
    { t: .19, pose: { drop: -.115, side: -.052, forward: -.036, yaw: -.58,
      pitch: .21, roll: -.10, chest: .20, highGuard: .92,
      rightFoot: [.075,.24,.16], rightHand: [.12,.81,.13], leftHand: [-.10,.79,.12] } },
    { t: .37, pose: { drop: -.092, side: -.093, yaw: -.85, pitch: .31,
      roll: -.25, rightFoot: [.09,.43,.26],
      rightHand: [.17,.79,.10], leftHand: [-.12,.82,.19] } },
    { t: .50, pose: { drop: -.058, side: -.115, forward: .08, yaw: -1.05, pitch: .38,
      roll: -.34, chest: .19, rightFoot: [.16,.61,.68], leftFoot: [-.10,0,.05],
      leftHand: [-.20,.85,.11], rightHand: [.20,.73,-.03] } },
    { t: .58, pose: { drop: -.061, side: -.112, forward: .09, yaw: -1.04, pitch: .36,
      roll: -.30, rightFoot: [.18,.61,.71], leftFoot: [-.10,0,.05],
      leftHand: [-.19,.85,.12], rightHand: [.20,.73,-.02] } },
    { t: .72, pose: { drop: -.066, side: -.075, yaw: -.71, pitch: .23,
      roll: -.20, rightFoot: [.13,.46,.51], leftHand: [-.15,.79,.14] } },
    { t: .81, pose: { drop: -.065, yaw: -.28, pitch: .15, rightFoot: [.065,.22,.22],
      highGuard: .86 } },
    { t: 1, pose: { highGuard: .85 } },
  ],
  risingKick: [
    { t: 0, pose: { highGuard: .80 } },
    { t: .14, pose: { drop: -.13, side: -.065, forward: -.045, yaw: -.49,
      pitch: .26, roll: .1, leftHand: [-.10,.77,.14], rightHand: [.12,.81,.17], highGuard: .85 } },
    { t: .30, pose: { drop: -.15, side: -.085, forward: .035, yaw: -.70,
      pitch: .34, roll: -.18, spin: -Math.PI*.85,
      rightFoot: [.105,.37,.17], leftFoot: [-.11,0,.03],
      leftHand: [-.16,.77,.14], rightHand: [.14,.76,.07] } },
    { t: .42, pose: { drop: -.13, side: -.12, forward: .065, yaw: -.45,
      pitch: .26, roll: -.26, spin: -Math.PI*1.66,
      rightFoot: [.15,.59,.42], leftFoot: [-.12,0,.03],
      leftHand: [-.21,.75,.10], rightHand: [.17,.73,.06] } },
    { t: .50, pose: { drop: -.075, side: -.13, forward: .095,
      yaw: .18, pitch: .29, roll: -.41, spin: -PI2,
      rightFoot: [.15,.82,.68], leftFoot: [-.12,0,.04],
      leftHand: [-.26,.85,.04], rightHand: [.25,.71,-.03] } },
    { t: .58, pose: { drop: -.075, side: -.12, forward: .09, yaw: .21,
      pitch: .31, roll: -.34, spin: -PI2,
      rightFoot: [.18,.79,.64], leftFoot: [-.12,0,.04],
      leftHand: [-.25,.84,.04], rightHand: [.24,.71,-.03] } },
    { t: .68, pose: { drop: -.085, side: -.083, yaw: .15, roll: -.24, spin: -PI2,
      pitch: .19, rightFoot: [.14,.62,.48],
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

/**
 * Per-fighter performance accents are applied once while baking calibrated IK
 * clips, not every animation frame. The first and last guard poses are exactly
 * shared, while the actual contact key stays at phase .50 for every fighter.
 * No additional strikes or combat-frame differences are generated.
 */
export function sampleHeroVideoChoreography(
  move: VideoStrike,
  phase: number,
  width: number,
  fighterName: string,
): VideoBodyPose {
  const original = sampleVideoChoreography(move, phase, width);
  const u = Math.max(0, Math.min(1, Number.isFinite(phase) ? phase : 0));
  const weight = Math.sin(Math.PI * u) ** 4;
  if (weight < 1e-9) return original;

  const hero = fighterName.toUpperCase();
  if (hero === "KAIRO" && (move === "jab" || move === "backfist")) {
    // Grounded heavy weight transfer, rear-hand counterweight and extra torque.
    return {
      ...original,
      drop: (original.drop ?? 0) - weight * .027,
      forward: (original.forward ?? 0) + weight * .027,
      yaw: (original.yaw ?? 0) * (1 + weight * .19),
      // Keep KAIRO's heavy hip/ground drive, but a backfist is not a
      // head-first body blow. Limit its extra thoracic hinge, leaving its
      // authored fist positions and pelvis rotation entirely unchanged.
      chest: (original.chest ?? 0) + weight * (move === "backfist" ? .022 : .058),
    };
  }
  if (hero === "SERA" && (move === "kick" || move === "risingKick")) {
    // Fast, high, flexible kicks: lift the active foot but never the support foot.
    return {
      ...original,
      rightFoot: [
        original.rightFoot![0] + weight * .025,
        original.rightFoot![1] + weight * .045,
        original.rightFoot![2] + weight * .027,
      ],
      side: (original.side ?? 0) - weight * .018,
      roll: (original.roll ?? 0) - weight * .055,
    };
  }
  if (hero === "VANTA" && (move === "backfist" || move === "jab")) {
    // Deceptive lateral rotation, not KAIRO's forward-heavy shoulder drive.
    return {
      ...original,
      side: (original.side ?? 0) - weight * .045,
      yaw: (original.yaw ?? 0) + weight * .19,
      roll: (original.roll ?? 0) - weight * .075,
    };
  }
  if (hero === "AXION" && (move === "kick" || move === "risingKick")) {
    // Massive braced rotation with a restrained high-foot position.
    return {
      ...original,
      drop: (original.drop ?? 0) - weight * .032,
      forward: (original.forward ?? 0) + weight * .045,
      yaw: (original.yaw ?? 0) - weight * .13,
      pitch: (original.pitch ?? 0) + weight * .07,
    };
  }
  return original;
}
