import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-kick-sequence";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9528;
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

async function poseMove(sessionId, moveId, stage, correctionsEnabled = false) {
  return execute(sessionId, `${gameLookup}
    const game = findGame();
    const [moveId, stage, correctionsEnabled] = arguments;
    if (!game) return { error: 'game-not-found' };
    game.settings.update({ motionCorrections: correctionsEnabled });
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

    // The production mixer crossfades between authored clips. Start every probe
    // from the same fully-settled neutral and then advance the requested move at
    // 60 Hz up to the sampled tick. Jumping directly to contact would capture a
    // synthetic blend with the previous probe rather than an in-game frame.
    let auditTime = performance.now() / 1000;
    for (let settle = 0; settle < 8; settle += 1) {
      auditTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, auditTime);
      game.updateVisual(game.p2, game.p1, auditTime + 0.007);
    }

    const readyHost = game.p1.visual.root.children.find(child => child.name?.startsWith('quaternius-ubc-') && child.name?.endsWith('-runtime'));
    const readyFoot = readyHost?.getObjectByName(moveId === 'lowKick' ? 'foot_r' : 'foot_l');
    const readySupportHeight = readyFoot?.getWorldPosition(new readyFoot.position.constructor()).y ?? null;

    if (!game.p1.beginMove(moveId)) return { error: 'begin-move-failed', moveId };
    const move = game.p1.currentMove;
    const ticks = {
      startup: Math.max(0, move.startup - 3),
      contact: move.startup,
      recovery: Math.min(move.startup + move.active + move.recovery - 1, move.startup + move.active + 5),
    };
    const targetTick = ticks[stage];
    for (let tick = 0; tick <= targetTick; tick += 1) {
      game.p1.moveTick = tick;
      auditTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, auditTime);
      game.updateVisual(game.p2, game.p1, auditTime + 0.007);
    }
    game.p1.moveTick = targetTick;
    for (let frame = 0; frame < 18; frame += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);

    const importedHost = (fighter) => fighter.visual.root.children.find((child) => child.name?.startsWith('quaternius-ubc-') && child.name?.endsWith('-runtime'));
    const model = (fighter) => {
      const host = importedHost(fighter);
      return host?.children.find((child) => child.type === 'Group' || child.children?.length > 0) ?? host?.children?.[0] ?? null;
    };
    const point = (object) => {
      if (!object) return null;
      const p = object.getWorldPosition(new object.position.constructor());
      return { x: p.x, y: p.y, z: p.z };
    };
    const project = (object) => {
      if (!object) return null;
      const p = object.getWorldPosition(new object.position.constructor());
      p.project(game.camera);
      return {
        x: (p.x * 0.5 + 0.5) * game.renderer.domElement.width,
        y: (-p.y * 0.5 + 0.5) * game.renderer.domElement.height,
      };
    };
    const actor = model(game.p1);
    const target = model(game.p2);
    const footR = actor?.getObjectByName('foot_r') ?? null;
    const footL = actor?.getObjectByName('foot_l') ?? null;
    const chest = actor?.getObjectByName('spine_03') ?? null;
    const pelvis = actor?.getObjectByName('pelvis') ?? null;
    const targetChest = target?.getObjectByName('spine_03') ?? null;
    const targetPelvis = target?.getObjectByName('pelvis') ?? null;
    const strike = move.visualContact === 'LEFT_FOOT' ? footL : footR;
    const support = move.visualContact === 'LEFT_FOOT' ? footR : footL;
    const strikePoint = point(strike);
    const supportPoint = point(support);
    const chestPoint = point(chest);
    const pelvisPoint = point(pelvis);
    const targetChestPoint = point(targetChest);
    const targetPelvisPoint = point(targetPelvis);
    const strikeScreen = project(strike);
    const targetChestScreen = project(targetChest);
    const suffix = move.visualContact === 'LEFT_FOOT' ? 'l' : 'r';
    const hip = actor.getObjectByName('thigh_' + suffix).getWorldPosition(new strike.position.constructor());
    const knee = actor.getObjectByName('calf_' + suffix).getWorldPosition(new strike.position.constructor());
    const ankle = strike.getWorldPosition(new strike.position.constructor());
    const kneeDegrees = hip.sub(knee).angleTo(ankle.sub(knee)) * 180 / Math.PI;

    return {
      moveId,
      stage,
      tick: game.p1.moveTick,
      startup: move.startup,
      active: move.active,
      recovery: move.recovery,
      strikePoint,
      supportPoint,
      chestPoint,
      pelvisPoint,
      targetChestPoint,
      targetPelvisPoint,
      strikeScreen,
      targetChestScreen,
      supportHeight: supportPoint?.y ?? null,
      strikeHeight: strikePoint?.y ?? null,
      torsoLean: chestPoint && pelvisPoint ? Math.hypot(chestPoint.x - pelvisPoint.x, chestPoint.z - pelvisPoint.z) : null,
      strikeTargetScreenDistance: strikeScreen && targetChestScreen ? Math.hypot(strikeScreen.x - targetChestScreen.x, strikeScreen.y - targetChestScreen.y) : null,
      readySupportHeight,
      strikeKneeDegrees: kneeDegrees,
      motionMode: String(importedHost(game.p1)?.userData?.quaterniusMotionMode ?? 'UNKNOWN'),
      cameraContactReadability: Number(game.camera.userData.tpsAuthoredContactReadabilityFactor ?? 0),
      cameraKickReadability: Number(game.camera.userData.tpsKickContactReadabilityFactor ?? 0),
      cameraFrontKickReadability: Number(game.camera.userData.tpsFrontKickReadabilityFactor ?? 0),
      cameraLowKickReadability: Number(game.camera.userData.tpsLowKickReadabilityFactor ?? 0),
      cameraShoulderOffset: Number(game.camera.userData.tpsShoulderOffset ?? 0),
      cameraBackDistance: Number(game.camera.userData.tpsBackDistance ?? 0),
      cameraTargetHeight: Number(game.camera.userData.tpsTargetHeight ?? 0),
      targetGroundOpacity: Number(game.targetGroundRing?.material?.opacity ?? 0),
      state: game.p1.state,
      simulationPosition: { x: game.p1.position.x, y: game.p1.position.y, z: game.p1.position.z },
    };
  `, [moveId, stage, correctionsEnabled]);
}

