import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9525;
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
    const wanted = arguments[0];
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes(wanted));
    if (!button) return false;
    button.click();
    return true;
  `, [text]);
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Block/punish handoff screenshot is not PNG: ${path}`);
  }
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

async function captureBlockScenario(sessionId) {
  return execute(sessionId, `${gameLookup}
    const game = findGame();
    if (!game) return { error: 'game-not-found' };
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.p1.resetForRound(0, 0.90, 1);
    game.p2.resetForRound(0, -0.90, -1);
    game.p1.velocity.set(0, 0, 0);
    game.p2.velocity.set(0, 0, 0);
    game.p1.setHitReactionVisual('MID', 'RIGHT', false);

    const renderPair = () => {
      game.renderTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, game.renderTime);
      game.updateVisual(game.p2, game.p1, game.renderTime + 0.001);
    };

    game.p1.state = 'BLOCK_STUN';
    game.p1.blockStun = 2;
    game.p1.hitStop = 0;
    renderPair();
    game.p1.blockStun = 1;
    renderPair();
    const before = game.p1.visual.root.userData;
    const sourcePose = Number(before.tpsGuardClashPose ?? 0);
    const sourceRole = before.tpsGuardClashRole ?? null;
    const sourceRotX = Number(before.tpsGuardClashHostRotX ?? 0);
    const simulationBefore = game.p1.position.clone();

    game.p1.blockStun = 0;
    game.p1.state = 'IDLE';
    if (!game.p1.beginMove('jab')) return { error: 'begin-move-failed', state: game.p1.state };
    const move = game.p1.currentMove;
    renderPair();
    const firstData = game.p1.visual.root.userData;
    const first = {
      factor: Number(firstData.tpsCounterattackHandoff ?? 0),
      source: firstData.tpsCounterattackHandoffSource ?? null,
      releaseTick: Number(firstData.tpsCounterattackHandoffReleaseTick ?? 0),
      move: firstData.tpsCounterattackHandoffMove ?? null,
    };

    game.p1.moveTick = Math.max(1, Math.floor(move.startup * 0.35));
    renderPair();
    const middle = Number(game.p1.visual.root.userData.tpsCounterattackHandoff ?? 0);
    game.p1.moveTick = Math.min(move.startup, Math.ceil(first.releaseTick + 1));
    renderPair();
    const released = Number(game.p1.visual.root.userData.tpsCounterattackHandoff ?? 0);

    // Rebuild the live first frame for the PNG.
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.state = 'BLOCK_STUN';
    game.p1.blockStun = 1;
    renderPair();
    game.p1.blockStun = 0;
    game.p1.state = 'IDLE';
    if (!game.p1.beginMove('jab')) return { error: 'repeat-begin-failed' };
    renderPair();
    const captureFactor = Number(game.p1.visual.root.userData.tpsCounterattackHandoff ?? 0);
    const captureSource = game.p1.visual.root.userData.tpsCounterattackHandoffSource ?? null;

    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const simulationDrift = game.p1.position.distanceTo(simulationBefore);

    return { sourcePose, sourceRole, sourceRotX, first, middle, released, captureFactor, captureSource, simulationDrift, startup: move.startup };
  `);
}

