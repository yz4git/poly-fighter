import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-kick-sequence";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9534;
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

const helpers = `
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
  const linkStartFor = (move) => {
    const recoveryStart = move.startup + move.active;
    const recoveryTicks = Math.max(1, move.recovery);
    const usableRecovery = Math.max(1, recoveryTicks - 2);
    const settleTicks = Math.max(1, Math.min(usableRecovery, Math.round(recoveryTicks * 0.22)));
    return recoveryStart + settleTicks;
  };
  const forceComboLink = (game, fromMove, toMoveId, linkTick, serial) => {
    const data = game.p1.visual.root.userData;
    data.tpsComboLinkSerial = serial;
    data.tpsComboLinkState = 'LINKED';
    data.tpsComboLinkFromMove = fromMove.id;
    data.tpsComboLinkTick = linkTick;
    data.tpsComboLinkStart = linkTick;
    data.tpsComboLinkEnd = linkTick + Math.max(1, fromMove.cancelWindow) - 1;
    data.tpsComboLinkRouteFrom = 'FAR';
    data.tpsComboLinkRouteTo = 'FAR';
    data.tpsComboLinkBranch = 'NEUTRAL';
    data.tpsComboLinkBlendSeconds = 0.075;
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.state = 'IDLE';
    game.p1.hitTargets.clear();
    if (!game.p1.beginMove(toMoveId)) return false;
    game.p1.updatePhysics(1 / 60);
    return true;
  };
`;

async function auditLinkedSequence(sessionId, sequence) {
  return execute(sessionId, `${gameLookup}${helpers}
    const sequence = arguments[0];
    const game = findGame();
    if (!game) return { error: 'game-not-found' };
    resetMatch(game);
    let auditTime = performance.now() / 1000;
    for (let settle = 0; settle < 12; settle += 1) {
      auditTime += 1 / 60;
      renderTick(game, auditTime);
    }

    const frames = [];
    let serial = Number(game.p1.visual.root.userData.tpsComboLinkSerial ?? 0);
    if (!game.p1.beginMove(sequence[0])) return { error: 'begin-first-failed' };

    for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex += 1) {
      const moveId = sequence[sequenceIndex];
      const move = game.p1.currentMove;
      if (!move || move.id !== moveId) {
        return { error: 'unexpected-move', sequenceIndex, moveId, actual: move?.id ?? null };
      }
      const total = move.startup + move.active + move.recovery;
      const linkTick = sequenceIndex < sequence.length - 1 ? linkStartFor(move) : total - 1;
      for (let tick = 0; tick <= linkTick; tick += 1) {
        game.p1.moveTick = tick;
        auditTime += 1 / 60;
        renderTick(game, auditTime);
        const left = footPoint(game.p1, 'l');
        const right = footPoint(game.p1, 'r');
        if (!left || !right) return { error: 'missing-foot', sequenceIndex, moveId, tick };
        const data = game.p1.visual.root.userData;
        frames.push({
          sequenceIndex,
          moveId,
          tick,
          linkTick,
          leftHeight: left.y,
          rightHeight: right.y,
          minFootHeight: Math.min(left.y, right.y),
          bridge: Number(data.tpsKickSpamGroundBridge ?? 0),
          bridgeMove: String(data.tpsKickSpamGroundBridgeMove ?? 'NONE'),
          supportFootLock: Number(data.tpsKickSupportFoot ?? 0),
          supportFootMove: String(data.tpsKickSupportFootMove ?? 'NONE'),
          simulationY: game.p1.position.y,
          grounded: Boolean(game.p1.grounded),
        });
      }

      if (sequenceIndex < sequence.length - 1) {
        serial += 1;
        if (!forceComboLink(game, move, sequence[sequenceIndex + 1], linkTick, serial)) {
          return { error: 'forced-link-failed', sequenceIndex, moveId, next: sequence[sequenceIndex + 1] };
        }
      }
    }

    const airborne = frames.filter((frame) => frame.minFootHeight >= 0.48);
    const transitionFrames = frames.filter((frame) => frame.sequenceIndex > 0 && frame.tick <= 4);
    return {
      sequence,
      frameCount: frames.length,
      bridgeFrames: frames.filter((frame) => frame.bridge > 0.5).length,
      transitionBridgeFrames: transitionFrames.filter((frame) => frame.bridge > 0.5).length,
      worstMinFootHeight: Math.max(...frames.map((frame) => frame.minFootHeight)),
      airborne,
      transitionFrames,
      ungroundedSimulation: frames.filter((frame) => !frame.grounded || Math.abs(frame.simulationY) > 1e-6),
      frames,
    };
  `, [sequence]);
}

