import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.MODEL_VIEW_AUDIT_DIR ?? "artifacts/visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9516;
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
    } catch {
      // ChromeDriver is still starting.
    }
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

async function waitForModelView(sessionId, fighter) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await execute(sessionId, `
      const fighter = arguments[0];
      const panel = document.querySelector('section[aria-label="Model View"]');
      const canvas = panel?.querySelector('canvas');
      const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) : null;
      const text = panel?.textContent ?? '';
      const runtimeRequests = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/models/sera-blender-runtime.glb'));
      return {
        panel: Boolean(panel),
        canvas: Boolean(canvas),
        webgl: Boolean(gl),
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        fighterVisible: text.includes(fighter),
        fallback: text.includes('MODEL VIEW FALLBACK'),
        seraRuntimeRequested: runtimeRequests.length > 0,
        bodyText: text.slice(0, 700),
      };
    `, [fighter]);
    if (state?.panel && state?.canvas && state?.webgl && state?.width > 2 && state?.height > 2 && state?.fighterVisible && !state?.fallback) return state;
    await delay(100);
  }
  throw new Error(`MODEL VIEW did not become ready for ${fighter}`);
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`MODEL VIEW screenshot is not PNG: ${path}`);
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
  const open = await clickButton(sessionId, "MODEL VIEW");
  if (!open?.clicked) throw new Error(`MODEL VIEW title button not found: ${JSON.stringify(open)}`);

  await mkdir(outputDir, { recursive: true });
  const sera = await waitForModelView(sessionId, "SERA");
  await delay(700);
  const seraAfterLoad = await waitForModelView(sessionId, "SERA");
  await screenshot(sessionId, `${outputDir}/model-view-sera.png`);

  const kairoClick = await clickButton(sessionId, "KAIRO");
  if (!kairoClick?.clicked) throw new Error(`KAIRO Model View selector not found: ${JSON.stringify(kairoClick)}`);
  const kairo = await waitForModelView(sessionId, "KAIRO");
  await delay(250);
  await screenshot(sessionId, `${outputDir}/model-view-kairo.png`);

  const reset = await clickButton(sessionId, "RESET VIEW");
  if (!reset?.clicked) throw new Error(`RESET VIEW button not found: ${JSON.stringify(reset)}`);
  const back = await clickButton(sessionId, "TITLE");
  if (!back?.clicked) throw new Error(`TITLE button not found from Model View: ${JSON.stringify(back)}`);
  await delay(150);
  const titleState = await execute(sessionId, `return { title: document.body.innerText.includes('START MATCH'), modelView: document.body.innerText.includes('CHARACTER LAB') };`);
  if (!titleState?.title || titleState?.modelView) throw new Error(`MODEL VIEW did not return cleanly to title: ${JSON.stringify(titleState)}`);

  await writeFile(`${outputDir}/model-view-state.json`, JSON.stringify({ sera, seraAfterLoad, kairo, titleState }, null, 2));
  await writeFile(`${outputDir}/model-view-webdriver.log`, driverLog);
  console.log(JSON.stringify({ sera, seraAfterLoad, kairo, titleState }));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  try {
    if (!driverProcess.killed) driverProcess.kill("SIGTERM");
  } catch {
    // ChromeDriver may already have exited.
  }
}
