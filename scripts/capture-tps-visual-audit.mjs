import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9518;
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
    if (!button) return { clicked: false, buttons: [...document.querySelectorAll('button')].map((entry) => entry.textContent) };
    button.click();
    return { clicked: true, label: button.textContent };
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

async function state(sessionId) {
  return execute(sessionId, `${gameLookup}
    const game = findGame();
    const canvas = document.querySelector('.scene-host canvas');
    const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) : null;
    const p1 = game?.p1?.position;
    const p2 = game?.p2?.position;
    return {
      ready: Boolean(game && canvas && gl),
      tpsText: document.body.innerText.includes('TPS LOCK-ON'),
      targetLocked: Boolean(game?.scene?.getObjectByName?.('tps-target-ground-ring')),
      arena: Boolean(game?.scene?.getObjectByName?.('tps-circular-arena')),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      p1: p1 ? { x: p1.x, y: p1.y, z: p1.z, health: game.p1.health, state: game.p1.state } : null,
      p2: p2 ? { x: p2.x, y: p2.y, z: p2.z, health: game.p2.health, state: game.p2.state } : null,
      cpuDirector: game?.p2?.visual?.root?.userData ? {
        policy: game.p2.visual.root.userData.tpsCpuDirectorPolicy ?? null,
        intent: game.p2.visual.root.userData.tpsCpuDirectorIntent ?? null,
        reason: game.p2.visual.root.userData.tpsCpuDirectorReason ?? null,
        move: game.p2.visual.root.userData.tpsCpuDirectorMove ?? null,
        telegraphTicks: game.p2.visual.root.userData.tpsCpuDirectorTelegraphTicks ?? 0,
        comebackMercy: game.p2.visual.root.userData.tpsCpuDirectorComebackMercy ?? 0,
        pressure: game.p2.visual.root.userData.tpsCpuDirectorPressure ?? 0,
      } : null,
      camera: game ? {
        x: game.camera.position.x, y: game.camera.position.y, z: game.camera.position.z,
        closeReadabilityFactor: game.camera.userData.tpsCloseReadabilityFactor ?? 0,
        shoulderOffset: game.camera.userData.tpsShoulderOffset ?? 0,
        targetHeight: game.camera.userData.tpsTargetHeight ?? 0,
      } : null,
    };
  `);
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`TPS screenshot is not PNG: ${path}`);
  await writeFile(path, bytes);
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
  const titleProbe = await execute(sessionId, `
    const labels = [...document.querySelectorAll('button')].map((entry) => entry.textContent ?? '');
    return {
      startFight: labels.some((label) => label.includes('START FIGHT')),
      legacyStartMatch: labels.some((label) => label.includes('START MATCH')),
      legacyTpsModeButton: labels.some((label) => label.includes('TPS LOCK-ON BATTLE')),
      modelView: labels.some((label) => label.includes('MODEL VIEW')),
    };
  `);
  if (!titleProbe.startFight || titleProbe.legacyStartMatch || titleProbe.legacyTpsModeButton || !titleProbe.modelView) throw new Error(`TPS-first title route mismatch: ${JSON.stringify(titleProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-title.png`);
  const click = await clickButton(sessionId, "START FIGHT");
  if (!click?.clicked) throw new Error(`TPS main title button not found: ${JSON.stringify(click)}`);
  await delay(140);
  const loadoutProbe = await execute(sessionId, `return {
    tpsLoadout: document.body.innerText.includes('TPS LOADOUT'),
    legacyCharacterSelect: document.body.innerText.includes('CHARACTER SELECT'),
    engage: [...document.querySelectorAll('button')].some((entry) => entry.textContent?.includes('ENGAGE')),
  };`);
  if (!loadoutProbe.tpsLoadout || loadoutProbe.legacyCharacterSelect || !loadoutProbe.engage) throw new Error(`TPS-first loadout route mismatch: ${JSON.stringify(loadoutProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-loadout.png`);
  const engage = await clickButton(sessionId, "ENGAGE");
  if (!engage?.clicked) throw new Error(`TPS loadout engage button not found: ${JSON.stringify(engage)}`);

  let initial = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    initial = await state(sessionId);
    if (initial?.ready && initial?.targetLocked && initial?.arena && initial?.canvasWidth > 2 && initial?.canvasHeight > 2) break;
    await delay(100);
  }
  if (!initial?.ready || !initial?.arena) throw new Error(`TPS WebGL did not become ready: ${JSON.stringify(initial)}`);

  await mkdir(outputDir, { recursive: true });
  await delay(850);
  initial = await state(sessionId);
  await screenshot(sessionId, `${outputDir}/tps-idle.png`);

  // Capture a deterministic iPhone-landscape CSS viewport. Recent headless
  // Chrome builds may accept CDP device metrics without changing window.inner*
  // (and therefore without notifying the Three.js ResizeObserver). Resize the
  // real WebDriver window instead, compensating for runner window decorations.
  const desktopRect = await command(`/session/${sessionId}/window/rect`);
  let iphone = null;
  let iphoneWindow = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    iphoneWindow = await execute(sessionId, `return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      dpr: window.devicePixelRatio,
    };`);
    const chromeWidth = Math.max(0, iphoneWindow.outerWidth - iphoneWindow.innerWidth);
    const chromeHeight = Math.max(0, iphoneWindow.outerHeight - iphoneWindow.innerHeight);
    await command(`/session/${sessionId}/window/rect`, "POST", {
      width: Math.round(932 + chromeWidth),
      height: Math.round(430 + chromeHeight),
    });
    await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
    await delay(350);
    iphone = await state(sessionId);
    if (iphone?.canvasWidth >= 900 && iphone?.canvasWidth <= 950 && iphone?.canvasHeight >= 400 && iphone?.canvasHeight <= 450) break;
  }
  if (!(iphone?.canvasWidth >= 900 && iphone?.canvasWidth <= 950 && iphone?.canvasHeight >= 400 && iphone?.canvasHeight <= 450)) {
    throw new Error(`TPS iPhone viewport probe is outside the expected range: ${JSON.stringify({ iphone, iphoneWindow, desktopRect })}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-iphone-idle.png`);
  await command(`/session/${sessionId}/window/rect`, "POST", desktopRect);
  await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
  await delay(300);

  let directorSample = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    directorSample = await state(sessionId);
    if (directorSample?.cpuDirector?.policy === 'FUN_DIRECTOR_V1'
      && directorSample.cpuDirector.reason
      && directorSample.cpuDirector.reason !== 'opening-read-window') break;
    await delay(100);
  }
  if (directorSample?.cpuDirector?.policy !== 'FUN_DIRECTOR_V1' || !directorSample?.cpuDirector?.reason || directorSample.cpuDirector.reason === 'opening-read-window') {
    throw new Error(`TPS live CPU never entered FUN_DIRECTOR_V1 decision-making: ${JSON.stringify(directorSample)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-cpu-director.png`);

  // The screenshots above intentionally exercise the live tactical CPU. From this
  // point onward isolate locomotion so a CPU hit cannot invalidate the input probe.
  // Keep requestAnimationFrame active: only enemy decision-making is frozen.
  await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.input.clear();
    game.p1.resetForRound(0, 3.2, 1);
    game.p2.resetForRound(0, -2.2, -1);
    game.enemyOpeningGraceTicks = 9999;
    game.updateEnemy = () => {
      game.p2.currentMove = null;
      game.p2.moveTick = 0;
      game.p2.velocity.set(0, 0, 0);
      game.p2.state = 'IDLE';
    };
    game.updateVisual(game.p1, game.p2, game.renderTime);
    game.updateVisual(game.p2, game.p1, game.renderTime + 0.23);
    game.updateCamera(1);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return true;
  `);
  await delay(120);
  // Real-time input probes stay on requestAnimationFrame so they audit the same
  // continuous movement/camera path a player uses in the browser. Re-sample the
  // lock basis immediately before input after the deterministic combat reset.
  const beforeStrafe = await state(sessionId);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.press('right', 'tps-audit-move'); return true;`);
  await delay(420);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.release('right', 'tps-audit-move'); return true;`);
  const afterStrafe = await state(sessionId);
  if (!afterStrafe?.p1 || !beforeStrafe?.p1 || !beforeStrafe?.p2) throw new Error(`TPS strafe state missing: ${JSON.stringify({ beforeStrafe, afterStrafe })}`);
  const initialForwardX = beforeStrafe.p2.x - beforeStrafe.p1.x;
  const initialForwardZ = beforeStrafe.p2.z - beforeStrafe.p1.z;
  const initialForwardLength = Math.max(1e-5, Math.hypot(initialForwardX, initialForwardZ));
  const initialRightX = -initialForwardZ / initialForwardLength;
  const initialRightZ = initialForwardX / initialForwardLength;
  const strafeDX = afterStrafe.p1.x - beforeStrafe.p1.x;
  const strafeDZ = afterStrafe.p1.z - beforeStrafe.p1.z;
  const lateralTravel = Math.abs(strafeDX * initialRightX + strafeDZ * initialRightZ);
  if (lateralTravel < 0.25) {
    throw new Error(`TPS strafe did not move along the live lock-relative tangent: ${JSON.stringify({ lateralTravel, beforeStrafe, afterStrafe })}`);
  }

  const beforeForwardDistance = Math.hypot(afterStrafe.p2.x - afterStrafe.p1.x, afterStrafe.p2.z - afterStrafe.p1.z);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.press('up', 'tps-audit-forward'); return true;`);
  await delay(360);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.release('up', 'tps-audit-forward'); return true;`);
  const afterForward = await state(sessionId);
  const afterForwardDistance = Math.hypot(afterForward.p2.x - afterForward.p1.x, afterForward.p2.z - afterForward.p1.z);
  if (!(afterForwardDistance < beforeForwardDistance + 0.2)) {
    throw new Error(`TPS forward input did not track target: ${JSON.stringify({ beforeForwardDistance, afterForwardDistance })}`);
  }

  const quickstepProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.p2.currentMove = null;
    game.p2.moveTick = 0;
    game.p2.hitStop = 0;
    game.p2.hitStun = 0;
    game.p2.blockStun = 0;
    game.p2.hitTargets.clear();
    game.p2.velocity.set(0, 0, 0);
    game.p2.state = 'IDLE';
    game.enemyDirectorPendingMove = null;
    game.enemyDirectorTelegraphTicks = 0;
    game.enemyDirectorTelegraphTotalTicks = 0;
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.hitStop = 0;
    game.p1.hitStun = 0;
    game.p1.blockStun = 0;
    game.p1.velocity.set(0, 0, 0);
    game.p1.state = 'IDLE';
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerEvadeSign = 0;
    game.playerFlankWindowTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerStepThreatTicks = 0;
    game.playerStepThreatMoveId = null;
    game.p1.position.set(0, 0, 1.4);
    game.p2.position.set(0, 0, -0.3);
    // The real-time strafe probe above can leave FighterRuntime.input on RIGHT
    // even after InputSystem.clear(). Reset the runtime frame too, otherwise the
    // deterministic quickstep probe can lose the justPressed edge and look flaky.
    const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
    game.p1.input = { ...neutral };
    game.p1.previousInput = { ...neutral };
    const start = { x: game.p1.position.x, z: game.p1.position.z };
    game.press('guard', 'tps-audit-evade-g');
    game.press('right', 'tps-audit-evade-side');
    for (let index = 0; index < 6; index += 1) game.step();
    game.release('guard', 'tps-audit-evade-g');
    game.release('right', 'tps-audit-evade-side');
    for (let index = 0; index < 18; index += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { start, end: { x: game.p1.position.x, z: game.p1.position.z }, state: game.p1.state, flankWindowTicks: game.playerFlankWindowTicks };
  `);
  const quickstepTravel = Math.hypot(quickstepProbe.end.x - quickstepProbe.start.x, quickstepProbe.end.z - quickstepProbe.start.z);
  if (quickstepTravel < 0.45) throw new Error(`TPS quickstep travel too small: ${JSON.stringify({ quickstepProbe, quickstepTravel })}`);
  if (quickstepProbe.flankWindowTicks !== 0) throw new Error(`TPS neutral lateral STEP incorrectly granted free flank advantage: ${JSON.stringify(quickstepProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-quickstep.png`);

  const punchProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    // Freeze RAF only after the real-time locomotion probes. From here onward,
    // drive the exact 60 Hz gameplay steps explicitly so contact checks cannot
    // race browser scheduling on a busy CI runner.
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state !== 'HIT' && game.p2.state !== 'BLOCK_STUN') game.p2.state = 'IDLE';
    };
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.state = 'IDLE';
    }
    game.p1.position.set(0, 0, 0.72);
    game.p2.position.set(0, 0, -0.42);
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerEvadeSign = 0;
    // Settle the shoulder camera after the deterministic close-range teleport.
    // This makes the captured framing representative of actual continuous play.
    for (let index = 0; index < 24; index += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const canvas = game.renderer.domElement;
    const playerScreen = game.p1.position.clone();
    const enemyScreen = game.p2.position.clone();
    playerScreen.y = 1.2;
    enemyScreen.y = 1.2;
    playerScreen.project(game.camera);
    enemyScreen.project(game.camera);
    const screenSeparation = Math.abs(enemyScreen.x - playerScreen.x) * canvas.width * 0.5;
    const targetGroundRing = Boolean(game.scene.getObjectByName('tps-target-ground-ring'));
    game.press('punch', 'tps-audit-punch');
    game.step();
    game.release('punch', 'tps-audit-punch');
    let steps = 1;
    while (steps < 60 && game.p2.health === 100) {
      game.step();
      steps += 1;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const impactPlayerScreen = game.p1.position.clone();
    const impactEnemyScreen = game.p2.position.clone();
    impactPlayerScreen.y = 1.2;
    impactEnemyScreen.y = 1.2;
    impactPlayerScreen.project(game.camera);
    impactEnemyScreen.project(game.camera);
    const impactScreenSeparation = Math.abs(impactEnemyScreen.x - impactPlayerScreen.x) * canvas.width * 0.5;
    const impactWorldSeparation = Math.hypot(game.p2.position.x - game.p1.position.x, game.p2.position.z - game.p1.position.z);
    const spacingMode = game.p1.visual.root.userData.tpsContactSpacingMode ?? null;
    const spacingMinimum = game.p1.visual.root.userData.tpsContactSpacingMinimum ?? 0;
    const impactFxMove = game.graphics.group.userData.lastImpactMove ?? null;
    const impactFxHeight = game.graphics.group.userData.lastImpactHeight ?? 0;
    return { steps, p1Health: game.p1.health, p2Health: game.p2.health, p1State: game.p1.state, p2State: game.p2.state, screenSeparation, impactScreenSeparation, impactWorldSeparation, spacingMode, spacingMinimum, impactFxMove, impactFxHeight, targetGroundRing };
  `);
  const afterPunch = await state(sessionId);
  if (!(afterPunch?.p2?.health < 100)) throw new Error(`TPS punch failed to damage locked target: ${JSON.stringify({ punchProbe, afterPunch })}`);
  if (!(punchProbe?.screenSeparation >= 72)) throw new Error(`TPS close-range camera still overlaps fighter centers too heavily: ${JSON.stringify(punchProbe)}`);
  if (punchProbe?.spacingMode !== "IMPACT_PAIR" || !(punchProbe?.spacingMinimum >= 1.52) || !(punchProbe?.impactWorldSeparation >= 1.51) || !(punchProbe?.impactScreenSeparation >= 96)) throw new Error(`TPS resolved impact did not open the v3.2 contact lane: ${JSON.stringify(punchProbe)}`);
  if (punchProbe?.impactFxMove !== "jab" || !(punchProbe?.impactFxHeight >= 2.5)) throw new Error(`TPS impact FX did not follow the procedural strike contact height: ${JSON.stringify(punchProbe)}`);
  if (!punchProbe?.targetGroundRing) throw new Error(`TPS target ground ring was not present: ${JSON.stringify(punchProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-punch.png`);
  await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.effects.update(0.3);
    for (let index = 0; index < 10; index += 1) game.step();
    game.updateCamera(1 / 30);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return true;
  `);
  await screenshot(sessionId, `${outputDir}/tps-punch-settled.png`);

  // Continue the real damage reaction until gameplay becomes actionable. Motion
  // Expansion must still own a short presentation-only recoil tail on that first
  // IDLE frame; otherwise the defender snaps immediately back to ready pose.
  const damageAfterfeelProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      game.p2.updatePhysics(1 / 60);
      if (!['HIT', 'BLOCK_STUN', 'KNOCKDOWN', 'THROW', 'KO'].includes(game.p2.state)) game.p2.state = 'IDLE';
    };
    let steps = 0;
    while (steps < 80 && game.p2.state === 'HIT') {
      game.renderTime += 1 / 60;
      game.step();
      steps += 1;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const data = game.p2.visual.root.userData;
    return {
      steps,
      state: game.p2.state,
      canAct: game.p2.canAct(),
      phase: data.motionExpansionPhase ?? null,
      tailKind: data.motionExpansionTailKind ?? null,
      tailRemaining: data.motionExpansionTailRemaining ?? 0,
      clip: data.motionExpansionCurrentClip ?? null,
      correctionsEnabled: data.motionCorrectionsEnabled ?? false,
    };
  `);
  if (damageAfterfeelProbe.state !== 'IDLE' || !damageAfterfeelProbe.canAct || (damageAfterfeelProbe.correctionsEnabled && (damageAfterfeelProbe.phase !== 'SETTLE' || damageAfterfeelProbe.tailKind !== 'REACTION' || !(damageAfterfeelProbe.tailRemaining > 0)))) {
    throw new Error(`TPS damage reaction mode mismatch after gameplay recovery: ${JSON.stringify(damageAfterfeelProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-damage-afterfeel.png`);


  // Verify a real blocked strike at the same close range used by the damage probe.
  // TPS exposes STEP to the player, while the CPU still owns authored GUARD states;
  // this capture checks guard pose -> BLOCK_STUN -> impact spacing as one visual beat.
  const guardProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.guardDamage = 0;
      fighter.hitStop = 0;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 0.76);
    game.p2.position.set(0, 0, -0.44);
    game.p2.state = 'GUARD';
    // Isolate the canonical guard/block test from earlier mash repetitions.
    // The normal game intentionally changes neutral ATTACK openers over time,
    // but this check measures a fixed first-jab block and its physical spacing.
    game.__neutralMashPhrase = -1;
    game.__neutralMashAttackCount = 0;
    game.__neutralMashLastBase = null;
    game.__mashBufferTicks = 0;
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state !== 'BLOCK_STUN') game.p2.state = 'GUARD';
    };
    for (let index = 0; index < 24; index += 1) game.updateCamera(1 / 60);
    game.press('punch', 'tps-audit-guard-punch');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-audit-guard-punch');
    let steps = 1;
    while (steps < 60 && game.p2.state !== 'BLOCK_STUN') { game.step(); steps += 1; }
    for (let index = 0; index < 8; index += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      moveId,
      steps,
      p2Health: game.p2.health,
      p2State: game.p2.state,
      guardDamage: game.p2.guardDamage,
      spacingMode: game.p1.visual.root.userData.tpsContactSpacingMode ?? null,
      spacingMinimum: game.p1.visual.root.userData.tpsContactSpacingMinimum ?? 0,
      worldSeparation: Math.hypot(game.p2.position.x - game.p1.position.x, game.p2.position.z - game.p1.position.z),
      cameraShoulder: game.camera.userData.tpsShoulderOffset ?? 0,
    };
  `);
  if (guardProbe.moveId !== 'jab' || guardProbe.p2Health !== 100 || guardProbe.p2State !== 'BLOCK_STUN' || !(guardProbe.guardDamage > 0) || guardProbe.spacingMode !== 'IMPACT_PAIR' || !(guardProbe.spacingMinimum >= 1.52) || !(guardProbe.worldSeparation >= 1.51)) {
    throw new Error(`TPS guard/block visual sequence failed: ${JSON.stringify(guardProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-guard.png`);

  // Exercise an explicit gameplay kick through the real combat step/resolve path.
  // Context ATTACK selection is covered elsewhere; this probe isolates kick contact readability.
  const kickContactProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.hitStop = 0;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.p1.position.set(0, 0, 0.94);
    game.p2.position.set(0, 0, -0.72);
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state !== 'HIT') game.p2.state = 'IDLE';
    };
    for (let index = 0; index < 24; index += 1) game.updateCamera(1 / 60);
    if (!game.p1.beginMove('kick')) throw new Error('TPS kick probe could not start kick');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    let steps = 1;
    while (steps < 80 && game.p2.health === 100) { game.step(); steps += 1; }
    for (let index = 0; index < 8; index += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      moveId,
      steps,
      p2Health: game.p2.health,
      p2State: game.p2.state,
      spacingMode: game.p1.visual.root.userData.tpsContactSpacingMode ?? null,
      spacingMinimum: game.p1.visual.root.userData.tpsContactSpacingMinimum ?? 0,
      worldSeparation: Math.hypot(game.p2.position.x - game.p1.position.x, game.p2.position.z - game.p1.position.z),
      cameraShoulder: game.camera.userData.tpsShoulderOffset ?? 0,
      cameraBack: game.camera.userData.tpsBackDistance ?? 0,
      kickPairSpacing: game.p1.visual.root.userData.tpsKickPairSpacing ?? 0,
      kickPairBodyRetreat: game.p1.visual.root.userData.tpsKickPairBodyRetreat ?? 0,
      kickPairChestDistance: game.p1.visual.root.userData.tpsKickPairChestDistance ?? 0,
      kickPairLeftFootError: game.p1.visual.root.userData.tpsKickPairLeftFootError ?? 0,
      kickPairRightFootError: game.p1.visual.root.userData.tpsKickPairRightFootError ?? 0,
    };
  `);
  if (kickContactProbe.moveId !== 'kick' || !(kickContactProbe.p2Health < 100) || kickContactProbe.spacingMode !== 'IMPACT_PAIR' || !(kickContactProbe.spacingMinimum >= 1.62) || !(kickContactProbe.worldSeparation >= 1.61)) {
    throw new Error(`TPS kick contact visual sequence failed: ${JSON.stringify(kickContactProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-kick-contact.png`);

  // Drive a continuous approach -> orbit sequence through real gameplay steps and
  // sample every camera frame. This catches sudden shoulder-camera jumps that are
  // invisible in single before/after screenshots.
  const cameraContinuityProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.hitStop = 0;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 2.6);
    game.p2.position.set(0, 0, -0.2);
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    for (let index = 0; index < 30; index += 1) game.updateCamera(1 / 60);
    let previousCamera = game.camera.position.clone();
    let previousLook = game.cameraLookTarget.clone();
    let maxCameraStep = 0;
    let maxLookTargetStep = 0;
    const sampleFrame = () => {
      game.renderTime += 1 / 60;
      game.step();
      game.updateCamera(1 / 60);
      maxCameraStep = Math.max(maxCameraStep, game.camera.position.distanceTo(previousCamera));
      maxLookTargetStep = Math.max(maxLookTargetStep, game.cameraLookTarget.distanceTo(previousLook));
      previousCamera.copy(game.camera.position);
      previousLook.copy(game.cameraLookTarget);
    };
    game.press('up', 'tps-camera-approach');
    for (let index = 0; index < 34; index += 1) sampleFrame();
    game.release('up', 'tps-camera-approach');
    game.press('right', 'tps-camera-orbit');
    for (let index = 0; index < 36; index += 1) sampleFrame();
    game.release('right', 'tps-camera-orbit');
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const canvas = game.renderer.domElement;
    const playerScreen = game.p1.position.clone();
    const enemyScreen = game.p2.position.clone();
    playerScreen.y = 1.2;
    enemyScreen.y = 1.2;
    playerScreen.project(game.camera);
    enemyScreen.project(game.camera);
    const screenSeparation = Math.abs(enemyScreen.x - playerScreen.x) * canvas.width * 0.5;
    return {
      maxCameraStep,
      maxLookTargetStep,
      screenSeparation,
      fightDistance: Math.hypot(game.p2.position.x - game.p1.position.x, game.p2.position.z - game.p1.position.z),
      shoulderOffset: game.camera.userData.tpsShoulderOffset ?? 0,
      backDistance: game.camera.userData.tpsBackDistance ?? 0,
      cameraOrbitRadius: Math.hypot(game.camera.userData.tpsShoulderOffset ?? 0, game.camera.userData.tpsBackDistance ?? 0),
      closeFactor: game.camera.userData.tpsCloseReadabilityFactor ?? 0,
    };
  `);
  if (!(cameraContinuityProbe.maxCameraStep < 0.235) || !(cameraContinuityProbe.maxLookTargetStep < 0.22) || !(cameraContinuityProbe.screenSeparation >= 64) || !(cameraContinuityProbe.cameraOrbitRadius > 6.6) || !(cameraContinuityProbe.backDistance > 3.6)) {
    throw new Error(`TPS camera continuity exceeded the playtest comfort envelope: ${JSON.stringify(cameraContinuityProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-camera-continuity.png`);

  // A completed heavy attack gets the same treatment: gameplay is already free
  // to accept a new action while the rendered body holds/recenters for a short
  // follow-through beat. Use a whiff so defender state cannot influence it.
  const attackAfterfeelProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.state = 'IDLE';
    }
    game.p1.position.set(0, 0, 2.8);
    game.p2.position.set(0, 0, -2.8);
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    if (!game.p1.beginMove('power')) return { error: 'power-begin-failed' };
    let steps = 0;
    while (steps < 100 && game.p1.state === 'ATTACK') {
      game.renderTime += 1 / 60;
      game.step();
      steps += 1;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const data = game.p1.visual.root.userData;
    return {
      steps,
      state: game.p1.state,
      canAct: game.p1.canAct(),
      phase: data.motionExpansionPhase ?? null,
      tailKind: data.motionExpansionTailKind ?? null,
      tailRemaining: data.motionExpansionTailRemaining ?? 0,
      clip: data.motionExpansionCurrentClip ?? null,
      correctionsEnabled: data.motionCorrectionsEnabled ?? false,
    };
  `);
  if (attackAfterfeelProbe.error || attackAfterfeelProbe.state !== 'IDLE' || !attackAfterfeelProbe.canAct || (attackAfterfeelProbe.correctionsEnabled && (attackAfterfeelProbe.phase !== 'SETTLE' || attackAfterfeelProbe.tailKind !== 'ATTACK' || !(attackAfterfeelProbe.tailRemaining > 0)))) {
    throw new Error(`TPS attack follow-through mode mismatch after gameplay recovery: ${JSON.stringify(attackAfterfeelProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-attack-afterfeel.png`);

  const throwProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 0.48);
    game.p2.position.set(0, 0, -0.48);
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); if (game.p2.state !== 'HIT' && game.p2.state !== 'KNOCKDOWN') game.p2.state = 'IDLE'; };
    game.press('guard', 'tps-audit-throw-g');
    game.step();
    game.press('kick', 'tps-audit-throw-k');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('guard', 'tps-audit-throw-g');
    game.release('kick', 'tps-audit-throw-k');
    let steps = 2;
    while (steps < 45 && game.p2.health === 100) { game.step(); steps += 1; }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { moveId, steps, p2Health: game.p2.health, p2State: game.p2.state };
  `);
  if (throwProbe.moveId !== 'throw' || !(throwProbe.p2Health < 100)) throw new Error(`TPS G+K throw failed: ${JSON.stringify(throwProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-throw.png`);

  const comboProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); if (!['HIT', 'KNOCKDOWN', 'KO'].includes(game.p2.state)) game.p2.state = 'IDLE'; };
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 0.78);
    game.p2.position.set(0, 0, -0.42);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.__neutralMashPhrase = -1;
    game.__neutralMashAttackCount = 0;
    game.__neutralMashLastBase = null;
    game.__mashBufferTicks = 0;
    const moves = [];
    const tap = (owner) => { game.press('punch', owner); game.step(); game.release('punch', owner); };
    tap('tps-combo-1');
    if (game.p1.currentMove?.id) moves.push(game.p1.currentMove.id);
    let queued2 = false;
    let queued3 = false;
    for (let index = 0; index < 150 && moves.length < 3; index += 1) {
      const current = game.p1.currentMove?.id ?? null;
      if (!queued2 && current === moves[0] && game.p1.moveTick >= 4) { tap('tps-combo-2'); queued2 = true; continue; }
      if (queued2 && moves.length === 1 && current && current !== moves[0]) moves.push(current);
      if (!queued3 && moves.length === 2 && current === moves[1] && game.p1.moveTick >= 4) { tap('tps-combo-3'); queued3 = true; continue; }
      if (moves.length === 2 && current && current !== moves[1]) moves.push(current);
      game.step();
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { moves, baseMoves: moves.map(id => game.p1.definition.moves[id]?.motionBase ?? id), p2Health: game.p2.health, comboStage: game.playerComboStage };
  `);
  const comboSequence = comboProbe.baseMoves.join(',');
  const validCloseCombos = new Set(['jab,straight,power', 'jab,backfist,power']);
  // The actual TPS now selects SNAPPY/DRIVE/PIVOT/CRUSH variations from
  // the 224-move library. Compare the combat family, not an old fixed ID.
  if (!validCloseCombos.has(comboSequence) || comboProbe.p2Health >= 100 || comboProbe.comboStage !== 3) {
    throw new Error(`TPS ATTACK combo sequence failed: ${JSON.stringify(comboProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-combo.png`);

  // Deterministically prove a real branch at the authored link window. Force the
  // opening route to CLOSE_A, buffer SIDE+ATTACK after jab contact, and require
  // the next move to crossfade into CLOSE_B/backfist inside the published window.
  const comboLinkProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state === 'HIT') game.p2.updatePhysics(1 / 60);
      else game.p2.state = 'IDLE';
    };
    const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.state = 'IDLE';
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 0.78);
    game.p2.position.set(0, 0, -0.42);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.__comboRoute = undefined;
    game.__comboRouteSeed = 0;
    game.__comboLinkSerial = 0;
    game.__comboQueuedBranch = undefined;
    game.__neutralMashPhrase = -1;
    game.__neutralMashAttackCount = 0;
    game.__neutralMashLastBase = null;
    game.__mashBufferTicks = 0;
    game.p1.visual.root.userData.tpsComboLinkState = null;
    game.p1.visual.root.userData.tpsComboLinkSerial = 0;

    game.press('punch', 'tps-link-open');
    game.renderTime += 1 / 60;
    game.step();
    game.release('punch', 'tps-link-open');
    const firstMove = game.p1.currentMove?.id ?? null;
    game.__comboRoute = 'CLOSE_A';
    game.p1.visual.root.userData.tpsComboRoute = 'CLOSE_A';

    let guard = 0;
    while (guard < 45 && (game.p2.health === 100 || game.p1.moveTick < 6)) {
      game.renderTime += 1 / 60;
      game.step();
      guard += 1;
    }

    game.press('right', 'tps-link-side');
    game.press('punch', 'tps-link-attack');
    game.renderTime += 1 / 60;
    game.step();
    game.release('punch', 'tps-link-attack');
    game.release('right', 'tps-link-side');

    let linked = false;
    let secondMove = null;
    for (let index = 0; index < 40; index += 1) {
      if (game.p1.currentMove?.id && game.p1.currentMove.id !== firstMove) {
        linked = true;
        secondMove = game.p1.currentMove.id;
        break;
      }
      game.renderTime += 1 / 60;
      game.step();
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const data = game.p1.visual.root.userData;
    return {
      linked,
      firstMove,
      secondMove,
      secondBase: secondMove ? (game.p1.definition.moves[secondMove]?.motionBase ?? secondMove) : null,
      p2Health: game.p2.health,
      linkState: data.tpsComboLinkState ?? null,
      linkSerial: data.tpsComboLinkSerial ?? 0,
      fromMove: data.tpsComboLinkFromMove ?? null,
      linkTick: data.tpsComboLinkTick ?? -1,
      linkStart: data.tpsComboLinkStart ?? -1,
      linkEnd: data.tpsComboLinkEnd ?? -1,
      routeFrom: data.tpsComboLinkRouteFrom ?? null,
      routeTo: data.tpsComboLinkRouteTo ?? null,
      branch: data.tpsComboLinkBranch ?? null,
      requestedBlend: data.tpsComboLinkBlendSeconds ?? 0,
      appliedBlend: data.motionExpansionComboBlendSeconds ?? 0,
      inertialRequestedOverlap: data.unimateMotionExpansionOverlap ?? 0,
      inertialActive: Boolean(data.kimodoInertialTransitionActive),
      inertialWeight: Number(data.kimodoInertialTransitionWeight ?? 0),
      inertialPinnedBones: Number(data.kimodoInertialReplacementPinnedBones ?? 0),
      inertialMinBoneScale: Number(data.kimodoInertialMinimumBoneScale ?? 1),
      replacementMode: data.unimateReplacementMode ?? null,
      motionMove: data.motionExpansionCurrentMove ?? null,
      motionBase: data.motionExpansionCurrentMove ? (game.p1.definition.moves[data.motionExpansionCurrentMove]?.motionBase ?? data.motionExpansionCurrentMove) : null,
      motionPhase: data.motionExpansionPhase ?? null,
      correctionPolicy: data.motionCorrectionPolicy ?? null,
    };
  `);
  // A newly-authored guard->strike handoff can legitimately settle in 52ms
  // rather than the 60ms BF->BF handoff. Require a meaningful bounded blend,
  // an active inertial transition, protected bones and the true linked hit.
  if (!comboLinkProbe.linked
    || comboLinkProbe.firstMove !== 'jab'
    || comboLinkProbe.secondBase !== 'backfist'
    || comboLinkProbe.linkState !== 'LINKED'
    || comboLinkProbe.fromMove !== 'jab'
    || comboLinkProbe.routeFrom !== 'CLOSE_A'
    || comboLinkProbe.routeTo !== 'CLOSE_B'
    || comboLinkProbe.branch !== 'SIDE'
    || comboLinkProbe.linkTick < comboLinkProbe.linkStart
    || comboLinkProbe.linkTick > comboLinkProbe.linkEnd
    || Math.abs(comboLinkProbe.requestedBlend - 0.075) > 0.0001
    || !(comboLinkProbe.inertialRequestedOverlap >= 0.045 && comboLinkProbe.inertialRequestedOverlap <= 0.11)
    || !comboLinkProbe.inertialActive
    || !(comboLinkProbe.inertialWeight > 0)
    || !(comboLinkProbe.inertialPinnedBones > 0)
    || !(comboLinkProbe.inertialMinBoneScale < 1)
    || comboLinkProbe.replacementMode !== "ATTACK_GRAPH_PIN"
    || !(["RAW_CLIP_PLAYBACK", "AUTHORED_ATTACK_PRESERVE"].includes(comboLinkProbe.correctionPolicy)
      ? Math.abs(comboLinkProbe.appliedBlend) <= 0.0001 && comboLinkProbe.motionMove === null
      : Math.abs(comboLinkProbe.appliedBlend - 0.075) <= 0.0001 && comboLinkProbe.motionBase === 'backfist')) {
    throw new Error(`TPS authored combo branch did not link cleanly: ${JSON.stringify(comboLinkProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-combo-link.png`);


  const whiffComboProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      fighter.grounded = true;
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 3.1);
    game.p2.position.set(0, 0, -2.1);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.__neutralMashPhrase = -1;
    game.__neutralMashAttackCount = 0;
    game.__neutralMashLastBase = null;
    game.__mashBufferTicks = 0;
    game.__rangeAttackSerial = 0;
    game.__comboRoute = undefined;
    game.playerFlankWindowTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerInterceptTicks = 0;
    game.playerReversalTicks = 0;
    game.airCombo = null;
    game.p1.visual.root.userData.tpsComboLinkState = null;
    game.p1.visual.root.userData.tpsCleanHitConfirmed = false;
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    game.press('punch', 'tps-whiff-1');
    game.step();
    game.release('punch', 'tps-whiff-1');
    const firstMove = game.p1.currentMove?.id ?? null;
    const firstTotal = game.p1.currentMove
      ? game.p1.currentMove.startup + game.p1.currentMove.active + game.p1.currentMove.recovery
      : 0;
    let queued = false;
    let chainedMove = null;
    let transitionStep = -1;
    let sidestepFrames = 0;
    let firstMoveConnected = false;
    // The next opener resets tpsRangeTravelTotal. Track the previous move's
    // maximum while it is still active, not after the branch switches.
    let firstMoveTravel = Number(game.p1.visual.root.userData.tpsRangeTravelTotal ?? 0);
    const firstStartup = game.p1.currentMove?.startup ?? 0;
    const firstRecovery = game.p1.currentMove?.recovery ?? 0;
    // A recovery tap must fit within the 20-frame prebuffer. A rangeComet has
    // 29 recovery frames, so pressing on recovery frame 1 would EXPIRE before
    // the fighter can legally act. Eight frames from the end is unambiguous.
    const tapTick = firstTotal - Math.min(8, Math.max(3, firstRecovery - 2));
    for (let index = 0; index < 150; index += 1) {
      // The committed rangeComet starts aimed at the stationary opponent.
      // Then a genuine fixed-tick lateral STEP moves the defender off that
      // already locked lane during startup. No teleport, fake contact, or
      // visual-only avoidance: the same collision geometry decides the miss.
      if (game.p1.state === 'ATTACK' && game.p1.currentMove?.id === firstMove
        && game.p1.moveTick >= Math.max(1, firstStartup - 17)
        && game.p1.moveTick < firstStartup && sidestepFrames < 16) {
        game.p2.position.x += .11;
        sidestepFrames += 1;
      }
      if (!queued && game.p1.state === 'ATTACK'
        && game.p1.currentMove?.id === firstMove
        && game.p1.moveTick >= tapTick) {
        game.press('punch', 'tps-whiff-2');
        game.step();
        game.release('punch', 'tps-whiff-2');
        queued = true;
      } else {
        game.step();
      }
      if (game.p1.currentMove?.id === firstMove) {
        firstMoveTravel = Math.max(firstMoveTravel,
          Number(game.p1.visual.root.userData.tpsRangeTravelTotal ?? 0));
        if (game.p1.hitTargets.has(game.p2.id)) firstMoveConnected = true;
      }
      const current = game.p1.currentMove?.id ?? null;
      if (current && firstMove && current !== firstMove) {
        chainedMove = current; transitionStep = index + 1; break;
      }
    }
    return { firstMove, chainedMove, firstTotal, transitionStep,
      tapTick, sidestepFrames, sidestepDistance: game.p2.position.x,
      firstMoveConnected, travel: firstMoveTravel,
      comboStage: game.playerComboStage, p2Health: game.p2.health,
      linkState: game.p1.visual.root.userData.tpsComboLinkState ?? null };
  `);
  // On a true miss, the next tap is held until full recovery and starts a
  // fresh opener, NOT a confirmed/canceled combo. This is the intended
  // responsive no-hit ATTACK-only behaviour for iPhone mash play.
  if (whiffComboProbe.firstMove !== 'rangeComet'
    || whiffComboProbe.sidestepFrames !== 16
    || !(whiffComboProbe.sidestepDistance > 1.7)
    || !(whiffComboProbe.travel > 0.5)
    || whiffComboProbe.firstMoveConnected
    || !whiffComboProbe.chainedMove || whiffComboProbe.chainedMove === whiffComboProbe.firstMove
    || whiffComboProbe.transitionStep < whiffComboProbe.firstTotal - 2
    || whiffComboProbe.comboStage !== 1 || whiffComboProbe.p2Health !== 100
    || whiffComboProbe.linkState === 'LINKED') {
    throw new Error(`TPS whiff buffer skipped recovery or invented a combo: ${JSON.stringify(whiffComboProbe)}`);
  }

  const dashAttackProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 1.8);
    game.p2.position.set(0, 0, -0.2);
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.press('up', 'tps-dash-forward');
    game.press('guard', 'tps-dash-step');
    game.step();
    game.step();
    game.press('punch', 'tps-dash-attack');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-dash-attack');
    game.release('guard', 'tps-dash-step');
    game.release('up', 'tps-dash-forward');
    let steps = 3;
    while (steps < 60 && game.p2.health === 100) { game.step(); steps += 1; }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { moveId, steps, p2Health: game.p2.health };
  `);
  if (dashAttackProbe.moveId !== 'dashKick' || !(dashAttackProbe.p2Health < 100)) throw new Error(`TPS forward STEP + ATTACK dash failed: ${JSON.stringify(dashAttackProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-dash-attack.png`);

  const flankProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 0.78);
    game.p2.position.set(0, 0, -0.42);
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerStepThreatTicks = 0;
    game.playerStepThreatMoveId = null;
    game.enemyDirectorPendingMove = null;
    game.enemyDirectorTelegraphTicks = 0;
    game.enemyDirectorTelegraphTotalTicks = 0;
    game.p2.beginMove('straight');
    game.updateEnemy = () => {
      if (game.p2.state === 'ATTACK') game.p2.advanceAttack();
      game.p2.updatePhysics(1 / 60);
    };
    game.press('right', 'tps-flank-side');
    game.press('guard', 'tps-flank-step');
    const evadeTrace = [];
    for (let index = 0; index < 9; index += 1) {
      game.step();
      evadeTrace.push({
        frame: index + 1,
        p2State: game.p2.state,
        p2Move: game.p2.currentMove?.id ?? null,
        p2MoveTick: game.p2.moveTick,
        p2Active: game.p2.isActive(),
        threatTicks: game.playerStepThreatTicks,
        threatMove: game.playerStepThreatMoveId ?? null,
        sideWeight: game.playerStepSideWeight,
        evadeTicks: game.playerEvadeTicks,
        perfectTicks: game.playerPerfectEvadeTicks,
        flankTicks: game.playerFlankWindowTicks,
        p2HitPlayer: game.p2.hitTargets.has(game.p1.id),
        p1Health: game.p1.health,
      });
    }
    game.release('guard', 'tps-flank-step');
    game.release('right', 'tps-flank-side');
    const healthAfterEvade = game.p1.health;
    const perfectAfterEvade = game.playerPerfectEvadeTicks;
    const flankWindowAfterEvade = game.playerFlankWindowTicks;
    game.p2.currentMove = null;
    game.p2.moveTick = 0;
    game.p2.velocity.set(0, 0, 0);
    game.p2.state = 'GUARD';
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); if (!['HIT', 'KNOCKDOWN', 'KO'].includes(game.p2.state)) game.p2.state = 'GUARD'; game.p2.updatePhysics(1 / 60); };
    game.press('punch', 'tps-flank-attack');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-flank-attack');
    let steps = 1;
    while (steps < 60 && game.p2.health === 100) { game.step(); steps += 1; }
    for (let index = 0; index < 16; index += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const canvas = game.renderer.domElement;
    const playerScreen = game.p1.position.clone();
    const enemyScreen = game.p2.position.clone();
    playerScreen.y = 1.2;
    enemyScreen.y = 1.2;
    playerScreen.project(game.camera);
    enemyScreen.project(game.camera);
    const screenSeparation = Math.abs(enemyScreen.x - playerScreen.x) * canvas.width * 0.5;
    return { healthAfterEvade, perfectAfterEvade, flankWindowAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks, screenSeparation, evadeTrace };
  `);
  if (flankProbe.healthAfterEvade !== 100) throw new Error(`TPS lateral STEP failed to evade strike: ${JSON.stringify(flankProbe)}`);
  if (!(flankProbe.perfectAfterEvade > 0) || !(flankProbe.flankWindowAfterEvade > 0)) throw new Error(`TPS successful lateral dodge did not award PERFECT STEP: ${JSON.stringify(flankProbe)}`);
  if (!(flankProbe.p2Health < 100) || flankProbe.p2State === 'BLOCK_STUN') throw new Error(`TPS flank attack did not beat guard: ${JSON.stringify(flankProbe)}`);
  if (!(flankProbe.screenSeparation >= 75)) throw new Error(`TPS flank camera still lets the player obscure the target: ${JSON.stringify(flankProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-flank.png`);

  // A real blocked jab must change the next *neutral* opener's attack level,
  // not chain through blockstun or pretend the guard was a clean hit.
  const reactiveGuardProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      fighter.grounded = true;
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    // Mirror the already-audited canonical guard/block setup. The defender
    // stays on a stable standing GUARD for the entire first strike instead of
    // accidentally transitioning to HIT in a fresh custom physics setup.
    game.p1.position.set(0, 0, 0.76);
    game.p2.position.set(0, 0, -0.44);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.__comboRoute = undefined;
    game.__comboQueuedBranch = undefined;
    game.__neutralMashPhrase = -1;
    game.__neutralMashAttackCount = 0;
    game.__neutralMashLastBase = null;
    game.__neutralMashLastOutcome = undefined;
    game.__mashBufferTicks = 0;
    game.p1.visual.root.userData.tpsCleanHitConfirmed = false;
    game.p1.visual.root.userData.tpsComboLinkState = null;
    // Flank-evade audit before this probe leaves an earned GUARD-BYPASS
    // counter buff. Reset both temporary flank windows to ordinary neutral
    // before checking standing guard against a real ATTACK button tap.
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerInterceptTicks = 0;
    game.playerReversalTicks = 0;
    game.airCombo = null;
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state !== 'BLOCK_STUN') game.p2.state = 'GUARD';
    };
    game.p2.state = 'GUARD';
    game.press('punch', 'tps-adaptive-guard-first');
    game.step();
    const first = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-adaptive-guard-first');

    // This is a real 60Hz ATTACK button press into a standing GUARD, with
    // ordinary gameplay strike timing and no synthetic hit registration.
    let blockedObserved = false;
    let firstCompletedAt = -1;
    for (let frame=0; frame < 130; frame++) {
      game.step();
      if (game.p1.hitTargets.has(game.p2.id) && game.p1.visual.root.userData.tpsCleanHitConfirmed !== true)
        blockedObserved = true;
      if (game.p1.state !== 'ATTACK' && !game.p1.currentMove) { firstCompletedAt = frame; break; }
    }
    const lastOutcome = game.__neutralMashLastOutcome ?? null;
    const noDamage = game.p2.health === 100;
    game.press('punch', 'tps-adaptive-guard-response');
    game.step();
    const second = game.p1.currentMove?.id ?? null;
    const response = game.p1.visual.root.userData.tpsMashPressureResponse ?? null;
    const stage = game.playerComboStage;
    const cue = game.combatBeat ?? null;
    game.release('punch', 'tps-adaptive-guard-response');
    game.updateCamera(1/60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { first, blockedObserved, firstCompletedAt, lastOutcome, noDamage,
      second, response, stage, linkState: game.p1.visual.root.userData.tpsComboLinkState ?? null,
      cue };
  `);
  if (reactiveGuardProbe.first !== 'jab' || !reactiveGuardProbe.blockedObserved
    || reactiveGuardProbe.firstCompletedAt < 0 || !reactiveGuardProbe.noDamage
    || reactiveGuardProbe.lastOutcome !== 'BLOCK'
    || reactiveGuardProbe.second !== 'lowKick'
    || reactiveGuardProbe.response !== 'LOW_SWITCH'
    || reactiveGuardProbe.stage !== 1
    || reactiveGuardProbe.linkState === 'LINKED') {
    throw new Error(`TPS one-button reactive guard mix-up failed: ${JSON.stringify(reactiveGuardProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-reactive-guard-mixup.png`);

  // Tap ATTACK+SIDE *before* the authored cancel point, then release the thumb.
  // Even after multiple neutral mash phrases, the buffered SIDE must win over
  // neutral phrase selection and route through the actual B branch on contact.
  const bufferedDirectionProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      fighter.grounded = true;
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    // Use the exact same real-hit replay used by the long-standing
    // successful SIDE-branch audit above, then enable phrase 3 *only after*
    // the first actual contact. That isolates the neutral-mash override bug.
    game.p1.position.set(0, 0, .78);
    game.p2.position.set(0, 0, -.42);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.__comboRoute = undefined;
    game.__comboRouteSeed = 0;
    game.__comboQueuedBranch = undefined;
    game.__neutralMashPhrase = -1;
    game.__neutralMashAttackCount = 0;
    game.__neutralMashLastBase = null;
    game.__neutralMashLastOutcome = undefined;
    game.__mashBufferTicks = 0;
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerInterceptTicks = 0;
    game.playerReversalTicks = 0;
    game.airCombo = null;
    game.p1.visual.root.userData.tpsCleanHitConfirmed = false;
    game.p1.visual.root.userData.tpsComboLinkState = null;
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state === 'HIT') game.p2.updatePhysics(1 / 60);
      else game.p2.state = 'IDLE';
    };

    game.press('punch', 'tps-buffered-real-open');
    game.renderTime += 1 / 60;
    game.step();
    const firstMove = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-buffered-real-open');
    game.__comboRoute = 'CLOSE_A';
    let settle = 0;
    while (settle < 45 && (game.p2.health === 100 || game.p1.moveTick < 6)) {
      game.renderTime += 1 / 60;
      game.step();
      settle++;
    }
    const actualHit = firstMove === 'jab' && game.p2.health < 100
      && game.p1.hitTargets.has(game.p2.id)
      && game.p1.visual.root.userData.tpsCleanHitConfirmed === true;

    // Later ATTACK-only phrases must not steal the SIDE intent. The user taps
    // SIDE+ATTACK at the original queue-start tick and then releases both.
    game.__neutralMashPhrase = 2;
    game.__neutralMashAttackCount = 7;
    game.__neutralMashLastBase = 'jab';
    game.press('right', 'tps-buffered-side');
    game.press('punch', 'tps-buffered-attack');
    game.renderTime += 1 / 60;
    game.step();
    const queuedAtTap = game.__comboQueuedBranch
      ?? game.p1.visual.root.userData.tpsComboLinkBranch ?? null;
    game.release('punch', 'tps-buffered-attack');
    game.release('right', 'tps-buffered-side');
    let nextMove = null;
    let linkFrame = -1;
    for (let frame=0; frame < 40; frame++) {
      if (game.p1.currentMove?.id && game.p1.currentMove.id !== firstMove) {
        nextMove = game.p1.currentMove.id;
        linkFrame = frame;
        break;
      }
      game.renderTime += 1 / 60;
      game.step();
    }
    game.updateCamera(1/60);
    game.updateLockOn();
    game.renderer.render(game.scene,game.camera);
    return { actualHit, firstMove, queuedAtTap, nextMove, nextBase: nextMove
      ? game.p1.definition.moves[nextMove]?.motionBase ?? nextMove : null,
      linkFrame, route: game.p1.visual.root.userData.tpsComboRoute ?? null,
      linkState: game.p1.visual.root.userData.tpsComboLinkState ?? null,
      selectedMash: game.p1.visual.root.userData.tpsMashSelectedMove ?? null };
  `);
  if (!bufferedDirectionProbe.actualHit
    || bufferedDirectionProbe.queuedAtTap !== 'SIDE'
    || bufferedDirectionProbe.nextBase !== 'backfist'
    || bufferedDirectionProbe.route !== 'CLOSE_B'
    || bufferedDirectionProbe.linkState !== 'LINKED'
    || bufferedDirectionProbe.selectedMash !== null
    || bufferedDirectionProbe.linkFrame < 0) {
    throw new Error(`TPS buffered side branch was stolen by neutral mashing: ${JSON.stringify(bufferedDirectionProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-buffered-side-branch.png`);

  // CPU-pattern read uses only actual 60Hz ATTACK animations from the live
  // fighter, not an injected attack table, hidden tap or fabricated hit.
  // Observe each move after its first five visible frames, then fully clear
  // that action before starting another independently readable strike.
  const cpuPatternProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    const neutral = { left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false };
    for (const fighter of [game.p1,game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0,0,0);
      fighter.hitTargets.clear();
      fighter.hitStop = 0; fighter.hitStun = 0; fighter.blockStun = 0;
      fighter.knockdownTicks = 0; fighter.health = 100;
      fighter.state = 'IDLE'; fighter.grounded = true;
      fighter.input = {...neutral}; fighter.previousInput = {...neutral};
    }
    game.p1.position.set(0,0,.9);
    game.p2.position.set(0,0,-2.7);
    game.playerComboStage=0;game.playerComboGraceTicks=0;game.playerAttackQueued=false;
    game.playerFlankWindowTicks=0;game.playerFlankAttackTicks=0;
    game.playerInterceptTicks=0;game.playerReversalTicks=0;game.airCombo=null;
    // A fresh round gets a fresh CPU memory. Earlier graphical audits must
    // not contribute hidden initial training samples to this exact replay.
    game.enemyFunDirector = new game.enemyFunDirector.constructor(game.difficulty,47);
    game.updateEnemy = () => {
      game.enemyFunDirector.observe(game.enemySituation());
      game.p2.state='GUARD';game.p2.velocity.set(0,0,0);
    };
    const observations=[];
    function playVisibleStrike(moveId) {
      game.p1.currentMove=null;game.p1.moveTick=0;game.p1.state='IDLE';
      game.p1.hitTargets.clear();game.p1.hitStop=0;
      game.step();
      if (!game.p1.beginMove(moveId)) throw new Error('Could not play CPU read strike '+moveId);
      for(let tick=0;tick<7;tick++) game.step();
      observations.push({
        move:moveId,tick:game.p1.moveTick,
        read:game.enemyFunDirector.getStrikeRead(),
      });
    }
    const hiddenBefore=game.enemyFunDirector.getStrikeRead();
    for(let index=0;index<8;index++) playVisibleStrike('lowKick');
    const lowRead=game.enemyFunDirector.getStrikeRead();
    const lowData={
      mode:game.p2.visual.root.userData.tpsCpuStrikeReadMode,
      samples:game.p2.visual.root.userData.tpsCpuStrikeReadSamples,
      ratio:game.p2.visual.root.userData.tpsCpuStrikeLowRatio,
    };
    const lowCountedOnce=observations.slice(0,8).every((x,i)=>x.read.samples===i+1);
    // The last 8 distinct, VISIBLE punches must disprove old low history
    // rather than make the CPU cling to a permanent scripted counter.
    for(let index=0;index<8;index++) playVisibleStrike('jab');
    const upperRead=game.enemyFunDirector.getStrikeRead();
    const upperData={
      mode:game.p2.visual.root.userData.tpsCpuStrikeReadMode,
      samples:game.p2.visual.root.userData.tpsCpuStrikeReadSamples,
      ratio:game.p2.visual.root.userData.tpsCpuStrikeLowRatio,
    };
    game.updateCamera(1/60);game.updateLockOn();
    game.renderer.render(game.scene,game.camera);
    return { hiddenBefore, lowCountedOnce, lowRead, lowData,
      upperRead,upperData,observations,enemyHealth:game.p2.health };
  `);
  if (!cpuPatternProbe.lowCountedOnce
    || cpuPatternProbe.lowRead.mode !== 'LOW_PATTERN'
    || cpuPatternProbe.lowRead.samples !== 8
    || cpuPatternProbe.lowRead.lowRatio !== 1
    || cpuPatternProbe.lowData.mode !== 'LOW_PATTERN'
    || cpuPatternProbe.lowData.samples !== 8
    || cpuPatternProbe.upperRead.mode !== 'UPPER_PATTERN'
    || cpuPatternProbe.upperRead.samples !== 8
    || cpuPatternProbe.upperRead.lowRatio !== 0
    || cpuPatternProbe.upperData.mode !== 'UPPER_PATTERN'
    || cpuPatternProbe.enemyHealth !== 100) {
    throw new Error(`TPS CPU visible-strike learning or forgetting failed: ${JSON.stringify(cpuPatternProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-cpu-observed-pattern.png`);

  // Exercise both v10 mindgames in the real headless WebGL fight runtime.
  // First, the previous real 8-jab replay has taught this CPU UPPER_PATTERN.
  // Reuse that earned history: queue a BAIT telegraph and watch it cancel
  // *before beginMove*, physically step sideways and leave health intact.
  const feintProbe = await execute(sessionId, `${gameLookup}
    const g=findGame(), neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    for(const fighter of [g.p1,g.p2]){
      fighter.currentMove=null;fighter.moveTick=0;fighter.state='IDLE';
      fighter.velocity.set(0,0,0);fighter.hitTargets.clear();
      fighter.hitStop=0;fighter.hitStun=0;fighter.blockStun=0;
      fighter.knockdownTicks=0;fighter.health=100;fighter.grounded=true;
      fighter.input={...neutral};fighter.previousInput={...neutral};
    }
    g.input.clear();g.p1.position.set(0,0,.8);g.p2.position.set(0,0,-.8);
    g.enemyOpeningGraceTicks=0;g.enemyTactic='BAIT';g.enemyTacticTicks=999;
    g.enemyDirectorPendingMove=null;g.enemyDirectorDecision=null;
    g.enemyDirectorTelegraphTicks=0;g.enemyDirectorHoldTicks=0;
    g.enemyFeintPending=false;g.enemyFeintCandidateSerial=3;
    g.enemyLastFeintTick=-1000;g.enemyWhiffPunishCooldownTicks=0;
    g.p2.visual.root.userData.tpsCpuFeintSerial=0;
    const learned=g.enemyFunDirector.getStrikeRead();
    delete g.updateEnemy;
    const decision={intent:'POWER',holdTicks:1,telegraphTicks:0,reason:'earned-visible-bait',comebackMercy:0,pressure:0};
    g.enemyDirectorDecision=decision;
    const queued=g.queueEnemyAttackDecision(decision);
    const initial=g.p2.position.clone();
    let loadFrames=0,feintSeen=false,feintMove=null,healthAtFeint=-1,neverAttacked=true;
    for(let i=0;i<40;i++){
      g.step();loadFrames++;
      if(g.p2.currentMove||g.p2.state==='ATTACK')neverAttacked=false;
      if(Number(g.p2.visual.root.userData.tpsCpuFeintSerial??0)>0){
        feintSeen=true;
        feintMove=g.p2.visual.root.userData.tpsCpuFeintMove??null;
        healthAtFeint=g.p1.health;
        break;
      }
    }
    for(let i=0;i<8;i++)g.step();
    const dx=g.p2.position.x-initial.x, dz=g.p2.position.z-initial.z;
    g.updateCamera(1/60);g.updateLockOn();g.renderer.render(g.scene,g.camera);
    return {learned,queued,loadFrames,feintSeen,feintMove,
      healthAtFeint,neverAttacked,dx,dz,phase:g.p2.visual.root.userData.tpsEnemyTelegraphPhase,
      serial:g.p2.visual.root.userData.tpsCpuFeintSerial??0,p1Health:g.p1.health};
  `);
  if(feintProbe.learned.mode!=='UPPER_PATTERN'
    ||!feintProbe.queued||!feintProbe.feintSeen||!feintProbe.neverAttacked
    ||feintProbe.feintMove!=='power'
    ||feintProbe.healthAtFeint!==100||feintProbe.p1Health!==100
    ||Math.hypot(feintProbe.dx,feintProbe.dz)<.14
    ||feintProbe.serial!==1
    ||feintProbe.loadFrames<5||feintProbe.loadFrames>25)
    throw new Error(`TPS earned feint did not visibly cancel and sidestep: ${JSON.stringify(feintProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-cpu-feint.png`);

  // The player now gets a real chance to CALL the cancelled CPU windup using
  // the same ATTACK button as every other move. No forced opponent health edit,
  // simulated hit registration or manual hitbox changes are permitted.
  const playerFeintReadProbe = await execute(sessionId, `${gameLookup}
    const g=findGame();
    const readBefore=g.enemyFeintReadTicks;
    const rangeBefore=Math.hypot(g.p2.position.x-g.p1.position.x,g.p2.position.z-g.p1.position.z);
    const priorHealth=g.p2.health;
    const priorPunishes=g.trainingProgress.punishes;
    const priorSerial=Number(g.p1.visual.root.userData.tpsFeintPunishHitSerial??0);
    g.playerComboStage=0;g.playerComboGraceTicks=0;
    g.playerAttackQueued=false;g.__comboRoute=undefined;
    g.playerInterceptTicks=0;g.playerReversalTicks=0;
    g.playerPerfectEvadeTicks=0;g.playerFlankWindowTicks=0;
    g.playerFlankAttackTicks=0;g.__comboQueuedBranch=undefined;
    g.p1.input.punch=false;g.p1.previousInput.punch=false;
    g.press('punch','tps-player-feint-read');
    g.step();
    const selected=g.p1.currentMove?.id??null;
    const armed=g.p1.visual.root.userData.tpsFeintPunishArmed===true;
    const lockedLane=g.p1.visual.root.userData.tpsFeintPunishLane??null;
    g.release('punch','tps-player-feint-read');
    let contactFrame=-1,firstHitHealth=null,feintReadAfter=null;
    const stepTravel=[];
    for(let tick=0;tick<25;tick++){
      g.step();
      stepTravel.push(Number(g.p1.visual.root.userData.tpsFeintPunishTravel??0));
      const serial=Number(g.p1.visual.root.userData.tpsFeintPunishHitSerial??0);
      if(serial>priorSerial){
        contactFrame=tick;
        firstHitHealth=g.p2.health;
        feintReadAfter=g.enemyFeintReadTicks;
        break;
      }
    }
    g.updateCamera(1/60);g.updateLockOn();
    g.renderer.render(g.scene,g.camera);
    return {readBefore,rangeBefore,selected,armed,lockedLane,contactFrame,
      firstHitHealth,feintReadAfter,priorHealth,priorPunishes,
      punishCount:g.trainingProgress.punishes,priorSerial,
      serial:Number(g.p1.visual.root.userData.tpsFeintPunishHitSerial??0),
      stepTravel,enemyState:g.p2.state,beat:g.combatBeatLabel};
  `);
  if (playerFeintReadProbe.readBefore<11
    ||playerFeintReadProbe.rangeBefore>1.92
    ||playerFeintReadProbe.selected!=='straight'
    ||!playerFeintReadProbe.armed
    ||!Array.isArray(playerFeintReadProbe.lockedLane)
    ||playerFeintReadProbe.contactFrame<0
    ||!(playerFeintReadProbe.firstHitHealth<playerFeintReadProbe.priorHealth)
    ||playerFeintReadProbe.serial!==playerFeintReadProbe.priorSerial+1
    ||playerFeintReadProbe.punishCount!==playerFeintReadProbe.priorPunishes+1
    ||playerFeintReadProbe.feintReadAfter!==0
    ||Math.max(...playerFeintReadProbe.stepTravel)>.34001) {
    throw new Error(`TPS player's real ATTACK failed to read and punish CPU feint: ${JSON.stringify(playerFeintReadProbe)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-player-feint-punish.png`);

  // V12: In the actual imported 3D skeleton, a true POWER strike and a
  // bait POWER feint must share their early coil but have physically distinct
  // hip/shoulder silhouettes by the final visible windup frames.
  // The only variable between replays is the earned feint-candidate slot.
  const poseCompare = async (candidateSerial, snapshotName) => {
    const sample = await execute(sessionId, `${gameLookup}
      const g=findGame();
      const neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
      for(const fighter of [g.p1,g.p2]) {
        fighter.currentMove=null;fighter.moveTick=0;fighter.state='IDLE';
        fighter.velocity.set(0,0,0);fighter.hitTargets.clear();
        fighter.hitStop=0;fighter.hitStun=0;fighter.blockStun=0;
        fighter.knockdownTicks=0;fighter.health=100;fighter.grounded=true;
        fighter.input={...neutral};fighter.previousInput={...neutral};
      }
      g.input.clear();
      delete g.updateEnemy;
      g.p1.position.set(0,0,.8);
      g.p2.position.set(0,0,-.8);
      g.playerComboStage=0;g.playerAttackQueued=false;
      g.playerFlankWindowTicks=0;g.playerFlankAttackTicks=0;
      g.playerInterceptTicks=0;g.playerReversalTicks=0;
      g.enemyOpeningGraceTicks=0;g.enemyTactic='BAIT';g.enemyTacticTicks=999;
      g.enemyDirectorPendingMove=null;g.enemyDirectorDecision=null;
      g.enemyDirectorTelegraphTicks=0;g.enemyDirectorHoldTicks=0;
      g.enemyFeintPending=false;g.enemyFeintReadTicks=0;
      g.enemyFeintCandidateSerial=arguments[0];
      g.enemyLastFeintTick=-1000;g.enemyWhiffPunishCooldownTicks=0;
      const data=g.p2.visual.root.userData;
      data.tpsCpuFeintReadTicks=0;
      data.tpsEnemyTelegraphFeintPlanned=false;
      const learned=g.enemyFunDirector.getStrikeRead();
      const decision={intent:'POWER',holdTicks:1,telegraphTicks:0,
        reason:'visual-comparison',comebackMercy:0,pressure:0};
      g.enemyDirectorDecision=decision;
      const queued=g.queueEnemyAttackDecision(decision);
      const planned=g.enemyFeintPending;
      const total=g.enemyDirectorTelegraphTotalTicks;
      function pose(){
        const host=g.p2.visual.root.children.find(x=>x.name.startsWith('quaternius-ubc-')&&x.name.endsWith('-runtime'));
        return {
          phase:data.tpsEnemyTelegraphPoseKind??null,
          bodyIntensity:Number(data.tpsEnemyTelegraphPoseIntensity??0),
          yaw:Number(data.tpsEnemyTelegraphPoseHostYaw??0),
          shoulder:Number(data.tpsEnemyTelegraphPoseShoulder??0),
          hip:Number(data.tpsEnemyTelegraphPoseHip??0),
          bones:Number(data.tpsEnemyTelegraphPoseImportedBoneCount??0),
          hostYaw:host?.rotation.y??null,
          hostPitch:host?.rotation.x??null,
          hostRoll:host?.rotation.z??null,
          hostX:host?.position.x??null,
          skin:data.quaterniusModelState,
          attack:g.p2.currentMove?.id??null,
          telegraph:g.enemyDirectorTelegraphTicks,
        };
      }
      for(let i=0;i<4;i++)g.step();
      const early=pose();
      for(let i=0;i<4;i++)g.step();
      const late=pose();
      g.updateCamera(1/60);
      g.updateLockOn();
      g.renderer.render(g.scene,g.camera);
      return {learned,queued,planned,total,early,late,
        enemyHealth:g.p2.health,playerHealth:g.p1.health};
    `, [candidateSerial]);
    await screenshot(sessionId, `${outputDir}/${snapshotName}`);
    return sample;
  };
  const strikePoseProbe = await poseCompare(1,'tps-real-windup-body.png');
  const feintPoseProbe = await poseCompare(3,'tps-feint-windup-body.png');
  if(strikePoseProbe.learned.mode!=='UPPER_PATTERN'
    ||feintPoseProbe.learned.mode!=='UPPER_PATTERN'
    ||!strikePoseProbe.queued||!feintPoseProbe.queued
    ||strikePoseProbe.planned||!feintPoseProbe.planned
    ||strikePoseProbe.total!==feintPoseProbe.total
    ||strikePoseProbe.early.phase!=='COIL'||feintPoseProbe.early.phase!=='COIL'
    ||strikePoseProbe.late.phase!=='STRIKE_PREP'
    ||feintPoseProbe.late.phase!=='FEINT_PREP'
    ||strikePoseProbe.late.skin!=='ready'||feintPoseProbe.late.skin!=='ready'
    ||strikePoseProbe.late.bones<4||feintPoseProbe.late.bones<4
    ||Math.abs(strikePoseProbe.early.yaw-feintPoseProbe.early.yaw)>.001
    ||Math.abs(strikePoseProbe.early.shoulder-feintPoseProbe.early.shoulder)>.001
    ||Math.abs(strikePoseProbe.late.yaw-feintPoseProbe.late.yaw)<.05
    ||Math.abs(strikePoseProbe.late.hip-feintPoseProbe.late.hip)<.07
    ||Math.abs(strikePoseProbe.late.shoulder-feintPoseProbe.late.shoulder)<.03
    ||strikePoseProbe.late.attack!==null||feintPoseProbe.late.attack!==null) {
    throw new Error(`TPS imported real-vs-feint body silhouettes are not readable and distinct: ${JSON.stringify({strikePoseProbe,feintPoseProbe})}`);
  }

  const feintPoseExitProbe = await execute(sessionId, `${gameLookup}
    const g=findGame(), data=g.p2.visual.root.userData;
    let exit=null,activeAttack=false;
    for(let i=0;i<16;i++) {
      g.step();
      if(g.p2.currentMove||g.p2.state==='ATTACK')activeAttack=true;
      if(data.tpsEnemyTelegraphPoseKind==='FEINT_EXIT') {
        exit={phase:data.tpsEnemyTelegraphPoseKind,
          yaw:Number(data.tpsEnemyTelegraphPoseHostYaw??0),
          shoulder:Number(data.tpsEnemyTelegraphPoseShoulder??0),
          hip:Number(data.tpsEnemyTelegraphPoseHip??0),
          readTicks:g.enemyFeintReadTicks,
          state:g.p2.state};
        break;
      }
    }
    g.updateCamera(1/60);g.renderer.render(g.scene,g.camera);
    return {exit,activeAttack,playerHealth:g.p1.health};
  `);
  if (!feintPoseExitProbe.exit
    ||Math.abs(feintPoseExitProbe.exit.yaw)<.10
    ||feintPoseExitProbe.activeAttack
    ||feintPoseExitProbe.playerHealth!==100)
    throw new Error(`TPS planted feint exit stopped being real lateral movement: ${JSON.stringify(feintPoseExitProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-feint-body-exit.png`);

  // A miss is real only if the *actual* attack's active frames ended with
  // no defender collision. Slide the opponent across the committed lane
  // during the startup, then let the production CPU detect recovery by itself.
  const whiffPunishProbe = await execute(sessionId, `${gameLookup}
    const g=findGame(),neutral={left:false,right:false,up:false,down:false,punch:false,kick:false,guard:false};
    for(const fighter of [g.p1,g.p2]){
      fighter.currentMove=null;fighter.moveTick=0;fighter.state='IDLE';
      fighter.velocity.set(0,0,0);fighter.hitTargets.clear();
      fighter.hitStop=0;fighter.hitStun=0;fighter.blockStun=0;
      fighter.knockdownTicks=0;fighter.health=100;fighter.grounded=true;
      fighter.input={...neutral};fighter.previousInput={...neutral};
    }
    g.input.clear();
    g.p1.position.set(0,0,.8);g.p2.position.set(0,0,-.45);
    g.playerComboStage=0;g.playerComboGraceTicks=0;g.playerAttackQueued=false;
    g.playerFlankWindowTicks=0;g.playerFlankAttackTicks=0;
    g.playerInterceptTicks=0;g.playerReversalTicks=0;
    g.enemyFunDirector=new g.enemyFunDirector.constructor('HARD',47);
    g.difficulty='HARD';
    g.enemyOpeningGraceTicks=0;g.enemyTactic='ORBIT';g.enemyTacticTicks=999;
    g.enemyDirectorPendingMove=null;g.enemyDirectorDecision=null;
    g.enemyDirectorHoldTicks=0;g.enemyDirectorTelegraphTicks=0;
    g.enemyWhiffPunishCooldownTicks=0;g.enemyFeintPending=false;
    // The prior V12 FEINT_EXIT replay leaves an honest 36-frame plant. The
    // next, independent whiff scenario starts a fresh neutral exchange.
    g.enemyFeintReadTicks=0;
    g.p2.visual.root.userData.tpsCpuFeintReadTicks=0;
    g.p2.visual.root.userData.tpsEnemyTelegraphFeintPlanned=false;
    g.p2.visual.root.userData.tpsCpuWhiffPunishSerial=0;
    // The initial attack commitment is aimed at the original centerline.
    g.updateEnemy=()=>{g.p2.state='IDLE';g.p2.velocity.set(0,0,0);g.p2.updatePhysics(1/60);};
    g.p1.beginMove('power');
    const move=g.p1.currentMove, activeEnd=move.startup+move.active;
    let sidesteps=0,firstHit=false;
    for(let i=0;i<activeEnd+3;i++){
      if(g.p1.moveTick>=2&&sidesteps<17){
        g.p2.position.x+=.078;
        g.p2.position.z+=.035;
        sidesteps++;
      }
      g.step();
      if(g.p1.hitTargets.has(g.p2.id))firstHit=true;
    }
    const missed=!firstHit&&!g.p1.hitTargets.has(g.p2.id);
    const distanceAtWhiff=Math.hypot(g.p1.position.x-g.p2.position.x,g.p1.position.z-g.p2.position.z);
    delete g.updateEnemy;
    let selected=null,replied=false,replyMove=null;
    let reactionTicks=0;
    for(let i=0;i<28;i++){
      g.step();reactionTicks++;
      const serial=Number(g.p2.visual.root.userData.tpsCpuWhiffPunishSerial??0);
      if(serial>0){replied=true;selected=g.p2.visual.root.userData.tpsCpuWhiffPunishMove??null;break;}
    }
    // Let real strike preview/startup proceed; cannot be a frame-zero hit.
    for(let i=0;i<15;i++)g.step();
    replyMove=g.p2.currentMove?.id??null;
    g.updateCamera(1/60);g.updateLockOn();g.renderer.render(g.scene,g.camera);
    return {sidesteps,missed,firstHit,move:move.id,activeEnd,
      distanceAtWhiff,replied,selected,reactionTicks,replyMove,
      cpuSerial:g.p2.visual.root.userData.tpsCpuWhiffPunishSerial??0,
      playerHealth:g.p1.health,enemyHealth:g.p2.health,
      cooldown:g.enemyWhiffPunishCooldownTicks};
  `);
  if(whiffPunishProbe.move!=='power'
    ||whiffPunishProbe.sidesteps!==17
    ||!whiffPunishProbe.missed
    ||!whiffPunishProbe.replied
    ||!['jab','straight'].includes(whiffPunishProbe.selected)
    ||whiffPunishProbe.cpuSerial!==1
    ||whiffPunishProbe.distanceAtWhiff>1.62)
    throw new Error(`TPS real-spatial whiff punish failed or cheated: ${JSON.stringify(whiffPunishProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-cpu-whiff-punish.png`);

  await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.hitTargets.clear();
    game.p1.state = 'IDLE';
    game.p1.velocity.set(0, 0, 0);
    game.p1.position.set(9, 0, 0);
    game.step();
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return true;
  `);
  const afterBoundary = await state(sessionId);
  const radial = Math.hypot(afterBoundary.p1.x, afterBoundary.p1.z);
  if (radial > 6.15) throw new Error(`TPS circular boundary failed: ${radial}`);

  const report = { initial, iphone, directorSample, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, damageAfterfeelProbe, guardProbe, kickContactProbe, cameraContinuityProbe, attackAfterfeelProbe, throwProbe, comboProbe, comboLinkProbe, whiffComboProbe, dashAttackProbe, flankProbe, reactiveGuardProbe, bufferedDirectionProbe, cpuPatternProbe, feintProbe, playerFeintReadProbe, strikePoseProbe, feintPoseProbe, feintPoseExitProbe, whiffPunishProbe, afterBoundary, radial };
  await writeFile(`${outputDir}/tps-runtime-state.json`, JSON.stringify(report, null, 2));
  await writeFile(`${outputDir}/webdriver.log`, driverLog);
  console.log(JSON.stringify(report));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  try { if (!driverProcess.killed) driverProcess.kill("SIGTERM"); } catch {}
}
