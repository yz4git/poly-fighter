/**
 * Optional discovery probe: verify whether more suitable martial arts kick
 * source files from CMU subject 135 have GLB conversions.
 */
const names=[
  "135_04-front-kick",
  "135_07-mawashigeri",
  "135_11-yokogeri",
  "141_14-punch-and-kick",
  "143_24-kicking",
];
for(const name of names){
  const url=`https://huggingface.co/datasets/codepawl/cmu-mocap-glb/resolve/main/skeleton/${name}/${name}_skeleton.glb`;
  try{
    const r=await fetch(url,{method:"HEAD",signal:AbortSignal.timeout(12000)});
    console.log(JSON.stringify({name,status:r.status,size:r.headers.get("content-length"),url:r.url}));
  }catch(e){console.log(JSON.stringify({name,error:String(e)}));}
}
try{
  const r=await fetch("https://huggingface.co/api/datasets/codepawl/cmu-mocap-glb/tree/main/skeleton?limit=1000",{signal:AbortSignal.timeout(18000)});
  if(r.ok){const data=await r.json(); console.log("MARTIAL_DIRECTORY_NAMES",JSON.stringify(data.filter(x=>/135_|141_14|143_24/i.test(x.path)).map(x=>x.path)));}
  else console.log("MARTIAL_DIRECTORY_FAIL",r.status);
}catch(e){console.log("MARTIAL_DIRECTORY_ERROR",String(e));}
