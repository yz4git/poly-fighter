import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const driver = process.env.WEBDRIVER_BIN;
if (!driver) throw new Error("WEBDRIVER_BIN is required");
const output = process.env.COMBAT_AUDIT_DIR ?? "artifacts/combat-motion-audit";
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const port = 9527;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const processDriver = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let logs = "", session;
processDriver.stdout.on("data", data => { logs += data; });
processDriver.stderr.on("data", data => { logs += data; });
async function command(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok || json.value?.error) throw new Error(JSON.stringify(json));
  return json.value;
}
const execute = (script, args = []) => command(`/session/${session}/execute/sync`, "POST", { script, args });
const lookup = `
function findGame() {
  const host = document.querySelector('main.poly-app');
  const key = host && Object.keys(host).find(k => k.startsWith('__reactFiber$'));
  let fiber = key ? host[key] : null;
  const seen = new Set();
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber); let hook = fiber.memoizedState;
    while (hook) {
      const value = hook.memoizedState;
      const g = value && typeof value === 'object' && 'current' in value ? value.current : null;
      if (g?.p1 && g?.p2 && g.renderer && g.scene && g.camera) return g;
      hook = hook.next;
    }
    fiber = fiber.return;
  }
  return null;
}
`;
const helpers = `
function reset(f) {
  f.currentMove = null; f.moveTick = 0; f.hitStop = 0; f.hitStun = 0; f.blockStun = 0;
  f.knockdownTicks = 0; f.guardDamage = 0; f.velocity.set(0,0,0); f.hitTargets.clear();
  f.health = 100; f.state = 'IDLE'; f.grounded = true;
}
function model(f) { return f.visual.root.children.find(c=>c.name?.startsWith('quaternius-ubc-'))?.children[0]; }
function points(f) {
  const m = model(f); const V = f.position.constructor;
  return Object.fromEntries(['Head','pelvis','spine_03','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r','hand_l','hand_r','thigh_l','thigh_r','calf_l','calf_r','foot_l','foot_r'].map(name=>[name,m.getObjectByName(name).getWorldPosition(new V()).toArray()]));
}
function render(g) {
  g.__motionAuditTime = (g.__motionAuditTime ?? 100) + 1/60;
  g.updateVisual(g.p1,g.p2,g.__motionAuditTime);
  g.updateVisual(g.p2,g.p1,g.__motionAuditTime+.23);
  g.updateCamera(1/60); g.updateLockOn(); g.renderer.render(g.scene,g.camera);
}
`;
async function shot(name) {
  const encoded = await command(`/session/${session}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await writeFile(`${output}/${name}.png`, bytes);
}
const report = { version: "COMBAT_MOTION_V7", models: {}, errors: [], screenshots: 0 };
try {
  await mkdir(output, { recursive: true });
  for (let i = 0; i < 100; i++) {
    try { await command("/status"); break; } catch { if (i === 99) throw new Error(logs); await wait(100); }
  }
  const created = await command("/session", "POST", { capabilities: { alwaysMatch: { browserName: "chrome", "goog:loggingPrefs": { browser: "ALL" }, "goog:chromeOptions": { args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=swiftshader", "--window-size=1120,700", "--hide-scrollbars"] } } } });
  session = created.sessionId;
  await command(`/session/${session}/url`, "POST", { url });
  await wait(650);
  for (const label of ["TPS LOCK-ON BATTLE", "ENGAGE TPS"]) {
    const clicked = await execute(`const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(arguments[0]));b?.click();return !!b;`, [label]);
    assert.ok(clicked, label); await wait(200);
  }
  let ready;
  for (let i = 0; i < 200; i++) {
    ready = await execute(`${lookup} const g=findGame();return g && [g.p1,g.p2].map(f=>({ready:f.visual.root.userData.quaterniusModelState,clips:f.visual.root.userData.combatMotionClipCount,version:f.visual.root.userData.combatMotionVersion}));`);
    if (ready?.every(f => f.ready === "ready" && f.clips >= 27)) break;
    await wait(100);
  }
  assert.ok(ready?.every(f => f.clips >= 27), `motion load failed: ${JSON.stringify(ready)}`);
  await execute(`${lookup}const g=findGame();cancelAnimationFrame(g.raf);g.running=false;g.finished=false;g.input.clear();g.__motionActors=[g.p1,g.p2];g.__motionAuditTime=100;return true;`);
  const attacks = ["jab", "straight", "bodyBlow", "backfist", "power", "kick", "lowKick", "risingKick", "dashKick", "counter", "throw"];
  for (const [actorIndex, actorName] of [[0, "kairo"], [1, "sera"]]) {
    await execute(`${lookup}${helpers}const g=findGame();g.p1=g.__motionActors[arguments[0]];g.p2=g.__motionActors[1-arguments[0]];reset(g.p1);reset(g.p2);g.p1.position.set(0,0,.8);g.p2.position.set(0,0,-1.4);g.__enemyVisualForward=null;for(let i=0;i<18;i++)render(g);return true;`, [actorIndex]);
    await shot(`${actorName}-ready`); report.screenshots++;
    const actor = { attacks: {}, states: {} };
    report.models[actorName] = actor;
    for (const move of attacks) {
      const setup = await execute(`${lookup}${helpers}const g=findGame();reset(g.p1);reset(g.p2);g.p1.position.set(0,0,.8);g.p2.position.set(0,0,-1.4);for(let i=0;i<12;i++)render(g);g.p1.beginMove(arguments[0]);const m=g.p1.currentMove;g.__auditTick=-1;return {startup:m.startup,active:m.active,total:m.startup+m.active+m.recovery};`, [move]);
      const keys = [...new Set([0, Math.max(1, Math.floor(setup.startup / 2)), setup.startup, setup.startup + setup.active - 1, Math.floor((setup.startup + setup.active + setup.total) / 2), setup.total - 1])];
      const frames = [];
      for (const tick of keys) {
        const captured = await execute(`${lookup}${helpers}const g=findGame();const frames=[];for(let i=g.__auditTick+1;i<=arguments[0];i++){g.p1.moveTick=i;g.p1.stateMachine.stateTicks=i;render(g);const host=g.p1.visual.root.children.find(c=>c.name?.startsWith('quaternius-ubc-'));frames.push({tick:i,points:points(g.p1),clip:host.userData.quaterniusCurrentClip,phase:host.userData.combatMotionSampledPhase,contact:host.userData.combatMotionContactPhase});}g.__auditTick=arguments[0];return frames;`, [tick]);
        frames.push(...captured);
        await shot(`${actorName}-${move}-${String(tick).padStart(3, "0")}`); report.screenshots++;
      }
      const contact = frames.find(frame => frame.tick === setup.startup);
      assert.ok(Math.abs(contact.phase - contact.contact) < 1e-6, `${actorName}/${move}: contact timing`);
      assert.equal(frames.at(-1).phase, 1, `${actorName}/${move}: recovery complete`);
      for (const frame of frames) for (const xyz of Object.values(frame.points)) assert.ok(xyz.every(Number.isFinite), `${actorName}/${move}: finite bones`);
      const freeze = await execute(`${lookup}${helpers}const g=findGame();g.p1.moveTick=g.p1.currentMove.startup;for(let i=0;i<8;i++)render(g);g.p1.hitStop=8;const before=points(g.p1);for(let i=0;i<8;i++)render(g);const after=points(g.p1);g.p1.hitStop=0;return {before,after};`);
      for (const name of Object.keys(freeze.before)) assert.ok(Math.hypot(...freeze.before[name].map((v, i) => v - freeze.after[name][i])) < 1e-6, `${actorName}/${move}: hitstop freezes ${name}`);
      actor.attacks[move] = { ...setup, frames, freezePassed: true };
    }
    const cases = [
      ...[["F",0,1],["B",0,-1],["L",-1,0],["R",1,0],["FR",1,1],["FL",-1,1],["BR",1,-1],["BL",-1,-1]].map(([label,x,z]) => ({ label:`walk-${label}`, state:"WALK",x,z,ticks:42 })),
      ...["F","B","L","R"].map(direction => ({ label:`step-${direction}`,state:"SIDESTEP",direction,ticks:9 })),
      ...[["guard","GUARD",24],["crouch","CROUCH",24],["block","BLOCK_STUN",14],["light-hit","HIT",20],["jump","JUMP",38],["down","KNOCKDOWN",40],["thrown","THROW",40],["wakeup","WAKEUP",23]].map(([label,state,ticks])=>({label,state,ticks})),
    ];
    for (const c of cases) {
      await execute(`${lookup}${helpers}const g=findGame();reset(g.p1);reset(g.p2);g.p1.position.set(0,0,.8);g.p2.position.set(0,0,-1.4);for(let i=0;i<12;i++)render(g);const c=arguments[0];g.p1.state=c.state;g.p1.hitStun=c.ticks;g.p1.blockStun=c.ticks;g.p1.reactionKind='LIGHT';g.p1.reactionSerial++;g.__auditTick=-1;return true;`, [c]);
      const frames = [];
      for (const tick of [Math.floor(c.ticks * .4), c.ticks - 1]) {
        const captured = await execute(`${lookup}${helpers}const g=findGame();const c=arguments[0];const frames=[];for(let i=g.__auditTick+1;i<=arguments[1];i++){g.p1.stateMachine.stateTicks=i;if(c.state==='WALK'){g.p1.position.x-=(c.x||0)*.025;g.p1.position.z-=(c.z||0)*.025;g.p2.position.x-=(c.x||0)*.025;g.p2.position.z-=(c.z||0)*.025;}if(c.direction){g.playerStepDirection.set(c.direction==='R'?-1:c.direction==='L'?1:0,0,c.direction==='B'?1:c.direction==='F'?-1:0);}if(c.state==='JUMP'){g.p1.grounded=false;g.p1.position.y=Math.sin(i/(c.ticks-1)*Math.PI)*.8;}render(g);frames.push({tick:i,clip:g.p1.visual.root.userData.combatMotionCurrentClip,points:points(g.p1),footDrift:g.p1.visual.root.userData.combatMotionFootDrift??0});}g.__auditTick=arguments[1];return frames;`, [c,tick]);
        frames.push(...captured);
        await shot(`${actorName}-${c.label}-${String(tick).padStart(3,"0")}`); report.screenshots++;
      }
      if (c.state === "WALK") assert.ok(frames.every(f=>f.footDrift < .06), `${actorName}/${c.label}: foot plant residual`);
      if (c.state === "BLOCK_STUN") assert.ok(frames.every(f=>f.clip === "CM_Block"), "normal blocks never play a guard break");
      actor.states[c.label] = frames;
    }
  }
  const browser = await command(`/session/${session}/log`, "POST", { type: "browser" });
  report.errors = browser.filter(entry => entry.level === "SEVERE" && !entry.message.includes("favicon"));
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ models: Object.keys(report.models), screenshots: report.screenshots, errors: report.errors.length }));
} finally {
  await writeFile(`${output}/webdriver.log`, logs);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  if (session) await command(`/session/${session}`, "DELETE").catch(() => {});
  processDriver.kill("SIGTERM");
}
