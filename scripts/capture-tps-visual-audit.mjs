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
  const click = await clickButton(sessionId, "TPS LOCK-ON BATTLE");
  if (!click?.clicked) throw new Error(`TPS title button not found: ${JSON.stringify(click)}`);
  await delay(120);
  const engage = await clickButton(sessionId, "ENGAGE TPS");
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
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.velocity.set(0, 0, 0);
    game.p1.state = 'IDLE';
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerEvadeSign = 0;
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
  if (punchProbe?.spacingMode !== "IMPACT_PAIR" || !(punchProbe?.spacingMinimum >= 1.40) || !(punchProbe?.impactWorldSeparation >= 1.39) || !(punchProbe?.impactScreenSeparation >= 90)) throw new Error(`TPS resolved impact did not open the v3.1 contact lane: ${JSON.stringify(punchProbe)}`);
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
    return { moves, p2Health: game.p2.health, comboStage: game.playerComboStage };
  `);
  const comboSequence = comboProbe.moves.join(',');
  const validCloseCombos = new Set(['jab,straight,power', 'jab,backfist,power']);
  if (!validCloseCombos.has(comboSequence)) throw new Error(`TPS ATTACK combo sequence failed: ${JSON.stringify(comboProbe)}`);
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
      motionMove: data.motionExpansionCurrentMove ?? null,
      motionPhase: data.motionExpansionPhase ?? null,
      correctionPolicy: data.motionCorrectionPolicy ?? null,
    };
  `);
  if (!comboLinkProbe.linked
    || comboLinkProbe.firstMove !== 'jab'
    || comboLinkProbe.secondMove !== 'backfist'
    || comboLinkProbe.linkState !== 'LINKED'
    || comboLinkProbe.fromMove !== 'jab'
    || comboLinkProbe.routeFrom !== 'CLOSE_A'
    || comboLinkProbe.routeTo !== 'CLOSE_B'
    || comboLinkProbe.branch !== 'SIDE'
    || comboLinkProbe.linkTick < comboLinkProbe.linkStart
    || comboLinkProbe.linkTick > comboLinkProbe.linkEnd
    || Math.abs(comboLinkProbe.requestedBlend - 0.075) > 0.0001
    || !(["RAW_CLIP_PLAYBACK", "AUTHORED_ATTACK_PRESERVE"].includes(comboLinkProbe.correctionPolicy)
      ? Math.abs(comboLinkProbe.appliedBlend) <= 0.0001 && comboLinkProbe.motionMove === null
      : Math.abs(comboLinkProbe.appliedBlend - 0.075) <= 0.0001 && comboLinkProbe.motionMove === 'backfist')) {
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
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 3.1);
    game.p2.position.set(0, 0, -2.1);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    game.press('punch', 'tps-whiff-1');
    game.step();
    game.release('punch', 'tps-whiff-1');
    const firstMove = game.p1.currentMove?.id ?? null;
    let queued = false;
    let chainedMove = null;
    for (let index = 0; index < 150; index += 1) {
      if (!queued && game.p1.state === 'ATTACK' && game.p1.moveTick >= 4) {
        game.press('punch', 'tps-whiff-2');
        game.step();
        game.release('punch', 'tps-whiff-2');
        queued = true;
      } else {
        game.step();
      }
      const current = game.p1.currentMove?.id ?? null;
      if (current && firstMove && current !== firstMove) { chainedMove = current; break; }
      if (queued && game.p1.state !== 'ATTACK') break;
    }
    return { firstMove, chainedMove, comboStage: game.playerComboStage, p2Health: game.p2.health };
  `);
  if (whiffComboProbe.chainedMove !== null || whiffComboProbe.comboStage !== 0 || whiffComboProbe.p2Health !== 100) {
    throw new Error(`TPS whiff incorrectly continued ATTACK combo: ${JSON.stringify(whiffComboProbe)}`);
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
    game.p2.beginMove('straight');
    game.updateEnemy = () => {
      if (game.p2.state === 'ATTACK') game.p2.advanceAttack();
      game.p2.updatePhysics(1 / 60);
    };
    game.press('right', 'tps-flank-side');
    game.press('guard', 'tps-flank-step');
    for (let index = 0; index < 9; index += 1) game.step();
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
    return { healthAfterEvade, perfectAfterEvade, flankWindowAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks, screenSeparation };
  `);
  if (flankProbe.healthAfterEvade !== 100) throw new Error(`TPS lateral STEP failed to evade strike: ${JSON.stringify(flankProbe)}`);
  if (!(flankProbe.perfectAfterEvade > 0) || !(flankProbe.flankWindowAfterEvade > 0)) throw new Error(`TPS successful lateral dodge did not award PERFECT STEP: ${JSON.stringify(flankProbe)}`);
  if (!(flankProbe.p2Health < 100) || flankProbe.p2State === 'BLOCK_STUN') throw new Error(`TPS flank attack did not beat guard: ${JSON.stringify(flankProbe)}`);
  if (!(flankProbe.screenSeparation >= 75)) throw new Error(`TPS flank camera still lets the player obscure the target: ${JSON.stringify(flankProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-flank.png`);

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

  const report = { initial, iphone, directorSample, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, damageAfterfeelProbe, attackAfterfeelProbe, throwProbe, comboProbe, comboLinkProbe, whiffComboProbe, dashAttackProbe, flankProbe, afterBoundary, radial };
  await writeFile(`${outputDir}/tps-runtime-state.json`, JSON.stringify(report, null, 2));
  await writeFile(`${outputDir}/webdriver.log`, driverLog);
  console.log(JSON.stringify(report));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  try { if (!driverProcess.killed) driverProcess.kill("SIGTERM"); } catch {}
}
