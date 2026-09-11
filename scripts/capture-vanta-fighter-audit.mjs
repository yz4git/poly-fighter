import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const baseUrl = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}vantaAudit=1`;
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
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
    throw new Error(`VANTA audit screenshot is not PNG: ${path}`);
  }
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
  await delay(650);
  await resizeToCssViewport(sessionId, 932, 430);
  await mkdir(outputDir, { recursive: true });

  const auditEntry = await execute(sessionId, `return {
    marker: document.body.dataset.vantaAuditEntry ?? '',
    title: document.body.innerText,
  };`);
  if (auditEntry.marker !== "STAGE_1_VISUAL_ONLY") {
    throw new Error(`VANTA audit query hook did not activate: ${JSON.stringify(auditEntry)}`);
  }

  if (!await clickButton(sessionId, "RIVAL CIRCUIT")) throw new Error("Could not open Rival Circuit");
  await delay(300);
  const briefing = await execute(sessionId, `return {
    hasVanta: document.body.innerText.includes('CPU // VANTA'),
    text: document.querySelector('.circuit-briefing')?.textContent ?? '',
  };`);
  if (!briefing.hasVanta) throw new Error(`VANTA audit loadout is not wired: ${JSON.stringify(briefing)}`);

  if (!await clickButton(sessionId, "ENTER CIRCUIT")) throw new Error("Could not enter VANTA audit match");
  await delay(1400);

  const state = await execute(sessionId, `
    const strip = document.querySelector('.circuit-run-strip');
    const rightName = document.querySelector('.right-player .hud-name strong')?.textContent ?? '';
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      canvas: Boolean(document.querySelector('.scene-host.visible canvas')),
      strip: strip?.textContent ?? '',
      opponentName: rightName,
      auditEntry: document.body.dataset.vantaAuditEntry ?? '',
      visual: document.body.dataset.vantaFighterVisual ?? '',
      fighterName: document.body.dataset.vantaFighterName ?? '',
      orbiters: Number(document.body.dataset.vantaFighterOrbiters ?? '0'),
      palette: document.body.dataset.vantaFighterPalette ?? '',
      modelPalette: document.body.dataset.vantaFighterModelPalette ?? '',
      aiPolicy: document.body.dataset.rivalCircuitAiPolicy ?? '',
      aiStyle: document.body.dataset.rivalCircuitAiStyle ?? '',
      fallback: document.body.innerText.includes('3D描画を開始できませんでした') || document.body.innerText.includes('描画中にエラーが発生しました'),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  `);

  const pass = state.width === 932
    && state.height === 430
    && state.canvas
    && state.strip.includes("GLASSLINE")
    && state.opponentName === "VANTA"
    && state.auditEntry === "STAGE_1_VISUAL_ONLY"
    && state.visual === "VANTA_V2"
    && state.fighterName === "VANTA"
    && state.orbiters === 3
    && state.palette === "VIOLET_BLACK_GOLD"
    && state.modelPalette === "APPLIED"
    && state.aiPolicy === "RIVAL_CIRCUIT_V1"
    && state.aiStyle === "PRESSURE"
    && !state.fallback
    && !state.horizontalOverflow
    && !state.verticalOverflow;
  if (!pass) throw new Error(`VANTA iPhone WebGL runtime failed: ${JSON.stringify(state)}`);

  await screenshot(sessionId, `${outputDir}/rival-circuit-vanta-iphone.png`);
  await writeFile(`${outputDir}/rival-circuit-vanta.json`, `${JSON.stringify({ briefing, state }, null, 2)}\n`);
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
