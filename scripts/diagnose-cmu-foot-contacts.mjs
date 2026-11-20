import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CMU_MOCAP_PILOT_CLIPS, cmuMocapPilotUrl } from "../src/game/cmu-mocap-pilot.ts";

const loader = new GLTFLoader();
for (const entry of CMU_MOCAP_PILOT_CLIPS) {
  const response = await fetch(cmuMocapPilotUrl(entry.id), {signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(entry.id + " HTTP " + response.status);
  const gltf = await loader.parseAsync(await response.arrayBuffer(),"");
  const root = gltf.scene;
  const clip = gltf.animations.reduce((a,b)=>a.duration>b.duration?a:b);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip).play();
  action.setLoop(THREE.LoopOnce,1);
  action.clampWhenFinished = true;
  const foot = ["ltoes","rtoes"].map(name => root.getObjectByName(name));
  if (foot.some(x=>!x))throw new Error("missing source toe bones");
  const count=Math.ceil(clip.duration*30);
  const data=[[],[]];
  for(let frame=0;frame<=count;frame++){
    const t=clip.duration*frame/count;
    mixer.setTime(t);
    root.updateWorldMatrix(true,true);
    for(let s=0;s<2;s++){
      data[s].push({t,p:foot[s].getWorldPosition(new THREE.Vector3()).toArray()});
    }
  }
  const stats=data.map((frames,s)=>{
    const heights=frames.map(x=>x.p[1]);
    const min=Math.min(...heights);
    const v=frames.map((frame,i)=>{
      if(!i)return 0;
      const a=new THREE.Vector3(...frame.p);
      const b=new THREE.Vector3(...frames[i-1].p);
      return a.sub(b).length()/(clip.duration/count);
    });
    const nearFloor=frames.map((x,i)=>x.p[1]-min<0.08?i:-1).filter(i=>i>=0);
    const stationary=frames.map((x,i)=>x.p[1]-min<0.08&&v[i]<0.16?i:-1).filter(i=>i>=0);
    const percentile=(arr,q)=>arr.length?arr.slice().sort((a,b)=>a-b)[Math.floor((arr.length-1)*q)]:null;
    const islands=[];
    for(const i of stationary){if(!islands.length||i>islands[islands.length-1].end+1)islands.push({start:i,end:i});else islands[islands.length-1].end=i;}
    return {side:s===0?"L":"R",minHeight:min,
      floorFraction:nearFloor.length/frames.length,lockedFraction:stationary.length/frames.length,
      v:{p10:percentile(v,.1),p25:percentile(v,.25),p50:percentile(v,.5),p75:percentile(v,.75),p95:percentile(v,.95)},
      nearFloorSpeed:{p10:percentile(nearFloor.map(i=>v[i]),.1),p50:percentile(nearFloor.map(i=>v[i]),.5),p90:percentile(nearFloor.map(i=>v[i]),.9)},
      stationaryRuns:islands.filter(x=>x.end-x.start>=5).slice(0,25).map(x=>({s:+(x.start/30).toFixed(2),e:+(x.end/30).toFixed(2)}))};
  });
  mixer.stopAllAction();mixer.uncacheRoot(root);
  console.log("CMU_CONTACT_DISTRIBUTION",JSON.stringify({clip:entry.id,duration:clip.duration,stats}));
}
