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
  if (!response.ok || payload?.value?.error) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
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
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Screenshot is not PNG: ${path}`);
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

const sharedAuditHelpers = `
  const importedHost = (fighter) => fighter.visual.root.children.find(
    (child) => child.name?.startsWith('quaternius-ubc-') && child.name?.endsWith('-runtime')
  );
  const importedModel = (fighter) => {
    const host = importedHost(fighter);
    return host?.children.find((child) => child.type === 'Group' || child.children?.length > 0)
      ?? host?.children?.[0]
      ?? null;
  };
  const footPoint = (fighter, suffix) => {
    const model = importedModel(fighter);
    const foot = model?.getObjectByName('foot_' + suffix);
    if (!foot) return null;
    const point = foot.getWorldPosition(new foot.position.constructor());
    return { x: point.x, y: point.y, z: point.z };
  };
  const resetMatch = (game) => {
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(5);
    game.p1.resetForRound(0, 0.82, 1);
    game.p2.resetForRound(0, -0.58, -1);
    game.p1.velocity.set(0, 0, 0);
    game.p2.velocity.set(0, 0, 0);
    game.p1.facing = 1;
    game.p2.facing = -1;
    game.p1.hitStop = 0;
    game.p2.hitStop = 0;
  };
  const renderTick = (game, auditTime) => {
    game.updateVisual(game.p1, game.p2, auditTime);
    game.updateVisual(game.p2, game.p1, auditTime + 0.007);
    game.renderer.render(game.scene, game.camera);
  };
