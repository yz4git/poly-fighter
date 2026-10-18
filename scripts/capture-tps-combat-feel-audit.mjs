import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-kick-sequence";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9531;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const driverProcess = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let driverLog = "";
driverProcess.stdout.on("data", (chunk) => { driverLog += chunk.toString(); });
driverProcess.stderr.on("data", (chunk) => { driverLog += chunk.toString(); });

async function waitForDriver() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`ChromeDriver did not start.\n${driverLog}`);
}

async function command(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.value?.error) throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload.value;
}

async function execute(sessionId, script, args = []) {
  return command(`/session/${sessionId}/execute/sync`, "POST", { script, args });
}

async function clickButton(sessionId, text) {
  return execute(sessionId, `
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes(arguments[0]));
    if (!button) return false;
    button.click();
    return true;
  `, [text]);
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`Screenshot is not PNG: ${path}`);
  await writeFile(path, bytes);
}

const gameLookup = `
  function findGame() {
    const host = document.querySelector('main.poly-app');
    if (!host) return null;
    const key = Object.keys(host).find((entry) => entry.startsWith('__reactFiber$'));
    let fiber = key ? host[key] : null;
    const visited = new Set();
    while (fiber && !visited.has(fiber)) {
      visited.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        const value = hook.memoizedState;
        const current = value && typeof value === 'object' && 'current' in value ? value.current : null;
        if (current && current.p1 && current.p2 && current.renderer && current.camera && current.scene) return current;
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    return null;
  }
`;

const reset = `
  const game = findGame();
  cancelAnimationFrame(game.raf); game.running = false;
  game.updateEnemy = game.__feelOriginalEnemy ?? game.updateEnemy.bind(game);
  game.__feelOriginalEnemy = game.updateEnemy;
  game.resetRound(); game.paused = false; game.finished = false;
  game.input.clear(); game.p1.resetForRound(0, .72, 1); game.p2.resetForRound(0, -.72, -1);
  game.enemyOpeningGraceTicks = 0; game.enemyTacticTicks = 999;
  game.effects.update(5);
  for (let i = 0; i < 10; i++) {
    game.renderTime += 1 / 60;
    game.updateVisual(game.p1, game.p2, game.renderTime);
    game.updateVisual(game.p2, game.p1, game.renderTime + .007);
  }
  const frame = () => { game.renderTime += 1 / 60; game.step(); };
  const render = () => {
    for (let i = 0; i < 18; i++) game.updateCamera(1 / 60);
    game.updateLockOn(); game.renderer.render(game.scene, game.camera);
  };
`;

