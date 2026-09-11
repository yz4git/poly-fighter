import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9527;
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
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`APEX audit screenshot is not PNG: ${path}`);
  await writeFile(path, bytes);
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

  if (!await clickButton(sessionId, "RIVAL CIRCUIT")) throw new Error("Could not open Rival Circuit");
  await delay(220);
  if (!await clickButton(sessionId, "ENTER CIRCUIT")) throw new Error("Could not enter Rival Circuit match");
  await delay(900);

  const injected = await execute(sessionId, `
    const strip = document.querySelector('.circuit-run-strip');
    if (!strip) return false;
    strip.textContent = 'STAGE 5/5 · APEX-0 · FINAL RIVAL · APEX';
    return true;
  `);
  if (!injected) throw new Error("Could not expose APEX final-rival runtime label");
  await delay(850);

  const state = await execute(sessionId, `
    const strip = document.querySelector('.circuit-run-strip');
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      canvas: Boolean(document.querySelector('.scene-host.visible canvas')),
      strip: strip?.textContent ?? '',
      boss: document.body.dataset.rivalCircuitApexBoss ?? '',
      bossPhase: document.body.dataset.rivalCircuitApexPhase ?? '',
      bossPhaseLabel: document.body.dataset.rivalCircuitApexPhaseLabel ?? '',
      bladeCount: Number(document.body.dataset.rivalCircuitApexBladeCount ?? '0'),
      aiPolicy: document.body.dataset.rivalCircuitAiPolicy ?? '',
      aiStyle: document.body.dataset.rivalCircuitAiStyle ?? '',
      aiPhase: document.body.dataset.rivalCircuitAiPhase ?? '',
      aiTactic: document.body.dataset.rivalCircuitAiTactic ?? '',
      fallback: document.body.innerText.includes('3D描画を開始できませんでした') || document.body.innerText.includes('描画中にエラーが発生しました'),
    };
  `);

  const pass = state.canvas
    && state.strip.includes('APEX-0')
    && state.boss === 'APEX_ZERO_V1'
    && state.bossPhase === 'CALIBRATE'
    && state.bossPhaseLabel.includes('PHASE 1')
    && state.bladeCount === 4
    && state.aiPolicy === 'RIVAL_CIRCUIT_V1'
    && state.aiStyle === 'APEX'
    && state.aiPhase === 'ANGLE'
    && state.aiTactic === 'ORBIT'
    && !state.fallback;
  if (!pass) throw new Error(`APEX-0 final-rival WebGL runtime failed: ${JSON.stringify(state)}`);

  await screenshot(sessionId, `${outputDir}/rival-circuit-apex-calibrate-iphone.png`);
  await writeFile(`${outputDir}/rival-circuit-apex.json`, `${JSON.stringify(state, null, 2)}\n`);
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
