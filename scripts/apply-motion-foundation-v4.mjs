import { NodeIO } from "@gltf-transform/core";
import { Quaternion } from "three";
import { writeFile } from "node:fs/promises";

const [proceduralPath, sourcePath, outputPath, metricsPath] = process.argv.slice(2);
if (!proceduralPath || !sourcePath || !outputPath || !metricsPath) {
  throw new Error("usage: node apply-motion-foundation-v4.mjs <procedural.glb> <source.glb> <output.glb> <metrics.json>");
}

const VERSION = "SOURCE_FOUNDATION_V1_PUNCH_ONLY";

// The source clip is never replayed wholesale. Only its local delta from frame
// zero is transferred, at deliberately low weights, into the already-authored
// PF strike. This preserves move identity while adding human whole-body timing.
// Kick foundations are intentionally excluded: real WebGL A/B showed that even
// low-weight Jump_Start support-leg deltas fight the final world-space Foot Lock.
const FOUNDATIONS = [
  {
    target: "PF_BodyBlow_L",
    source: "Punch_Jab",
    bones: {
      pelvis: { rotation: 0.52, translation: 0.44 },
      spine_01: { rotation: 0.46 }, spine_02: { rotation: 0.40 }, spine_03: { rotation: 0.30 },
      thigh_r: { rotation: 0.18 }, calf_r: { rotation: 0.14 }, foot_r: { rotation: 0.10 },
    },
  },
  {
    target: "PF_BodyBlow_R",
    source: "Punch_Cross",
    bones: {
      pelvis: { rotation: 0.52, translation: 0.44 },
      spine_01: { rotation: 0.46 }, spine_02: { rotation: 0.40 }, spine_03: { rotation: 0.30 },
      thigh_l: { rotation: 0.18 }, calf_l: { rotation: 0.14 }, foot_l: { rotation: 0.10 },
    },
  },
  {
    target: "PF_Power_R",
    source: "Punch_Cross",
    bones: {
      pelvis: { rotation: 0.64, translation: 0.54 },
      spine_01: { rotation: 0.56 }, spine_02: { rotation: 0.48 }, spine_03: { rotation: 0.36 },
      thigh_l: { rotation: 0.22 }, calf_l: { rotation: 0.18 }, foot_l: { rotation: 0.12 },
      thigh_r: { rotation: 0.10 },
    },
  },
];

const io = new NodeIO();
const procedural = await io.read(proceduralPath);
const source = await io.read(sourcePath);
const pRoot = procedural.getRoot();
const sRoot = source.getRoot();
const pAnimations = new Map(pRoot.listAnimations().map((animation) => [animation.getName(), animation]));
const sAnimations = new Map(sRoot.listAnimations().map((animation) => [animation.getName(), animation]));

function channelMap(animation) {
  const map = new Map();
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const path = channel.getTargetPath();
    const sampler = channel.getSampler();
    const input = sampler?.getInput()?.getArray();
    const output = sampler?.getOutput()?.getArray();
    if (!node?.getName() || !path || !input || !output) continue;
    map.set(`${node.getName()}:${path}`, { channel, sampler, input, output });
  }
  return map;
}

function locate(times, normalized) {
  if (times.length <= 1) return { left: 0, right: 0, alpha: 0 };
  const start = times[0];
  const end = times[times.length - 1];
  const time = start + (end - start) * Math.max(0, Math.min(1, normalized));
  if (time <= start) return { left: 0, right: 0, alpha: 0 };
  if (time >= end) return { left: times.length - 1, right: times.length - 1, alpha: 0 };
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const span = Math.max(1e-6, times[hi] - times[lo]);
  return { left: lo, right: hi, alpha: (time - times[lo]) / span };
}

function normalizedAt(times, index) {
  if (times.length <= 1) return 0;
  const start = times[0];
  const end = times[times.length - 1];
  return (times[index] - start) / Math.max(1e-6, end - start);
}

function sampleRotation(track, normalized, out = new Quaternion()) {
  const { left, right, alpha } = locate(track.input, normalized);
  const qa = new Quaternion().fromArray(track.output, left * 4).normalize();
  if (left === right) return out.copy(qa);
  const qb = new Quaternion().fromArray(track.output, right * 4).normalize();
  return out.slerpQuaternions(qa, qb, alpha).normalize();
}

