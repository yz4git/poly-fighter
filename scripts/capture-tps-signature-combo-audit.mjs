import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const output = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-signature-combos";
if (!driver) throw new Error("WEBDRIVER_BIN is required");
const port = 9544, sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const proc = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
proc.stderr.on("data", c => { log += String(c); });
proc.stdout.on("data", c => { log += String(c); });
async function request(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.value?.error) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json.value;
}
const lookup = `function findGame(){
  const host=document.querySelector("main.poly-app");if(!host)return null;
  const key=Object.keys(host).find(k=>k.startsWith("__reactFiber$"));let fiber=key?host[key]:null;
  const visited=new Set();while(fiber&&!visited.has(fiber)){
    visited.add(fiber);let hook=fiber.memoizedState;
    while(hook){const v=hook.memoizedState, c=v&&typeof v==="object"&&"current"in v?v.current:null;
    if(c&&c.p1&&c.p2&&c.renderer&&c.camera&&c.scene)return c;hook=hook.next;}fiber=fiber.return;
  }return null;
}`;
async function execute(id, code, args = []) {
  return request(`/session/${id}/execute/sync`, "POST", { script: code, args });
}
async function click(id, label) {
  return execute(id, `const button=[...document.querySelectorAll("button")].find(b=>b.textContent?.includes(arguments[0]));if(!button)return false;button.click();return true;`, [label]);
}
async function screenshot(id, path) {
  const png=Buffer.from(await request(`/session/${id}/screenshot`), "base64");
  if(png.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("Screenshot not PNG");
  await writeFile(path,png);
}
let session=null;
try {
  for(let i=0;i<150;i++){try{const r=await fetch(`http://127.0.0.1:${port}/status`);if(r.ok)break;}catch{}await sleep(100);}
  const value=await request("/session","POST",{capabilities:{alwaysMatch:{browserName:"chrome","goog:chromeOptions":{args:["--headless=new","--no-sandbox","--disable-dev-shm-usage","--ignore-gpu-blocklist","--enable-webgl","--use-angle=swiftshader","--window-size=1200,650"]}}}});
  session=value.sessionId;
  await request(`/session/${session}/url`,"POST",{url});
  await sleep(800);
  if(!(await click(session,"START FIGHT")))throw Error("Title not ready");
  await sleep(250);
  if(!(await click(session,"ENGAGE")))throw Error("Match not ready");
  let ready=false;
  for(let i=0;i<180;i++){
    ready=await execute(session,`${lookup}const g=findGame();return !!g&&g.p1.visual.root.userData.cinematicMotionClipCount>=5;`);
    if(ready)break;
    await sleep(150);
  }
  if(!ready)throw Error(`Cinematic rig not ready (driver: ${log.slice(-1500)})`);
  await mkdir(output,{recursive:true});
  // Step real physics between individually authored strike windows. This is an
  // integration check of the actual TPS scene, not a mock of hit calculations.
  const results=await execute(session,`${lookup}
    const g=findGame();
    cancelAnimationFrame(g.raf);g.running=false;g.paused=false;g.finished=false;
    g.finishPending=false;g.input.clear();g.enemyOpeningGraceTicks=99999;
    g.p1.resetForRound(0,.85,1);g.p2.resetForRound(0,-.58,-1);
    g.p1.health=100;g.p2.health=100;g.airCombo=null;
    g.p1.hitStop=0;g.p2.hitStop=0;
    let now=performance.now()/1000;
    const advance=frames=>{for(let i=0;i<frames;i++){g.p1.hitStop=0;g.p2.hitStop=0;g.p2.updatePhysics(1/60);}};
    const hit=(id)=>{
      g.p1.currentMove=null;g.p1.state="IDLE";g.p1.hitStop=0;
      if(!g.p1.beginMove(id))return{error:"cannot begin "+id};
      g.p1.moveTick=g.p1.currentMove.startup;
      g.trackCommittedAttack(g.p1,g.p2);
      g.resolveAttack(g.p1,g.p2,false);
      for(let n=0;n<12;n++){now+=1/60;g.updateVisual(g.p1,g.p2,now);g.updateVisual(g.p2,g.p1,now+.001);}
      g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
      return {name:id,chain:g.airCombo?.hits??0,hp:g.p2.health,y:g.p2.position.y,
       vy:g.p2.velocity.y,state:g.p2.state,clip:g.p1.visual.root.userData.combatMotionCurrentClip,
       cinematicClips:g.p1.visual.root.userData.cinematicMotionClipCount};
    };
    const launch=hit("skyBreaker");
    advance(15);const aerial1=hit("airChase");
    advance(12);const aerial2=hit("airChase");
    advance(12);const slam=hit("meteorSlam");
    return {launch,aerial1,aerial2,slam};
  `);
  if(results.launch?.chain!==1||results.launch.vy<6)throw Error(`Launcher failed: ${JSON.stringify(results)}`);
  if(results.aerial1?.chain!==2||results.aerial2?.chain!==3)throw Error(`Aerial follow-up failed: ${JSON.stringify(results)}`);
  if(results.slam?.chain!==0||results.slam.vy> -5)throw Error(`Meteor finish failed: ${JSON.stringify(results)}`);
  for(const item of Object.values(results)) {
    if(item.error||!item.clip?.startsWith("FX_"))throw Error(`Cinematic clip not bound: ${JSON.stringify(results)}`);
  }
  // Also test the real TPS two-button selector. The subclass overrides the
  // core attack chooser: a direct move test alone cannot catch that mismatch.
  const selection=await execute(session,`${lookup}
    const g=findGame();
    g.p1.resetForRound(0,.85,1);g.p2.resetForRound(0,-.58,-1);
    g.playerComboStage=1;g.playerFlankWindowTicks=0;g.playerReversalTicks=0;
    g.playerInterceptTicks=0;g.playerPerfectEvadeTicks=0;g.playerStepSideWeight=0;
    g.airCombo=null;
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    g.p1.setInput({...neutral,up:true,punch:true});
    const launchStarted=g.beginContextAttack();
    const launcher=g.p1.currentMove?.id??null;
    g.p1.currentMove=null;g.p1.state="IDLE";
    g.p2.grounded=false;g.p2.state="HIT";g.p2.position.y=1.3;
    g.airCombo={attackerId:"p1",defenderId:"p2",hits:1,remainingTicks:90};
    g.playerComboStage=2;
    g.p1.setInput({...neutral,punch:true});
    const chaseStarted=g.beginContextAttack();
    const chase=g.p1.currentMove?.id??null;
    g.p1.currentMove=null;g.p1.state="IDLE";
    g.airCombo={attackerId:"p1",defenderId:"p2",hits:3,remainingTicks:90};
    g.playerComboStage=4;
    g.p1.setInput({...neutral,punch:true});
    const finishStarted=g.beginContextAttack();
    return {launchStarted,launcher,chaseStarted,chase,finishStarted,finisher:g.p1.currentMove?.id??null};
  `);
  if(!selection.launchStarted||selection.launcher!=="skyBreaker"
    ||!selection.chaseStarted||selection.chase!=="airChase"
    ||!selection.finishStarted||selection.finisher!=="meteorSlam"){
    throw Error(`TPS input combo selector failed: ${JSON.stringify(selection)}`);
  }
  await screenshot(session,`${output}/tps-signature-meteor.png`);
  await writeFile(`${output}/signature-air-combo.json`,JSON.stringify({ ...results, selection },null,2));
  console.log(JSON.stringify({ ...results, selection },null,2));
}finally{
  if(session)await request(`/session/${session}`,"DELETE").catch(()=>undefined);
  proc.kill("SIGTERM");
}
