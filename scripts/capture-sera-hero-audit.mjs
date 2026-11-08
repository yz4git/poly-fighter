// Genuine Chromium WebGL validation; screenshots are always from the canvas.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const executable=process.env.WEBDRIVER_BIN;
if(!executable) throw new Error("WEBDRIVER_BIN is required");
const target=process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const out=process.env.SERA_HERO_AUDIT_DIR ?? "artifacts/sera-hero-browser";
const port=9523;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const driver=spawn(executable,["--port="+port,"--allowed-ips="],{stdio:"ignore"});
let session=null;
async function request(path,method="GET",payload){
 const response=await fetch("http://127.0.0.1:"+port+path,{
  method,headers:payload?{"content-type":"application/json"}:undefined,
  body:payload?JSON.stringify(payload):undefined
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok || data.value?.error)throw new Error(path+" "+JSON.stringify(data));
 return data.value;
}
async function js(script,args=[]){
 return request("/session/"+session+"/execute/sync","POST",{script,args});
}
async function screenshot(name){
 const png=Buffer.from(await request("/session/"+session+"/screenshot"),"base64");
 if(png.length<1000 || png.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
  throw new Error("Invalid actual browser screenshot "+name);
 await writeFile(out+"/"+name+".png",png);
}
async function click(text){
 return js("const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes(arguments[0]));if(!b)return false;b.click();return true;",[text]);
}
async function state(){
 return js("const canvas=document.querySelector('section[aria-label=\"Model View\"] canvas');"+
 "const data=canvas?.dataset;return {"+
 "canvas:!!canvas,webgl:!!(canvas && (canvas.getContext('webgl2')||canvas.getContext('webgl'))),"+
 "modelState:data?.heroModelState??'absent',mappedBones:Number(data?.heroMappedBones??0),"+
 "triangles:Number(data?.heroPbrTriangleCount??0),"+
 "texturedMaterials:Number(data?.heroPbrTextureMaterials??0),error:data?.heroModelError??'',"+
 "raw:document.querySelector('section[aria-label=\"Model View\"]')?.textContent?.slice(0,700)??''};");
}
try{
 let connected=false;
 for(let i=0;i<200;i++){
  try{await request("/status");connected=true;break;}catch{await wait(100);}
 }
 if(!connected)throw new Error("ChromeDriver unavailable");
 const response=await request("/session","POST",{capabilities:{alwaysMatch:{
  browserName:"chrome","goog:chromeOptions":{args:[
   "--headless=new","--no-sandbox","--disable-dev-shm-usage",
   "--ignore-gpu-blocklist","--enable-webgl","--use-angle=swiftshader",
   "--window-size=1536,706","--hide-scrollbars"
  ]}
 }}});
 session=response.sessionId;
 await request("/session/"+session+"/url","POST",{url:target});
 await wait(600);
 if(!await click("MODEL VIEW"))throw new Error("MODEL VIEW button missing");
 await wait(250);
 const modelChoice=process.env.SERA_HERO_CHOICE ?? "SERA HERO PBR";
 if(!await click(modelChoice))throw new Error("Hero model switch missing: "+modelChoice);
 let current;
 for(let i=0;i<200;i++){
  current=await state();
  if(current.modelState==="failed")throw new Error("Hero GLB failed: "+current.error);
  if(current.modelState==="ready")break;
  await wait(150);
 }
 if(current?.modelState!=="ready")throw new Error("Hero runtime never ready: "+JSON.stringify(current));
 if(current.mappedBones<20 || current.triangles<10000 || current.texturedMaterials<1 || !current.webgl){
  throw new Error("Actual GLB/retarget validation failed: "+JSON.stringify(current));
 }
 await mkdir(out,{recursive:true});
 await screenshot("sera-hero-idle");
 const select=await js("const el=document.querySelector('select[aria-label=\"Motion clip\"]');"+
 "if(!el)return false;const v='BF_Power_R';"+
 "if(![...el.options].some(o=>o.value===v))return false;"+
 "const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;"+
 "setter.call(el,v);el.dispatchEvent(new Event('change',{bubbles:true}));return true;");
 if(!select)throw new Error("Blender strike clip not available");
 await wait(450);
 await screenshot("sera-hero-power");
 const final=await state();
 if(final.modelState!=="ready")throw new Error("Hero disappeared while animating: "+JSON.stringify(final));
 await writeFile(out+"/hero-browser-state.json",JSON.stringify({idle:current,afterAttack:final},null,2));
 console.log("REAL_SERA_HERO_WEBGL_OK",JSON.stringify(final));
}finally{
 if(session)await request("/session/"+session,"DELETE").catch(()=>{});
 driver.kill("SIGTERM");
}
