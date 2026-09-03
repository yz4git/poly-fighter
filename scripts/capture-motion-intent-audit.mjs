import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");
const port = 9522;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const proc = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let driverLog = "";
proc.stdout.on("data", (c) => { driverLog += c.toString(); });
proc.stderr.on("data", (c) => { driverLog += c.toString(); });
async function waitForDriver() { for (let i = 0; i < 150; i += 1) { try { const r = await fetch(`http://127.0.0.1:${port}/status`); if (r.ok) return; } catch {} await delay(100); } throw new Error(driverLog); }
async function command(path, method = "GET", body) { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const p = await r.json().catch(() => ({})); if (!r.ok || p?.value?.error) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(p)}`); return p.value; }
async function execute(id, script, args = []) { return command(`/session/${id}/execute/sync`, "POST", { script, args }); }
async function screenshot(id, path) { const encoded = await command(`/session/${id}/screenshot`); await writeFile(path, Buffer.from(encoded, "base64")); }
async function clickButton(id, text) { return execute(id, `const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes(arguments[0]));if(!b)return false;b.click();return true;`, [text]); }
const lookup = `function findGame(){const host=document.querySelector('main.poly-app');if(!host)return null;const key=Object.keys(host).find(k=>k.startsWith('__reactFiber$'));let f=key?host[key]:null;const seen=new Set();while(f&&!seen.has(f)){seen.add(f);let h=f.memoizedState;while(h){const v=h.memoizedState;const c=v&&typeof v==='object'&&'current'in v?v.current:null;if(c&&c.p1&&c.p2&&c.renderer&&c.camera&&c.scene)return c;h=h.next;}f=f.return;}return null;}`;
const reset = `function resetFighter(f){f.currentMove=null;f.moveTick=0;f.hitStop=0;f.hitStun=0;f.blockStun=0;f.knockdownTicks=0;f.guardDamage=0;f.velocity.set(0,0,0);f.hitTargets.clear();f.health=100;f.state='IDLE';f.grounded=true;const n={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};f.input={...n};f.previousInput={...n};}`;
const cases = [
  { fighter: "p1", name: "kairo", move: "backfist", clip: "PF_Backfist_R", contact: "RIGHT_FIST" },
  { fighter: "p1", name: "kairo", move: "bodyBlow", clip: "PF_BodyBlow_L", contact: "LEFT_FIST" },
  { fighter: "p1", name: "kairo", move: "counter", clip: "PF_Counter_L", contact: "LEFT_FIST" },
  { fighter: "p2", name: "sera", move: "backfist", clip: "PF_Backfist_L", contact: "LEFT_FIST" },
  { fighter: "p2", name: "sera", move: "bodyBlow", clip: "PF_BodyBlow_R", contact: "RIGHT_FIST" },
  { fighter: "p2", name: "sera", move: "counter", clip: "PF_Counter_L", contact: "LEFT_FIST" },
];
let sessionId = null;
try {
  await waitForDriver();
  const session = await command("/session", "POST", { capabilities: { alwaysMatch: { browserName: "chrome", "goog:chromeOptions": { args: ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--ignore-gpu-blocklist","--enable-webgl","--use-angle=swiftshader","--window-size=1200,650","--hide-scrollbars"] } } } });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(650);
  await execute(sessionId, `
    const current = JSON.parse(window.localStorage.getItem('poly-fighter-settings-v1') ?? '{}');
    window.localStorage.setItem('poly-fighter-settings-v1', JSON.stringify({ ...current, motionCorrections: true }));
    window.location.reload();
    return true;
  `);
  await delay(650);
  if (!(await clickButton(sessionId, "TPS LOCK-ON BATTLE"))) throw new Error("TPS title button not found");
  await delay(120);
  if (!(await clickButton(sessionId, "ENGAGE TPS"))) throw new Error("TPS engage button not found");
  let ready = false;
  for (let i = 0; i < 160; i += 1) {
    ready = await execute(sessionId, `${lookup}const g=findGame();if(!g)return false;return [g.p1,g.p2].every(f=>f.visual.root.userData.motionExpansionHasProcedural===true&&f.visual.root.userData.motionExpansionProceduralClipCount===23);`);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("Both fighters did not preload 23 procedural clips");
  await mkdir(outputDir, { recursive: true });
  await execute(sessionId, `${lookup}const g=findGame();cancelAnimationFrame(g.raf);g.running=false;g.finished=false;g.input.clear();g.enemyOpeningGraceTicks=9999;return true;`);
  const results = [];
  for (const c of cases) {
    const result = await execute(sessionId, `${lookup}${reset}const c=arguments[0];const g=findGame();resetFighter(g.p1);resetFighter(g.p2);g.finished=false;g.input.clear();g.p1.position.set(0,0,0.74);g.p2.position.set(0,0,-0.48);g.p1.facing=1;g.p2.facing=-1;const a=g[c.fighter],o=c.fighter==='p1'?g.p2:g.p1;if(!a.beginMove(c.move))return {error:'move-not-found'};const move=a.currentMove;const contact=move?.visualContact??null;if(!move)return {error:'move-missing-after-begin'};a.state='ATTACK';a.hitStop=0;a.moveTick=move.startup+Math.max(0,Math.floor(Math.max(1,move.active)/2));let t=performance.now()/1000;for(let i=0;i<12;i+=1){a.hitStop=0;o.hitStop=0;t+=1/60;g.updateVisual(o,a,t+0.007);g.updateVisual(a,o,t);}g.updateCamera(1/60);g.updateLockOn();g.renderer.render(g.scene,g.camera);return {active:a.visual.root.userData.motionExpansionPhase==='ACTIVE',state:a.state,move:c.move,clip:a.visual.root.userData.motionExpansionCurrentClip??null,phase:a.visual.root.userData.motionExpansionPhase??null,contact,currentMove:a.visual.root.userData.motionExpansionCurrentMove??null,visible:a.visual.root.userData.motionExpansionTargetsVisibleQuaternius===true,startup:move.startup,activeFrames:move.active,moveTick:a.moveTick};`, [c]);
    if (result?.error || !result?.active || result.phase !== "ACTIVE" || result.state !== "ATTACK") throw new Error(`Intent case failed to reach ACTIVE: ${JSON.stringify({ c, result })}`);
    if (result.clip !== c.clip || result.contact !== c.contact || result.currentMove !== c.move || !result.visible) throw new Error(`Intent mismatch: ${JSON.stringify({ c, result })}`);
    results.push({ ...c, ...result });
    await screenshot(sessionId, `${outputDir}/tps-intent-${c.name}-${c.move.toLowerCase()}.png`);
  }
  await writeFile(`${outputDir}/motion-intent.json`, JSON.stringify({ proceduralClipCount: 23, cases: results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  proc.kill("SIGTERM");
}
