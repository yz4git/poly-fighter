import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9529;
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

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`FINISH audit screenshot is not PNG: ${path}`);
  await writeFile(path, bytes);
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

async function resizeToCssViewport(sessionId, width, height) {
  const metrics = await execute(sessionId, `return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
  };`);
  await command(`/session/${sessionId}/window/rect`, "POST", {
    width: Math.round(width + Math.max(0, metrics.outerWidth - metrics.innerWidth)),
    height: Math.round(height + Math.max(0, metrics.outerHeight - metrics.innerHeight)),
  });
  await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
  await delay(220);
}

async function finishState(sessionId, freezeOnHit = false) {
  return execute(sessionId, `
    const freeze = Boolean(arguments[0]);
    const phase = document.body.dataset.rivalCircuitFinishPhase ?? '';
    let frozeHitFrame = false;
    if (freeze && phase === 'HIT') {
      const pause = document.querySelector('.tps-pause-button');
      if (pause instanceof HTMLButtonElement && pause.getAttribute('aria-label') === 'Pause') {
        pause.click();
        frozeHitFrame = true;
      }
    }
    const actions = [...document.querySelectorAll('.tps-two-button-actions button')].map((button) => ({
      label: button.getAttribute('aria-label'),
      text: button.textContent?.trim() ?? '',
      rect: (() => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      })(),
    }));
    return {
      canvas: Boolean(document.querySelector('.scene-host.visible canvas')),
      strip: document.querySelector('.circuit-run-strip')?.textContent ?? '',
      policy: document.body.dataset.rivalCircuitFinishPolicy ?? '',
      ready: document.body.dataset.rivalCircuitFinishReady ?? '',
      phase,
      move: document.body.dataset.rivalCircuitFinishMove ?? '',
      stage: document.body.dataset.rivalCircuitFinishStage ?? '',
      health: Number(document.body.dataset.rivalCircuitFinishHealth ?? '-1'),
      activations: Number(document.body.dataset.rivalCircuitFinishActivations ?? '0'),
      pseudoContent: getComputedStyle(document.body, '::after').content,
      frozeHitFrame,
      actions,
      fallback: document.body.innerText.includes('3D描画を開始できませんでした') || document.body.innerText.includes('描画中にエラーが発生しました'),
      width: window.innerWidth,
      height: window.innerHeight,
    };
  `, [freezeOnHit]);
}

let sessionId = null;
try {
  await waitForDriver();
  const session = await command("/session", "POST", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        "goog:chromeOptions": {
          args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--window-size=932,430"],
        },
      },
    },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(500);
  await resizeToCssViewport(sessionId, 932, 430);
  await mkdir(outputDir, { recursive: true });

  if (!await clickButton(sessionId, "RIVAL CIRCUIT")) throw new Error("Could not open Rival Circuit for FINISH audit");
  await delay(220);
  if (!await clickButton(sessionId, "ENTER CIRCUIT")) throw new Error("Could not enter Rival Circuit for FINISH audit");
  await delay(750);

  // Production users cannot reach this path: the runtime honors the health seed
  // only while navigator.webdriver is true. It gives CI a deterministic critical
  // health window without weakening the player-facing game.
  await execute(sessionId, `
    document.body.dataset.rivalCircuitFinishAuditHealth = '12';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    return navigator.webdriver;
  `);

  let ready = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(100);
    ready = await finishState(sessionId);
    if (ready.ready === '1') break;
  }
  await execute(sessionId, `
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    return true;
  `);
  if (!ready || ready.ready !== '1') throw new Error(`FINISH READY window did not open: ${JSON.stringify(ready)}`);
  if (
    !ready.canvas
    || !ready.strip.includes('GLASSLINE')
    || ready.policy !== 'CIRCUIT_FINISH_V1'
    || ready.stage !== '1'
    || ready.health !== 12
    || ready.move !== 'power'
    || ready.fallback
    || ready.actions.length !== 2
    || !ready.actions.some((action) => action.label === 'Attack')
    || !ready.actions.some((action) => action.label === 'Step')
  ) {
    throw new Error(`FINISH READY runtime audit failed: ${JSON.stringify(ready)}`);
  }
  await screenshot(sessionId, `${outputDir}/rival-circuit-finish-ready-iphone.png`);

  await execute(sessionId, `
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }));
    return true;
  `);
  await delay(90);
  await execute(sessionId, `
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'j', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'l', bubbles: true, cancelable: true }));
    return true;
  `);

  let hit = null;
  for (let attempt = 0; attempt < 28; attempt += 1) {
    await delay(50);
    hit = await finishState(sessionId, true);
    if (hit.phase === 'HIT') break;
  }
  if (!hit || hit.phase !== 'HIT') throw new Error(`FINISH chord did not connect: ${JSON.stringify(hit)}`);
  if (
    hit.policy !== 'CIRCUIT_FINISH_V1'
    || hit.move !== 'power'
    || hit.activations < 1
    || hit.health !== 0
    || !hit.frozeHitFrame
    || hit.fallback
  ) {
    throw new Error(`FINISH hit runtime audit failed: ${JSON.stringify(hit)}`);
  }
  await screenshot(sessionId, `${outputDir}/rival-circuit-finish-hit-iphone.png`);
  await writeFile(`${outputDir}/rival-circuit-finish.json`, `${JSON.stringify({ ready, hit }, null, 2)}\n`);
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
