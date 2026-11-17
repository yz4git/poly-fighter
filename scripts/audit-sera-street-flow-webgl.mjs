import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const driver = process.env.WEBDRIVER_BIN;
if (!driver) throw new Error("WEBDRIVER_BIN is required");
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const dir = process.env.STREET_AUDIT_DIR ?? "artifacts/sera-street-flow";
const port = 9568, delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(driver, ["--port="+port, "--allowed-ips="], {stdio:"ignore"});
let session = null;

async function cmd(path, method="GET", body) {
  const res=await fetch("http://127.0.0.1:"+port+path, {
    method,headers:body===undefined?undefined:{"content-type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok||json.value?.error)throw new Error(method+" "+path+": "+JSON.stringify(json));
  return json.value;
}
async function run(source,args=[]) {
  return cmd("/session/"+session+"/execute/sync","POST",{script:source,args});
}
async function click(text) {
  return run("const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes(arguments[0]));if(!b||b.disabled)return false;b.click();return true;",[text]);
}
async function save(name) {
  const data=Buffer.from(await cmd("/session/"+session+"/screenshot"),"base64");
  if(data.length<2000||data.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw new Error("Chrome screenshot failed: "+name);
  await writeFile(dir+"/"+name+".png",data);
}
const lookup=`
  function findGame() {
    const host=document.querySelector('main.poly-app');
    const key=host&&Object.keys(host).find(x=>x.startsWith('__reactFiber$'));
    let fiber=key?host[key]:null;const seen=new Set();
    while(fiber&&!seen.has(fiber)){
      seen.add(fiber);let hook=fiber.memoizedState;
      while(hook){
        const value=hook.memoizedState;
        const current=value&&typeof value==='object'&&'current'in value?value.current:null;
        if(current?.p1&&current?.p2&&current?.renderer&&current?.camera&&current?.scene)return current;
        hook=hook.next;
      }
      fiber=fiber.return;
    }
    return null;
  }
`;
const helpers=`
  function visual(game) {
    const root=game.p1.visual.root;
    const host=root.children.find(x=>x.name?.startsWith('quaternius-ubc-')&&x.name?.endsWith('-runtime'));
    const clip=host?.userData.quaterniusCurrentClip??null;
    const pts={};
    for(const name of ['pelvis','spine_03','Head','hand_l','hand_r','foot_l','foot_r']) {
      const bone=host?.getObjectByName(name);
      if(!bone)continue;
      const p=bone.getWorldPosition(new bone.position.constructor());
      pts[name]=[p.x,p.y,p.z];
    }
    return {clip, points:pts, hostReady:root.userData.quaterniusModelState==='ready',
      version:host?.userData.seraStreetFlowMotionVersion??null,
      move:game.p1.currentMove?.id??null, tick:game.p1.moveTick,state:game.p1.state,
      clean:root.userData.tpsCleanHitConfirmed===true,
      hit:game.p1.hitTargets?.has(game.p2.id)??false,
      p2Health:game.p2.health, p2State:game.p2.state,
      draw:game.renderer.info.render.calls};
  }
  function advance(game,n=1) {
    let now=performance.now()/1000;
    for(let i=0;i<n;i++) {
      game.p1.hitStop=0;game.p2.hitStop=0;
      game.step();
      now+=1/60;
      game.updateVisual(game.p1,game.p2,now);
      game.updateVisual(game.p2,game.p1,now+.007);
    }
    game.updateCamera(1/60);game.updateLockOn();
    game.renderer.render(game.scene,game.camera);
  }
`;

try{
  for(let i=0;i<160;i++){try{await cmd("/status");break;}catch(e){if(i===159)throw e;await delay(100);}}
  const result=await cmd("/session","POST",{capabilities:{alwaysMatch:{
    browserName:"chrome","goog:chromeOptions":{args:[
      "--headless=new","--no-sandbox","--disable-dev-shm-usage",
      "--ignore-gpu-blocklist","--enable-webgl","--use-angle=swiftshader",
      "--window-size=1200,675","--hide-scrollbars"
    ]}
  }}});
  session=result.sessionId;
  await mkdir(dir,{recursive:true});
  await cmd("/session/"+session+"/url","POST",{url});
  await delay(500);
  if(!await click("START FIGHT"))throw new Error("START FIGHT missing");
  await delay(250);
  if(!await run("const p=document.querySelector('button[data-fighter-slot=P1][data-fighter-id=blue]');if(!p)return false;p.click();return true;"))
    throw new Error("SERA P1 selection missing");
  if(!await run("const p=document.querySelector('button[data-fighter-slot=P2][data-fighter-id=red]');if(!p)return false;p.click();return true;"))
    throw new Error("KAIRO CPU selection missing");
  const guide=await run("return !!document.querySelector('[data-sera-street-flow-guide]');");
  if(!guide)throw new Error("SERA control hints not shown in fighter loadout");
  if(!await click("ENGAGE"))throw new Error("ENGAGE missing");

  let ready=null;
  for(let i=0;i<180;i++){
    ready=await run(`${lookup}${helpers}const game=findGame();return game?{
      hero:game.p1.definition.name,cpu:game.p2.definition.name,
      available:['streetFlowJab','streetFlowKick','streetFlowPalm'].every(id=>!!game.p1.definition.moves[id]),
      ...visual(game),
    }:null;`);
    if(ready?.hostReady && ready?.available && ready.clip)break;
    await delay(130);
  }
  if(!ready?.hostReady||ready.hero!=="SERA"||ready.cpu!=="KAIRO"||!ready.available)
    throw new Error("Live TPS rig or SERA phrase not loaded: "+JSON.stringify(ready));

  const setup=await run(`${lookup}${helpers}
    const game=findGame();
    cancelAnimationFrame(game.raf);game.running=false;game.finished=false;game.input.clear();
    game.p1.resetForRound(0,.61,1);
    game.p2.resetForRound(0,-.58,-1);
    game.p1.position.set(0,0,.61);game.p2.position.set(0,0,-.58);
    game.p1.facing=1;game.p2.facing=-1;
    game.enemyOpeningGraceTicks=9999;
    game.updateEnemy=()=>{game.p2.velocity.set(0,0,0);};
    game.p1.currentMove=null;game.p1.state='IDLE';
    game.playerComboStage=0;game.__streetFlowCompletedBeats=0;
    advance(game,9);
    const neutral=visual(game);
    game.press('up','gif-test-stick');
    game.press('punch','gif-test-touch');
    advance(game,1);
    const entry=visual(game);
    game.release('up','gif-test-stick');
    game.release('punch','gif-test-touch');
    return {neutral,entry,p1Health:game.p1.health,initialDistance:Math.hypot(game.p1.position.x-game.p2.position.x,game.p1.position.z-game.p2.position.z)};
  `);
  if(setup.entry.move!=="streetFlowJab")
    throw new Error("Real forward+ATTACK did not initiate user's GIF phrase: "+JSON.stringify(setup));
  await save("01-sera-street-guard-start");

  const moves=["streetFlowJab","streetFlowKick","streetFlowPalm"];
  const clips=["CM_StreetFlow_Jab","CM_StreetFlow_HighKick","CM_StreetFlow_LowPalm"];
  const evidence=[];
  for(let index=0;index<moves.length;index++){
    const target=moves[index];

    // Pause at the fighter's real first-active skinned pose, and take an
    // actual browser screenshot BEFORE simulating the rest of the combo.
    // A later screenshot after linking would misleadingly show the NEXT move
    // even if the JSON metadata correctly described this move.
    const active=await run(`${lookup}${helpers}
      const game=findGame();
      const target=arguments[0];
      let imagePose=null;
      for(let i=0;i<120;i++){
        const move=game.p1.currentMove;
        if(!move||move.id!==target||game.p1.state!=='ATTACK')break;
        if(game.p1.moveTick>=move.startup){
          imagePose=visual(game);break;
        }
        advance(game,1);
      }
      advance(game,0);
      return imagePose;
    `,[target]);
    if(!active || active.move!==target || active.clip!==clips[index])
      throw new Error("Actual captured active frame does not show the requested authored SERA clip: "+JSON.stringify({index,target,active}));
    await save("0"+(index+2)+"-sera-street-"+target);

    // Resume real 60Hz combat. Button buffering is allowed ONLY after the
    // actual hitTarget AND cleanHit flag, inside the recovery cancel window.
    const sample=await run(`${lookup}${helpers}
      const game=findGame();
      const target=arguments[0];
      let queued=false,linked=false,last=null,clean=false;
      const trace=[];
      for(let i=0;i<130;i++){
        const move=game.p1.currentMove;
        if(!move || move.id!==target) { linked=Boolean(move); break; }
        const hit=game.p1.hitTargets.has(game.p2.id);
        const confirmed=game.p1.visual.root.userData.tpsCleanHitConfirmed===true;
        if(hit&&confirmed)clean=true;
        const recoveryStart=move.startup+move.active;
        if(target!=='streetFlowPalm'&&!queued&&hit&&confirmed
           && game.p1.moveTick>=recoveryStart){
          game.press('punch','gif-test-link');
          advance(game,1);
          game.release('punch','gif-test-link');
          queued=true;
        }else advance(game,1);
        last=visual(game);
        if(i%8===0)trace.push({i,move:last.move,state:last.state,tick:last.tick,hit:last.hit,clean:last.clean});
        if(last.move!==target){linked=Boolean(last.move);break;}
      }
      return {queued,clean,linked,last,trace};
    `,[target]);
    if(target!=="streetFlowPalm"&&!sample.clean)
      throw new Error("User GIF attack did not score a real clean hit: "+JSON.stringify({index,target,sample}));
    evidence.push({move:target,expectedClip:clips[index],active,...sample});
    if(index<moves.length-1){
      const transition=await run(`${lookup}${helpers}
        const game=findGame();return {current:game.p1.currentMove?.id??null,visual:visual(game),
          comboStage:game.playerComboStage,streetBeat:game.__streetFlowCompletedBeats};
      `);
      if(transition.current!==moves[index+1])
        throw new Error("Real clean-contact ATTACK tap did not link: "+JSON.stringify({index,transition,sample}));
    }
  }

  const p=Object.fromEntries(evidence.map(item=>[item.move,item.active.points]));
  const dist=(a,b)=>a&&b?Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]):0;
  const guard=setup.neutral.points;
  if(dist(p.streetFlowJab?.hand_l,guard.hand_l)<.14
    || dist(p.streetFlowKick?.foot_r,guard.foot_r)<.20
    || dist(p.streetFlowPalm?.hand_r,guard.hand_r)<.17)
    throw new Error("The actual imported 3D rig is not visibly executing distinct GIF poses: "+JSON.stringify({guard,p}));
  if(p.streetFlowKick?.foot_r?.[1] <= p.streetFlowKick?.foot_l?.[1]+.25)
    throw new Error("SERA did not visibly raise the high side kick above the grounded support foot");
  await writeFile(dir+"/real-gif-combat.json",JSON.stringify({
    reference:"12-frame 110ms user-supplied action GIF",
    note:"Actual 60Hz SERA gameplay; real first/second clean hit required; not a new photoreal actor",
    guide,setup,evidence,
  },null,2));
  console.log("SERA_12_FRAME_STREET_FLOW_LIVE_COMBAT_PASSED",JSON.stringify({
    p1:ready.hero,p2:ready.cpu,moves:evidence.map(x=>x.move),
    clips:evidence.map(x=>x.active.clip),linkedCleanHits:evidence.slice(0,2).map(x=>x.clean)
  }));
}finally{
  if(session)await cmd("/session/"+session,"DELETE").catch(()=>{});
  child.kill("SIGTERM");
}