`;

async function auditSequence(sessionId, sequence) {
  return execute(sessionId, `${gameLookup}${sharedAuditHelpers}
    const sequence = arguments[0];
    const game = findGame();
    if (!game) return { error: 'game-not-found' };
    resetMatch(game);

    let auditTime = performance.now() / 1000;
    for (let settle = 0; settle < 10; settle += 1) {
      auditTime += 1 / 60;
      renderTick(game, auditTime);
    }

    const frames = [];
    for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex += 1) {
      const moveId = sequence[sequenceIndex];
      if (!game.p1.beginMove(moveId)) {
        return { error: 'begin-move-failed', moveId, sequenceIndex, state: game.p1.state };
      }
      const move = game.p1.currentMove;
      const total = move.startup + move.active + move.recovery;
      for (let tick = 0; tick < total; tick += 1) {
        game.p1.moveTick = tick;
        auditTime += 1 / 60;
        renderTick(game, auditTime);
        const left = footPoint(game.p1, 'l');
        const right = footPoint(game.p1, 'r');
        if (!left || !right) return { error: 'missing-foot', moveId, sequenceIndex, tick };
        const data = game.p1.visual.root.userData;
        frames.push({
          sequenceIndex,
          moveId,
          tick,
          leftHeight: left.y,
          rightHeight: right.y,
          minFootHeight: Math.min(left.y, right.y),
          bridge: Number(data.tpsKickSpamGroundBridge ?? 0),
          bridgeMove: String(data.tpsKickSpamGroundBridgeMove ?? 'NONE'),
          bridgeSupportHeight: Number(data.tpsKickSpamGroundBridgeSupportHeight ?? 0),
          supportFootLock: Number(data.tpsKickSupportFoot ?? 0),
          simulationY: game.p1.position.y,
          grounded: Boolean(game.p1.grounded),
        });
      }

      // End the move in simulation, then begin the next kick immediately without
      // rendering IDLE in between. This is the exact visual handoff created by
      // rapidly pressing K as soon as recovery allows the next attack.
      game.p1.moveTick = total - 1;
      game.p1.advanceAttack();
      if (game.p1.currentMove || game.p1.state !== 'IDLE') {
        return { error: 'move-did-not-finish', moveId, sequenceIndex, state: game.p1.state };
      }
    }

    const airborne = frames.filter((frame) => frame.minFootHeight >= 0.48);
    const ungroundedSimulation = frames.filter((frame) => !frame.grounded || Math.abs(frame.simulationY) > 1e-6);
    return {
      sequence,
      frameCount: frames.length,
      bridgeFrames: frames.filter((frame) => frame.bridge > 0.5).length,
      worstMinFootHeight: Math.max(...frames.map((frame) => frame.minFootHeight)),
      airborne,
      ungroundedSimulation,
      frames,
    };
  `, [sequence]);
}

async function poseRestartFrame(sessionId, previousMoveId, nextMoveId) {
  return execute(sessionId, `${gameLookup}${sharedAuditHelpers}
    const [previousMoveId, nextMoveId] = arguments;
    const game = findGame();
    if (!game) return { error: 'game-not-found' };
    resetMatch(game);
    let auditTime = performance.now() / 1000;
    for (let settle = 0; settle < 10; settle += 1) {
      auditTime += 1 / 60;
      renderTick(game, auditTime);
    }

    if (!game.p1.beginMove(previousMoveId)) return { error: 'begin-previous-failed' };
    const previous = game.p1.currentMove;
    const previousTotal = previous.startup + previous.active + previous.recovery;
    for (let tick = 0; tick < previousTotal; tick += 1) {
      game.p1.moveTick = tick;
      auditTime += 1 / 60;
      renderTick(game, auditTime);
    }
    game.p1.moveTick = previousTotal - 1;
    game.p1.advanceAttack();
    if (!game.p1.beginMove(nextMoveId)) return { error: 'begin-next-failed', state: game.p1.state };
    game.p1.moveTick = 0;
    auditTime += 1 / 60;
    renderTick(game, auditTime);
    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);

    const left = footPoint(game.p1, 'l');
    const right = footPoint(game.p1, 'r');
    const data = game.p1.visual.root.userData;
    return {
      previousMoveId,
      nextMoveId,
      tick: 0,
      leftHeight: left?.y ?? null,
      rightHeight: right?.y ?? null,
      minFootHeight: left && right ? Math.min(left.y, right.y) : null,
      bridge: Number(data.tpsKickSpamGroundBridge ?? 0),
      bridgeMove: String(data.tpsKickSpamGroundBridgeMove ?? 'NONE'),
      supportFootLock: Number(data.tpsKickSupportFoot ?? 0),
      simulationY: game.p1.position.y,
      grounded: Boolean(game.p1.grounded),
    };
  `, [previousMoveId, nextMoveId]);
}

let sessionId = null;
try {
  await waitForDriver();
  const session = await command('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: [
            '--headless=new',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--ignore-gpu-blocklist',
            '--enable-webgl',
            '--use-angle=swiftshader',
            '--window-size=1536,706',
            '--hide-scrollbars',
          ],
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
  for (let attempt = 0; attempt < 140; attempt += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      return Boolean(game && game.p1?.visual?.root?.userData?.quaterniusModelState === 'ready' && game.p2?.visual?.root?.userData?.quaterniusModelState === 'ready');
    `);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Kick spam audit did not reach ready WebGL models');

  const repeated = await auditSequence(sessionId, ['kick', 'kick', 'kick', 'kick']);
  const mixed = await auditSequence(sessionId, ['kick', 'lowKick', 'risingKick', 'kick']);
  if (repeated?.error) throw new Error(`Repeated kick audit failed: ${JSON.stringify(repeated)}`);
  if (mixed?.error) throw new Error(`Mixed kick audit failed: ${JSON.stringify(mixed)}`);
  if (repeated.airborne.length > 0) {
    throw new Error(`Repeated K still has both feet airborne: ${JSON.stringify(repeated.airborne.slice(0, 6))}`);
  }
  if (mixed.airborne.length > 0) {
    throw new Error(`Mixed rapid kicks still have both feet airborne: ${JSON.stringify(mixed.airborne.slice(0, 6))}`);
  }
  if (repeated.ungroundedSimulation.length > 0 || mixed.ungroundedSimulation.length > 0) {
    throw new Error('Kick spam presentation changed grounded simulation state');
  }

  const kickRestart = await poseRestartFrame(sessionId, 'kick', 'kick');
  if (kickRestart?.error || kickRestart.minFootHeight === null || kickRestart.minFootHeight >= 0.48) {
    throw new Error(`Kick -> Kick restart frame is airborne: ${JSON.stringify(kickRestart)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-kick-spam-kick-to-kick.png`);

  const lowRestart = await poseRestartFrame(sessionId, 'kick', 'lowKick');
  if (lowRestart?.error || lowRestart.minFootHeight === null || lowRestart.minFootHeight >= 0.48) {
    throw new Error(`Kick -> Low Kick restart frame is airborne: ${JSON.stringify(lowRestart)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-kick-spam-kick-to-lowkick.png`);

  await writeFile(
    `${outputDir}/tps-kick-spam.json`,
    `${JSON.stringify({ repeated, mixed, kickRestart, lowRestart }, null, 2)}\n`,
    'utf8',
  );
} finally {
  if (sessionId) await command(`/session/${sessionId}`, 'DELETE').catch(() => {});
  driverProcess.kill('SIGTERM');
  await writeFile(`${outputDir}/webdriver-kick-spam.log`, driverLog, 'utf8').catch(() => {});
}
