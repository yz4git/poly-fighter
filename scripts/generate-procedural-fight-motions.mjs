import { Accessor, NodeIO } from "@gltf-transform/core";
import { Euler, Quaternion } from "three";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [inputPath, outputPath, metricsPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !metricsPath) {
  throw new Error("usage: node generate-procedural-fight-motions.mjs <source.glb> <output.glb> <metrics.json>");
}

const VERSION = "PROCEDURAL_FIGHT_V1";
const DEG = Math.PI / 180;
const R = (x = 0, y = 0, z = 0) => [x * DEG, y * DEG, z * DEG];
const K = (u, xyz) => ({ u, xyz });

/**
 * Procedural Fight Motion Generator v1
 *
 * Rather than inventing a skeleton, this generator remixes known-good UAL
 * animation clips and applies deterministic additive body mechanics. This keeps
 * foot/hand continuity from the authored source while making the actual attack
 * vocabulary specific to POLY FIGHTER. Runtime opponent-weighted IK remains a
 * small final contact correction, not the primary source of the motion.
 */
const SPECS = [
  {
    name: "PF_Jab_L",
    base: "Punch_Jab",
    family: "punch",
    bones: {
      pelvis: [K(0, R()), K(0.48, R(0, -4, 0)), K(0.68, R(0, 7, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.45, R(0, -7, 0)), K(0.68, R(-2, 9, -2)), K(1, R())],
      spine_03: [K(0, R()), K(0.45, R(-2, -8, 0)), K(0.68, R(-3, 12, -4)), K(1, R())],
      clavicle_l: [K(0, R()), K(0.50, R(0, 0, -8)), K(0.70, R(0, 0, 13)), K(1, R())],
      upperarm_l: [K(0, R()), K(0.50, R(8, -7, -10)), K(0.70, R(-12, 13, 8)), K(1, R())],
    },
  },
  {
    name: "PF_Cross_R",
    base: "Punch_Cross",
    family: "punch",
    bones: {
      pelvis: [K(0, R()), K(0.38, R(0, -12, 0)), K(0.68, R(0, 18, 0)), K(1, R())],
      spine_01: [K(0, R()), K(0.42, R(0, -6, 0)), K(0.68, R(0, 8, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.40, R(0, -14, 0)), K(0.69, R(-2, 20, 2)), K(1, R())],
      spine_03: [K(0, R()), K(0.40, R(-3, -12, 1)), K(0.69, R(-5, 18, 5)), K(1, R())],
      clavicle_r: [K(0, R()), K(0.42, R(0, 0, 8)), K(0.70, R(0, 0, -15)), K(1, R())],
      upperarm_r: [K(0, R()), K(0.44, R(10, 9, 10)), K(0.70, R(-14, -15, -8)), K(1, R())],
    },
  },
  {
    name: "PF_Backfist_R",
    base: "Punch_Cross",
    family: "punch",
    bones: {
      pelvis: [K(0, R()), K(0.32, R(0, 26, -2)), K(0.62, R(0, -34, 4)), K(0.78, R(0, -42, 3)), K(1, R())],
      spine_01: [K(0, R()), K(0.34, R(0, 12, 0)), K(0.66, R(0, -18, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.34, R(3, 28, -4)), K(0.66, R(-2, -38, 6)), K(1, R())],
      spine_03: [K(0, R()), K(0.34, R(4, 22, -8)), K(0.66, R(-4, -31, 12)), K(1, R())],
      clavicle_r: [K(0, R()), K(0.36, R(0, 0, -22)), K(0.68, R(0, 0, 34)), K(1, R())],
      upperarm_r: [K(0, R()), K(0.36, R(-8, -20, -28)), K(0.68, R(18, 35, 36)), K(1, R())],
      lowerarm_r: [K(0, R()), K(0.36, R(0, 0, -18)), K(0.68, R(0, 0, 24)), K(1, R())],
    },
  },
  {
    name: "PF_BodyBlow_L",
    base: "Punch_Jab",
    family: "punch",
    bones: {
      pelvis: [K(0, R()), K(0.38, R(7, -10, -3)), K(0.66, R(-4, 16, 3)), K(1, R())],
      spine_01: [K(0, R()), K(0.38, R(10, -5, 0)), K(0.66, R(5, 8, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.38, R(17, -14, -4)), K(0.66, R(9, 21, 6)), K(1, R())],
      spine_03: [K(0, R()), K(0.38, R(13, -11, -6)), K(0.66, R(5, 16, 9)), K(1, R())],
      clavicle_l: [K(0, R()), K(0.40, R(0, 0, -16)), K(0.67, R(0, 0, 23)), K(1, R())],
      upperarm_l: [K(0, R()), K(0.40, R(18, -10, -18)), K(0.67, R(-8, 18, 18)), K(1, R())],
    },
  },
  {
    name: "PF_Power_R",
    base: "Punch_Cross",
    family: "punch",
    bones: {
      pelvis: [K(0, R()), K(0.30, R(0, -28, -5)), K(0.58, R(2, -34, -7)), K(0.72, R(-4, 38, 8)), K(0.84, R(-2, 28, 5)), K(1, R())],
      spine_01: [K(0, R()), K(0.34, R(5, -13, 0)), K(0.72, R(-3, 17, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.32, R(10, -31, -7)), K(0.60, R(8, -38, -8)), K(0.73, R(-8, 43, 10)), K(1, R())],
      spine_03: [K(0, R()), K(0.33, R(7, -25, -10)), K(0.60, R(5, -30, -13)), K(0.73, R(-11, 35, 15)), K(1, R())],
      neck_01: [K(0, R()), K(0.58, R(0, 8, 0)), K(0.75, R(0, -9, 0)), K(1, R())],
      clavicle_r: [K(0, R()), K(0.34, R(0, 0, 20)), K(0.60, R(0, 0, 30)), K(0.73, R(0, 0, -38)), K(1, R())],
      upperarm_r: [K(0, R()), K(0.34, R(20, 18, 25)), K(0.60, R(26, 24, 34)), K(0.73, R(-24, -32, -28)), K(1, R())],
    },
  },
  {
    name: "PF_FrontKick_R",
    base: "Idle_Loop",
    family: "kick",
    bones: {
      pelvis: [K(0, R()), K(0.35, R(4, 5, 0)), K(0.62, R(-7, -8, 0)), K(0.78, R(-3, -4, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.38, R(-6, 0, 0)), K(0.65, R(-16, 0, 0)), K(1, R())],
      spine_03: [K(0, R()), K(0.38, R(-8, 0, 0)), K(0.65, R(-22, 0, 0)), K(1, R())],
      thigh_r: [K(0, R()), K(0.36, R(-24, 0, 0)), K(0.64, R(-68, -4, 2)), K(0.76, R(-78, -4, 2)), K(1, R())],
      calf_r: [K(0, R()), K(0.36, R(28, 0, 0)), K(0.64, R(8, 0, 0)), K(0.76, R(2, 0, 0)), K(1, R())],
      foot_r: [K(0, R()), K(0.64, R(16, 0, 0)), K(0.76, R(20, 0, 0)), K(1, R())],
      thigh_l: [K(0, R()), K(0.60, R(6, 0, -3)), K(1, R())],
    },
  },
  {
    name: "PF_LowKick_L",
    base: "Idle_Loop",
    family: "kick",
    bones: {
      pelvis: [K(0, R()), K(0.34, R(2, 22, -5)), K(0.62, R(3, -30, 9)), K(0.78, R(2, -24, 7)), K(1, R())],
      spine_02: [K(0, R()), K(0.35, R(3, 16, -5)), K(0.64, R(2, -23, 10)), K(1, R())],
      spine_03: [K(0, R()), K(0.35, R(4, 12, -7)), K(0.64, R(3, -17, 13)), K(1, R())],
      thigh_l: [K(0, R()), K(0.34, R(-17, 20, -6)), K(0.62, R(-32, -48, 18)), K(0.76, R(-27, -55, 20)), K(1, R())],
      calf_l: [K(0, R()), K(0.34, R(20, 0, 0)), K(0.62, R(7, 0, 0)), K(0.76, R(4, 0, 0)), K(1, R())],
      foot_l: [K(0, R()), K(0.62, R(8, 0, -12)), K(0.76, R(10, 0, -16)), K(1, R())],
      thigh_r: [K(0, R()), K(0.62, R(5, 0, 5)), K(1, R())],
    },
  },
  {
    name: "PF_RisingKick_R",
    base: "Idle_Loop",
    family: "kick",
    bones: {
      pelvis: [K(0, R()), K(0.34, R(-4, 8, 0)), K(0.62, R(-12, -8, 0)), K(0.78, R(-17, -5, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.36, R(-8, 0, 0)), K(0.64, R(-22, 4, 0)), K(0.80, R(-28, 3, 0)), K(1, R())],
      spine_03: [K(0, R()), K(0.36, R(-12, 0, 0)), K(0.64, R(-31, 5, 0)), K(0.80, R(-36, 4, 0)), K(1, R())],
      thigh_r: [K(0, R()), K(0.34, R(-28, 0, 0)), K(0.62, R(-92, -5, 0)), K(0.78, R(-112, -4, 0)), K(1, R())],
      calf_r: [K(0, R()), K(0.34, R(38, 0, 0)), K(0.62, R(14, 0, 0)), K(0.78, R(4, 0, 0)), K(1, R())],
      foot_r: [K(0, R()), K(0.62, R(24, 0, 0)), K(0.78, R(30, 0, 0)), K(1, R())],
    },
  },
  {
    name: "PF_DashKick_R",
    base: "Jump_Start",
    family: "kick",
    bones: {
      pelvis: [K(0, R()), K(0.32, R(-6, -8, 0)), K(0.58, R(-14, 8, 0)), K(0.78, R(-11, 5, 0)), K(1, R())],
      spine_01: [K(0, R()), K(0.58, R(-8, 0, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.35, R(-8, 0, 0)), K(0.60, R(-22, 0, 0)), K(0.80, R(-18, 0, 0)), K(1, R())],
      spine_03: [K(0, R()), K(0.35, R(-12, 0, 0)), K(0.60, R(-36, 0, 0)), K(0.80, R(-29, 0, 0)), K(1, R())],
      thigh_r: [K(0, R()), K(0.34, R(-30, 0, 0)), K(0.60, R(-78, -4, 0)), K(0.80, R(-82, -4, 0)), K(1, R())],
      calf_r: [K(0, R()), K(0.34, R(30, 0, 0)), K(0.60, R(2, 0, 0)), K(0.80, R(0, 0, 0)), K(1, R())],
      thigh_l: [K(0, R()), K(0.60, R(-28, 6, 0)), K(0.80, R(-18, 4, 0)), K(1, R())],
      calf_l: [K(0, R()), K(0.60, R(26, 0, 0)), K(0.80, R(18, 0, 0)), K(1, R())],
    },
  },
  {
    name: "PF_Throw",
    base: "Punch_Cross",
    family: "throw",
    bones: {
      pelvis: [K(0, R()), K(0.30, R(7, -10, 0)), K(0.55, R(13, 8, 0)), K(0.74, R(-8, 28, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.30, R(13, -8, 0)), K(0.55, R(18, 8, 0)), K(0.74, R(-14, 23, 0)), K(1, R())],
      spine_03: [K(0, R()), K(0.30, R(16, -6, 0)), K(0.55, R(22, 6, 0)), K(0.74, R(-18, 18, 0)), K(1, R())],
      upperarm_l: [K(0, R()), K(0.45, R(-28, 20, -24)), K(0.66, R(-38, 12, -30)), K(1, R())],
      upperarm_r: [K(0, R()), K(0.45, R(-28, -20, 24)), K(0.66, R(-38, -12, 30)), K(1, R())],
      lowerarm_l: [K(0, R()), K(0.45, R(0, 0, 24)), K(0.66, R(0, 0, 34)), K(1, R())],
      lowerarm_r: [K(0, R()), K(0.45, R(0, 0, -24)), K(0.66, R(0, 0, -34)), K(1, R())],
    },
  },
  {
    name: "PF_Counter_R",
    base: "Punch_Cross",
    family: "punch",
    bones: {
      pelvis: [K(0, R()), K(0.28, R(0, 14, -6)), K(0.45, R(0, 18, -8)), K(0.68, R(0, -23, 8)), K(1, R())],
      spine_02: [K(0, R()), K(0.28, R(-3, 18, -8)), K(0.45, R(-5, 24, -10)), K(0.68, R(-3, -28, 10)), K(1, R())],
      spine_03: [K(0, R()), K(0.28, R(-8, 15, -9)), K(0.45, R(-11, 20, -12)), K(0.68, R(-7, -23, 13)), K(1, R())],
      clavicle_r: [K(0, R()), K(0.45, R(0, 0, 17)), K(0.68, R(0, 0, -24)), K(1, R())],
      upperarm_r: [K(0, R()), K(0.45, R(14, 16, 15)), K(0.68, R(-18, -24, -17)), K(1, R())],
    },
  },
  {
    name: "PF_HitHeavy",
    base: "Hit_Chest",
    family: "reaction",
    bones: {
      pelvis: [K(0, R()), K(0.30, R(0, 0, -6)), K(0.58, R(4, -16, -12)), K(0.76, R(8, -22, -16)), K(1, R())],
      spine_01: [K(0, R()), K(0.58, R(8, -10, -7)), K(0.76, R(12, -15, -10)), K(1, R())],
      spine_02: [K(0, R()), K(0.32, R(-4, 0, 0)), K(0.58, R(13, -19, -12)), K(0.76, R(18, -25, -15)), K(1, R())],
      spine_03: [K(0, R()), K(0.32, R(-7, 0, 0)), K(0.58, R(19, -24, -16)), K(0.76, R(25, -30, -18)), K(1, R())],
      neck_01: [K(0, R()), K(0.60, R(8, -12, -12)), K(0.78, R(12, -18, -16)), K(1, R())],
      head: [K(0, R()), K(0.60, R(10, -14, -16)), K(0.78, R(15, -20, -22)), K(1, R())],
    },
  },
  {
    name: "PF_Launch",
    base: "Hit_Chest",
    family: "reaction",
    bones: {
      pelvis: [K(0, R()), K(0.30, R(-6, 0, 0)), K(0.58, R(-18, 0, 0)), K(0.78, R(-24, 0, 0)), K(1, R())],
      spine_01: [K(0, R()), K(0.58, R(-10, 0, 0)), K(0.78, R(-15, 0, 0)), K(1, R())],
      spine_02: [K(0, R()), K(0.32, R(-8, 0, 0)), K(0.58, R(-24, 0, 0)), K(0.78, R(-32, 0, 0)), K(1, R())],
      spine_03: [K(0, R()), K(0.32, R(-10, 0, 0)), K(0.58, R(-31, 0, 0)), K(0.78, R(-40, 0, 0)), K(1, R())],
      neck_01: [K(0, R()), K(0.58, R(-15, 0, 0)), K(0.78, R(-22, 0, 0)), K(1, R())],
      head: [K(0, R()), K(0.58, R(-18, 0, 0)), K(0.78, R(-26, 0, 0)), K(1, R())],
      thigh_l: [K(0, R()), K(0.70, R(20, 0, 0)), K(1, R())],
      thigh_r: [K(0, R()), K(0.70, R(14, 0, 0)), K(1, R())],
    },
  },
  {
    name: "PF_DownBack",
    base: "Death01",
    family: "reaction",
    bones: {
      pelvis: [K(0, R()), K(0.36, R(-8, 4, 0)), K(0.64, R(-18, 7, 0)), K(0.82, R(-25, 9, 0)), K(1, R(-18, 4, 0))],
      spine_02: [K(0, R()), K(0.55, R(-16, 0, 0)), K(0.82, R(-27, 0, 0)), K(1, R(-20, 0, 0))],
      spine_03: [K(0, R()), K(0.55, R(-22, 0, 0)), K(0.82, R(-34, 0, 0)), K(1, R(-25, 0, 0))],
    },
  },
  {
    name: "PF_Wakeup",
    base: "Jump_Land",
    family: "recovery",
    bones: {
      pelvis: [K(0, R(14, 0, 0)), K(0.28, R(18, 0, 0)), K(0.55, R(8, 0, 0)), K(0.78, R(-3, 0, 0)), K(1, R())],
      spine_01: [K(0, R(18, 0, 0)), K(0.35, R(14, 0, 0)), K(0.68, R(4, 0, 0)), K(1, R())],
      spine_02: [K(0, R(24, 0, 0)), K(0.35, R(18, 0, 0)), K(0.68, R(5, 0, 0)), K(1, R())],
      spine_03: [K(0, R(28, 0, 0)), K(0.35, R(20, 0, 0)), K(0.68, R(6, 0, 0)), K(1, R())],
    },
  },
];

const io = new NodeIO();
const document = await io.read(inputPath);
const root = document.getRoot();
const buffer = root.listBuffers()[0] ?? document.createBuffer("procedural-motion-buffer");
const nodes = new Map(root.listNodes().filter((node) => node.getName()).map((node) => [node.getName(), node]));
const animations = new Map(root.listAnimations().filter((animation) => animation.getName()).map((animation) => [animation.getName(), animation]));

for (const required of ["pelvis", "spine_02", "spine_03", "upperarm_l", "upperarm_r", "thigh_l", "thigh_r"]) {
  if (!nodes.has(required)) throw new Error(`Required UAL bone missing: ${required}`);
}
for (const spec of SPECS) {
  if (!animations.has(spec.base)) throw new Error(`Required base clip missing for ${spec.name}: ${spec.base}`);
}

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
      return [
        left.xyz[0] + (right.xyz[0] - left.xyz[0]) * smooth,
        left.xyz[1] + (right.xyz[1] - left.xyz[1]) * smooth,
        left.xyz[2] + (right.xyz[2] - left.xyz[2]) * smooth,
      ];
    }
  }
  return [0, 0, 0];
}

function maxTime(animation) {
  let duration = 0;
  for (const channel of animation.listChannels()) {
    const input = channel.getSampler()?.getInput()?.getArray();
    if (!input?.length) continue;
    duration = Math.max(duration, input[input.length - 1]);
  }
  return Math.max(duration, 1 / 30);
}

function cloneAccessor(array, type, name) {
  return document.createAccessor(name)
    .setType(type)
    .setArray(new Float32Array(array))
    .setBuffer(buffer);
}

function buildMotion(spec) {
  const base = animations.get(spec.base);
  const duration = maxTime(base);
  const animation = document.createAnimation(spec.name);
  const animatedBones = new Set();

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
    const curve = spec.bones[boneName];

    if (targetPath === "rotation" && curve && copied.length % 4 === 0) {
      animatedBones.add(boneName);
      const q = new Quaternion();
      const delta = new Quaternion();
      const euler = new Euler();
      for (let sample = 0; sample < times.length; sample += 1) {
        const offset = sample * 4;
        const u = duration <= 0 ? 0 : times[sample] / duration;
        const xyz = sampleCurve(curve, u);
        q.fromArray(copied, offset).normalize();
        euler.set(xyz[0], xyz[1], xyz[2], "XYZ");
        delta.setFromEuler(euler);
        q.multiply(delta).normalize().toArray(copied, offset);
      }
    }

    const input = cloneAccessor(times, Accessor.Type.SCALAR, `${spec.name}-${boneName || "node"}-time`);
    const output = cloneAccessor(copied, sourceOutput.getType(), `${spec.name}-${boneName || "node"}-${targetPath}`);
    const sampler = document.createAnimationSampler(`${spec.name}-${boneName || "node"}-${targetPath}-sampler`)
      .setInput(input)
      .setOutput(output)
      .setInterpolation(sourceSampler.getInterpolation());
    const nextChannel = document.createAnimationChannel(`${spec.name}-${boneName || "node"}-${targetPath}-channel`)
      .setTargetNode(targetNode)
      .setTargetPath(targetPath)
      .setSampler(sampler);
    animation.addSampler(sampler).addChannel(nextChannel);
  }

  // Most UAL actions key the full armature. Fail loudly if a modifier bone was
  // not present in the base clip so a future source-pack change cannot silently
  // degrade a generated strike.
  const missingAnimated = Object.keys(spec.bones).filter((bone) => nodes.has(bone) && !animatedBones.has(bone));
  return {
    name: spec.name,
    base: spec.base,
    family: spec.family,
    duration,
    channels: animation.listChannels().length,
    modifiedBones: [...animatedBones].sort(),
    missingAnimated,
  };
}

const metrics = [];
for (const spec of SPECS) metrics.push(buildMotion(spec));
for (const animation of [...root.listAnimations()]) {
  if (!animation.getName().startsWith("PF_")) animation.dispose();
}
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
  metrics,
  meshes: root.listMeshes().length,
  skins: root.listSkins().length,
};
await mkdir(path.dirname(metricsPath), { recursive: true });
await writeFile(metricsPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
