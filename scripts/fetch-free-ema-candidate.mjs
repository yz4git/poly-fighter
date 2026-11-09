/**
 * Temporary source review: artist's explicitly free "No thanks" download
 * flow. Never pays, logs in, bypasses gates, commits or uploads source files.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
const executable=process.env.WEBDRIVER_BIN;
if(!executable)throw new Error("ChromeDriver required");
const out=path.resolve(process.env.EMA_DOWNLOAD_DIR??"artifacts/ema-candidate-private");
await mkdir(out,{recursive:true});
const port=9549;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const driver=spawn(executable,["--port="+port,"--allowed-ips="],{stdio:"ignore"});
let session=null;
async function request(endpoint,method="GET",body){
  const res=await fetch("http://127.0.0.1:"+port+endpoint,{
    method,headers:body?{"content-type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined
  });
  const response=await res.json().catch(()=>({}));
  if(!res.ok||response.value?.error)
    throw new Error(endpoint+" "+JSON.stringify(response).slice(0,800));
  return response.value;
}
const js=(script,args=[])=>request("/session/"+session+"/execute/sync","POST",{script,args});
const address=()=>request("/session/"+session+"/url");
const visit=url=>request("/session/"+session+"/url","POST",{url});
const shortText=()=>js("return document.body?.innerText?.slice(0,1400)??'';");
try{
  let ready=false;
  for(let i=0;i<150;i++){try{await request("/status");ready=true;break;}catch{await wait(100);}}
  if(!ready)throw Error("ChromeDriver unavailable");
  const r=await request("/session","POST",{capabilities:{alwaysMatch:{
    browserName:"chrome","goog:chromeOptions":{
      args:["--headless=new","--no-sandbox","--disable-dev-shm-usage",
        "--disable-popup-blocking","--window-size=1400,850"],
      prefs:{"download.default_directory":out,
        "download.prompt_for_download":false,
        "download.directory_upgrade":true,
        "safebrowsing.enabled":true}
    }
  }}});
  session=r.sessionId;
  await request("/session/"+session+"/goog/cdp/execute","POST",{
    cmd:"Browser.setDownloadBehavior",params:{behavior:"allow",downloadPath:out}
  });
  await visit("https://theunseenvulga.itch.io/3d-character-riggedema/purchase");
  await wait(950);
  const clicked=await js(
    "const elements=[...document.querySelectorAll('a,button,input[type=submit]')];"+
    "const target=elements.find(x=>/no thanks.*downloads/i.test(x.textContent||x.value||''));"+
    "if(!target)return false;target.click();return true;"
  );
  if(!clicked)throw new Error("Official free skip-payment link not found: "+await shortText());
  let url=await address(),links=[];
  for(let i=0;i<100;i++){
    url=await address();
    links=await js(
      "return [...document.querySelectorAll('a')].map(el=>({"+
      "text:el.innerText?.trim().slice(0,80)||'',"+
      "href:el.getAttribute('href')||'',"+
      "parent:el.parentElement?.parentElement?.innerText?.slice(0,140)||''"+
      "})).filter(x=>/ema\\.glb|download/i.test(x.text+' '+x.parent)).slice(0,40);"
    );
    if(/\/download\b/.test(url) && links.length)break;
    await wait(150);
  }
  const clickedFile=await js(
    "const labels=[...document.querySelectorAll('*')].filter(x=>"+
      "x.children.length===0&&x.textContent?.trim()==='EMA.glb');"+
    "for(const label of labels){"+
      "for(let p=label.parentElement;p&&p!==document.body;p=p.parentElement){"+
        "if((p.innerText||'').length>400)break;"+
        "const anchors=[...p.querySelectorAll('a')].filter(a=>"+
          "/download/i.test(a.textContent||'')&&a.getAttribute('href')!=='#');"+
        "if(anchors.length){anchors[0].click();return true;}"+
      "}"+
    "}"+
    "return false;"
  );
  if(!clickedFile)throw new Error("EMA.glb not offered by public page: "+
    JSON.stringify({url,links}).slice(0,1900));
  let file=null;
  for(let i=0;i<180;i++){
    const files=await readdir(out);
    for(const name of files){
      if(!name.toLowerCase().endsWith(".glb"))continue;
      const size=(await stat(path.join(out,name))).size;
      if(size>1000000){file=path.join(out,name);break;}
    }
    if(file)break;
    await wait(200);
  }
  if(!file)throw new Error("Official free file transfer did not complete: "+
    JSON.stringify({url:await address(),files:await readdir(out),links}).slice(0,1800));
  const stats=await stat(file);
  await writeFile(path.join(out,"download-audit.json"),JSON.stringify({
    originalSource:"https://theunseenvulga.itch.io/3d-character-riggedema",
    author:"THEUNSEENVULGA",
    licenseAsStatedByAuthor:"CC0-1.0",
    role:"REFERENCE_ONLY_NOT_APPROVED_SERA",
    downloadedFilename:path.basename(file),bytes:stats.size,
    neverSoldOrPaid:true,downloadedViaPublicNoThanksFlow:true,
    notForRedistribution:true
  },null,2));
  console.log("EMA_CC0_ARTIST_SOURCE_DOWNLOADED",file,stats.size);
}finally{
  if(session)await request("/session/"+session,"DELETE").catch(()=>{});
  driver.kill("SIGTERM");
}
