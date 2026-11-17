#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/validate-sera-hero-glb.mjs input.glb [report.json]");
  process.exit(2);
}
const bytes = fs.readFileSync(file);
function assert(ok, reason) { if (!ok) throw new Error("SERA Hero rejected: " + reason); }
assert(bytes.length >= 20, "GLB too small");
assert(bytes.toString("ascii", 0, 4) === "glTF", "bad GLB signature");
assert(bytes.readUInt32LE(4) === 2, "must use glTF 2");
assert(bytes.readUInt32LE(8) === bytes.length, "length mismatch");
const jsonLength = bytes.readUInt32LE(12);
assert(bytes.readUInt32LE(16) === 0x4e4f534a, "missing JSON chunk");
assert(jsonLength + 20 <= bytes.length, "invalid JSON length");
const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
const names = new Set((gltf.nodes ?? []).map(n => n.name));
const expected = [
 "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
 "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
 "RightShoulder", "RightArm", "RightForeArm", "RightHand",
 "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
];
assert(expected.every(n => names.has(n)), "missing joints: " + expected.filter(n => !names.has(n)).join(", "));
assert((gltf.skins ?? []).length > 0, "must be skinned");
assert((gltf.images ?? []).length >= 2, "needs embedded PBR images");
assert(gltf.images.every(i => Number.isInteger(i.bufferView) || i.uri?.startsWith("data:")), "external textures not allowed");
assert((gltf.materials ?? []).some(m => m.pbrMetallicRoughness?.baseColorTexture || m.normalTexture), "no textured PBR material");
let triangles=0, skinPrimitives=0, uvPrimitives=0, texturePrimitives=0, morphTargets=0;
for(const mesh of gltf.meshes ?? []) for(const p of mesh.primitives ?? []) {
 assert((p.mode ?? 4) === 4, "triangles only");
 const pos=gltf.accessors[p.attributes?.POSITION];
 assert(pos?.count > 0, "mesh has no positions");
 triangles += (p.indices === undefined ? pos.count : gltf.accessors[p.indices].count)/3;
 if(p.attributes?.JOINTS_0 !== undefined && p.attributes?.WEIGHTS_0 !== undefined) skinPrimitives++;
 if(p.attributes?.TEXCOORD_0 !== undefined) uvPrimitives++;
 const mat=gltf.materials?.[p.material ?? -1];
 if(mat?.pbrMetallicRoughness?.baseColorTexture || mat?.normalTexture) texturePrimitives++;
 morphTargets=Math.max(morphTargets,p.targets?.length ?? 0);
}
assert(triangles >= 10000 && triangles <= 100000, "triangle budget: " + triangles);
assert(skinPrimitives > 0 && uvPrimitives > 0 && texturePrimitives > 0, "needs UV skinned textured mesh");
assert(bytes.length <= 24*1024*1024, "asset too large for iPhone web delivery");
const report={
 asset:path.basename(file),bytes:bytes.length,triangles:Math.round(triangles),
 images:gltf.images.length,textures:gltf.textures?.length ?? 0,
 materials:gltf.materials?.length ?? 0,skins:gltf.skins.length,
 mappedRequiredBones:expected.length,morphTargets,
 targetMobileSize:bytes.length<=12*1024*1024?"within-initial-budget":"needs-optimization",
 status:"valid-geometry-needs-render-and-device-approval"
};
if(process.argv[3]){
 fs.mkdirSync(path.dirname(process.argv[3]),{recursive:true});
 fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+"\n");
}
console.log(JSON.stringify(report,null,2));
