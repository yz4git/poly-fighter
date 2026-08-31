import { NodeIO } from "@gltf-transform/core";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: node build-quaternius-flat-model.mjs <input.gltf> <output.glb>");
}

const json = JSON.parse(await readFile(inputPath, "utf8"));

function stripTextureReferences(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(stripTextureReferences);
    return;
  }
  for (const key of Object.keys(value)) {
    if (key.toLowerCase().endsWith("texture")) {
      delete value[key];
      continue;
    }
    stripTextureReferences(value[key]);
  }
}

for (const material of json.materials ?? []) {
  stripTextureReferences(material);
  if (material.pbrMetallicRoughness) {
    material.pbrMetallicRoughness.metallicFactor = 0;
    material.pbrMetallicRoughness.roughnessFactor = 0.82;
  }
}
delete json.images;
delete json.textures;
delete json.samplers;

// Remove image-only extension declarations after texture references are gone.
if (Array.isArray(json.extensionsUsed)) {
  json.extensionsUsed = json.extensionsUsed.filter((name) => !String(name).includes("texture"));
  if (json.extensionsUsed.length === 0) delete json.extensionsUsed;
}
if (Array.isArray(json.extensionsRequired)) {
  json.extensionsRequired = json.extensionsRequired.filter((name) => !String(name).includes("texture"));
  if (json.extensionsRequired.length === 0) delete json.extensionsRequired;
}

await writeFile(inputPath, `${JSON.stringify(json)}\n`);

const io = new NodeIO();
const document = await io.read(inputPath);
const root = document.getRoot();
for (const material of root.listMaterials()) {
  material.setMetallicFactor(0);
  material.setRoughnessFactor(0.82);
}
await io.write(outputPath, document);

console.log(JSON.stringify({
  input: path.basename(inputPath),
  output: path.basename(outputPath),
  nodes: root.listNodes().length,
  meshes: root.listMeshes().length,
  materials: root.listMaterials().length,
  textures: root.listTextures().length,
  skins: root.listSkins().length,
  animations: root.listAnimations().length,
}, null, 2));
