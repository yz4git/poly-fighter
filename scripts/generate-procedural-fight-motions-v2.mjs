import { Accessor, NodeIO } from "@gltf-transform/core";
import { Euler, Quaternion } from "three";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [inputPath, outputPath, metricsPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !metricsPath) {
  throw new Error("usage: node generate-procedural-fight-motions-v2.mjs <source.glb> <output.glb> <metrics.json>");
}

const VERSION = "PROCEDURAL_FIGHT_V2";
const DEG = Math.PI / 180;
const R = (x = 0, y = 0, z = 0) => [x * DEG, y * DEG, z * DEG];
const T = (x = 0, y = 0, z = 0) => [x, y, z];
const K = (u, xyz) => ({ u, xyz });
const S = (v, n = 1) => v * n;

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
  { name: "PF_Backfist_R", base: "Punch_Cross", family: "punch", style: "HOOK", side: 1, power: 0.92, contactU: 0.62, plantFoot: "LEFT" },
  { name: "PF_BodyBlow_L", base: "Punch_Jab", family: "punch", style: "BODY", side: -1, power: 0.88, contactU: 0.70, plantFoot: "RIGHT" },
  { name: "PF_Power_R", base: "Punch_Cross", family: "punch", style: "HEAVY", side: 1, power: 1.18, contactU: 0.73, plantFoot: "LEFT" },
  { name: "PF_FrontKick_R", base: "Idle_Loop", family: "kick", style: "FRONT_KICK", side: 1, power: 0.94, contactU: 0.64, plantFoot: "LEFT" },
  { name: "PF_LowKick_L", base: "Idle_Loop", family: "kick", style: "LOW_KICK", side: -1, power: 0.98, contactU: 0.67, plantFoot: "RIGHT" },
  { name: "PF_RisingKick_R", base: "Idle_Loop", family: "kick", style: "RISING_KICK", side: 1, power: 1.10, contactU: 0.69, plantFoot: "LEFT" },
  { name: "PF_DashKick_R", base: "Jump_Start", family: "kick", style: "DASH_KICK", side: 1, power: 1.12, contactU: 0.66, plantFoot: "AIR" },
  { name: "PF_Throw", base: "Punch_Cross", family: "throw", style: "THROW", side: 1, power: 1.00, contactU: 0.58, plantFoot: "BOTH" },
  { name: "PF_Counter_R", base: "Punch_Cross", family: "punch", style: "COUNTER", side: 1, power: 1.04, contactU: 0.55, plantFoot: "LEFT" },
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
  const impact = spec.contactU;
  const anticipate = Math.max(0.18, impact - 0.34);
  const settle = Math.min(0.90, impact + 0.13);
  return { p, s, impact, anticipate, settle };
}

