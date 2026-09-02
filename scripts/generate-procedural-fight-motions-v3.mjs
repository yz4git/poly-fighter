import { Accessor, NodeIO } from "@gltf-transform/core";
import { Euler, Quaternion } from "three";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [inputPath, outputPath, metricsPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !metricsPath) {
  throw new Error("usage: node generate-procedural-fight-motions-v2.mjs <source.glb> <output.glb> <metrics.json>");
}

const VERSION = "PROCEDURAL_FIGHT_V3";
// KICK_MOTION_V7: chamber -> extension -> re-chamber with support-foot-safe authored curves.
// PUNCH_MOTION_V8_SOURCE_BASE: BODY/HEAVY reuse proven punch source mechanics before pose-graph shaping.
const DEG = Math.PI / 180;
const R = (x = 0, y = 0, z = 0) => [x * DEG, y * DEG, z * DEG];
const T = (x = 0, y = 0, z = 0) => [x, y, z];
const K = (u, xyz, ease = "smooth") => ({ u, xyz, ease });

const POSE_GRAPH_NODES = [
  "STANCE", "LOAD", "ANTICIPATION_HOLD", "LAUNCH", "PRE_CONTACT",
  "IMPACT", "OVERTRAVEL", "RECOIL", "SETTLE",
];

// Each family gets a deliberately different rhythm. The old generator derived
// every move from impact +/- fixed offsets, which made unrelated attacks share
// the same cadence. V3 treats timing as authored move data.
const MOVE_TIMINGS = {
  JAB:         { load: .10, hold: .16, launch: .26, pre: .48, impact: .61, over: .67, recoil: .76, settle: .88 },
  CROSS:       { load: .12, hold: .21, launch: .32, pre: .55, impact: .68, over: .75, recoil: .84, settle: .93 },
  HOOK:        { load: .14, hold: .27, launch: .38, pre: .54, impact: .64, over: .74, recoil: .84, settle: .94 },
  BODY:        { load: .16, hold: .29, launch: .41, pre: .58, impact: .70, over: .77, recoil: .87, settle: .95 },
  HEAVY:       { load: .17, hold: .34, launch: .47, pre: .63, impact: .73, over: .81, recoil: .90, settle: .97 },
  FRONT_KICK:  { load: .13, hold: .25, launch: .37, pre: .52, impact: .64, over: .72, recoil: .83, settle: .94 },
  LOW_KICK:    { load: .15, hold: .28, launch: .40, pre: .55, impact: .67, over: .76, recoil: .87, settle: .95 },
  RISING_KICK: { load: .17, hold: .30, launch: .42, pre: .58, impact: .69, over: .78, recoil: .88, settle: .96 },
  DASH_KICK:   { load: .08, hold: .16, launch: .27, pre: .49, impact: .66, over: .73, recoil: .82, settle: .92 },
  THROW:       { load: .13, hold: .26, launch: .39, pre: .51, impact: .58, over: .66, recoil: .80, settle: .93 },
  COUNTER:     { load: .06, hold: .12, launch: .22, pre: .42, impact: .55, over: .63, recoil: .75, settle: .88 },
};

const DEFAULT_TIMING = { load: .12, hold: .22, launch: .34, pre: .53, impact: .66, over: .74, recoil: .84, settle: .94 };
const MOTION_DNA = {
  POWER: { id: "KAIRO_POWER", hipLead: 1.18, chestFollow: 1.10, recoil: 1.14, lateral: 0.82, guardDiscipline: 1.00 },
  SPEED: { id: "SERA_SPEED", hipLead: 1.04, chestFollow: 0.94, recoil: 0.82, lateral: 1.22, guardDiscipline: 0.92 },
};

function timingFor(spec) {
  return MOVE_TIMINGS[spec.style] ?? DEFAULT_TIMING;
}


/**
 * Procedural Fight Motion Generator v2
 *
 * V1 proved that deterministic UAL remixing works. V2 adds a reusable motion
 * grammar instead of hand-tuning every key independently: anticipation, drive,
 * impact overtravel, and settle. It also authors additive pelvis translation
 * (center-of-mass compression/drive returning to bind), plus generated guard,
 * evasion, and recovery clips.
 */
