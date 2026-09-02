import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.KICK_AUDIT_DIR ?? "artifacts/kick-sequence-v7";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9527;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const driverProcess = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let driverLog = "";
driverProcess.stdout.on("data", (c) => { driverLog += c.toString(); });
driverProcess.stderr.on("data", (c) => { driverLog += c.toString(); });

async function command(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.value?.error) throw new Error(`${method} ${path}: ${JSON.stringify(payload)}`);
  return payload.value;
}
async function waitForDriver() {
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error(`ChromeDriver did not start\n${driverLog}`);
}
async function execute(sessionId, script, args = []) {
  return command(`/session/${sessionId}/execute/sync`, "POST", { script, args });
}
async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  await writeFile(path, Buffer.from(encoded, "base64"));
}
async function clickButton(sessionId, text) {
  return execute(sessionId, `
    const wanted = arguments[0];
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes(wanted));
    if (!button) return false;
    button.click();
    return true;
  `, [text]);
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

const resetCode = `
  function resetFighter(fighter) {
    fighter.currentMove = null;
    fighter.moveTick = 0;
    fighter.hitStop = 0;
    fighter.hitStun = 0;
    fighter.blockStun = 0;
    fighter.knockdownTicks = 0;
    fighter.guardDamage = 0;
    fighter.velocity.set(0, 0, 0);
    fighter.hitTargets.clear();
    fighter.health = 100;
    fighter.state = 'IDLE';
    fighter.grounded = true;
    const neutral = { left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false };
    fighter.input = { ...neutral };
    fighter.previousInput = { ...neutral };
  }
`;

const configs = {
  kick:       { activeStep: 8 },
  lowKick:    { activeStep: 7 },
  risingKick: { activeStep: 11 },
  dashKick:   { activeStep: 12 },
};

let sessionId;
try {
  await waitForDriver();
  const session = await command("/session", "POST", {
    capabilities: { alwaysMatch: { browserName: "chrome", "goog:chromeOptions": { args: [
      "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--ignore-gpu-blocklist",
      "--enable-webgl", "--use-angle=swiftshader", "--window-size=1200,650", "--hide-scrollbars",
    ] } } },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(650);
  if (!(await clickButton(sessionId, "TPS LOCK-ON BATTLE"))) throw new Error("TPS title button not found");
  await delay(120);
  if (!(await clickButton(sessionId, "ENGAGE TPS"))) throw new Error("TPS engage button not found");

  let ready = false;
  for (let i = 0; i < 160; i += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      return !!game && game.p1.visual.root.userData.motionExpansionHasProcedural === true;
    `);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("procedural motion pack did not preload");

  await execute(sessionId, `${gameLookup}
    const game = findGame();
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.enemyOpeningGraceTicks = 9999;
    game.updateEnemy = () => { game.p2.velocity.set(0,0,0); if (!['HIT','KNOCKDOWN','KO','THROW'].includes(game.p2.state)) game.p2.state='IDLE'; };
    return true;
  `);

  await mkdir(outputDir, { recursive: true });
  const report = {};
  for (const [moveId, cfg] of Object.entries(configs)) {
    const initialized = await execute(sessionId, `${gameLookup}${resetCode}
      const game = findGame();
      resetFighter(game.p1); resetFighter(game.p2);
      game.finished = false; game.input.clear();
      game.p1.position.set(0,0,0.74); game.p2.position.set(0,0,-0.48);
      game.p1.facing = 1; game.p2.facing = -1;
      return game.p1.beginMove(arguments[0]);
    `, [moveId]);
    if (!initialized) throw new Error(`move not found: ${moveId}`);

    const selected = new Map([
      [Math.max(1, cfg.activeStep - 3), "chamber"],
      [cfg.activeStep, "impact"],
      [cfg.activeStep + 4, "recoil"],
    ]);
    report[moveId] = {};
    for (let step = 1; step <= cfg.activeStep + 4; step += 1) {
      const state = await execute(sessionId, `${gameLookup}
        const game = findGame();
        game.p1.hitStop = 0; game.p2.hitStop = 0;
        game.step();
        game.p1.hitStop = 0; game.p2.hitStop = 0;
        const t = performance.now()/1000;
        game.updateVisual(game.p1, game.p2, t);
        game.updateVisual(game.p2, game.p1, t + 0.007);
        game.updateCamera(1/60); game.updateLockOn(); game.renderer.render(game.scene, game.camera);
        const root = game.p1.visual.root;
        const modelHost = root.children.find((child) => child.name?.startsWith('quaternius-ubc-'));
        const model = modelHost?.children.find((child) => child.type === 'Group' || child.children?.length > 0) ?? modelHost?.children?.[0];
        const point = (name) => { const obj=model?.getObjectByName(name); if(!obj) return null; const V=obj.position.constructor; const p=obj.getWorldPosition(new V()); return {x:p.x,y:p.y,z:p.z}; };
        return {
          step: arguments[0], moveTick: game.p1.moveTick, state: game.p1.state,
          phase: root.userData.motionExpansionPhase ?? null,
          clip: root.userData.motionExpansionCurrentClip ?? null,
          footLockError: root.userData.motionExpansionFootLockError ?? null,
          strikeContactError: root.userData.motionExpansionStrikeContactError ?? null,
          pelvis: point('pelvis'), kneeL: point('calf_l'), kneeR: point('calf_r'), footL: point('foot_l'), footR: point('foot_r'), handL: point('hand_l'), handR: point('hand_r'),
        };
      `, [step]);
      const label = selected.get(step);
      if (label) {
        report[moveId][label] = state;
        await screenshot(sessionId, `${outputDir}/${moveId}-${label}.png`);
      }
    }
  }
  await writeFile(`${outputDir}/kick-sequence.json`, JSON.stringify(report, null, 2) + "\n");
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => {});
  driverProcess.kill("SIGTERM");
}
