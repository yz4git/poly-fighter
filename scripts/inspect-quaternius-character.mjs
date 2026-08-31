import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("Not a GLB file");
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);
  let offset = 12;
  let json = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (type === 0x4e4f534a) json = JSON.parse(buffer.subarray(start, end).toString("utf8"));
    offset = end;
  }
  if (!json) throw new Error("GLB JSON chunk missing");
  return json;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function summarize(file, gltf) {
  const nodes = gltf.nodes ?? [];
  const nodeName = (index) => nodes[index]?.name ?? `node_${index}`;
  const joints = unique((gltf.skins ?? []).flatMap((skin) => (skin.joints ?? []).map(nodeName)));
  const animationTargets = unique((gltf.animations ?? []).flatMap((animation) =>
    (animation.channels ?? []).map((channel) => nodeName(channel.target?.node))));
  return {
    file,
    asset: gltf.asset ?? null,
    scenes: (gltf.scenes ?? []).length,
    nodes: nodes.length,
    meshes: (gltf.meshes ?? []).length,
    materials: (gltf.materials ?? []).length,
    textures: (gltf.textures ?? []).length,
    skins: (gltf.skins ?? []).length,
    animations: (gltf.animations ?? []).map((animation, index) => ({
      index,
      name: animation.name ?? `animation_${index}`,
      channels: (animation.channels ?? []).length,
    })),
    jointNames: joints,
    animationTargetNames: animationTargets,
  };
}

const [modelPath, motionPath, outputPath] = process.argv.slice(2);
if (!modelPath || !motionPath || !outputPath) {
  throw new Error("usage: node inspect-quaternius-character.mjs <model.glb> <motion.glb> <report.json>");
}

const model = summarize(path.basename(modelPath), parseGlb(await readFile(modelPath)));
const motion = summarize(path.basename(motionPath), parseGlb(await readFile(motionPath)));
const modelJointSet = new Set(model.jointNames);
const motionTargetSet = new Set(motion.animationTargetNames);
const shared = unique(model.jointNames.filter((name) => motionTargetSet.has(name)));
const missingMotionTargets = unique(motion.animationTargetNames.filter((name) => !modelJointSet.has(name)));
const coverage = motion.animationTargetNames.length > 0 ? shared.length / motion.animationTargetNames.length : 0;

const report = {
  source: {
    model: "Quaternius Universal Base Characters — Superhero Male FullBody",
    animations: "Quaternius Universal Animation Library",
    license: "CC0-1.0",
  },
  model,
  motion,
  compatibility: {
    sharedJointNames: shared,
    sharedJointCount: shared.length,
    motionTargetCount: motion.animationTargetNames.length,
    targetNameCoverage: Number(coverage.toFixed(4)),
    missingMotionTargets,
    directlyBindableByNodeName: coverage >= 0.9,
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.compatibility, null, 2));
