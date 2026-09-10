import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9526;
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
    throw new Error(`Attack/action handoff screenshot is not PNG: ${path}`);
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

async function captureScenario(sessionId, target) {
  return execute(sessionId, `${gameLookup}
    const game = findGame();
    const target = arguments[0];
    if (!game) return { error: 'game-not-found' };
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.p1.resetForRound(0, 1.05, 1);
    game.p2.resetForRound(0, -1.05, -1);
    game.p1.velocity.set(0, 0, 0);
    game.p2.velocity.set(0, 0, 0);

    const renderPair = () => {
      game.renderTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, game.renderTime);
      game.updateVisual(game.p2, game.p1, game.renderTime + 0.001);
    };
    const seedPowerTail = () => {
      game.p1.currentMove = null;
      game.p1.moveTick = 0;
      game.p1.state = 'IDLE';
      renderPair();
      if (!game.p1.beginMove('power')) return false;
      const move = game.p1.currentMove;
      game.p1.moveTick = Math.max(0, move.startup + move.active + move.recovery - 1);
      renderPair();
      game.p1.currentMove = null;
      game.p1.moveTick = 0;
      game.p1.state = 'IDLE';
      renderPair();
      return true;
    };

    if (!seedPowerTail()) return { error: 'power-tail-seed-failed' };
    const sourceData = game.p1.visual.root.userData;
    const source = {
      factor: Number(sourceData.tpsAttackAfterfeel ?? 0),
      move: sourceData.tpsAttackAfterfeelMove ?? null,
      positionX: Number(sourceData.tpsAttackAfterfeelPositionX ?? 0),
      rotationX: Number(sourceData.tpsAttackAfterfeelRotationX ?? 0),
      rotationY: Number(sourceData.tpsAttackAfterfeelRotationY ?? 0),
      rotationZ: Number(sourceData.tpsAttackAfterfeelRotationZ ?? 0),
    };
    const simulationBefore = game.p1.position.clone();

    game.p1.state = target;
    renderPair();
    const firstData = game.p1.visual.root.userData;
    const first = {
      factor: Number(firstData.tpsAttackActionHandoff ?? 0),
      envelope: Number(firstData.tpsAttackActionHandoffEnvelope ?? 0),
      sourceMove: firstData.tpsAttackActionHandoffSourceMove ?? null,
      target: firstData.tpsAttackActionHandoffTarget ?? null,
      attackAfterfeel: Number(firstData.tpsAttackAfterfeel ?? 0),
      positionX: Number(firstData.tpsAttackActionHandoffPositionX ?? 0),
      rotationY: Number(firstData.tpsAttackActionHandoffRotationY ?? 0),
    };

    renderPair();
    renderPair();
    const middle = Number(game.p1.visual.root.userData.tpsAttackActionHandoff ?? 0);
    for (let frame = 0; frame < 8; frame += 1) renderPair();
    const released = Number(game.p1.visual.root.userData.tpsAttackActionHandoff ?? 0);

    // Rebuild the first live transition frame for the screenshot artifact.
    if (!seedPowerTail()) return { error: 'repeat-power-tail-seed-failed' };
    game.p1.state = target;
    renderPair();
    const captureData = game.p1.visual.root.userData;
    const captureFactor = Number(captureData.tpsAttackActionHandoff ?? 0);
    const captureTarget = captureData.tpsAttackActionHandoffTarget ?? null;

    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const simulationDrift = game.p1.position.distanceTo(simulationBefore);

    return { source, first, middle, released, captureFactor, captureTarget, simulationDrift, actualState: game.p1.state };
  `, [target]);
}

function assertProbe(probe, target) {
  if (probe?.error) throw new Error(`${target} handoff setup failed: ${JSON.stringify(probe)}`);
  if (!(probe.source.factor > 0) || probe.source.move !== 'power') {
    throw new Error(`${target} source attack afterfeel disappeared: ${JSON.stringify(probe)}`);
  }
  const sourceMagnitude = Math.abs(probe.source.positionX)
    + Math.abs(probe.source.rotationX)
    + Math.abs(probe.source.rotationY)
    + Math.abs(probe.source.rotationZ);
  if (!(sourceMagnitude > 1e-6)) throw new Error(`${target} source tail had no host motion: ${JSON.stringify(probe)}`);
  if (!(probe.first.factor > 0) || !(probe.first.envelope > 0) || probe.first.sourceMove !== 'power' || probe.first.target !== target) {
    throw new Error(`${target} handoff did not own the first action frame: ${JSON.stringify(probe)}`);
  }
  if (probe.first.attackAfterfeel > 1e-4) {
    throw new Error(`${target} still depended on the old attack-afterfeel layer: ${JSON.stringify(probe)}`);
  }
  if (probe.middle > probe.first.factor + 1e-6) throw new Error(`${target} handoff grew after entry: ${JSON.stringify(probe)}`);
  if (probe.released > 1e-4) throw new Error(`${target} handoff survived its short release: ${JSON.stringify(probe)}`);
  if (!(probe.captureFactor > 0) || probe.captureTarget !== target || probe.actualState !== target) {
    throw new Error(`${target} PNG is not on a live handoff frame: ${JSON.stringify(probe)}`);
  }
  if (!(probe.simulationDrift <= 1e-6)) throw new Error(`${target} presentation changed simulation position: ${JSON.stringify(probe)}`);
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
  if (!ready) throw new Error("TPS attack/action handoff audit did not reach ready WebGL models");

  const guard = await captureScenario(sessionId, "GUARD");
  assertProbe(guard, "GUARD");
  await screenshot(sessionId, `${outputDir}/tps-attack-action-handoff-guard.png`);

  const sidestep = await captureScenario(sessionId, "SIDESTEP");
  assertProbe(sidestep, "SIDESTEP");
  await screenshot(sessionId, `${outputDir}/tps-attack-action-handoff-sidestep.png`);

  await writeFile(
    `${outputDir}/tps-attack-action-handoff.json`,
    `${JSON.stringify({ guard, sidestep }, null, 2)}\n`,
    "utf8",
  );
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => {});
  driverProcess.kill("SIGTERM");
  await writeFile(`${outputDir}/tps-attack-action-handoff-webdriver.log`, driverLog, "utf8").catch(() => {});
}
