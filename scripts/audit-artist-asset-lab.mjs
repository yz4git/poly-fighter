// Browser proof of the real iPhone-oriented art-intake workflow.
// Uses the existing V2 GLB ONLY as a technical test fixture, NOT as approved art.
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const driverPath=process.env.WEBDRIVER_BIN;
if (!driverPath) throw new Error("WEBDRIVER_BIN required");
const root=process.env.PREVIEW_URL ?? "http://127.0.0.1:3000/";
const output=process.env.ARTIST_LAB_AUDIT_DIR ?? "artifacts/artist-lab-real-webgl";
const inputPath=path.resolve("public/models/hero/sera-hero-pbr.glb");
const port=9577;
const wait=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
const driver=spawn(driverPath,["--port="+port,"--allowed-ips="],{stdio:"ignore"});
let session=null;
async function request(url,method="GET",body){
  const response=await fetch("http://127.0.0.1:"+port+url,{
    method,headers:body?{"content-type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok || result.value?.error)throw new Error(url+": "+JSON.stringify(result));
  return result.value;
}
const js=(script,args=[])=>request("/session/"+session+"/execute/sync","POST",{script,args});
const click=async label=>js(
  "const btn=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes(arguments[0]));"
  +"if(!btn)return false;btn.click();return true;",[label]);
async function state(){
  return js(
    "const lab=document.querySelector('section[aria-label=\"SERA Artist Asset Lab\"]');"
    +"const c=lab?.querySelector('canvas');return {"
    +"active:!!lab,canvas:!!c,"
    +"glbState:lab?.dataset.assetIntakeState ?? '',"
    +"triangles:Number(lab?.dataset.assetTriangles ?? 0),"
    +"message:lab?.querySelector('[role=status]')?.textContent?.slice(0,300) ?? ''"
    +"};");
}
async function capture(name){
  const data=Buffer.from(await request("/session/"+session+"/screenshot"),"base64");
  if(data.length<2000 || data.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
    throw new Error("Screenshot not actual PNG data");
  await writeFile(output+"/"+name+".png",data);
}
try {
  let available=false;
  for(let i=0;i<200;i++){
    try{await request("/status");available=true;break;}catch{await wait(100);}
  }
  if(!available)throw new Error("ChromeDriver unavailable");
  const response=await request("/session","POST",{capabilities:{alwaysMatch:{
    browserName:"chrome","goog:chromeOptions":{args:[
      "--headless=new","--no-sandbox","--disable-dev-shm-usage",
      "--ignore-gpu-blocklist","--enable-webgl","--use-angle=swiftshader",
      "--window-size=1450,770","--hide-scrollbars"
    ]}
  }}});
  session=response.sessionId;
  await request("/session/"+session+"/url","POST",{url:root});
  await wait(750);
  if(!await click("MODEL VIEW"))throw new Error("Cannot enter MODEL VIEW");
  await wait(400);
  if(!await click("ARTIST ASSET LAB / GLB"))throw new Error("ARTIST ASSET LAB button missing");
  await wait(300);
  const before=await state();
  if(!before.active||!before.canvas||before.glbState!=="empty")
    throw new Error("New artist-first browser lab failed to initialize: "+JSON.stringify(before));
  await mkdir(output,{recursive:true});
  await capture("00-artist-lab-empty");
  // Only the actual file upload protocol can exercise browser blob loading.
  // Temporarily show the input in the CI browser; user UI still uses a label.
  await js(
    "const el=document.querySelector('section[aria-label=\"SERA Artist Asset Lab\"] input[type=file]');"
    +"if(!el)return false;el.style.display='block';return true;");
  const elements=await request("/session/"+session+"/elements","POST",{
    using:"css selector",value:"section[aria-label='SERA Artist Asset Lab'] input[type=file]"
  });
  const elementId=elements?.[0]?.["element-6066-11e4-a52e-4f735466cecf"];
  if(!elementId)throw new Error("Artist file input missing");
  await request("/session/"+session+"/element/"+elementId+"/value","POST",{
    text:inputPath,value:[...inputPath]
  });
  let current;
  for(let i=0;i<200;i++){
    current=await state();
    if(current.glbState==="tech-pass" || current.glbState==="rejected") break;
    await wait(200);
  }
  if(current?.glbState!=="tech-pass"||current.triangles<10000)
    throw new Error("Real GLB import did not complete: "+JSON.stringify(current));
  await wait(350);
  await capture("01-artist-v2-technical-fixture-only");
  if(!await click("FACE"))throw new Error("Face camera missing");
  await wait(200);
  await capture("02-face-review-technical-fixture-only");
  await writeFile(output+"/actual-browser-result.json",JSON.stringify({
    before,after:current,
    note:"V2 fixture demonstrates only local GLB import; it is NOT approved SERA art",
  },null,2));
  console.log("ARTIST_LAB_REAL_WEBGL_FILE_IMPORT_PASSED",JSON.stringify(current));
} finally {
  if(session) await request("/session/"+session,"DELETE").catch(()=>{});
  driver.kill("SIGTERM");
}