async function capturePunishScenario(sessionId) {
  return execute(sessionId, `${gameLookup}
    const game = findGame();
    if (!game) return { error: 'game-not-found' };
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.p1.resetForRound(0, 0.90, 1);
    game.p2.resetForRound(0, -0.90, -1);
    game.p1.velocity.set(0, 0, 0);
    game.p2.velocity.set(0, 0, 0);

    const renderPair = () => {
      game.renderTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, game.renderTime);
      game.updateVisual(game.p2, game.p1, game.renderTime + 0.001);
    };

    game.p1.state = 'IDLE';
    game.playerReversalTicks = 8;
    game.playerPerfectEvadeTicks = 0;
    game.playerEvadeSign = 1;
    renderPair();
    const before = game.p1.visual.root.userData;
    const sourcePose = Number(before.tpsPunishReadyPose ?? 0);
    const sourceRotY = Number(before.tpsPunishReadyRotY ?? 0);
    const simulationBefore = game.p1.position.clone();

    if (!game.p1.beginMove('power')) return { error: 'begin-move-failed', state: game.p1.state };
    const move = game.p1.currentMove;
    renderPair();
    const firstData = game.p1.visual.root.userData;
    const first = {
      factor: Number(firstData.tpsCounterattackHandoff ?? 0),
      source: firstData.tpsCounterattackHandoffSource ?? null,
      releaseTick: Number(firstData.tpsCounterattackHandoffReleaseTick ?? 0),
      move: firstData.tpsCounterattackHandoffMove ?? null,
    };

    game.p1.moveTick = Math.max(1, Math.floor(move.startup * 0.35));
    renderPair();
    const middle = Number(game.p1.visual.root.userData.tpsCounterattackHandoff ?? 0);
    game.p1.moveTick = Math.min(move.startup, Math.ceil(first.releaseTick + 1));
    renderPair();
    const released = Number(game.p1.visual.root.userData.tpsCounterattackHandoff ?? 0);

    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.state = 'IDLE';
    game.playerReversalTicks = 8;
    renderPair();
    if (!game.p1.beginMove('power')) return { error: 'repeat-begin-failed' };
    renderPair();
    const captureFactor = Number(game.p1.visual.root.userData.tpsCounterattackHandoff ?? 0);
    const captureSource = game.p1.visual.root.userData.tpsCounterattackHandoffSource ?? null;

    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const simulationDrift = game.p1.position.distanceTo(simulationBefore);

    return { sourcePose, sourceRotY, first, middle, released, captureFactor, captureSource, simulationDrift, startup: move.startup };
  `);
}

function assertProbe(probe, expectedSource, moveId) {
  if (probe?.error) throw new Error(`${expectedSource} handoff setup failed: ${JSON.stringify(probe)}`);
  if (!(probe.sourcePose > 0)) throw new Error(`${expectedSource} source pose disappeared: ${JSON.stringify(probe)}`);
  if (!(probe.first.factor > 0) || probe.first.source !== expectedSource || probe.first.move !== moveId) {
    throw new Error(`${expectedSource} handoff did not own first startup frame: ${JSON.stringify(probe)}`);
  }
  if (probe.middle > probe.first.factor + 1e-6) throw new Error(`${expectedSource} handoff grew during startup: ${JSON.stringify(probe)}`);
  if (probe.released > 1e-4) throw new Error(`${expectedSource} handoff survived release point: ${JSON.stringify(probe)}`);
  if (!(probe.captureFactor > 0) || probe.captureSource !== expectedSource) {
    throw new Error(`${expectedSource} PNG is not on live handoff frame: ${JSON.stringify(probe)}`);
  }
  if (!(probe.simulationDrift <= 1e-6)) throw new Error(`${expectedSource} presentation changed simulation position: ${JSON.stringify(probe)}`);
}

let sessionId = null;
try {
  await waitForDriver();
  const session = await command("/session", "POST", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        "goog:chromeOptions": {
          args: [
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--ignore-gpu-blocklist",
            "--enable-webgl",
            "--use-angle=swiftshader",
            "--window-size=1536,706",
            "--hide-scrollbars",
          ],
        },
      },
    },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(650);
  await mkdir(outputDir, { recursive: true });

  if (!(await clickButton(sessionId, "START FIGHT"))) throw new Error("START FIGHT button not found");
  await delay(140);
  if (!(await clickButton(sessionId, "ENGAGE"))) throw new Error("ENGAGE button not found");

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      const canvas = document.querySelector('.scene-host canvas');
      const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) : null;
      return Boolean(game && gl && game.p1?.visual?.root?.userData?.quaterniusModelState === 'ready' && game.p2?.visual?.root?.userData?.quaterniusModelState === 'ready');
    `);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("TPS block/punish handoff audit did not reach ready WebGL models");

  const block = await captureBlockScenario(sessionId);
  assertProbe(block, "BLOCK", "jab");
  await screenshot(sessionId, `${outputDir}/tps-block-punish-handoff-block-jab.png`);

  const punish = await capturePunishScenario(sessionId);
  assertProbe(punish, "PUNISH", "power");
  await screenshot(sessionId, `${outputDir}/tps-block-punish-handoff-punish-power.png`);

  await writeFile(
    `${outputDir}/tps-block-punish-handoff.json`,
    `${JSON.stringify({ block, punish }, null, 2)}\n`,
    "utf8",
  );
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => {});
  driverProcess.kill("SIGTERM");
  await writeFile(`${outputDir}/tps-block-punish-handoff-webdriver.log`, driverLog, "utf8").catch(() => {});
}
