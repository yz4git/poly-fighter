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
    if (initial?.ready && initial?.tpsText && initial?.arena && initial?.canvasWidth > 2 && initial?.canvasHeight > 2) break;
    await delay(100);
  }
  if (!initial?.ready || !initial?.arena) throw new Error(`TPS WebGL did not become ready: ${JSON.stringify(initial)}`);

  await mkdir(outputDir, { recursive: true });
  await delay(850);
  initial = await state(sessionId);
  await screenshot(sessionId, `${outputDir}/tps-idle.png`);

  await execute(sessionId, `${gameLookup} const game = findGame(); game.press('right', 'tps-audit-move'); return true;`);
  await delay(420);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.release('right', 'tps-audit-move'); return true;`);
  const afterStrafe = await state(sessionId);
  if (!afterStrafe?.p1 || !initial?.p1 || Math.abs(afterStrafe.p1.x - initial.p1.x) < 0.25) {
    throw new Error(`TPS strafe did not move laterally: ${JSON.stringify({ initial, afterStrafe })}`);
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

  await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.p1.position.set(0, 0, 0.9);
    game.p2.position.set(0, 0, -0.55);
    game.p1.health = 100;
    game.p2.health = 100;
    game.p1.state = 'IDLE';
    game.p2.state = 'IDLE';
    game.press('punch', 'tps-audit-punch');
    return true;
  `);
  await delay(110);
  await execute(sessionId, `${gameLookup} const game = findGame(); game.release('punch', 'tps-audit-punch'); return true;`);
  await delay(360);
  const afterPunch = await state(sessionId);
  if (!(afterPunch?.p2?.health < 100)) throw new Error(`TPS punch failed to damage locked target: ${JSON.stringify(afterPunch)}`);
  await screenshot(sessionId, `${outputDir}/tps-punch.png`);

  await execute(sessionId, `${gameLookup} const game = findGame(); game.p1.position.set(9, 0, 0); return true;`);
  await delay(80);
  const afterBoundary = await state(sessionId);
  const radial = Math.hypot(afterBoundary.p1.x, afterBoundary.p1.z);
  if (radial > 6.15) throw new Error(`TPS circular boundary failed: ${radial}`);

  const report = { initial, afterStrafe, beforeForwardDistance, afterForward, afterForwardDistance, afterPunch, afterBoundary, radial };
  await writeFile(`${outputDir}/tps-runtime-state.json`, JSON.stringify(report, null, 2));
  await writeFile(`${outputDir}/webdriver.log`, driverLog);
  console.log(JSON.stringify(report));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  try { if (!driverProcess.killed) driverProcess.kill("SIGTERM"); } catch {}
}
