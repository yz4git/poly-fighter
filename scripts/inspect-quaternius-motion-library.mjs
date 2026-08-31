import { mkdir, writeFile } from "node:fs/promises";

const SOURCE_COMMIT = "e24c23cf2a1323488a3faa226ea7ea21f644b73e";
const SOURCE_URL = `https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/${SOURCE_COMMIT}/glTF/AnimationLibrary_Godot_Standard.gltf`;
const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Failed to download Quaternius glTF: ${response.status}`);
const gltf = await response.json();

const animations = (gltf.animations ?? []).map((animation, index) => ({
  index,
  name: animation.name ?? `animation-${index}`,
  channels: animation.channels?.length ?? 0,
  samplers: animation.samplers?.length ?? 0,
}));
const interesting = animations.filter(({ name }) => /punch|kick|fight|combat|idle|walk|run|jog|hit|hurt|death|knock|block|guard|strafe|dodge/i.test(name));
const nodes = (gltf.nodes ?? []).map((node, index) => ({ index, name: node.name ?? `node-${index}`, children: node.children ?? [] }));
const boneCandidates = nodes.filter(({ name }) => /hips|pelvis|spine|chest|neck|head|shoulder|arm|forearm|hand|thigh|leg|shin|foot|toe/i.test(name));
const report = {
  source: SOURCE_URL,
  sourceCommit: SOURCE_COMMIT,
  animationCount: animations.length,
  animations,
  interesting,
  nodeCount: nodes.length,
  boneCandidates,
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/quaternius-motion-inspection.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`Quaternius animations: ${animations.length}`);
console.log(`Interesting clips (${interesting.length}):`);
for (const clip of interesting) console.log(`- ${clip.index}: ${clip.name} (${clip.channels} channels)`);
console.log("Bone candidates:");
for (const node of boneCandidates) console.log(`- ${node.index}: ${node.name}`);
