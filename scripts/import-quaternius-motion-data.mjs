import { mkdir, writeFile } from "node:fs/promises";

const SOURCE_COMMIT = "e24c23cf2a1323488a3faa226ea7ea21f644b73e";
const SOURCE_ROOT = `https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/${SOURCE_COMMIT}/glTF`;
const GLTF_URL = `${SOURCE_ROOT}/AnimationLibrary_Godot_Standard.gltf`;
const BIN_URL = `${SOURCE_ROOT}/AnimationLibrary_Godot_Standard.bin`;
const SELECTED = [
  "Idle_Loop",
  "Walk_Loop",
  "Jog_Fwd_Loop",
  "Punch_Jab",
  "Punch_Cross",
  "Hit_Chest",
  "Hit_Head",
  "Death01",
];
const TRACKED = {
  hips: "DEF-hips",
  chest: "DEF-spine.003",
  head: "DEF-head",
  leftHand: "DEF-hand.L",
  rightHand: "DEF-hand.R",
  leftFoot: "DEF-foot.L",
  rightFoot: "DEF-foot.R",
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

const [gltfResponse, binResponse] = await Promise.all([fetch(GLTF_URL), fetch(BIN_URL)]);
if (!gltfResponse.ok) throw new Error(`glTF download failed: ${gltfResponse.status}`);
if (!binResponse.ok) throw new Error(`BIN download failed: ${binResponse.status}`);
const gltf = await gltfResponse.json();
const bin = new Uint8Array(await binResponse.arrayBuffer());
const nodes = gltf.nodes ?? [];
const animations = gltf.animations ?? [];
const parent = new Array(nodes.length).fill(-1);
for (let index = 0; index < nodes.length; index += 1) {
  for (const child of nodes[index].children ?? []) parent[child] = index;
}
const nodeIndex = Object.fromEntries(Object.entries(TRACKED).map(([key, name]) => {
  const index = nodes.findIndex((node) => node.name === name);
  if (index < 0) throw new Error(`Required Quaternius node not found: ${name}`);
  return [key, index];
}));

function readAccessor(index) {
  const accessor = gltf.accessors[index];
  if (!accessor) throw new Error(`Missing accessor ${index}`);
  if (accessor.componentType !== 5126) throw new Error(`Accessor ${index} is not FLOAT (${accessor.componentType})`);
  const components = TYPE_SIZE[accessor.type];
  if (!components) throw new Error(`Unsupported accessor type ${accessor.type}`);
  const view = gltf.bufferViews[accessor.bufferView];
  const stride = view.byteStride ?? components * 4;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new Array(accessor.count);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let row = 0; row < accessor.count; row += 1) {
    const values = new Array(components);
    for (let column = 0; column < components; column += 1) {
      values[column] = dv.getFloat32(base + row * stride + column * 4, true);
    }
    data[row] = values;
  }
  return data;
}

