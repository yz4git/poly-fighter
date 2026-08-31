import { NodeIO } from "@gltf-transform/core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const [inputPath, outputPath, namesCsv] = process.argv.slice(2);
if (!inputPath || !outputPath || !namesCsv) {
  throw new Error("usage: node curate-quaternius-animations.mjs <input.glb> <output.glb> <comma-separated clips>");
}

const keep = new Set(namesCsv.split(",").map((name) => name.trim()).filter(Boolean));
const io = new NodeIO();
const document = await io.read(inputPath);
const root = document.getRoot();
const available = root.listAnimations().map((animation) => animation.getName());
const missing = [...keep].filter((name) => !available.includes(name));
if (missing.length) throw new Error(`Missing requested clips: ${missing.join(", ")}`);

for (const animation of [...root.listAnimations()]) {
  if (!keep.has(animation.getName())) animation.dispose();
}

// Runtime motion packs only need named nodes + animation tracks. Removing the
// mannequin mesh, materials, textures and skin keeps iPhone downloads small
// while preserving all animation target node names for direct binding.
for (const mesh of [...root.listMeshes()]) mesh.dispose();
for (const skin of [...root.listSkins()]) skin.dispose();
for (const material of [...root.listMaterials()]) material.dispose();
for (const texture of [...root.listTextures()]) texture.dispose();

await mkdir(path.dirname(outputPath), { recursive: true });
await io.write(outputPath, document);
console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  kept: root.listAnimations().map((animation) => animation.getName()),
  meshes: root.listMeshes().length,
  materials: root.listMaterials().length,
  textures: root.listTextures().length,
  skins: root.listSkins().length,
}, null, 2));