async function poseFirstLink(sessionId, nextTick) {
  return execute(sessionId, `${gameLookup}${helpers}
    const nextTick = arguments[0];
    const game = findGame();
    if (!game) return { error: 'game-not-found' };
    resetMatch(game);
    let auditTime = performance.now() / 1000;
    for (let settle = 0; settle < 12; settle += 1) {
      auditTime += 1 / 60;
      renderTick(game, auditTime);
    }
    if (!game.p1.beginMove('kick')) return { error: 'begin-kick-failed' };
    const move = game.p1.currentMove;
    const linkTick = linkStartFor(move);
    for (let tick = 0; tick <= linkTick; tick += 1) {
      game.p1.moveTick = tick;
      auditTime += 1 / 60;
      renderTick(game, auditTime);
    }
    const serial = Number(game.p1.visual.root.userData.tpsComboLinkSerial ?? 0) + 1;
    if (!forceComboLink(game, move, 'lowKick', linkTick, serial)) return { error: 'link-failed' };
    for (let tick = 0; tick <= nextTick; tick += 1) {
      game.p1.moveTick = tick;
      auditTime += 1 / 60;
      renderTick(game, auditTime);
    }
    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const left = footPoint(game.p1, 'l');
    const right = footPoint(game.p1, 'r');
    const data = game.p1.visual.root.userData;
    return {
      moveId: game.p1.currentMove?.id ?? null,
      tick: game.p1.moveTick,
      leftHeight: left?.y ?? null,
      rightHeight: right?.y ?? null,
      minFootHeight: left && right ? Math.min(left.y, right.y) : null,
      bridge: Number(data.tpsKickSpamGroundBridge ?? 0),
      bridgeMove: String(data.tpsKickSpamGroundBridgeMove ?? 'NONE'),
      supportFootLock: Number(data.tpsKickSupportFoot ?? 0),
      supportFootMove: String(data.tpsKickSupportFootMove ?? 'NONE'),
      simulationY: game.p1.position.y,
      grounded: Boolean(game.p1.grounded),
    };
  `, [nextTick]);
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
  if (!ready) throw new Error('Kick link audit did not reach ready WebGL models');

  const farCombo = await auditLinkedSequence(sessionId, ['kick', 'lowKick', 'risingKick']);
  const repeatKick = await auditLinkedSequence(sessionId, ['kick', 'kick', 'kick']);
  if (farCombo?.error) throw new Error(`FAR linked kick audit failed: ${JSON.stringify(farCombo)}`);
  if (repeatKick?.error) throw new Error(`Repeated linked kick audit failed: ${JSON.stringify(repeatKick)}`);
  if (farCombo.airborne.length > 0) {
    throw new Error(`FAR kick links still lift both feet: ${JSON.stringify(farCombo.airborne.slice(0, 8))}`);
  }
  if (repeatKick.airborne.length > 0) {
    throw new Error(`Repeated kick links still lift both feet: ${JSON.stringify(repeatKick.airborne.slice(0, 8))}`);
  }
  if (farCombo.ungroundedSimulation.length > 0 || repeatKick.ungroundedSimulation.length > 0) {
    throw new Error('Kick link presentation changed grounded simulation state');
  }

  const linkTick0 = await poseFirstLink(sessionId, 0);
  if (linkTick0?.error || linkTick0.minFootHeight === null || linkTick0.minFootHeight >= 0.48) {
    throw new Error(`Kick -> Low Kick link tick 0 is airborne: ${JSON.stringify(linkTick0)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-kick-link-kick-to-lowkick-t0.png`);

  const linkTick3 = await poseFirstLink(sessionId, 3);
  if (linkTick3?.error || linkTick3.minFootHeight === null || linkTick3.minFootHeight >= 0.48) {
    throw new Error(`Kick -> Low Kick link tick 3 is airborne: ${JSON.stringify(linkTick3)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-kick-link-kick-to-lowkick-t3.png`);

  await writeFile(
    `${outputDir}/tps-kick-link.json`,
    `${JSON.stringify({ farCombo, repeatKick, linkTick0, linkTick3 }, null, 2)}\n`,
    'utf8',
  );
} finally {
  if (sessionId) await command(`/session/${sessionId}`, 'DELETE').catch(() => {});
  driverProcess.kill('SIGTERM');
  await writeFile(`${outputDir}/webdriver-kick-link.log`, driverLog, 'utf8').catch(() => {});
}