function sampleTranslation(track, normalized, out = [0, 0, 0]) {
  const { left, right, alpha } = locate(track.input, normalized);
  const l = left * 3;
  const r = right * 3;
  out[0] = track.output[l] + (track.output[r] - track.output[l]) * alpha;
  out[1] = track.output[l + 1] + (track.output[r + 1] - track.output[l + 1]) * alpha;
  out[2] = track.output[l + 2] + (track.output[r + 2] - track.output[l + 2]) * alpha;
  return out;
}

function angleDegrees(q) {
  const w = Math.max(-1, Math.min(1, Math.abs(q.w)));
  return (2 * Math.acos(w) * 180) / Math.PI;
}

const metrics = [];
const identity = new Quaternion();

for (const spec of FOUNDATIONS) {
  const targetAnimation = pAnimations.get(spec.target);
  const sourceAnimation = sAnimations.get(spec.source);
  if (!targetAnimation) throw new Error(`missing target animation ${spec.target}`);
  if (!sourceAnimation) throw new Error(`missing source animation ${spec.source}`);
  const targetTracks = channelMap(targetAnimation);
  const sourceTracks = channelMap(sourceAnimation);
  const result = { target: spec.target, source: spec.source, tracks: [], maxRotationDeltaDeg: 0, maxTranslationDelta: 0 };

  for (const [bone, weights] of Object.entries(spec.bones)) {
    for (const path of ["rotation", "translation"]) {
      const weight = weights[path] ?? 0;
      if (weight <= 0) continue;
      const targetTrack = targetTracks.get(`${bone}:${path}`);
      const sourceTrack = sourceTracks.get(`${bone}:${path}`);
      if (!targetTrack || !sourceTrack) continue;

      const copied = new Float32Array(targetTrack.output);
      if (path === "rotation") {
        const sourceStart = sampleRotation(sourceTrack, 0);
        const sourceStartInv = sourceStart.clone().invert();
        const sourceNow = new Quaternion();
        const delta = new Quaternion();
        const weighted = new Quaternion();
        const targetQ = new Quaternion();
        for (let i = 0; i < targetTrack.input.length; i += 1) {
          const u = normalizedAt(targetTrack.input, i);
          sampleRotation(sourceTrack, u, sourceNow);
          delta.copy(sourceStartInv).multiply(sourceNow).normalize();
          weighted.copy(identity).slerp(delta, weight).normalize();
          targetQ.fromArray(copied, i * 4).normalize().multiply(weighted).normalize().toArray(copied, i * 4);
          result.maxRotationDeltaDeg = Math.max(result.maxRotationDeltaDeg, angleDegrees(weighted));
        }
      } else {
        const start = sampleTranslation(sourceTrack, 0, [0, 0, 0]);
        const now = [0, 0, 0];
        for (let i = 0; i < targetTrack.input.length; i += 1) {
          const u = normalizedAt(targetTrack.input, i);
          sampleTranslation(sourceTrack, u, now);
          const offset = i * 3;
          const dx = (now[0] - start[0]) * weight;
          const dy = (now[1] - start[1]) * weight;
          const dz = (now[2] - start[2]) * weight;
          copied[offset] += dx;
          copied[offset + 1] += dy;
          copied[offset + 2] += dz;
          result.maxTranslationDelta = Math.max(result.maxTranslationDelta, Math.hypot(dx, dy, dz));
        }
      }
      targetTrack.sampler.getOutput().setArray(copied);
      result.tracks.push({ bone, path, weight });
    }
  }

  result.maxRotationDeltaDeg = Number(result.maxRotationDeltaDeg.toFixed(3));
  result.maxTranslationDelta = Number(result.maxTranslationDelta.toFixed(5));
  metrics.push(result);
}

await io.write(outputPath, procedural);
await writeFile(metricsPath, JSON.stringify({ version: VERSION, source: sourcePath, procedural: proceduralPath, output: outputPath, foundations: metrics }, null, 2) + "\n");
console.log(JSON.stringify({ version: VERSION, foundations: metrics }, null, 2));
