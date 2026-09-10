import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-close-punch-lane";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9527;
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

async function captureMove(sessionId, moveId) {
  return execute(sessionId, `${gameLookup}
    const game = findGame();
    const moveId = arguments[0];
    if (!game) return { error: 'game-not-found' };
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(5);
    game.p1.resetForRound(0, 0.68, 1);
    game.p2.resetForRound(0, -0.46, -1);
    game.p1.velocity.set(0, 0, 0);
    game.p2.velocity.set(0, 0, 0);
    game.p1.facing = 1;
    game.p2.facing = -1;
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); if (game.p2.state !== 'HIT') game.p2.state = 'IDLE'; };
    const simulationBefore = game.p1.position.clone();

    if (!game.p1.beginMove(moveId)) return { error: 'begin-move-failed', moveId };
    const move = game.p1.currentMove;
    game.p1.moveTick = move.startup;
    game.renderTime += 1 / 60;
    game.updateVisual(game.p1, game.p2, game.renderTime);
    game.updateVisual(game.p2, game.p1, game.renderTime + 0.001);
    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);

    const data = game.p1.visual.root.userData;
    const host = game.p1.visual.root.children.find((child) => child.name?.startsWith('quaternius-ubc-') && child.name?.endsWith('-runtime'));
    const model = host?.children.find((child) => child.type === 'Group' || child.children?.length > 0) ?? host?.children?.[0] ?? null;
    const chest = model?.getObjectByName('spine_03') ?? null;
    const enemyHost = game.p2.visual.root.children.find((child) => child.name?.startsWith('quaternius-ubc-') && child.name?.endsWith('-runtime'));
    const enemyModel = enemyHost?.children.find((child) => child.type === 'Group' || child.children?.length > 0) ?? enemyHost?.children?.[0] ?? null;
    const enemyChest = enemyModel?.getObjectByName('spine_03') ?? null;
    const project = (object) => {
      if (!object) return null;
      const p = object.getWorldPosition(new object.position.constructor());
      p.project(game.camera);
      return { x: (p.x * 0.5 + 0.5) * game.renderer.domElement.width, y: (-p.y * 0.5 + 0.5) * game.renderer.domElement.height };
    };
    const chestScreen = project(chest);
    const enemyChestScreen = project(enemyChest);
    const chestGapPx = chestScreen && enemyChestScreen ? Math.abs(chestScreen.x - enemyChestScreen.x) : 0;
    return {
      moveId,
      factor: Number(data.tpsClosePunchLane ?? 0),
      laneX: Number(data.tpsClosePunchLaneX ?? 0),
      yaw: Number(data.tpsClosePunchLaneYaw ?? 0),
      roll: Number(data.tpsClosePunchLaneRoll ?? 0),
      laneMove: data.tpsClosePunchLaneMove ?? null,
      distance: Number(data.tpsClosePunchLaneDistance ?? 0),
      bodyBlowLevelChange: Number(data.tpsBodyBlowLevelChange ?? 0),
      chestGapPx,
      simulationDrift: game.p1.position.distanceTo(simulationBefore),
      state: game.p1.state,
      moveTick: game.p1.moveTick,
      startup: move.startup,
    };
  `, [moveId]);
}

function assertMove(result, moveId) {
  if (result?.error) throw new Error(`${moveId} setup failed: ${JSON.stringify(result)}`);
  if (result.moveId !== moveId || result.laneMove !== moveId || result.state !== 'ATTACK') throw new Error(`${moveId} did not stay on the audited attack frame: ${JSON.stringify(result)}`);
  if (!(result.factor > 0.20) || !(Math.abs(result.laneX) > 0.004) || !(Math.abs(result.yaw) > 0.008)) throw new Error(`${moveId} close punch lane did not open enough: ${JSON.stringify(result)}`);
  if (!(result.distance < 1.92)) throw new Error(`${moveId} was not tested at close range: ${JSON.stringify(result)}`);
  if (!(result.chestGapPx >= 90)) throw new Error(`${moveId} chest screen lanes still collapse below the 90px readability floor: ${JSON.stringify(result)}`);
  if (!(result.simulationDrift <= 1e-6)) throw new Error(`${moveId} presentation changed simulation position: ${JSON.stringify(result)}`);
  if (moveId === 'bodyBlow' && !(result.bodyBlowLevelChange > 0.1)) throw new Error(`bodyBlow lost its existing level-change layer: ${JSON.stringify(result)}`);
}

let sessionId = null;
try {
  await waitForDriver();
  const session = await command('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--window-size=1536,706', '--hide-scrollbars'],
        },
      },
    },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, 'POST', { url });
  await delay(650);
  await mkdir(outputDir, { recursive: true });
  if (!(await clickButton(sessionId, 'START FIGHT'))) throw new Error('START FIGHT button not found');
  await delay(140);
  if (!(await clickButton(sessionId, 'ENGAGE'))) throw new Error('ENGAGE button not found');

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      return Boolean(game && game.p1?.visual?.root?.userData?.quaterniusModelState === 'ready' && game.p2?.visual?.root?.userData?.quaterniusModelState === 'ready');
    `);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Close punch lane audit did not reach ready WebGL models');

  const results = {};
  for (const moveId of ['jab', 'straight', 'bodyBlow']) {
    const result = await captureMove(sessionId, moveId);
    assertMove(result, moveId);
    results[moveId] = result;
    await screenshot(sessionId, `${outputDir}/tps-close-punch-${moveId.toLowerCase()}.png`);
  }
  await writeFile(`${outputDir}/tps-close-punch-lane.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
} finally {
  if (sessionId) await command(`/session/${sessionId}`, 'DELETE').catch(() => {});
  driverProcess.kill('SIGTERM');
  await writeFile(`${outputDir}/webdriver.log`, driverLog, 'utf8').catch(() => {});
}
