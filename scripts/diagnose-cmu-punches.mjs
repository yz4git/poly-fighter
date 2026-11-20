import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cmuMocapPilotUrl } from "../src/game/cmu-mocap-pilot.ts";

const response = await fetch(cmuMocapPilotUrl("BOXING"), {signal:AbortSignal.timeout(30000)});
if (!response.ok) throw new Error("CMU BOXING HTTP "+response.status);
const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
const root = gltf.scene;
const clip = gltf.animations.reduce((a,b)=>a.duration>b.duration?a:b);
const joints = Object.fromEntries(["root","thorax","lfemur","rfemur","lhumerus","rhumerus","lradius","rradius","lwrist","rwrist","lhand","rhand","head"].map(name=>[name,root.getObjectByName(name)]));
for(const [name, node] of Object.entries(joints)) if(!node)throw Error("Missing source joint "+name);
const mixer=new THREE.AnimationMixer(root);
const action=mixer.clipAction(clip);
action.play();action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;
const n=Math.ceil(clip.duration*30), dt=clip.duration/n;
const poses=[];
const position=(name)=>joints[name].getWorldPosition(new THREE.Vector3());
const stats={L:[],R:[]};
for(let i=0;i<=n;i++){
 mixer.setTime(i*dt);root.updateWorldMatrix(true,true);
 const side=position("lfemur").sub(position("rfemur")).normalize();
 const up=position("thorax").sub(position("root")).normalize();
 const forward=side.clone().cross(up).normalize();
 const arms={};
 for(const [label,prefix] of [["L","l"],["R","r"]]){
  const shoulder=position(prefix+"humerus");
  const elbow=position(prefix+"radius");
  const wrist=position(prefix+"wrist");
  const hand=position(prefix+"hand");
  const rel=wrist.clone().sub(shoulder);
  const elbowBend=THREE.MathUtils.radToDeg(elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow)));
  arms[label]={wrist,shoulder,rel,forward:rel.dot(forward),side:rel.dot(side),up:rel.dot(up),reach:rel.length(),bend:elbowBend};
  stats[label].push({t:i*dt,forward:arms[label].forward,side:arms[label].side,up:arms[label].up,reach:arms[label].reach,bend:elbowBend});
 }
 poses.push(arms);
}
for(const hand of ["L","R"]){
 const series=stats[hand], speeds=series.map((v,i)=>{
  if(!i)return 0;
  return poses[i][hand].rel.distanceTo(poses[i-1][hand].rel)/dt;
 });
 const peaks=[];
 for(let i=5;i<n-5;i++){
  const v=speeds[i];
  if(v<0.7||v<speeds[i-1]||v<speeds[i+1])continue;
  if(peaks.length&&i-peaks[peaks.length-1].i<9) {
    if(v>peaks[peaks.length-1].v)peaks[peaks.length-1]={i,v};
  }else peaks.push({i,v});
 }
 const top=peaks.sort((a,b)=>b.v-a.v).slice(0,25).map(p=>{
  const i=p.i, window=series.slice(Math.max(0,i-10),Math.min(n+1,i+20));
  const pre=series[Math.max(0,i-10)],now=series[i],post=series[Math.min(n,i+20)];
  const max=window.reduce((a,b)=>b.forward>a.forward?b:a);
  const min=window.reduce((a,b)=>b.forward<a.forward?b:a);
  return {t:+(i*dt).toFixed(2), speed:+p.v.toFixed(2),
   reach:+now.reach.toFixed(2),bend:+now.bend.toFixed(1),
   ahead:+now.forward.toFixed(2),preAhead:+pre.forward.toFixed(2),
   postAhead:+post.forward.toFixed(2), windowMaxAhead:+max.forward.toFixed(2),
   windowMinAhead:+min.forward.toFixed(2),
   preReach:+pre.reach.toFixed(2), postReach:+post.reach.toFixed(2)};
 });
 const percentile=(arr,q)=>arr.slice().sort((a,b)=>a-b)[Math.floor((arr.length-1)*q)];
 console.log("CMU_BOXING_PUNCH_SCAN",JSON.stringify({hand,
   forwardRange:[Math.min(...series.map(x=>x.forward)),Math.max(...series.map(x=>x.forward))],
   reachRange:[Math.min(...series.map(x=>x.reach)),Math.max(...series.map(x=>x.reach))],
   speedQuantiles:[.25,.5,.75,.9,.95,.98,.99].map(q=>[q,percentile(speeds,q)]),
   top
 }));
}
mixer.stopAllAction();mixer.uncacheRoot(root);