let sessionId = null;
try {
  await waitForDriver();
  const session = await command('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        timeouts: {
          script: 180000,
          pageLoad: 120000,
          implicit: 0,
        },
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
  for (let attempt = 0; attempt < 140; attempt += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      return Boolean(game && game.p1?.visual?.root?.userData?.quaterniusModelState === 'ready' && game.p2?.visual?.root?.userData?.quaterniusModelState === 'ready');
    `);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Kick sequence audit did not reach ready WebGL models');

  const results = {};
  for (const moveId of ['kick', 'lowKick', 'risingKick', 'dashKick']) {
    results[moveId] = {};
    for (const stage of ['startup', 'contact', 'recovery']) {
      const result = await poseMove(sessionId, moveId, stage);
      if (result?.error) throw new Error(`${moveId}/${stage} failed: ${JSON.stringify(result)}`);
      if (result.state !== 'ATTACK') throw new Error(`${moveId}/${stage} left attack state: ${JSON.stringify(result)}`);
      if (result.supportHeight === null || result.strikeHeight === null) throw new Error(`${moveId}/${stage} missing foot landmarks: ${JSON.stringify(result)}`);
      results[moveId][stage] = result;
      await screenshot(sessionId, `${outputDir}/tps-kick-${moveId.toLowerCase()}-${stage}.png`);
    }
  }

  results.correctedContact = {};
  for (const moveId of ['kick', 'lowKick', 'risingKick', 'dashKick']) {
    const corrected = await poseMove(sessionId, moveId, 'contact', true);
    if (corrected?.error) throw new Error(JSON.stringify(corrected));
    results.correctedContact[moveId] = corrected;
    await screenshot(sessionId, `${outputDir}/tps-kick-${moveId.toLowerCase()}-corrected-contact.png`);
  }

  // Persist measurements before assertions so a failed readability threshold
  // still leaves complete evidence for the next visual correction pass.
  await writeFile(`${outputDir}/tps-kick-sequence.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

  // Measure the final rendered skeleton, after all presentation and root yaw.
  for (const moveId of ['kick', 'lowKick', 'risingKick', 'dashKick']) {
    for (const frame of Object.values(results[moveId])) {
      if (frame.readySupportHeight === null || Math.abs(frame.supportHeight - frame.readySupportHeight) > 0.035) {
        throw new Error(`${moveId}/${frame.stage}: supporting foot left its actual ready floor: ${JSON.stringify(frame)}`);
      }
      if (Math.abs(frame.simulationPosition.x) > 1e-6 || Math.abs(frame.simulationPosition.y) > 1e-6 || Math.abs(frame.simulationPosition.z - 0.82) > 1e-6) {
        throw new Error(`${moveId}: presentation changed simulation position: ${JSON.stringify(frame)}`);
      }
    }
    const contact = results[moveId].contact;
    if (!(contact.strikeKneeDegrees > 120 && contact.strikeKneeDegrees < 170)) {
      throw new Error(`${moveId}: final strike knee is folded or overextended: ${JSON.stringify(contact)}`);
    }
    if (contact.motionMode !== 'RAW_CLIP_PLAYBACK') {
      throw new Error(`${moveId}: audit must verify the default corrections-OFF path: ${JSON.stringify(contact)}`);
    }
    const corrected = results.correctedContact[moveId];
    if (corrected.motionMode !== 'CORRECTED' || Math.abs(corrected.strikeKneeDegrees - contact.strikeKneeDegrees) > 1) {
      throw new Error(`${moveId}: optional corrections changed the strike leg: ${JSON.stringify({ contact, corrected })}`);
    }

  }

  if (!(results.lowKick.contact.strikeHeight < results.kick.contact.strikeHeight - 0.45)) {
    throw new Error(`Low kick no longer reads below normal kick: ${JSON.stringify(results)}`);
  }
  if (!(results.risingKick.contact.strikeHeight > results.kick.contact.strikeHeight + 0.15)) {
    throw new Error(`Rising kick no longer reads above normal kick: ${JSON.stringify(results)}`);
  }

  // Camera-only readability pass: contact should open the shoulder lane more
  // than startup without changing simulation positions or authored pose timing.
  for (const moveId of ['kick', 'lowKick', 'risingKick', 'dashKick']) {
    const startup = results[moveId].startup;
    const contact = results[moveId].contact;
    if (!(contact.cameraContactReadability > startup.cameraContactReadability + 0.45)) {
      throw new Error(`${moveId} contact camera did not open enough: ${JSON.stringify({ startup, contact })}`);
    }
    if (!(contact.cameraShoulderOffset > startup.cameraShoulderOffset + 0.22)) {
      throw new Error(`${moveId} shoulder camera did not move laterally enough: ${JSON.stringify({ startup, contact })}`);
    }
    if (!(contact.targetGroundOpacity < startup.targetGroundOpacity)) {
      throw new Error(`${moveId} ground lock cue did not fade at contact: ${JSON.stringify({ startup, contact })}`);
    }
  }
  if (!(results.lowKick.contact.cameraTargetHeight < results.kick.contact.cameraTargetHeight - 0.08)) {
    throw new Error(`Low-kick camera did not retain enough lower-body framing: ${JSON.stringify(results)}`);
  }
  if (!(results.kick.contact.cameraFrontKickReadability > 0.65)) {
    throw new Error(`Front-kick-specific camera opening did not activate: ${JSON.stringify(results.kick.contact)}`);
  }
  if (!(results.kick.contact.cameraShoulderOffset > results.lowKick.contact.cameraShoulderOffset + 0.35)) {
    throw new Error(`Front kick still lacks a distinct side-view lane: ${JSON.stringify({ kick: results.kick.contact, lowKick: results.lowKick.contact })}`);
  }
} finally {
  if (sessionId) await command(`/session/${sessionId}`, 'DELETE').catch(() => {});
  driverProcess.kill('SIGTERM');
  await writeFile(`${outputDir}/webdriver.log`, driverLog, 'utf8').catch(() => {});
}
