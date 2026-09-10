import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9524;
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
    throw new Error(`Counterattack handoff screenshot is not PNG: ${path}`);
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

async function captureScenario(sessionId, moveId, fileStem) {
  const probe = await execute(sessionId, `${gameLookup}
    const moveId = arguments[0];
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
    game.p1.setHitReactionVisual('HEAVY', 'RIGHT', false);
    game.p1.state = 'HIT';
    game.p1.hitStop = 0;
    game.p1.hitStun = 3;

    const renderPair = () => {
      game.renderTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, game.renderTime);
      game.updateVisual(game.p2, game.p1, game.renderTime + 0.001);
    };

    for (let frame = 0; frame < 3; frame += 1) {
      renderPair();
      game.p1.hitStun = Math.max(0, game.p1.hitStun - 1);
      game.p1.stateMachine.tick();
    }

    // Author exactly one actionable recovery frame. The following beginMove is
    // therefore an immediate punish/reversal handoff rather than a fresh neutral
    // attack, which is the visual discontinuity this audit protects.
    game.p1.state = 'IDLE';
    renderPair();
    const before = game.p1.visual.root.userData;
    const recoveryBeforeAttack = Number(before.tpsImpactRecoverySeconds ?? 0);
    const recoveryFactorBeforeAttack = Number(before.tpsImpactRecoveryFactor ?? 0);
    const simulationBefore = game.p1.position.clone();

    const move = game.p1.definition.moves[moveId];
    if (!move) return { error: 'move-not-found', moveId };
    if (!game.p1.beginMove(moveId)) return { error: 'begin-move-failed', moveId, state: game.p1.state };

    renderPair();
    const first = game.p1.visual.root.userData;
    const firstFrame = {
      factor: Number(first.tpsCounterattackHandoff ?? 0),
      seconds: Number(first.tpsCounterattackHandoffSeconds ?? 0),
      move: first.tpsCounterattackHandoffMove ?? null,
      releaseTick: Number(first.tpsCounterattackHandoffReleaseTick ?? 0),
      moveTick: game.p1.moveTick,
    };

    // Advance only the authored visual clock. Gameplay physics and simulation
    // position stay frozen so any observed transform comes from presentation.
    const middleTick = Math.max(1, Math.min(move.startup - 1, Math.floor(move.startup * 0.35)));
    game.p1.moveTick = middleTick;
    renderPair();
    const middle = game.p1.visual.root.userData;
    const middleFrame = {
      factor: Number(middle.tpsCounterattackHandoff ?? 0),
      seconds: Number(middle.tpsCounterattackHandoffSeconds ?? 0),
      move: middle.tpsCounterattackHandoffMove ?? null,
      moveTick: game.p1.moveTick,
    };

    // One tick beyond the handoff release point must leave the authored attack
    // fully authoritative, always no later than the first active frame.
    const releaseTick = Math.max(1, Math.ceil(firstFrame.releaseTick + 1));
    game.p1.moveTick = Math.min(move.startup, releaseTick);
    renderPair();
    const released = game.p1.visual.root.userData;
    const releaseFrame = {
      factor: Number(released.tpsCounterattackHandoff ?? 0),
      seconds: Number(released.tpsCounterattackHandoffSeconds ?? 0),
      move: released.tpsCounterattackHandoffMove ?? null,
      moveTick: game.p1.moveTick,
    };

    // Re-author HIT -> one ready frame -> ATTACK so the PNG itself captures the
    // live bridge rather than a fresh attack after the numeric probe has already
    // consumed the recovery state.
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.setHitReactionVisual('HEAVY', 'RIGHT', false);
    game.p1.state = 'HIT';
    game.p1.hitStop = 0;
    game.p1.hitStun = 2;
    for (let frame = 0; frame < 2; frame += 1) {
      renderPair();
      game.p1.hitStun = Math.max(0, game.p1.hitStun - 1);
      game.p1.stateMachine.tick();
    }
    game.p1.state = 'IDLE';
    renderPair();
    if (!game.p1.beginMove(moveId)) return { error: 'repeat-begin-move-failed', moveId, state: game.p1.state };
    renderPair();
    const captureFactor = Number(game.p1.visual.root.userData.tpsCounterattackHandoff ?? 0);

    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    game.p1.visual.root.updateMatrixWorld(true);
    const leftFootY = game.p1.visual.rig.bones.leftFoot.getWorldPosition(game.p1.position.clone()).y;
    const rightFootY = game.p1.visual.rig.bones.rightFoot.getWorldPosition(game.p1.position.clone()).y;
    const simulationDrift = game.p1.position.distanceTo(simulationBefore);

    return {
      moveId,
      startup: move.startup,
      recoveryBeforeAttack,
      recoveryFactorBeforeAttack,
      firstFrame,
      middleFrame,
      releaseFrame,
      captureFactor,
      simulationDrift,
      leftFootY,
      rightFootY,
      actualState: game.p1.state,
      actualMove: game.p1.currentMove?.id ?? null,
    };
  `, [moveId]);

  if (probe?.error) throw new Error(`TPS counterattack handoff setup failed: ${JSON.stringify(probe)}`);
  if (!(probe.recoveryBeforeAttack > 0) || !(probe.recoveryFactorBeforeAttack > 0)) {
    throw new Error(`TPS counterattack source recovery disappeared: ${JSON.stringify(probe)}`);
  }
  if (!(probe.firstFrame.factor > 0) || probe.firstFrame.move !== moveId) {
    throw new Error(`TPS counterattack did not inherit recovery on first startup frame: ${JSON.stringify(probe)}`);
  }
  if (probe.middleFrame.factor > probe.firstFrame.factor + 1e-6) {
    throw new Error(`TPS counterattack handoff grew during startup: ${JSON.stringify(probe)}`);
  }
  if (probe.releaseFrame.factor > 1e-4 || probe.releaseFrame.move !== moveId) {
    throw new Error(`TPS counterattack handoff survived past release point: ${JSON.stringify(probe)}`);
  }
  if (!(probe.captureFactor > 0)) {
    throw new Error(`TPS counterattack PNG is not on a live handoff frame: ${JSON.stringify(probe)}`);
  }
  if (probe.actualState !== 'ATTACK' || probe.actualMove !== moveId) {
    throw new Error(`TPS counterattack authored move lost ownership: ${JSON.stringify(probe)}`);
  }
  if (!(probe.simulationDrift <= 1e-6)) {
    throw new Error(`TPS counterattack presentation changed simulation position: ${JSON.stringify(probe)}`);
  }
  for (const value of [probe.leftFootY, probe.rightFootY, probe.firstFrame.factor, probe.middleFrame.factor, probe.releaseFrame.factor, probe.captureFactor]) {
    if (!Number.isFinite(value)) throw new Error(`TPS counterattack handoff produced non-finite output: ${JSON.stringify(probe)}`);
  }

  await screenshot(sessionId, `${outputDir}/${fileStem}.png`);
  return probe;
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
  if (!ready) throw new Error("TPS counterattack handoff audit did not reach ready WebGL models");

  const jab = await captureScenario(sessionId, "jab", "tps-counterattack-handoff-jab");
  const kick = await captureScenario(sessionId, "kick", "tps-counterattack-handoff-kick");
  const power = await captureScenario(sessionId, "power", "tps-counterattack-handoff-power");

  await writeFile(
    `${outputDir}/tps-counterattack-handoff.json`,
    `${JSON.stringify({ jab, kick, power }, null, 2)}\n`,
    "utf8",
  );
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => {});
  driverProcess.kill("SIGTERM");
  await writeFile(`${outputDir}/tps-counterattack-handoff-webdriver.log`, driverLog, "utf8").catch(() => {});
}
