#!/usr/bin/env node
/**
 * TEST FIXTURE ONLY — make a real, visually viewable GLB without skin,
 * using the existing rejected V2 asset. NOT an art generator or candidate.
 * Preserves original binary mesh and textures, removes skinned rig references.
 * Proves professional face-first sculpt review works before an artist rigs it.
 */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";

const [src,dest] = process.argv.slice(2);
if (!src || !dest) throw new Error("Usage: script input.glb output-sculpt-fixture.glb");
const bytes=await readFile(src);
if(bytes.toString("utf8",0,4)!=="glTF" || bytes.readUInt32LE(4)!==2)
  throw new Error("Expected a glTF2 binary");
const originalJsonLength=bytes.readUInt32LE(12);
const doc=JSON.parse(bytes.subarray(20,20+originalJsonLength).toString("utf8"));
if(!doc.skins?.length || !doc.meshes?.length)throw new Error("Expected a skinned human input");
for(const node of doc.nodes??[])delete node.skin;
delete doc.skins;
for(const mesh of doc.meshes)for(const primitive of mesh.primitives??[]){
  delete primitive.attributes.JOINTS_0;
  delete primitive.attributes.WEIGHTS_0;
  delete primitive.attributes.JOINTS_1;
  delete primitive.attributes.WEIGHTS_1;
}
const text=Buffer.from(JSON.stringify(doc),"utf8");
const padding=(4-text.length%4)%4;
const json=Buffer.alloc(text.length+padding,0x20);
text.copy(json);
const rest=bytes.subarray(20+originalJsonLength);
const total=20+json.length+rest.length;
const result=Buffer.allocUnsafe(total);
result.write("glTF",0,"utf8");
result.writeUInt32LE(2,4);
result.writeUInt32LE(total,8);
result.writeUInt32LE(json.length,12);
result.writeUInt32LE(0x4E4F534A,16);
json.copy(result,20);
rest.copy(result,20+json.length);
await mkdir(path.dirname(dest),{recursive:true});
await writeFile(dest,result);
console.log("TEST_ONLY_STATIC_SCULPT_READY",total,"bytes; not SERA art");
