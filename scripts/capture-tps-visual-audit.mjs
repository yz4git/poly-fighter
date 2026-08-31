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
      targetLocked: document.body.innerText.includes('TARGET LOCKED'),
      arena: Boolean(game?.scene?.getObjectByName?.('tps-circular-arena')),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      p1: p1 ? { x: p1.x, y: p1.y, z: p1.z, health: game.p1.health, state: game.p1.state } : null,
      p2: p2 ? { x: p2.x, y: p2.y, z: p2.z, health: game.p2.health, state: game.p2.state } : null,
      camera: game ? { x: game.camera.position.x, y: game.camera.position.y, z: game.camera.position.z } : null,
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

  // Capture a deterministic iPhone-landscape CSS viewport. Window-rect resizing
  // is runner/decoration dependent in headless Chrome, so drive the CSS viewport
  // directly through Chrome DevTools device metrics instead.
  await command(`/session/${sessionId}/goog/cdp/execute`, "POST", {
    cmd: "Emulation.setDeviceMetricsOverride",
    params: { width: 932, height: 430, deviceScaleFactor: 1, mobile: false },
  });
  await delay(300);
  const iphone = await state(sessionId);
  if (!(iphone?.canvasWidth >= 900 && iphone?.canvasWidth <= 950 && iphone?.canvasHeight >= 400 && iphone?.canvasHeight <= 450)) {
    throw new Error(`TPS iPhone viewport probe is outside the expected range: "${JSON.stringify(iphone)}"`);
  }
  await screenshot(sessionId, `${outputDir}/tps-iphone-idle.png`);
  await command(`/session/${sessionId}/goog/cdp/execute`, "POST", {
    cmd: "Emulation.clearDeviceMetricsOverride",
    params: {},
  });
  await delay(300);
  // Real-time input probes stay on requestAnimationFrame so they audit the same
  // continuous movement/camera path a player uses in the browser.
  await execute(sessionId, `${gameLookup} const game = findGame(); game.press('right', 'tps-audit-move'); return true;`);
  await delay(420);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.release('right', 'tps-audit-move'); return true;`);
  const afterStrafe = await state(sessionId);
  if (!afterStrafe?.p1 || !initial?.p1 || !initial?.p2) throw new Error(`TPS strafe state missing: ${JSON.stringify({ initial, afterStrafe })}`);
  const initialForwardX = initial.p2.x - initial.p1.x;
  const initialForwardZ = initial.p2.z - initial.p1.z;
  const initialForwardLength = Math.max(1e-5, Math.hypot(initialForwardX, initialForwardZ));
  const initialRightX = -initialForwardZ / initialForwardLength;
  const initialRightZ = initialForwardX / initialForwardLength;
  const strafeDX = afterStrafe.p1.x - initial.p1.x;
  const strafeDZ = afterStrafe.p1.z - initial.p1.z;
  const lateralTravel = Math.abs(strafeDX * initialRightX + strafeDZ * initialRightZ);
  if (lateralTravel < 0.25) {
    throw new Error(`TPS strafe did not move along the lock-relative tangent: ${JSON.stringify({ lateralTravel, initial, afterStrafe })}`);
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
    return { start, end: { x: game.p1.position.x, z: game.p1.position.z }, state: game.p1.state };
  `);
  const quickstepTravel = Math.hypot(quickstepProbe.end.x - quickstepProbe.start.x, quickstepProbe.end.z - quickstepProbe.start.z);
  if (quickstepTravel < 0.45) throw new Error(`TPS quickstep travel too small: ${JSON.stringify({ quickstepProbe, quickstepTravel })}`);
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
    return { steps, p1Health: game.p1.health, p2Health: game.p2.health, p1State: game.p1.state, p2State: game.p2.state };
  `);
  const afterPunch = await state(sessionId);
  if (!(afterPunch?.p2?.health < 100)) throw new Error(`TPS punch failed to damage locked target: ${JSON.stringify({ punchProbe, afterPunch })}`);
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

  const report = { initial, iphone, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, afterBoundary, radial };
  await writeFile(`${outputDir}/tps-runtime-state.json`, JSON.stringify(report, null, 2));
  await writeFile(`${outputDir}/webdriver.log`, driverLog);
  console.log(JSON.stringify(report));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  try { if (!driverProcess.killed) driverProcess.kill("SIGTERM"); } catch {}
}