const SPECS = [
  { name: "PF_Jab_L", base: "Punch_Jab", family: "punch", style: "JAB", side: -1, power: 0.72, contactU: 0.66, plantFoot: "RIGHT" },
  { name: "PF_Cross_R", base: "Punch_Cross", family: "punch", style: "CROSS", side: 1, power: 0.90, contactU: 0.69, plantFoot: "LEFT" },
  { name: "PF_Backfist_R", base: "Punch_Cross", family: "punch", style: "HOOK", side: 1, power: 0.88, contactU: 0.62, plantFoot: "LEFT" },
  { name: "PF_Backfist_L", base: "Punch_Cross", family: "punch", style: "HOOK", side: -1, power: 0.88, contactU: 0.62, plantFoot: "RIGHT" },
  { name: "PF_BodyBlow_L", base: "Punch_Jab", family: "punch", style: "BODY", side: -1, power: 0.88, contactU: 0.70, plantFoot: "RIGHT" },
  { name: "PF_BodyBlow_R", base: "Punch_Cross", family: "punch", style: "BODY", side: 1, power: 0.88, contactU: 0.70, plantFoot: "LEFT" },
  { name: "PF_Power_R", base: "Punch_Cross", family: "punch", style: "HEAVY", side: 1, power: 1.18, contactU: 0.73, plantFoot: "LEFT" },
  { name: "PF_FrontKick_R", base: "Idle_Loop", family: "kick", style: "FRONT_KICK", side: 1, power: 0.94, contactU: 0.64, plantFoot: "LEFT" },
  { name: "PF_LowKick_L", base: "Idle_Loop", family: "kick", style: "LOW_KICK", side: -1, power: 0.98, contactU: 0.67, plantFoot: "RIGHT" },
  { name: "PF_RisingKick_R", base: "Idle_Loop", family: "kick", style: "RISING_KICK", side: 1, power: 1.10, contactU: 0.69, plantFoot: "LEFT" },
  { name: "PF_DashKick_R", base: "Jump_Start", family: "kick", style: "DASH_KICK", side: 1, power: 1.12, contactU: 0.66, plantFoot: "AIR" },
  { name: "PF_Throw", base: "Idle_Loop", family: "throw", style: "THROW", side: 1, power: 1.00, contactU: 0.58, plantFoot: "BOTH" },
  { name: "PF_Counter_R", base: "Punch_Cross", family: "punch", style: "COUNTER", side: 1, power: 1.00, contactU: 0.55, plantFoot: "LEFT" },
  { name: "PF_Counter_L", base: "Punch_Cross", family: "punch", style: "COUNTER", side: -1, power: 1.00, contactU: 0.55, plantFoot: "RIGHT" },
  { name: "PF_HitHeavy", base: "Hit_Chest", family: "reaction", style: "HIT_HEAVY", side: 1, power: 1.00, contactU: 0.18, plantFoot: "BOTH" },
  { name: "PF_Launch", base: "Hit_Chest", family: "reaction", style: "LAUNCH", side: 1, power: 1.00, contactU: 0.20, plantFoot: "AIR" },
  { name: "PF_DownBack", base: "Death01", family: "reaction", style: "DOWN", side: 1, power: 1.00, contactU: 0.35, plantFoot: "AIR" },
  { name: "PF_Wakeup", base: "Jump_Land", family: "recovery", style: "WAKEUP", side: 1, power: 1.00, contactU: 0.70, plantFoot: "BOTH" },
  { name: "PF_GuardBreak", base: "Hit_Chest", family: "reaction", style: "GUARD_BREAK", side: 1, power: 1.00, contactU: 0.22, plantFoot: "BOTH" },
  { name: "PF_Sidestep_L", base: "Idle_Loop", family: "evasion", style: "SIDESTEP", side: -1, power: 1.00, contactU: 0.50, plantFoot: "RIGHT" },
  { name: "PF_Sidestep_R", base: "Idle_Loop", family: "evasion", style: "SIDESTEP", side: 1, power: 1.00, contactU: 0.50, plantFoot: "LEFT" },
  { name: "PF_KickRecover", base: "Jump_Land", family: "recovery", style: "KICK_RECOVER", side: 1, power: 1.00, contactU: 0.60, plantFoot: "BOTH" },
  { name: "PF_HeavyRecover", base: "Jump_Land", family: "recovery", style: "HEAVY_RECOVER", side: 1, power: 1.00, contactU: 0.62, plantFoot: "BOTH" },
];

function strikeCadence(spec, scale = 1) {
  const p = spec.power * scale;
  const s = spec.side;
  const timing = timingFor(spec);
  return {
    p, s, timing,
    load: timing.load,
    anticipate: timing.hold,
    launch: timing.launch,
    preContact: timing.pre,
    impact: timing.impact,
    overtravel: timing.over,
    recoil: timing.recoil,
    settle: timing.settle,
  };
}

