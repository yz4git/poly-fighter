import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const chrome = process.env.CHROME_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const output = process.env.AUDIT_OUTPUT ?? "artifacts/visual-audit/sera-v10-1-game.png";
if (!chrome) throw new Error("CHROME_BIN is required");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromeProcess = spawn(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--ignore-gpu-blocklist",
  "--enable-webgl",
  "--use-angle=swiftshader",
  "--window-size=1536,706",
  "--hide-scrollbars",
  "--remote-debugging-port=9222",
  "--user-data-dir=/tmp/poly-fighter-visual-audit-chrome",
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let browserLog = "";
chromeProcess.stdout.on("data", (chunk) => { browserLog += chunk.toString(); });
chromeProcess.stderr.on("data", (chunk) => { browserLog += chunk.toString(); });

async function waitForDebugger() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9222/json/version");
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error(`Chrome debugger did not start.\n${browserLog}`);
}

async function newTarget(targetUrl) {
  const response = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to create Chrome target: ${response.status}`);
  return response.json();
}

function cdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const resolver = pending.get(message.id);
    if (!resolver) return;
    pending.delete(message.id);
    if (message.error) resolver.reject(new Error(JSON.stringify(message.error)));
    else resolver.resolve(message.result ?? {});
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    close() { socket.close(); },
  };
}

try {
  await waitForDebugger();
  const target = await newTarget(url);
  const cdp = cdpClient(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 706, deviceScaleFactor: 1, mobile: false });

  // Give React time to hydrate the title screen, then enter the match exactly
  // as a user would. This keeps the visual audit out of production code.
  await delay(1100);
  const click = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('START MATCH'));
      if (!button) return { clicked: false, text: document.body.innerText.slice(0, 500) };
      button.click();
      return { clicked: true };
    })()`,
    returnByValue: true,
  });
  if (!click.result?.value?.clicked) throw new Error(`START MATCH was not found: ${JSON.stringify(click.result?.value)}`);

  // The GLB is local to the preview server. Wait for the async loader plus a
  // few render frames, but capture before the opening CPU has time to wander.
  await delay(1400);
  const state = await cdp.send("Runtime.evaluate", {
    expression: `(() => ({
      canvasCount: document.querySelectorAll('canvas').length,
      titleVisible: document.body.innerText.includes('START MATCH'),
      fighterHud: document.body.innerText.includes('SERA') && document.body.innerText.includes('KAIRO'),
    }))()`,
    returnByValue: true,
  });
  if (!state.result?.value?.canvasCount || !state.result?.value?.fighterHud) {
    throw new Error(`Match canvas/HUD was not ready: ${JSON.stringify(state.result?.value)}`);
  }

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await mkdir(new URL("../artifacts/visual-audit/", import.meta.url), { recursive: true }).catch(() => undefined);
  await mkdir(output.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(output, Buffer.from(screenshot.data, "base64"));
  await writeFile("artifacts/visual-audit/browser.log", browserLog);
  console.log(JSON.stringify({ output, state: state.result.value }));
  cdp.close();
} finally {
  chromeProcess.kill("SIGTERM");
}
