import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const output = process.env.AUDIT_OUTPUT ?? "artifacts/visual-audit/sera-v10-1-game.png";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const driverProcess = spawn(driver, ["--port=9515", "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let driverLog = "";
driverProcess.stdout.on("data", (chunk) => { driverLog += chunk.toString(); });
driverProcess.stderr.on("data", (chunk) => { driverLog += chunk.toString(); });

async function waitForDriver() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9515/status");
      if (response.ok) return;
    } catch {
      // ChromeDriver is still starting.
    }
    await delay(100);
  }
  throw new Error(`ChromeDriver did not start.\n${driverLog}`);
}

async function command(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:9515${path}`, {
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
  await delay(1200);

  const clicked = await command(`/session/${sessionId}/execute/sync`, "POST", {
    script: `
      const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('START MATCH'));
      if (!button) return { clicked: false, text: document.body.innerText.slice(0, 600) };
      button.click();
      return { clicked: true };
    `,
    args: [],
  });
  if (!clicked?.clicked) throw new Error(`START MATCH was not found: ${JSON.stringify(clicked)}`);

  // Wait for React match construction, WebGL startup and the async GLB swap.
  await delay(1800);
  const state = await command(`/session/${sessionId}/execute/sync`, "POST", {
    script: `
      return {
        canvasCount: document.querySelectorAll('canvas').length,
        titleVisible: document.body.innerText.includes('START MATCH'),
        fighterHud: document.body.innerText.includes('SERA') && document.body.innerText.includes('KAIRO'),
        bodyText: document.body.innerText.slice(0, 800),
      };
    `,
    args: [],
  });
  if (!state?.canvasCount || !state?.fighterHud || state?.titleVisible) {
    throw new Error(`Match canvas/HUD was not ready: ${JSON.stringify(state)}`);
  }

  const screenshot = await command(`/session/${sessionId}/screenshot`);
  await mkdir(output.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(output, Buffer.from(screenshot, "base64"));
  await writeFile("artifacts/visual-audit/webdriver.log", driverLog);
  console.log(JSON.stringify({ output, state }));
} finally {
  if (sessionId) {
    await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  }
  driverProcess.kill("SIGTERM");
}