const clone3 = (value = [0, 0, 0]) => [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
const clone4 = (value = [0, 0, 0, 1]) => [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function qnorm(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((value) => value / length);
}
function qmul(a, b) {
  return qnorm([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
function qrotate(q, v) {
  const [x, y, z, w] = q;
  const uv = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
  const uuv = [y * uv[2] - z * uv[1], z * uv[0] - x * uv[2], x * uv[1] - y * uv[0]];
  return add3(v, add3(scale3(uv, 2 * w), scale3(uuv, 2)));
}
function qslerp(a, b, t) {
  let end = b;
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (dot < 0) { dot = -dot; end = b.map((value) => -value); }
  if (dot > 0.9995) return qnorm(a.map((value, index) => value + (end[index] - value) * t));
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sinTheta = Math.sin(theta) || 1;
  const aWeight = Math.sin((1 - t) * theta) / sinTheta;
  const bWeight = Math.sin(t * theta) / sinTheta;
  return qnorm(a.map((value, index) => value * aWeight + end[index] * bWeight));
}

function buildTracks(animation) {
  const tracks = new Map();
  for (const channel of animation.channels ?? []) {
    const sampler = animation.samplers[channel.sampler];
    if (!sampler || channel.target?.node === undefined || !channel.target?.path) continue;
    const interpolation = sampler.interpolation ?? "LINEAR";
    if (!new Set(["LINEAR", "STEP"]).has(interpolation)) throw new Error(`${animation.name}: unsupported interpolation ${interpolation}`);
    tracks.set(`${channel.target.node}:${channel.target.path}`, {
      interpolation,
      times: readAccessor(sampler.input).map((entry) => entry[0]),
      values: readAccessor(sampler.output),
      path: channel.target.path,
    });
  }
  return tracks;
}
function sampleTrack(track, time) {
  const { times, values, interpolation, path } = track;
  if (time <= times[0]) return [...values[0]];
  const last = times.length - 1;
  if (time >= times[last]) return [...values[last]];
  let high = 1;
  while (high < times.length && times[high] < time) high += 1;
  const low = Math.max(0, high - 1);
  if (interpolation === "STEP") return [...values[low]];
  const span = Math.max(1e-6, times[high] - times[low]);
  const alpha = (time - times[low]) / span;
  if (path === "rotation") return qslerp(values[low], values[high], alpha);
  return values[low].map((value, index) => value + (values[high][index] - value) * alpha);
}
function worldAt(time, tracks) {
  const cache = new Array(nodes.length);
  const solve = (index) => {
    if (cache[index]) return cache[index];
    const node = nodes[index];
    const translation = tracks.get(`${index}:translation`) ? sampleTrack(tracks.get(`${index}:translation`), time) : clone3(node.translation);
    const rotation = tracks.get(`${index}:rotation`) ? sampleTrack(tracks.get(`${index}:rotation`), time) : clone4(node.rotation);
    const scale = tracks.get(`${index}:scale`) ? sampleTrack(tracks.get(`${index}:scale`), time) : clone3(node.scale ?? [1, 1, 1]);
    const parentIndex = parent[index];
    if (parentIndex < 0) return (cache[index] = { pos: translation, rot: qnorm(rotation), scale });
    const parentWorld = solve(parentIndex);
    const pos = add3(parentWorld.pos, qrotate(parentWorld.rot, mul3(translation, parentWorld.scale)));
    return (cache[index] = { pos, rot: qmul(parentWorld.rot, rotation), scale: mul3(parentWorld.scale, scale) });
  };
  return nodes.map((_, index) => solve(index));
}
function round(value) { return Math.round(value * 100000) / 100000; }
const round3 = (value) => value.map(round);
function extract(animation) {
  const tracks = buildTracks(animation);
  let duration = 0;
  for (const track of tracks.values()) duration = Math.max(duration, track.times.at(-1) ?? 0);
  if (!(duration > 0)) throw new Error(`${animation.name}: invalid duration`);
  const sampleCount = Math.max(2, Math.round(duration * 30) + 1);
  const firstWorld = worldAt(0, tracks);
  const firstHips = firstWorld[nodeIndex.hips];
  const headY = firstWorld[nodeIndex.head].pos[1];
  const footY = Math.min(firstWorld[nodeIndex.leftFoot].pos[1], firstWorld[nodeIndex.rightFoot].pos[1]);
  const height = Math.max(0.25, Math.abs(headY - footY));
  const inverseFirstHips = qinv(firstHips.rot);
  const samples = [];
  const trackedKeys = ["chest", "head", "leftHand", "rightHand", "leftFoot", "rightFoot"];
  for (let frame = 0; frame < sampleCount; frame += 1) {
    const time = duration * frame / (sampleCount - 1);
    const world = worldAt(time, tracks);
    const hips = world[nodeIndex.hips];
    const inverseHips = qinv(hips.rot);
    const sample = {
      t: round(time / duration),
      hipsDelta: round3(scale3(qrotate(inverseFirstHips, sub3(hips.pos, firstHips.pos)), 1 / height)),
    };
    for (const key of trackedKeys) {
      sample[key] = round3(scale3(qrotate(inverseHips, sub3(world[nodeIndex[key]].pos, hips.pos)), 1 / height));
    }
    samples.push(sample);
  }
  return { duration: round(duration), fps: 30, samples };
}

const clips = {};
for (const name of SELECTED) {
  const animation = animations.find((entry) => entry.name === name);
  if (!animation) throw new Error(`Selected Quaternius animation missing: ${name}`);
  clips[name] = extract(animation);
  console.log(`${name}: ${clips[name].duration}s, ${clips[name].samples.length} samples`);
}
const generated = `/* AUTO-GENERATED by scripts/import-quaternius-motion-data.mjs.\n * Source: Quaternius Universal Animation Library (CC0 1.0).\n * Mirror commit: ${SOURCE_COMMIT}. Only normalized motion trajectories are retained.\n */\n\nexport interface QuaterniusMotionSample {\n  t: number;\n  hipsDelta: readonly [number, number, number];\n  chest: readonly [number, number, number];\n  head: readonly [number, number, number];\n  leftHand: readonly [number, number, number];\n  rightHand: readonly [number, number, number];\n  leftFoot: readonly [number, number, number];\n  rightFoot: readonly [number, number, number];\n}\nexport interface QuaterniusMotionClip {\n  duration: number;\n  fps: number;\n  samples: readonly QuaterniusMotionSample[];\n}\nexport const QUATERNIUS_MOTION_SOURCE = ${JSON.stringify({ author: "Quaternius", library: "Universal Animation Library", license: "CC0-1.0", mirror: "J-Ponzo/gltf-universal-animation-library", commit: SOURCE_COMMIT })} as const;\nexport const QUATERNIUS_MOTIONS: Readonly<Record<string, QuaterniusMotionClip>> = ${JSON.stringify(clips)};\n`;
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/quaternius-motion-data.ts", generated);
await writeFile("artifacts/quaternius-motion-data-report.json", `${JSON.stringify({ sourceCommit: SOURCE_COMMIT, selected: Object.fromEntries(Object.entries(clips).map(([name, clip]) => [name, { duration: clip.duration, samples: clip.samples.length }])) }, null, 2)}\n`);
