import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const out = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-signature-combos";
if (!driver) throw Error("WEBDRIVER_BIN missing");
const port=9545, delay = ms => new Promise(r=>setTimeout(r,ms));
const proc=spawn(driver,[`--port=${port}`,"--allowed-ips="],{stdio:["ignore","pipe","pipe"]});
let log="";proc.stderr.on("data",c=>log+=String(c));
async function api(path, method="GET", body){
  const res=await fetch(`http://127.0.0.1:${port}${path}`,{
    method,headers:body===undefined?undefined:{"content-type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok||json.value?.error)throw Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json.value;
}
async function run(id,script,args=[]){return api(`/session/${id}/execute/sync`,"POST",{script,args});}
const lookup=`function findGame(){
  const host=document.querySelector("main.poly-app");if(!host)return null;
  const key=Object.keys(host).find(k=>k.startsWith("__reactFiber$"));let f=key?host[key]:null;
  const seen=new Set();while(f&&!seen.has(f)){seen.add(f);let h=f.memoizedState;
    while(h){const v=h.memoizedState,c=v&&typeof v==="object"&&"current"in v?v.current:null;
      if(c&&c.p1&&c.p2&&c.renderer&&c.camera&&c.scene)return c;h=h.next;}f=f.return;
  }return null;
}`;
let session;
try {
  for(let i=0;i<150;i++){try{if((await fetch(`http://127.0.0.1:${port}/status`)).ok)break;}catch{}await delay(100);}
  const s=await api("/session","POST",{capabilities:{alwaysMatch:{browserName:"chrome","goog:chromeOptions":{args:["--headless=new","--no-sandbox","--disable-dev-shm-usage","--ignore-gpu-blocklist","--enable-webgl","--use-angle=swiftshader","--window-size=1200,650"]}}}});
  session=s.sessionId;
  await api(`/session/${session}/url`,"POST",{url});await delay(750);
  const click=label=>run(session,`const b=[...document.querySelectorAll("button")].find(x=>x.textContent?.includes(arguments[0]));if(!b)return false;b.click();return true;`,[label]);
  if(!await click("START FIGHT"))throw Error("missing title");
  await delay(180);
  if(!await click("ENGAGE"))throw Error("missing battle");
  let ready=false;
  for(let i=0;i<120;i++){
    ready=await run(session,`${lookup}const g=findGame();return !!g&&g.p1.visual.root.userData.combatMotionClipCount>25;`);
    if(ready)break;await delay(120);
  }
  if(!ready)throw Error(`fighter not ready ${log.slice(-1000)}`);
  await mkdir(out,{recursive:true});
  const observations=await run(session,`${lookup}
    const g=findGame();cancelAnimationFrame(g.raf);g.running=false;g.paused=false;g.finished=false;g.input.clear();
    g.enemyOpeningGraceTicks=9999;
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    const reset=()=>{
      g.p1.resetForRound(0,.80,1);g.p2.resetForRound(0,-.40,-1);
      g.p1.hitStop=0;g.p2.hitStop=0;g.p1.guardDamage=0;
      g.playerEvadeTicks=0;g.playerEvadeCooldown=0;g.playerGuardPunishTicks=0;
      g.playerGuardCrouching=false;g.p1.input={...neutral};g.p1.previousInput={...neutral};
      g.p1.visual.root.userData.tpsGuardLevel=null;g.p2.currentMove=null;g.p2.state="IDLE";
    };
    const hold=(low)=>{
      g.updatePlayer({...neutral,guard:true,down:low});
      for(let i=0;i<12;i++){g.p1.hitStop=0;g.p2.hitStop=0;g.updatePlayer({...neutral,guard:true,down:low});}
      g.p1.position.set(0,0,.80);g.p2.position.set(0,0,-.40);
      return {state:g.p1.state,guardLevel:g.p1.visual.root.userData.tpsGuardLevel};
    };
    const attack=(id)=>{
      g.p2.currentMove=null;g.p2.state="IDLE";g.p2.hitStop=0;g.p1.hitStop=0;
      g.p2.beginMove(id);g.p2.moveTick=g.p2.currentMove.startup;
      g.trackCommittedAttack(g.p2,g.p1);const before=g.p1.health;
      g.resolveAttack(g.p2,g.p1,true);
      return {state:g.p1.state,damage:before-g.p1.health,blocked:g.p1.state==="BLOCK_STUN",
         punish:g.playerGuardPunishTicks,level:g.p1.visual.root.userData.tpsLastGuardBlockedLevel};
    };
    reset();const stand=hold(false);const standMid=attack("powerRush");
    reset();const standLow=hold(false);const lowBreak=attack("lowKick");
    reset();const lowGuard=hold(true);const blockedLow=attack("lowKick");
    reset();const lowVsMid=hold(true);const midBreak=attack("straight");
    reset();const throwGuard=hold(false);
    g.updatePlayer({...neutral,guard:true,punch:true});
    const playerThrow={move:g.p1.currentMove?.id,state:g.p1.state};
    g.p1.state="GUARD";g.p1.currentMove=null;g.p1.hitStop=0;g.p1.setInput({...neutral,guard:true});
    let now=performance.now()/1000;for(let i=0;i<12;i++){
      now+=1/60;g.updateVisual(g.p1,g.p2,now);g.updateVisual(g.p2,g.p1,now+.01);
    }
    g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
    return {stand,standMid,standLow,lowBreak,lowGuard,blockedLow,lowVsMid,midBreak,throwGuard,playerThrow};
  `);
  if(observations.stand?.state!=="GUARD"||observations.stand.guardLevel!=="STANDING")throw Error("standing hold guard failed "+JSON.stringify(observations));
  if(!observations.standMid?.blocked||observations.standMid.damage!==0||observations.standMid.punish<=0)throw Error("guard punish failed "+JSON.stringify(observations));
  if(observations.lowBreak.damage<=0||observations.lowBreak.blocked)throw Error("low didn't open standing guard "+JSON.stringify(observations));
  if(!observations.blockedLow.blocked||observations.blockedLow.damage!==0)throw Error("low guard didn't stop sweep "+JSON.stringify(observations));
  if(observations.midBreak.damage<=0||observations.midBreak.blocked)throw Error("mid didn't beat low guard "+JSON.stringify(observations));
  if(observations.playerThrow.move!=="throw")throw Error("throw inaccessible on touch buttons "+JSON.stringify(observations));
  await writeFile(`${out}/defense-triangle.json`,JSON.stringify(observations,null,2));
  const png=Buffer.from(await api(`/session/${session}/screenshot`),"base64");
  if(png.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("not PNG");
  await writeFile(`${out}/tps-guard-throw.png`,png);
  console.log(JSON.stringify(observations));
}finally{
  if(session)await api(`/session/${session}`,"DELETE").catch(()=>{});
  proc.kill("SIGTERM");
}