function makeCurves(spec) {
  const { p, s, timing, load, impact, anticipate, launch, preContact, overtravel, recoil, settle } = strikeCadence(spec);
  const bones = {};
  let pelvisMove = [K(0, T()), K(1, T())];

  const torso = (yaw, pitch = 0, roll = 0) => {
    // Pose-first torso chain. LOAD/HOLD stores energy, LAUNCH releases the hips,
    // chest arrives a fraction later, IMPACT is readable, and OVERTRAVEL keeps
    // momentum without folding the waist.
    bones.pelvis = [
      K(0, R()),
      K(load, R(pitch * 0.10 * p, yaw * -0.16 * s * p, roll * -0.10 * s * p), "easeIn"),
      K(anticipate, R(pitch * 0.14 * p, yaw * -0.22 * s * p, roll * -0.14 * s * p), "hold"),
      K(launch, R(pitch * 0.05 * p, yaw * -0.04 * s * p, roll * -0.04 * s * p), "snap"),
      K(preContact, R(pitch * -0.05 * p, yaw * 0.56 * s * p, roll * 0.46 * s * p), "snap"),
      K(impact, R(pitch * -0.08 * p, yaw * 1.00 * s * p, roll * 0.82 * s * p), "snap"),
      K(overtravel, R(pitch * -0.07 * p, yaw * 1.08 * s * p, roll * 0.88 * s * p), "easeOut"),
      K(recoil, R(pitch * -0.03 * p, yaw * 0.64 * s * p, roll * 0.48 * s * p), "easeOut"),
      K(settle, R(pitch * -0.01 * p, yaw * 0.26 * s * p, roll * 0.18 * s * p), "smooth"),
      K(1, R()),
    ];
    bones.spine_02 = [
      K(0, R()),
      K(load, R(pitch * 0.14 * p, yaw * -0.24 * s * p, roll * -0.16 * s * p), "easeIn"),
      K(anticipate, R(pitch * 0.18 * p, yaw * -0.34 * s * p, roll * -0.22 * s * p), "hold"),
      K(launch, R(pitch * 0.07 * p, yaw * -0.08 * s * p, roll * -0.06 * s * p), "snap"),
      K(preContact, R(pitch * -0.08 * p, yaw * 0.76 * s * p, roll * 0.64 * s * p), "snap"),
      K(impact, R(pitch * -0.12 * p, yaw * 1.26 * s * p, roll * 1.00 * s * p), "snap"),
      K(overtravel, R(pitch * -0.10 * p, yaw * 1.36 * s * p, roll * 1.08 * s * p), "easeOut"),
      K(recoil, R(pitch * -0.05 * p, yaw * 0.76 * s * p, roll * 0.56 * s * p), "easeOut"),
      K(settle, R(pitch * -0.02 * p, yaw * 0.30 * s * p, roll * 0.22 * s * p)),
      K(1, R()),
    ];
    bones.spine_03 = [
      K(0, R()),
      K(load, R(pitch * 0.12 * p, yaw * -0.28 * s * p, roll * -0.20 * s * p), "easeIn"),
      K(anticipate, R(pitch * 0.15 * p, yaw * -0.40 * s * p, roll * -0.26 * s * p), "hold"),
      K(launch, R(pitch * 0.06 * p, yaw * -0.12 * s * p, roll * -0.08 * s * p), "snap"),
      K(preContact, R(pitch * -0.10 * p, yaw * 0.90 * s * p, roll * 0.76 * s * p), "snap"),
      K(impact, R(pitch * -0.14 * p, yaw * 1.46 * s * p, roll * 1.18 * s * p), "snap"),
      K(overtravel, R(pitch * -0.12 * p, yaw * 1.58 * s * p, roll * 1.26 * s * p), "easeOut"),
      K(recoil, R(pitch * -0.06 * p, yaw * 0.86 * s * p, roll * 0.64 * s * p), "easeOut"),
      K(settle, R(pitch * -0.02 * p, yaw * 0.34 * s * p, roll * 0.24 * s * p)),
      K(1, R()),
    ];
  };

  const rootDrive = (forward, lateral = 0, down = 0.018, lift = 0) => {
    pelvisMove = [
      K(0, T()),
      K(load, T(-lateral * 0.18 * s, -down * 0.72, -forward * 0.18), "easeIn"),
      K(anticipate, T(-lateral * 0.26 * s, -down, -forward * 0.30), "hold"),
      K(launch, T(-lateral * 0.10 * s, -down * 0.72, -forward * 0.12), "snap"),
      K(preContact, T(lateral * 0.52 * s, lift * 0.36 - down * 0.35, forward * 0.58), "snap"),
      K(impact, T(lateral * s, lift - down * 0.20, forward), "snap"),
      K(overtravel, T(lateral * 1.05 * s, lift * 0.86 - down * 0.18, forward * 1.08), "easeOut"),
      K(recoil, T(lateral * 0.70 * s, lift * 0.48 - down * 0.30, forward * 0.70), "easeOut"),
      K(settle, T(lateral * 0.30 * s, lift * 0.18 - down * 0.12, forward * 0.28)),
      K(1, T()),
    ];
  };

  // Generated support-leg counter motion gives the runtime IK a stable starting
  // configuration. Runtime foot lock is authoritative; this prevents the source
  // clip from trying to lift the named support foot before IK is applied.
  const authorSupportLeg = (suffix) => {
    if (!bones[`thigh_${suffix}`]) bones[`thigh_${suffix}`] = [K(0, R()), K(anticipate, R(4, 0, 0)), K(impact, R(-3, 0, 0)), K(settle, R(1, 0, 0)), K(1, R())];
    if (!bones[`calf_${suffix}`]) bones[`calf_${suffix}`] = [K(0, R()), K(anticipate, R(-7, 0, 0)), K(impact, R(5, 0, 0)), K(settle, R(-2, 0, 0)), K(1, R())];
    if (!bones[`foot_${suffix}`]) bones[`foot_${suffix}`] = [K(0, R()), K(impact, R(2, 0, 0)), K(1, R())];
  };

  switch (spec.style) {
    case "JAB":
      torso(10, 1, -2); rootDrive(0.030, 0.010, 0.012);
      bones.clavicle_l = [K(0, R()), K(anticipate, R(0, 0, -10)), K(impact, R(0, 0, 15)), K(settle, R(0, 0, 7)), K(1, R())];
      bones.upperarm_l = [K(0, R()), K(anticipate, R(10, -9, -11)), K(impact, R(-14, 16, 10)), K(settle, R(-6, 7, 4)), K(1, R())];
      break;
    case "CROSS":
      torso(18, 1, 2); rootDrive(0.050, 0.018, 0.014);
      bones.spine_01 = bones.pelvis;
      bones.clavicle_r = [K(0, R()), K(anticipate, R(0, 0, 12)), K(impact, R(0, 0, -18)), K(settle, R(0, 0, -8)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(11, 11, 13)), K(impact, R(-17, -21, -13)), K(settle, R(-7, -9, -6)), K(1, R())];
      break;
    case "HOOK": {
      const arm = s < 0 ? "l" : "r";
      torso(17, 0, 2); rootDrive(0.040, -0.010, 0.012);
      bones.spine_01 = bones.pelvis;
      bones[`upperarm_${arm}`] = [K(0, R()), K(anticipate, R(9, -9 * s, 15 * s)), K(impact, R(-14, 19 * s, -14 * s)), K(settle, R(-6, 8 * s, -6 * s)), K(1, R())];
      bones[`lowerarm_${arm}`] = [K(0, R()), K(anticipate, R(0, 16 * s, 7 * s)), K(impact, R(0, -24 * s, -6 * s)), K(settle, R(0, -8 * s, -2 * s)), K(1, R())];
      break;
    }
    case "BODY": {
      const arm = s < 0 ? "l" : "r";
      torso(13, 2, -2); rootDrive(0.050, 0.012, 0.018);
      bones.spine_01 = bones.pelvis;
      bones[`clavicle_${arm}`] = [K(0, R()), K(anticipate, R(0, 0, 8 * s)), K(impact, R(0, 0, -13 * s)), K(1, R())];
      bones[`upperarm_${arm}`] = [K(0, R()), K(anticipate, R(11, 9 * s, 10 * s)), K(impact, R(-16, -15 * s, -10 * s)), K(settle, R(-6, -6 * s, -4 * s)), K(1, R())];
      break;
    }
    case "HEAVY":
      torso(24, 0, 2); rootDrive(0.082, 0.016, 0.016);
      bones.spine_01 = bones.pelvis;
      bones.neck_01 = [K(0, R()), K(anticipate, R(0, -3 * s, 0)), K(impact, R(1, 5 * s, 0)), K(1, R())];
      bones.clavicle_r = [K(0, R()), K(anticipate, R(0, 0, 11)), K(impact, R(0, 0, -16)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(12, 11, 12)), K(impact, R(-18, -21, -12)), K(settle, R(-7, -9, -5)), K(1, R())];
      bones.lowerarm_r = [K(0, R()), K(anticipate, R(0, 8, 5)), K(impact, R(0, -12, -4)), K(settle, R(0, -5, -2)), K(1, R())];
      break;
    case "COUNTER": {
      const arm = s < 0 ? "l" : "r";
      torso(14, 0, 1); rootDrive(0.048, 0.010, 0.014);
      bones[`clavicle_${arm}`] = [K(0, R()), K(anticipate, R(0, 0, 10 * s)), K(impact, R(0, 0, -15 * s)), K(1, R())];
      bones[`upperarm_${arm}`] = [K(0, R()), K(anticipate, R(10, 9 * s, 12 * s)), K(impact, R(-16, -18 * s, -11 * s)), K(settle, R(-6, -7 * s, -4 * s)), K(1, R())];
      break;
    }
    case "THROW":
      torso(18, 2, 0); rootDrive(0.046, 0, 0.016);
      bones.upperarm_l = [K(0, R()), K(anticipate, R(-12, 18, -20)), K(impact, R(-28, 6, -10)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(-12, -18, 20)), K(impact, R(-28, -6, 10)), K(1, R())];
      bones.lowerarm_l = [K(0, R()), K(anticipate, R(0, 15, 18)), K(impact, R(0, 4, 8)), K(1, R())];
      bones.lowerarm_r = [K(0, R()), K(anticipate, R(0, -15, -18)), K(impact, R(0, -4, -8)), K(1, R())];
      break;
    case "FRONT_KICK":
    case "RISING_KICK":
    case "DASH_KICK": {
      const rising = spec.style === "RISING_KICK";
      const dash = spec.style === "DASH_KICK";
      const chamber = Math.max(launch + 0.05, preContact - 0.04);
      const reChamber = Math.min(settle - 0.08, overtravel + 0.09);
      // Keep the planted leg out of the authored curves. Runtime Foot Lock remains
      // the final solve, while the strike leg now reads as chamber -> extension -> recoil.
      torso(4, rising ? -11 : dash ? -7 : -9, rising ? -1 : -2);
      rootDrive(dash ? 0.068 : rising ? 0.028 : 0.040, 0, dash ? 0.012 : 0.028, rising ? 0.014 : dash ? 0.024 : 0.004);
      bones.thigh_r = [
        K(0, R()),
        K(anticipate, R(20, 0, 0), "hold"),
        K(launch, R(-8, 0, 0), "snap"),
        K(chamber, R(rising ? -48 : dash ? -42 : -40, 0, 0), "easeIn"),
        K(impact, R(rising ? -116 : dash ? -94 : -86, 0, 0), "snap"),
        K(overtravel, R(rising ? -120 : dash ? -98 : -90, 0, 0), "easeOut"),
        K(reChamber, R(rising ? -54 : dash ? -48 : -46, 0, 0), "snap"),
        K(settle, R(-18, 0, 0), "easeOut"),
        K(1, R()),
      ];
      bones.calf_r = [
        K(0, R()),
        K(launch, R(18, 0, 0), "easeIn"),
        K(chamber, R(rising ? 74 : dash ? 68 : 70, 0, 0), "snap"),
        K(impact, R(rising ? 3 : 2, 0, 0), "snap"),
        K(overtravel, R(0, 0, 0), "easeOut"),
        K(reChamber, R(rising ? 74 : dash ? 70 : 72, 0, 0), "snap"),
        K(settle, R(26, 0, 0), "easeOut"),
        K(1, R()),
      ];
      bones.foot_r = [
        K(0, R()),
        K(chamber, R(-6, 0, 0), "easeIn"),
        K(impact, R(rising ? 22 : 12, 0, 0), "snap"),
        K(overtravel, R(rising ? 24 : 14, 0, 0), "easeOut"),
        K(reChamber, R(-4, 0, 0), "snap"),
        K(1, R()),
      ];
      bones.upperarm_l = [K(0, R()), K(anticipate, R(-10, 16, -14)), K(chamber, R(-18, 24, -28)), K(impact, R(-30, 30, -40)), K(reChamber, R(-14, 16, -18)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(-10, -16, 14)), K(chamber, R(-18, -24, 28)), K(impact, R(-30, -30, 40)), K(reChamber, R(-14, -16, 18)), K(1, R())];
      bones.lowerarm_l = [K(0, R()), K(chamber, R(0, 10, 16)), K(impact, R(0, 5, 10)), K(reChamber, R(0, 12, 18)), K(1, R())];
      bones.lowerarm_r = [K(0, R()), K(chamber, R(0, -10, -16)), K(impact, R(0, -5, -10)), K(reChamber, R(0, -12, -18)), K(1, R())];
      if (dash) {
        bones.thigh_l = [K(0, R()), K(launch, R(10, 0, 0)), K(impact, R(22, 0, 0)), K(reChamber, R(12, 0, 0)), K(1, R())];
        bones.calf_l = [K(0, R()), K(launch, R(-12, 0, 0)), K(impact, R(-30, 0, 0)), K(reChamber, R(-16, 0, 0)), K(1, R())];
      }
      break;
    }
    case "LOW_KICK": {
      const chamber = Math.max(launch + 0.05, preContact - 0.03);
      const reChamber = Math.min(settle - 0.08, overtravel + 0.09);
      // The right support leg is intentionally untouched. Hip rotation, strike-leg
      // chamber/extension and arm counterbalance create the power without foot drift.
      // LOW_KICK_V7_4_UPRIGHT: keep the hip turn, but stop cumulative pelvis/spine
      // roll from folding the torso toward the striking leg. A smaller lateral
      // root shift keeps the head over the support side while the leg still arcs low.
      torso(22, 0, 2);
      rootDrive(0.030, 0.012, 0.022);
      bones.thigh_l = [
        K(0, R()),
        K(anticipate, R(18, -10, -2), "hold"),
        K(launch, R(4, -4, 0), "snap"),
        K(chamber, R(-22, 20, -8), "easeIn"),
        K(impact, R(-62, 44, -14), "snap"),
        K(overtravel, R(-66, 47, -16), "easeOut"),
        K(reChamber, R(-28, 22, -9), "snap"),
        K(settle, R(-12, 8, -3), "easeOut"),
        K(1, R()),
      ];
      bones.calf_l = [
        K(0, R()),
        K(launch, R(18, 0, 0), "easeIn"),
        K(chamber, R(66, 0, 0), "snap"),
        K(impact, R(4, 0, 0), "snap"),
        K(overtravel, R(2, 0, 0), "easeOut"),
        K(reChamber, R(64, 0, 0), "snap"),
        K(settle, R(28, 0, 0), "easeOut"),
        K(1, R()),
      ];
      bones.foot_l = [K(0, R()), K(chamber, R(-5, 8, -4)), K(impact, R(2, 18, -12), "snap"), K(overtravel, R(4, 20, -14)), K(reChamber, R(-4, 8, -4), "snap"), K(1, R())];
      bones.upperarm_l = [K(0, R()), K(chamber, R(-14, -18, 22)), K(impact, R(-26, -30, 38)), K(reChamber, R(-12, -14, 18)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(chamber, R(-14, 18, -22)), K(impact, R(-26, 30, -38)), K(reChamber, R(-12, 14, -18)), K(1, R())];
      bones.lowerarm_l = [K(0, R()), K(chamber, R(0, -8, -14)), K(impact, R(0, -4, -8)), K(reChamber, R(0, -10, -16)), K(1, R())];
      bones.lowerarm_r = [K(0, R()), K(chamber, R(0, 8, 14)), K(impact, R(0, 4, 8)), K(reChamber, R(0, 10, 16)), K(1, R())];
      break;
    }
    case "HIT_HEAVY":
      bones.pelvis = [K(0, R()), K(0.18, R(-7, 9, 0)), K(0.48, R(9, -5, 0)), K(1, R())];
      bones.spine_01 = [K(0, R()), K(0.18, R(-11, 0, 0)), K(0.48, R(9, 0, 0)), K(1, R())];
      bones.spine_02 = [K(0, R()), K(0.18, R(-18, 4, 0)), K(0.48, R(13, -3, 0)), K(1, R())];
      bones.spine_03 = [K(0, R()), K(0.18, R(-25, 7, 0)), K(0.48, R(16, -4, 0)), K(1, R())];
      bones.neck_01 = [K(0, R()), K(0.18, R(-14, -5, 0)), K(0.48, R(8, 3, 0)), K(1, R())];
      pelvisMove = [K(0, T()), K(0.18, T(0, 0.006, -0.030)), K(0.48, T(0, -0.018, -0.015)), K(1, T())];
      break;
    case "LAUNCH":
      bones.pelvis = [K(0, R()), K(0.20, R(-13, 5, 0)), K(0.52, R(-22, 8, 0)), K(1, R(-8, 2, 0))];
      bones.spine_01 = [K(0, R()), K(0.20, R(-16, 0, 0)), K(0.52, R(-25, 0, 0)), K(1, R(-8, 0, 0))];
      bones.spine_02 = [K(0, R()), K(0.20, R(-22, 0, 0)), K(0.52, R(-34, 0, 0)), K(1, R(-10, 0, 0))];
      bones.spine_03 = [K(0, R()), K(0.20, R(-28, 0, 0)), K(0.52, R(-42, 0, 0)), K(1, R(-12, 0, 0))];
      bones.thigh_l = [K(0, R()), K(0.52, R(18, 0, 0)), K(1, R(6, 0, 0))];
      bones.thigh_r = [K(0, R()), K(0.52, R(15, 0, 0)), K(1, R(5, 0, 0))];
      pelvisMove = [K(0, T()), K(0.20, T(0, 0.035, -0.010)), K(0.52, T(0, 0.070, -0.022)), K(1, T())];
      break;
    case "DOWN":
      bones.pelvis = [K(0, R()), K(0.35, R(-10, 5, 0)), K(0.68, R(-22, 8, 0)), K(0.84, R(-28, 10, 0)), K(1, R(-18, 4, 0))];
      bones.spine_02 = [K(0, R()), K(0.52, R(-18, 0, 0)), K(0.84, R(-30, 0, 0)), K(1, R(-20, 0, 0))];
      bones.spine_03 = [K(0, R()), K(0.52, R(-25, 0, 0)), K(0.84, R(-38, 0, 0)), K(1, R(-25, 0, 0))];
      pelvisMove = [K(0, T()), K(0.35, T(0, 0.012, -0.025)), K(0.68, T(0, -0.025, -0.040)), K(1, T())];
      break;
    case "WAKEUP":
      bones.pelvis = [K(0, R(16, 0, 0)), K(0.28, R(20, 0, 0)), K(0.55, R(8, 0, 0)), K(0.78, R(-4, 0, 0)), K(1, R())];
      bones.spine_01 = [K(0, R(20, 0, 0)), K(0.35, R(15, 0, 0)), K(0.68, R(4, 0, 0)), K(1, R())];
      bones.spine_02 = [K(0, R(26, 0, 0)), K(0.35, R(19, 0, 0)), K(0.68, R(5, 0, 0)), K(1, R())];
      bones.spine_03 = [K(0, R(31, 0, 0)), K(0.35, R(22, 0, 0)), K(0.68, R(6, 0, 0)), K(1, R())];
      pelvisMove = [K(0, T(0, -0.035, 0)), K(0.34, T(0, -0.022, 0.006)), K(0.70, T(0, 0.004, 0.010)), K(1, T())];
      break;
    case "GUARD_BREAK":
      bones.pelvis = [K(0, R()), K(0.22, R(6, 7, 0)), K(0.55, R(11, -5, 0)), K(1, R())];
      bones.spine_02 = [K(0, R()), K(0.22, R(12, 0, 0)), K(0.55, R(18, 0, 0)), K(1, R())];
      bones.spine_03 = [K(0, R()), K(0.22, R(18, 0, 0)), K(0.55, R(26, 0, 0)), K(1, R())];
      bones.upperarm_l = [K(0, R()), K(0.22, R(10, 0, -16)), K(0.55, R(20, 0, -22)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(0.22, R(10, 0, 16)), K(0.55, R(20, 0, 22)), K(1, R())];
      pelvisMove = [K(0, T()), K(0.22, T(0, -0.015, -0.018)), K(0.55, T(0, -0.028, -0.010)), K(1, T())];
      break;
    case "SIDESTEP":
      bones.pelvis = [K(0, R()), K(0.22, R(2, 0, 8 * s)), K(0.50, R(0, 0, 14 * s)), K(0.76, R(0, 0, 6 * s)), K(1, R())];
      bones.spine_02 = [K(0, R()), K(0.50, R(0, 5 * s, -10 * s)), K(1, R())];
      bones.spine_03 = [K(0, R()), K(0.50, R(0, 7 * s, -14 * s)), K(1, R())];
      bones.thigh_l = [K(0, R()), K(0.28, R(s < 0 ? 10 : -8, 0, -7 * s)), K(0.50, R(s < 0 ? -14 : 12, 0, 8 * s)), K(1, R())];
      bones.thigh_r = [K(0, R()), K(0.28, R(s < 0 ? -8 : 10, 0, 5 * s)), K(0.50, R(s < 0 ? 12 : -14, 0, -6 * s)), K(1, R())];
      pelvisMove = [K(0, T()), K(0.22, T(0.025 * s, -0.018, 0)), K(0.50, T(0.075 * s, -0.010, 0)), K(0.76, T(0.030 * s, -0.006, 0)), K(1, T())];
      break;
    case "KICK_RECOVER":
    case "HEAVY_RECOVER": {
      const heavy = spec.style === "HEAVY_RECOVER";
      // FULL_BODY_BALANCE_V3: recovery carries momentum without folding at the waist.
      bones.pelvis = [K(0, R(-2, heavy ? -7 : 0, 0)), K(0.30, R(heavy ? 5 : 4, heavy ? 4 : 0, 0)), K(0.62, R(2, heavy ? 1 : 0, 0)), K(1, R())];
      bones.spine_02 = [K(0, R(heavy ? -5 : -4, heavy ? -8 : 0, 0)), K(0.30, R(heavy ? 6 : 5, heavy ? 5 : 0, 0)), K(0.62, R(2, heavy ? 1 : 0, 0)), K(1, R())];
      bones.spine_03 = [K(0, R(heavy ? -7 : -6, heavy ? -10 : 0, 0)), K(0.30, R(heavy ? 7 : 6, heavy ? 6 : 0, 0)), K(0.62, R(3, heavy ? 2 : 0, 0)), K(1, R())];
      bones.thigh_l = [K(0, R(-8, 0, 0)), K(0.30, R(9, 0, 0)), K(1, R())];
      bones.thigh_r = [K(0, R(-12, 0, 0)), K(0.30, R(11, 0, 0)), K(1, R())];
      pelvisMove = [K(0, T(0, heavy ? -0.012 : 0.010, heavy ? 0.022 : 0.016)), K(0.30, T(0, -0.034, 0.006)), K(0.62, T(0, -0.016, 0)), K(1, T())];
      break;
    }
  }

  if (spec.plantFoot === "LEFT" || spec.plantFoot === "BOTH") authorSupportLeg("l");
  if (spec.plantFoot === "RIGHT" || spec.plantFoot === "BOTH") authorSupportLeg("r");

  return { bones, translation: { pelvis: pelvisMove }, timing, poseGraph: POSE_GRAPH_NODES };
}

const io = new NodeIO();
const document = await io.read(inputPath);
const root = document.getRoot();
const buffer = root.listBuffers()[0] ?? document.createBuffer("procedural-motion-v2-buffer");
const nodes = new Map(root.listNodes().filter((node) => node.getName()).map((node) => [node.getName(), node]));
const animations = new Map(root.listAnimations().filter((animation) => animation.getName()).map((animation) => [animation.getName(), animation]));

for (const required of ["pelvis", "spine_02", "spine_03", "upperarm_l", "upperarm_r", "thigh_l", "thigh_r"]) {
  if (!nodes.has(required)) throw new Error(`Required UAL bone missing: ${required}`);
}
for (const spec of SPECS) if (!animations.has(spec.base)) throw new Error(`Required base clip missing for ${spec.name}: ${spec.base}`);

function sampleCurve(keys, u) {
  if (!keys?.length) return [0, 0, 0];
  if (u <= keys[0].u) return keys[0].xyz;
  if (u >= keys[keys.length - 1].u) return keys[keys.length - 1].xyz;
  for (let i = 1; i < keys.length; i += 1) {
    const right = keys[i];
    const left = keys[i - 1];
    if (u <= right.u) {
      const t = (u - left.u) / Math.max(1e-6, right.u - left.u);
      const mode = right.ease ?? left.ease ?? "smooth";
      const shaped = mode === "hold" ? (t < 0.82 ? 0 : ((t - 0.82) / 0.18) ** 2)
        : mode === "snap" ? 1 - (1 - t) ** 4
        : mode === "easeIn" ? t ** 3
        : mode === "easeOut" ? 1 - (1 - t) ** 3
        : t * t * (3 - 2 * t);
      return left.xyz.map((value, axis) => value + (right.xyz[axis] - value) * shaped);
    }
  }
  return [0, 0, 0];
}

function maxTime(animation) {
  let duration = 0;
  for (const channel of animation.listChannels()) {
    const input = channel.getSampler()?.getInput()?.getArray();
    if (input?.length) duration = Math.max(duration, input[input.length - 1]);
  }
  return Math.max(duration, 1 / 30);
}

function cloneAccessor(array, type, name) {
  return document.createAccessor(name).setType(type).setArray(new Float32Array(array)).setBuffer(buffer);
}

function buildMotion(spec) {
  const base = animations.get(spec.base);
  const duration = maxTime(base);
  const animation = document.createAnimation(spec.name);
  const curves = makeCurves(spec);
  const modifiedPaths = new Set();
  let maxPlanarRootShift = 0;
  let maxVerticalRootShift = 0;

  for (const channel of base.listChannels()) {
    const sourceSampler = channel.getSampler();
    const sourceInput = sourceSampler?.getInput();
    const sourceOutput = sourceSampler?.getOutput();
    const targetNode = channel.getTargetNode();
    const targetPath = channel.getTargetPath();
    if (!sourceSampler || !sourceInput || !sourceOutput || !targetNode || !targetPath) continue;
    const times = sourceInput.getArray();
    const values = sourceOutput.getArray();
    if (!times || !values) continue;

    const copied = new Float32Array(values);
    const boneName = targetNode.getName();
    const rotationCurve = curves.bones[boneName];
    const translationCurve = curves.translation[boneName];

    if (targetPath === "rotation" && rotationCurve && copied.length % 4 === 0) {
      modifiedPaths.add(`${boneName}:rotation`);
      const q = new Quaternion();
      const delta = new Quaternion();
      const euler = new Euler();
      for (let sample = 0; sample < times.length; sample += 1) {
        const offset = sample * 4;
        const xyz = sampleCurve(rotationCurve, times[sample] / duration);
        q.fromArray(copied, offset).normalize();
        euler.set(xyz[0], xyz[1], xyz[2], "XYZ");
        delta.setFromEuler(euler);
        q.multiply(delta).normalize().toArray(copied, offset);
      }
    }

    if (targetPath === "translation" && translationCurve && copied.length % 3 === 0) {
      modifiedPaths.add(`${boneName}:translation`);
      for (let sample = 0; sample < times.length; sample += 1) {
        const offset = sample * 3;
        const xyz = sampleCurve(translationCurve, times[sample] / duration);
        copied[offset] += xyz[0]; copied[offset + 1] += xyz[1]; copied[offset + 2] += xyz[2];
        maxPlanarRootShift = Math.max(maxPlanarRootShift, Math.hypot(xyz[0], xyz[2]));
        maxVerticalRootShift = Math.max(maxVerticalRootShift, Math.abs(xyz[1]));
      }
    }

    const input = cloneAccessor(times, Accessor.Type.SCALAR, `${spec.name}-${boneName || "node"}-time`);
    const output = cloneAccessor(copied, sourceOutput.getType(), `${spec.name}-${boneName || "node"}-${targetPath}`);
    const sampler = document.createAnimationSampler(`${spec.name}-${boneName || "node"}-${targetPath}-sampler`).setInput(input).setOutput(output).setInterpolation(sourceSampler.getInterpolation());
    const nextChannel = document.createAnimationChannel(`${spec.name}-${boneName || "node"}-${targetPath}-channel`).setTargetNode(targetNode).setTargetPath(targetPath).setSampler(sampler);
    animation.addSampler(sampler).addChannel(nextChannel);
  }

  const requiredPaths = [
    ...Object.keys(curves.bones).map((bone) => `${bone}:rotation`),
    ...Object.keys(curves.translation).map((bone) => `${bone}:translation`),
  ];
  const missingAnimated = requiredPaths.filter((entry) => !modifiedPaths.has(entry));
  const modifiedBones = [...new Set([...modifiedPaths].map((entry) => entry.split(":")[0]))].sort();
  return {
    name: spec.name, base: spec.base, family: spec.family, style: spec.style,
    contactU: timingFor(spec).impact, plantFoot: spec.plantFoot, duration,
    poseGraphNodes: POSE_GRAPH_NODES, timingProfile: timingFor(spec),
    channels: animation.listChannels().length, modifiedBones,
    modifiedPaths: [...modifiedPaths].sort(), missingAnimated,
    maxPlanarRootShift: Number(maxPlanarRootShift.toFixed(5)),
    maxVerticalRootShift: Number(maxVerticalRootShift.toFixed(5)),
  };
}

const metrics = SPECS.map(buildMotion);
for (const animation of [...root.listAnimations()]) if (!animation.getName().startsWith("PF_")) animation.dispose();
for (const mesh of [...root.listMeshes()]) mesh.dispose();
for (const skin of [...root.listSkins()]) skin.dispose();
for (const material of [...root.listMaterials()]) material.dispose();
for (const texture of [...root.listTextures()]) texture.dispose();

await mkdir(path.dirname(outputPath), { recursive: true });
await io.write(outputPath, document);
const report = {
  version: VERSION,
  source: inputPath,
  output: outputPath,
  generatedClipCount: root.listAnimations().length,
  clips: root.listAnimations().map((animation) => animation.getName()).sort(),
  rootMotionPolicy: "POSE_GRAPH_COM_WITH_RUNTIME_FOOT_LOCK",
  timingPolicy: "MOVE_SPECIFIC_9_POSE_TIMING",
  poseGraph: POSE_GRAPH_NODES,
  motionDna: MOTION_DNA,
  metrics,
  meshes: root.listMeshes().length,
  skins: root.listSkins().length,
};
await mkdir(path.dirname(metricsPath), { recursive: true });
await writeFile(metricsPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
