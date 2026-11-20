/** Short-lived quantitative audit of CMU leg motion on real source/target rigs.
 * The report is printed as JSON in the CMU probe's GitHub Actions logs.
 */
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cmuMocapPilotUrl, retargetCmuPilotClip } from "../src/game/cmu-mocap-pilot.ts";

function ab(b) { return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); }
const loader = new GLTFLoader();
const poses = (root, names) => Object.fromEntries(names.map((name) => {
  const n = root.getObjectByName(name);
  if(!n)return [name,null];
  const p=n.getWorldPosition(new THREE.Vector3());
  return [name,{parent:n.parent?.name,p:p.toArray().map(x=>Number(x.toFixed(4))),local:n.position.toArray().map(x=>Number(x.toFixed(4)))}];
}));
const samples=[0,0.2,0.5,0.8,1.2,1.5,2,2.5,3,3.5,4];
const sourceNames=["root","lhipjoint","lfemur","ltibia","lfoot","ltoes","rhipjoint","rfemur","rtibia","rfoot","rtoes","lowerback","upperback","thorax"];
const targetNames=["root","pelvis","thigh_l","calf_l","foot_l","ball_l","thigh_r","calf_r","foot_r","ball_r","spine_01"];
for (const variant of ["male","female"]){
  const bytes=readFileSync(`public/models/quaternius/ubc-superhero-${variant}-flat.glb`);
  const target=(await loader.parseAsync(ab(bytes),"")).scene;
  const res=await fetch(cmuMocapPilotUrl("WALK"));
  const {scene:source, animations}=await loader.parseAsync(await res.arrayBuffer(),"");
  source.updateWorldMatrix(true,true);target.updateWorldMatrix(true,true);
  console.log("BONE_REST",JSON.stringify({variant,source:poses(source,sourceNames),target:poses(target,targetNames)}));
  const sourceMixer = new THREE.AnimationMixer(source);
  const sourceAction=sourceMixer.clipAction(animations[0]).play();
  const targetClip=retargetCmuPilotClip(source,target,animations,"WALK");
  const targetMixer=new THREE.AnimationMixer(target);
  const targetAction=targetMixer.clipAction(targetClip).play();
  const s={}; const t={};
  for(const [rig,out,l,r,lf,rf,lk,rk] of [
    [source,s,"lfemur","rfemur","lfoot","rfoot","ltibia","rtibia"],
    [target,t,"thigh_l","thigh_r","foot_l","foot_r","calf_l","calf_r"],
  ]){
    out.rest=poses(rig,[l,r,lf,rf,lk,rk]);
    const side=rig.getObjectByName(l).getWorldPosition(new THREE.Vector3()).sub(rig.getObjectByName(r).getWorldPosition(new THREE.Vector3())).normalize();
    out.side=side.toArray().map(x=>Number(x.toFixed(3)));
  }
  for(const [time,i] of samples.map((x,i)=>[x,i])){
    sourceAction.time=time; sourceMixer.update(0);
    targetAction.time=time; targetMixer.update(0);
    for(const [rig,out,lf,rf,lk,rk] of [
      [source,s,"lfoot","rfoot","ltibia","rtibia"],
      [target,t,"foot_l","foot_r","calf_l","calf_r"],
    ]){
      rig.updateWorldMatrix(true,true);
      const p=rig.getObjectByName(lf).getWorldPosition(new THREE.Vector3());
      const q=rig.getObjectByName(rf).getWorldPosition(new THREE.Vector3());
      const lkn=rig.getObjectByName(lk).getWorldPosition(new THREE.Vector3());
      const rkn=rig.getObjectByName(rk).getWorldPosition(new THREE.Vector3());
      const side=new THREE.Vector3(...out.side);
      (out.samples??=[]).push({t:time,sep:Number(p.clone().sub(q).dot(side).toFixed(3)),kneeSep:Number(lkn.clone().sub(rkn).dot(side).toFixed(3)),feet:[p.toArray().map(x=>Number(x.toFixed(3))),q.toArray().map(x=>Number(x.toFixed(3)))]});
    }
  }
  console.log("LEG_COMPARE",JSON.stringify({variant,source:s,target:t}));
}