let sessionId = null;
try {
  await waitForDriver();
  const session = await command('/session', 'POST', { capabilities: { alwaysMatch: {
    browserName: 'chrome', timeouts: { script: 180000, pageLoad: 120000, implicit: 0 },
    'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--window-size=1536,706', '--hide-scrollbars'] },
  } } });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, 'POST', { url });
  await delay(600); await mkdir(outputDir, { recursive: true });
  if (!await clickButton(sessionId, 'START FIGHT')) throw new Error('START FIGHT unavailable');
  await delay(140);
  if (!await clickButton(sessionId, 'ENGAGE')) throw new Error('ENGAGE unavailable');
  let ready = false;
  for (let i = 0; i < 150; i++) {
    ready = await execute(sessionId, `${gameLookup} const g=findGame();return Boolean(g && g.p1.visual.root.userData.quaterniusModelState==='ready' && g.p2.visual.root.userData.quaterniusModelState==='ready');`);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Combat feel audit did not load both real models');

  const results = {};
  results.evade = await execute(sessionId, `${gameLookup}${reset}
    game.enemyDirectorPendingMove='jab'; game.enemyDirectorTelegraphTicks=12; game.enemyDirectorTelegraphTotalTicks=18;
    game.enemyDirectorDecision={intent:'JAB',holdTicks:1,telegraphTicks:18,reason:'feel-react',comebackMercy:0,pressure:0};
    game.press('right','feel-side'); game.press('guard','feel-step'); frame();
    game.release('right','feel-side'); game.release('guard','feel-step');
    let ticks=1;
    while(ticks<35 && game.trainingProgress.perfectEvades<1){frame();ticks++;}
    render(); return {ticks,health:game.p1.health,perfect:game.trainingProgress.perfectEvades,reversal:game.playerReversalTicks};
  `);
  await screenshot(sessionId, `${outputDir}/tps-feel-evade.png`);
  if (results.evade.health !== 100 || results.evade.perfect !== 1 || results.evade.reversal <= 0) throw new Error(`Physical evade failed: ${JSON.stringify(results.evade)}`);
  results.punish = await execute(sessionId, `${gameLookup}
    const game=findGame(); game.press('punch','feel-punish'); game.renderTime+=1/60;game.step();game.release('punch','feel-punish');
    let ticks=0;while(ticks<40 && game.trainingProgress.punishes<1){game.renderTime+=1/60;game.step();ticks++;}
    game.updateCamera(1/60);game.updateLockOn();game.renderer.render(game.scene,game.camera);
    return {ticks,punishes:game.trainingProgress.punishes,enemyHealth:game.p2.health,playerHealth:game.p1.health};
  `);
  await screenshot(sessionId, `${outputDir}/tps-feel-punish.png`);
  if (results.punish.punishes !== 1 || results.punish.enemyHealth >= 100) throw new Error(`Dodge counter failed: ${JSON.stringify(results.punish)}`);

  results.reactions = {};
  for (const [moveId, blocked, expected] of [['jab',false,'CM_Hit_HEAD_'],['kick',false,'CM_Hit_BODY_'],['lowKick',false,'CM_Hit_LEGS_'],['straight',true,'CM_Block_']]) {
    const key = blocked ? 'block' : moveId;
    results.reactions[key] = await execute(sessionId, `${gameLookup}${reset}
      const [moveId,blocked]=arguments;
      game.updateEnemy=()=>game.p2.updatePhysics(1/60);
      game.p1.position.z=.67;game.p2.position.z=-.67;
      const host=game.p2.visual.root.children.find(c=>c.name.startsWith('quaternius-ubc-'));
      const point=name=>host.getObjectByName(name).getWorldPosition(game.p2.position.clone());
      const floor=Math.min(point('foot_l').y,point('foot_r').y);
      if(blocked)game.p2.state='GUARD';
      game.p1.beginMove(moveId);
      const move=game.p1.currentMove;
      for(let i=0;i<=move.startup;i++){game.p1.moveTick=i;game.renderTime+=1/60;game.updateVisual(game.p1,game.p2,game.renderTime);}
      game.trackCommittedAttack(game.p1,game.p2);game.resolveAttack(game.p1,game.p2,blocked);
      for(let i=0;i<move.hitStop+5;i++)frame();
      render();
      return {state:game.p2.state,clip:game.p2.visual.root.userData.combatMotionCurrentClip,
        region:game.p2.visual.root.userData.tpsReactionRegion,health:game.p2.health,
        floor,support:Math.min(point('foot_l').y,point('foot_r').y),head:point('Head').toArray(),pelvis:point('pelvis').toArray()};
    `, [moveId, blocked]);
    await screenshot(sessionId, `${outputDir}/tps-feel-${key}-reaction.png`);
    const r = results.reactions[key];
    if (!r.clip?.startsWith(expected) || Math.abs(r.support-r.floor)>.045 || (blocked ? r.health!==100 : r.health>=100)) throw new Error(`Reaction/grounding failed: ${key} ${JSON.stringify(r)}`);
  }

  results.range = await execute(sessionId, `${gameLookup}${reset}
    game.updateEnemy=()=>{}; const moves=[];
    for(const d of [1.45,1.68,1.63,1.73,1.85,1.66,1.45]){
      game.input.clear();game.p1.setInput({left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false});
      game.p1.state='IDLE';game.p1.currentMove=null;game.p1.moveTick=0;game.playerComboStage=0;
      game.p1.position.set(0,0,d/2);game.p2.position.set(0,0,-d/2);
      game.press('punch','feel-range');frame();game.release('punch','feel-range');moves.push(game.p1.currentMove?.id);
    }
    return moves;
  `);
  if (JSON.stringify(results.range)!==JSON.stringify(['jab','jab','jab','jab','kick','kick','jab'])) throw new Error(`Touch range hysteresis failed: ${JSON.stringify(results.range)}`);

  results.queuedIntent = await execute(sessionId, `${gameLookup}${reset}
    game.updateEnemy=()=>game.p2.updatePhysics(1/60);
    game.press('right','feel-queue-side');game.press('guard','feel-queue-step');frame();
    game.release('guard','feel-queue-step');game.release('right','feel-queue-side');frame();
    game.press('down','feel-queue-back');game.press('punch','feel-queue-attack');frame();
    game.release('down','feel-queue-back');game.release('punch','feel-queue-attack');
    for(let i=0;i<10 && game.p1.state!=='ATTACK';i++)frame();
    return {move:game.p1.currentMove?.id,intent:game.p1.visual.root.userData.tpsOpeningIntent};
  `);
  if (!results.queuedIntent.intent?.back || !['backfist','lowKick'].includes(results.queuedIntent.move)) throw new Error(`Queued STEP attack lost intent: ${JSON.stringify(results.queuedIntent)}`);

  results.cpu = await execute(sessionId, `${gameLookup}${reset}
    game.enemyPersona='SKIRMISHER'; const before=game.p1.position.distanceTo(game.p2.position);
    const toward=game.p1.position.clone().sub(game.p2.position).normalize();
    game.beginEnemyDirectorMove('kick','KICK',toward);
    const m=game.p2.currentMove;game.p2.moveTick=m.startup+m.active+m.recovery-1;
    for(let i=0;i<7;i++)game.updateEnemy();
    return {before,after:game.p1.position.distanceTo(game.p2.position),intent:game.p2.visual.root.userData.tpsCpuDirectorIntent,reason:game.p2.visual.root.userData.tpsCpuDirectorReason};
  `);
  if (results.cpu.intent!=='RETREAT' || results.cpu.after<results.cpu.before+.10) throw new Error(`Skirmisher habit failed: ${JSON.stringify(results.cpu)}`);
  await writeFile(`${outputDir}/tps-combat-feel.json`, JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
} finally {
  if(sessionId) await command(`/session/${sessionId}`,'DELETE').catch(()=>{});
  driverProcess.kill('SIGTERM');
  await writeFile(`${outputDir}/webdriver-combat-feel.log`,driverLog).catch(()=>{});
}

