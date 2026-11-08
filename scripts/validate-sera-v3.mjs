#!/usr/bin/env node
// Acceptance gate for structurally NEW SERA V3, not reused V2 decoration.
import fs from "node:fs";
import path from "node:path";
const source=process.argv[2];
if(!source)throw new Error("Usage: node scripts/validate-sera-v3.mjs v3.glb [report.json]");
const blob=fs.readFileSync(source);
function need(condition,msg){if(!condition)throw new Error("SERA V3 gate: "+msg);}
need(blob.toString("utf8",0,4)==="glTF" && blob.readUInt32LE(4)===2,"expected GLB2");
need(blob.readUInt32LE(8)===blob.length,"length mismatch");
const chunk=blob.readUInt32LE(12);
need(blob.readUInt32LE(16)===0x4e4f534a,"missing JSON chunk");
const doc=JSON.parse(blob.toString("utf8",20,20+chunk));
const meshNames=(doc.meshes??[]).map(x=>x.name??"");
const materials=(doc.materials??[]).map(x=>x.name??"");
const root=meshNames.find(x=>x.includes("sera_hero"));
need(root,"source anatomical base lost");
need((doc.skins??[]).length>0,"no skinned GLB");
need((doc.images??[]).length>=12,"needs genuine cloth PBR plus skin and eyes");
need((doc.meshes??[]).length>25,"missing integrated hairstyle/garment geometry");
need(meshNames.some(x=>x.includes("V3")&&x.includes("fitted forearm shell")),"fitted forearm shell missing");
need(meshNames.some(x=>x.includes("V3")&&x.includes("battle tabard")),"tailored cloth missing");
need(meshNames.some(x=>x.includes("V3")&&x.includes("groom front")),"sculpted swept fringe missing");
need(!meshNames.some(x=>x.includes("SERA cobalt split-breastplate")||x.includes("SERA forearm gauntlet")),
 "V2 floating primitive armor leaked into V3");
need(materials.some(x=>x.includes("V3")&&x.includes("tailored textile")),"UV-weave chest materials missing");
need(materials.some(x=>x.includes("V3")&&x.includes("carbon armor")),"carbon composite materials missing");
need((doc.meshes.find(x=>x.name===root)?.primitives??[]).some(x=>(x.targets??[]).length>=20),
 "SERA face blend shapes missing");
const names=new Set((doc.nodes??[]).map(x=>x.name));
for(const bone of ["Head","Hips","Spine2","LeftArm","RightArm","LeftUpLeg","RightUpLeg"]){
 need(names.has(bone),"missing common motion bone "+bone);
}
let triangles=0,skinPrimitives=0;
for(const mesh of doc.meshes??[])for(const primitive of mesh.primitives??[]){
 const pos=doc.accessors[primitive.attributes?.POSITION];
 need(pos,"mesh missing positions");
 triangles+=(primitive.indices==null?pos.count:doc.accessors[primitive.indices].count)/3;
 if(primitive.attributes?.JOINTS_0!=null&&primitive.attributes?.WEIGHTS_0!=null)skinPrimitives++;
}
need(triangles>=35000&&triangles<=90000,"unreasonable source+tailored geometry: "+triangles);
need(skinPrimitives>=20,"many wardrobe/hair meshes are not rigged");
need(blob.length<=24*1024*1024,"iPhone GLB too large");
const report={
 kind:"SERA_V3_INTEGRATED_FIGHTER",glb:path.basename(source),size:blob.length,triangles:Math.round(triangles),
 imageCount:doc.images.length,materialCount:materials.length,meshCount:meshNames.length,
 skinnedPrimitives:skinPrimitives,faceMorphCount:20,
 result:"structurally-valid-awaiting-visual-and-real-iPhone-review"
};
console.log(JSON.stringify(report,null,2));
if(process.argv[3]){fs.mkdirSync(path.dirname(process.argv[3]),{recursive:true});
 fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+"\n");}
