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
  // Check actual bound two-button gameplay, not just pure input helpers.
  const throwUkemi=await run(session,`${lookup}
    const g=findGame();
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    g.p1.resetForRound(0,.54,1);g.p2.resetForRound(0,-.54,-1);
    g.p1.hitStop=0;g.p2.hitStop=0;g.playerThrowTechTicks=0;g.playerUkemiTicks=0;
    g.p2.beginMove("throw");
    g.p2.moveTick=Math.max(0,g.p2.currentMove.startup-3);
    const beforeHp=g.p1.health;
    g.updatePlayer({...neutral,punch:true});
    const buffered=g.playerThrowTechTicks;
    g.p2.moveTick=g.p2.currentMove.startup;
    g.trackCommittedAttack(g.p2,g.p1);
    g.resolveAttack(g.p2,g.p1,false);
    const throwBreak={
      buffered,health:g.p1.health,beforeHp,
      beat:g.combatBeatLabel,
      hasContact:g.p2.hitTargets.has(g.p1.id),
      bufferedAfter:g.playerThrowTechTicks,
    };
    g.p1.resetForRound(0,.72,1);g.p2.resetForRound(0,-.72,-1);
    g.p1.state="KNOCKDOWN";g.p1.knockdownTicks=34;
    g.p1.grounded=true;g.p1.hitStop=0;
    g.p1.input={...neutral};g.p1.previousInput={...neutral};
    g.playerUkemiTicks=0;
    const startX=g.p1.position.x;
    g.updatePlayer({...neutral,right:true,guard:true});
    const startTicks=g.playerUkemiTicks;
    for(let n=0;n<7;n++)g.updatePlayer({...neutral,right:true,guard:true});
    const ukemi={startTicks,endTicks:g.playerUkemiTicks,
      traveled:g.p1.position.x-startX,knockdownTicks:g.p1.knockdownTicks,
      state:g.p1.state,health:g.p1.health};
    let now=performance.now()/1000;
    for(let i=0;i<10;i++){now+=1/60;g.updateVisual(g.p1,g.p2,now);g.updateVisual(g.p2,g.p1,now+.01);}
    g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
    return {throwBreak,ukemi};
  `);
  if(throwUkemi.throwBreak.buffered<=0||throwUkemi.throwBreak.health!==throwUkemi.throwBreak.beforeHp
    ||!throwUkemi.throwBreak.hasContact||throwUkemi.throwBreak.bufferedAfter!==0
    ||throwUkemi.throwBreak.beat!=="THROW BREAK!")throw Error("timed throw break failed "+JSON.stringify(throwUkemi));
  if(throwUkemi.ukemi.startTicks!==7||throwUkemi.ukemi.endTicks!==0
    ||throwUkemi.ukemi.traveled<.42||throwUkemi.ukemi.health!==100)throw Error("directional wakeup roll failed "+JSON.stringify(throwUkemi));
  await writeFile(`${out}/throw-break-ukemi.json`,JSON.stringify(throwUkemi,null,2));
  const ukemiPng=Buffer.from(await api(`/session/${session}/screenshot`),"base64");
  if(ukemiPng.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("ukemi not PNG");
  await writeFile(`${out}/tps-ukemi-roll.png`,ukemiPng);
  // A second browser pass checks the *rendered* baked skeleton clips, not
  // merely the physical x displacement or the player's recovery flags.
  const throwVisual=await run(session,`${lookup}
    const g=findGame();
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    g.p1.resetForRound(0,.54,1);g.p2.resetForRound(0,-.54,-1);
    g.p1.hitStop=0;g.p2.hitStop=0;g.playerThrowTechTicks=0;g.input.clear();
    // Restore a genuine neutral visual pose before the event; the previous
    // audit may have left the imported skeleton half-way through a ground roll.
    g.renderTime=performance.now()/1000;
    for(let n=0;n<24;n++){
      g.renderTime+=1/60;
      g.updateVisual(g.p1,g.p2,g.renderTime);
      g.updateVisual(g.p2,g.p1,g.renderTime+.01);
    }
    g.p2.beginMove("throw");
    g.p2.moveTick=Math.max(0,g.p2.currentMove.startup-3);
    g.updatePlayer({...neutral,punch:true});
    g.p2.moveTick=g.p2.currentMove.startup;
    g.trackCommittedAttack(g.p2,g.p1);
    g.resolveAttack(g.p2,g.p1,false);
    // Sample a real post-hitstop mid-reaction, not frame zero of the blend.
    g.updateEnemy=()=>{g.p2.updatePhysics(1/60);};
    for(let n=0;n<15;n++){g.renderTime+=1/60;g.step();}
    g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
    return {playerClip:g.p1.visual.root.userData.combatMotionCurrentClip,
      enemyClip:g.p2.visual.root.userData.combatMotionCurrentClip,
      playerRole:g.p1.visual.root.userData.tpsThrowBreakRole,
      enemyRole:g.p2.visual.root.userData.tpsThrowBreakRole,
      playerPose:g.p1.visual.root.userData.tpsThrowBreakPoseTicks,
      enemyPose:g.p2.visual.root.userData.tpsThrowBreakPoseTicks,
      playerState:g.p1.state,enemyState:g.p2.state};
  `);
  if(throwVisual.playerClip!=="CM_ThrowTech_Defender"
    ||throwVisual.enemyClip!=="CM_ThrowTech_Attacker"
    ||throwVisual.playerRole!=="DEFENDER"||throwVisual.enemyRole!=="ATTACKER"
    ||throwVisual.playerState!=="HIT"||throwVisual.enemyState!=="HIT"
    ||throwVisual.playerPose<=0||throwVisual.enemyPose<=0)
    throw Error("rendered two-sided throw-tech clip missing "+JSON.stringify(throwVisual));
  const breakPng=Buffer.from(await api(`/session/${session}/screenshot`),"base64");
  if(breakPng.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("throw-break not PNG");
  await writeFile(`${out}/tps-throw-break-poses.png`,breakPng);

  const ukemiVisual=await run(session,`${lookup}
    const g=findGame();
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    g.p1.resetForRound(0,.72,1);g.p2.resetForRound(0,-.72,-1);
    g.p1.hitStop=0;g.p1.state="KNOCKDOWN";g.p1.grounded=true;g.p1.knockdownTicks=34;
    g.p1.input={...neutral};g.p1.previousInput={...neutral};g.playerUkemiTicks=0;g.playerUkemiPoseTicks=0;
    g.updatePlayer({...neutral,right:true,guard:true});
    for(let n=0;n<3;n++)g.updatePlayer({...neutral,right:true,guard:true});
    let now=performance.now()/1000;
    for(let n=0;n<3;n++){now+=1/60;g.updateVisual(g.p1,g.p2,now);g.updateVisual(g.p2,g.p1,now+.01);}
    g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
    return {clip:g.p1.visual.root.userData.combatMotionCurrentClip,
      ukemiClip:g.p1.visual.root.userData.tpsUkemiClip,
      poseTicks:g.p1.visual.root.userData.tpsUkemiPoseTicks,
      physicalTicks:g.playerUkemiTicks,
      state:g.p1.state,grounded:g.p1.grounded};
  `);
  if(ukemiVisual.clip!=="CM_TechRoll_R"||ukemiVisual.poseTicks<=0
    ||ukemiVisual.physicalTicks!==4||ukemiVisual.state!=="KNOCKDOWN"
    ||!ukemiVisual.grounded)throw Error("rendered full-body ukemi absent "+JSON.stringify(ukemiVisual));
  const rollingPng=Buffer.from(await api(`/session/${session}/screenshot`),"base64");
  if(rollingPng.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("rolling PNG invalid");
  await writeFile(`${out}/tps-ukemi-midroll.png`,rollingPng);
  const quickRiseVisual=await run(session,`${lookup}
    const g=findGame();
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    g.p1.resetForRound(0,.72,1);g.p2.resetForRound(0,-.72,-1);
    g.p1.hitStop=0;g.p1.state="KNOCKDOWN";g.p1.grounded=true;g.p1.knockdownTicks=34;
    g.p1.input={...neutral};g.p1.previousInput={...neutral};
    g.playerUkemiTicks=0;g.playerUkemiPoseTicks=0;
    const before=g.p1.position.clone();
    g.updatePlayer({...neutral,guard:true});
    for(let n=0;n<3;n++)g.updatePlayer({...neutral,guard:true});
    let now=performance.now()/1000;
    for(let n=0;n<3;n++){now+=1/60;g.updateVisual(g.p1,g.p2,now);g.updateVisual(g.p2,g.p1,now+.01);}
    g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
    return {clip:g.p1.visual.root.userData.combatMotionCurrentClip,
      poseTicks:g.p1.visual.root.userData.tpsUkemiPoseTicks,
      poseDuration:g.p1.visual.root.userData.tpsUkemiPoseDuration,
      physicalTicks:g.playerUkemiTicks,
      knockdownTicks:g.p1.knockdownTicks,
      distance:g.p1.position.distanceTo(before),
      state:g.p1.state};
  `);
  if(quickRiseVisual.clip!=="CM_QuickRise"||quickRiseVisual.poseTicks<=0
    ||quickRiseVisual.poseDuration!==12||quickRiseVisual.physicalTicks!==0
    ||quickRiseVisual.knockdownTicks>9||quickRiseVisual.distance>.001)
    throw Error("stationary quick rise animation/physics wrong "+JSON.stringify(quickRiseVisual));
  const risePng=Buffer.from(await api(`/session/${session}/screenshot`),"base64");
  if(risePng.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("rise PNG invalid");
  await writeFile(`${out}/tps-quick-rise.png`,risePng);
  await writeFile(`${out}/recovery-motion-visual.json`,JSON.stringify({throwVisual,ukemiVisual,quickRiseVisual},null,2));
  // Verify the four actual reference-video martial arts clips on a real
  // rigged 3D fighter, not just that a TypeScript array contains the names.
  const videoChoreography = {};
  const videoClips = {
    jab:"CM_Video_Jab",backfist:"CM_Video_Palm",
    kick:"CM_Video_SideKick",risingKick:"CM_Video_SpinKick",
  };
  for (const [moveId,expectedClip] of Object.entries(videoClips)) {
    const observation=await run(session,`${lookup}
      const g=findGame();
      g.input.clear();g.finished=false;g.finishPending=false;g.enemyOpeningGraceTicks=9999;
      g.p1.resetForRound(0,.86,1);g.p2.resetForRound(0,-.54,-1);
      g.p1.hitStop=0;g.p2.hitStop=0;
      g.p1.velocity.set(0,0,0);g.p2.velocity.set(0,0,0);
      if(!g.p1.beginMove(arguments[0]))return {error:"could not begin "+arguments[0]};
      g.p1.moveTick=g.p1.currentMove.startup;
      g.trackCommittedAttack(g.p1,g.p2);
      // Live visual updates settle the outgoing inertial pose into its new
      // kick/punch clip; the fighter itself does not teleport or auto-hit.
      let t=g.renderTime+1/60;
      for(let i=0;i<22;i++){
        t+=1/60;
        g.updateVisual(g.p1,g.p2,t);
        g.updateVisual(g.p2,g.p1,t+.23);
      }
      g.renderTime=t;
      g.updateCamera(1/60);g.updateLockOn();
      g.renderer.render(g.scene,g.camera);
      const d=g.p1.visual.root.userData;
      const canvas=document.querySelector(".scene-host canvas");
      return {
        move:arguments[0],clip:d.combatMotionCurrentClip,
        enabled:d.videoChoreographyActive,version:d.videoChoreographyVersion,
        count:d.videoChoreographyClipCount,
        state:g.p1.state,contact:g.p1.moveTick===g.p1.currentMove.startup,
        width:canvas?.width??0,height:canvas?.height??0,
        otherMove:g.p2.currentMove?.id??null,
      };
    `,[moveId]);
    if(observation.clip!==expectedClip||observation.enabled!==true
      ||observation.version!=="VIDEO_REFERENCE_CHOREOGRAPHY_V1"
      ||observation.count!==4||observation.state!=="ATTACK"
      ||!observation.contact||observation.width<100||observation.height<100)
      throw Error("reference video clip not rendered "+JSON.stringify(observation));
    videoChoreography[moveId]=observation;
    const frame=Buffer.from(await api(`/session/${session}/screenshot`),"base64");
    if(frame.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
      throw Error("reference video screen PNG invalid "+moveId);
    await writeFile(`${out}/tps-video-motion-${moveId}.png`,frame);
  }
  await writeFile(`${out}/video-choreography.json`,JSON.stringify(videoChoreography,null,2));

  // Real button event path: press/release ATTACK once every four fixed ticks.
  // No contact resolver or synthetic hit registration: every recovery must
  // finish honestly, yet none of the fast taps should be lost permanently.
  const mashReplay=await run(session,`${lookup}
    const g=findGame();
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    g.p1.resetForRound(0,.62,1);g.p2.resetForRound(0,-.55,-1);
    g.p1.input={...neutral};g.p1.previousInput={...neutral};
    g.playerComboStage=0;g.playerComboGraceTicks=0;g.playerAttackQueued=false;
    g.playerFlankWindowTicks=0;g.playerInterceptTicks=0;g.playerReversalTicks=0;
    g.playerPerfectEvadeTicks=0;g.airCombo=null;g.__comboRoute=undefined;
    g.__neutralMashAttackCount=0;g.__neutralMashLastBase=null;g.__mashBufferTicks=0;
    g.p1.visual.root.userData.tpsMashMoveSerial=0;
    const punches=[];let lastSerial=0;
    for(let frame=0;frame<1000&&punches.length<14;frame++){
      g.updatePlayer({...neutral,punch:frame%4===0});
      const serial=g.__neutralMashAttackCount??0;
      if(serial>lastSerial){
        punches.push({serial,move:g.p1.currentMove?.id??null,
          base:g.p1.currentMove?.motionBase??g.p1.currentMove?.id??null,
          phase:g.p1.state,frame,queued:g.__mashBufferTicks??0});
        lastSerial=serial;
      }
    }
    return {punches,distinct:[...new Set(punches.map(p=>p.base))],
      serial:g.__neutralMashAttackCount,simulatedHitTargets:g.p1.hitTargets.size};
  `);
  if(mashReplay.punches.length<12||mashReplay.distinct.length<7
    ||!mashReplay.distinct.includes("kick")||!mashReplay.distinct.includes("backfist")
    ||!mashReplay.distinct.includes("risingKick")
    ||mashReplay.punches.some(p=>p.phase!=="ATTACK"||!p.move))
    throw Error("fast physical ATTACK taps did not rotate through grounded move families "+JSON.stringify(mashReplay));

  // Confirm that the same selections install real, visible full-body 3D
  // clips, not only names in a move table; compare video-based palm and kicks.
  const mashRendered=await run(session,`${lookup}
    const g=findGame();
    const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    g.p1.resetForRound(0,.62,1);g.p2.resetForRound(0,-.55,-1);
    g.p1.input={...neutral};g.p1.previousInput={...neutral};
    g.playerComboStage=0;g.playerComboGraceTicks=0;g.playerAttackQueued=false;
    g.playerFlankWindowTicks=0;g.playerInterceptTicks=0;g.playerReversalTicks=0;
    g.playerPerfectEvadeTicks=0;g.airCombo=null;g.__comboRoute=undefined;
    g.__neutralMashAttackCount=0;g.__neutralMashLastBase=null;
    let now=performance.now()/1000;
    const clips=[];const names=[];
    for(let index=0;index<18;index++){
      g.p1.state="IDLE";g.p1.currentMove=null;g.p1.moveTick=0;
      g.p1.hitTargets.clear();
      g.playerComboStage=index%3;
      g.p1.setInput({...neutral,punch:true});
      if(!g.beginContextAttack())return {error:"attack failed at "+index,clips,names};
      const m=g.p1.currentMove;
      const expectedBase=m.motionBase??m.id;
      g.p1.moveTick=m.startup;
      now+=.19;
      g.updateVisual(g.p1,g.p2,now);g.updateVisual(g.p2,g.p1,now+.01);
      names.push(expectedBase);clips.push(g.p1.visual.root.userData.combatMotionCurrentClip);
    }
    g.renderTime=now;g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
    return {clips,names,serial:g.__neutralMashAttackCount,
      videoPalm:clips.includes("CM_Video_Palm"),
      videoKick:clips.includes("CM_Video_SideKick"),
      videoSpin:clips.includes("CM_Video_SpinKick")};
  `);
  if(mashRendered.error||mashRendered.serial!==18
    ||new Set(mashRendered.names).size<9
    ||!mashRendered.videoPalm||!mashRendered.videoKick||!mashRendered.videoSpin)
    throw Error("neutral mash lacks visible distinct video-derived technique coverage "+JSON.stringify(mashRendered));
  await writeFile(`${out}/mash-variety.json`,JSON.stringify({mashReplay,mashRendered},null,2));
  const mashPng=Buffer.from(await api(`/session/${session}/screenshot`),"base64");
  if(mashPng.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("mash variety PNG invalid");
  await writeFile(`${out}/tps-mash-variety.png`,mashPng);
  console.log(JSON.stringify({...observations,...throwUkemi,throwVisual,ukemiVisual,quickRiseVisual,videoChoreography,
    mashReplay,mashRendered}));
}finally{
  if(session)await api(`/session/${session}`,"DELETE").catch(()=>{});
  proc.kill("SIGTERM");
}