function makeCurves(spec) {
  const { p, s, impact, anticipate, settle } = strikeCadence(spec);
  const bones = {};
  let pelvisMove = [K(0, T()), K(1, T())];

  const torso = (yaw, pitch = 0, roll = 0) => {
    bones.pelvis = [K(0, R()), K(anticipate, R(pitch * 0.35 * p, yaw * -0.55 * s * p, roll * -0.35 * s * p)), K(impact, R(pitch * -0.28 * p, yaw * s * p, roll * s * p)), K(settle, R(pitch * -0.10 * p, yaw * 0.38 * s * p, roll * 0.28 * s * p)), K(1, R())];
    bones.spine_02 = [K(0, R()), K(anticipate, R(pitch * 0.55 * p, yaw * -0.80 * s * p, roll * -0.55 * s * p)), K(impact, R(pitch * -0.52 * p, yaw * 1.35 * s * p, roll * 1.25 * s * p)), K(settle, R(pitch * -0.18 * p, yaw * 0.48 * s * p, roll * 0.42 * s * p)), K(1, R())];
    bones.spine_03 = [K(0, R()), K(anticipate, R(pitch * 0.45 * p, yaw * -0.95 * s * p, roll * -0.70 * s * p)), K(impact, R(pitch * -0.68 * p, yaw * 1.60 * s * p, roll * 1.55 * s * p)), K(settle, R(pitch * -0.24 * p, yaw * 0.55 * s * p, roll * 0.50 * s * p)), K(1, R())];
  };

  const rootDrive = (forward, lateral = 0, down = 0.018, lift = 0) => {
    pelvisMove = [
      K(0, T()),
      K(anticipate, T(-lateral * 0.25 * s, -down, -forward * 0.30)),
      K(impact, T(lateral * s, lift - down * 0.20, forward)),
      K(settle, T(lateral * 0.42 * s, lift * 0.25, forward * 0.42)),
      K(1, T()),
    ];
  };

  switch (spec.style) {
    case "JAB":
      torso(10, 3, -2); rootDrive(0.030, 0.010, 0.012);
      bones.clavicle_l = [K(0, R()), K(anticipate, R(0, 0, -10)), K(impact, R(0, 0, 15)), K(settle, R(0, 0, 7)), K(1, R())];
      bones.upperarm_l = [K(0, R()), K(anticipate, R(10, -9, -11)), K(impact, R(-14, 16, 10)), K(settle, R(-6, 7, 4)), K(1, R())];
      break;
    case "CROSS":
      torso(18, 4, 2); rootDrive(0.050, 0.018, 0.014);
      bones.spine_01 = bones.pelvis;
      bones.clavicle_r = [K(0, R()), K(anticipate, R(0, 0, 12)), K(impact, R(0, 0, -18)), K(settle, R(0, 0, -8)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(11, 11, 13)), K(impact, R(-17, -21, -13)), K(settle, R(-7, -9, -6)), K(1, R())];
      break;
    case "HOOK":
      torso(24, 2, 5); rootDrive(0.028, -0.016, 0.014);
      bones.spine_01 = bones.pelvis;
      bones.upperarm_r = [K(0, R()), K(anticipate, R(12, -12, 22)), K(impact, R(-21, 28, -25)), K(settle, R(-8, 11, -10)), K(1, R())];
      bones.lowerarm_r = [K(0, R()), K(anticipate, R(0, 22, 11)), K(impact, R(0, -36, -9)), K(1, R())];
      break;
    case "BODY":
      torso(14, 14, -4); rootDrive(0.040, 0.012, 0.028);
      bones.spine_01 = bones.pelvis;
      bones.clavicle_l = [K(0, R()), K(anticipate, R(0, 0, -8)), K(impact, R(0, 0, 13)), K(1, R())];
      bones.upperarm_l = [K(0, R()), K(anticipate, R(13, -9, -12)), K(impact, R(-18, 17, 11)), K(1, R())];
      break;
    case "HEAVY":
      torso(28, 12, 6); rootDrive(0.070, 0.026, 0.032);
      bones.spine_01 = bones.pelvis;
      bones.neck_01 = [K(0, R()), K(anticipate, R(0, -5 * s, 0)), K(impact, R(1, 9 * s, 0)), K(1, R())];
      bones.clavicle_r = [K(0, R()), K(anticipate, R(0, 0, 15)), K(impact, R(0, 0, -22)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(16, 15, 17)), K(impact, R(-24, -29, -17)), K(settle, R(-10, -12, -7)), K(1, R())];
      break;
    case "COUNTER":
      torso(22, 3, 4); rootDrive(0.045, 0.020, 0.018);
      bones.clavicle_r = [K(0, R()), K(anticipate, R(0, 0, 13)), K(impact, R(0, 0, -19)), K(1, R())];
      bones.upperarm_r = [K(0, R()), K(anticipate, R(13, 11, 16)), K(impact, R(-19, -23, -15)), K(1, R())];
      break;
    case "THROW":
      torso(16, 15, 0); rootDrive(0.046, 0, 0.028);
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
      torso(6, rising ? -15 : dash ? -18 : -11, -2);
      rootDrive(dash ? 0.075 : rising ? 0.030 : 0.045, 0, dash ? 0.018 : 0.040, rising ? 0.022 : dash ? 0.034 : 0.006);
      bones.thigh_r = [K(0, R()), K(anticipate, R(24, 0, 0)), K(Math.max(anticipate + 0.08, impact - 0.18), R(-30, 0, 0)), K(impact, R(rising ? -104 : dash ? -84 : -74, 0, 0)), K(settle, R(-38, 0, 0)), K(1, R())];
      bones.calf_r = [K(0, R()), K(Math.max(anticipate + 0.08, impact - 0.18), R(56, 0, 0)), K(impact, R(rising ? 2 : 7, 0, 0)), K(settle, R(28, 0, 0)), K(1, R())];
      bones.foot_r = [K(0, R()), K(impact, R(rising ? 18 : 10, 0, 0)), K(1, R())];
      if (dash) {
        bones.thigh_l = [K(0, R()), K(impact, R(14, 0, 0)), K(1, R())];
        bones.calf_l = [K(0, R()), K(impact, R(-20, 0, 0)), K(1, R())];
      }
      break;
    }
    case "LOW_KICK":
      torso(21, 4, 8); rootDrive(0.032, 0.022, 0.045);
      bones.thigh_r = [K(0, R()), K(impact, R(-12, 0, 0)), K(1, R())];
      bones.thigh_l = [K(0, R()), K(anticipate, R(18, -8, 0)), K(Math.max(anticipate + 0.08, impact - 0.17), R(-14, 15, -5)), K(impact, R(-50, 34, -11)), K(settle, R(-20, 12, -4)), K(1, R())];
      bones.calf_l = [K(0, R()), K(Math.max(anticipate + 0.08, impact - 0.17), R(50, 0, 0)), K(impact, R(12, 0, 0)), K(settle, R(28, 0, 0)), K(1, R())];
      bones.foot_l = [K(0, R()), K(impact, R(0, 14, -8)), K(1, R())];
      break;
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
      bones.pelvis = [K(0, R(-6, heavy ? -10 : 0, 0)), K(0.30, R(heavy ? 10 : 8, heavy ? 6 : 0, 0)), K(0.62, R(3, heavy ? 2 : 0, 0)), K(1, R())];
      bones.spine_02 = [K(0, R(heavy ? -12 : -10, heavy ? -12 : 0, 0)), K(0.30, R(heavy ? 12 : 9, heavy ? 7 : 0, 0)), K(0.62, R(4, heavy ? 2 : 0, 0)), K(1, R())];
      bones.spine_03 = [K(0, R(heavy ? -17 : -15, heavy ? -15 : 0, 0)), K(0.30, R(heavy ? 15 : 12, heavy ? 9 : 0, 0)), K(0.62, R(5, heavy ? 3 : 0, 0)), K(1, R())];
      bones.thigh_l = [K(0, R(-8, 0, 0)), K(0.30, R(9, 0, 0)), K(1, R())];
      bones.thigh_r = [K(0, R(-12, 0, 0)), K(0.30, R(11, 0, 0)), K(1, R())];
      pelvisMove = [K(0, T(0, heavy ? -0.012 : 0.010, heavy ? 0.022 : 0.016)), K(0.30, T(0, -0.034, 0.006)), K(0.62, T(0, -0.016, 0)), K(1, T())];
      break;
    }
  }

  return { bones, translation: { pelvis: pelvisMove } };
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
      const smooth = t * t * (3 - 2 * t);
      return left.xyz.map((value, axis) => value + (right.xyz[axis] - value) * smooth);
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
    contactU: spec.contactU, plantFoot: spec.plantFoot, duration,
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
  rootMotionPolicy: "ADDITIVE_COM_RETURN_TO_BIND",
  timingPolicy: "ANTICIPATION_DRIVE_IMPACT_OVERTRAVEL_SETTLE",
  metrics,
  meshes: root.listMeshes().length,
  skins: root.listSkins().length,
};
await mkdir(path.dirname(metricsPath), { recursive: true });
await writeFile(metricsPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
