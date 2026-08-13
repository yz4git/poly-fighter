import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const output = process.env.AUDIT_OUTPUT ?? "artifacts/visual-audit/sera-v10-2-game.png";
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

async function clickButton(sessionId, text) {
  return command(`/session/${sessionId}/execute/sync`, "POST", {
    script: `
      const wanted = arguments[0];
      const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes(wanted));
      if (!button) return { clicked: false, text: document.body.innerText.slice(0, 800) };
      button.click();
      return { clicked: true, label: button.textContent };
    `,
    args: [text],
  });
}

async function buttonCenter(sessionId, text) {
  return command(`/session/${sessionId}/execute/sync`, "POST", {
    script: `
      const wanted = arguments[0];
      const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === wanted);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    `,
    args: [text],
  });
}

async function pointerAction(sessionId, point, holdMs = 0) {
  await command(`/session/${sessionId}/actions`, "POST", {
    actions: [{
      type: "pointer",
      id: "audit-pointer",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", x: point.x, y: point.y },
        { type: "pointerDown", button: 0 },
        ...(holdMs > 0 ? [{ type: "pause", duration: holdMs }] : []),
        { type: "pointerUp", button: 0 },
      ],
    }],
  });
  await command(`/session/${sessionId}/actions`, "DELETE").catch(() => undefined);
}

async function pointerDown(sessionId, point) {
  await command(`/session/${sessionId}/actions`, "POST", {
    actions: [{
      type: "pointer",
      id: "audit-hold-pointer",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", x: point.x, y: point.y },
        { type: "pointerDown", button: 0 },
      ],
    }],
  });
}

async function pointerUp(sessionId) {
  await command(`/session/${sessionId}/actions`, "POST", {
    actions: [{
      type: "pointer",
      id: "audit-hold-pointer",
      parameters: { pointerType: "mouse" },
      actions: [{ type: "pointerUp", button: 0 }],
    }],
  }).catch(() => undefined);
  await command(`/session/${sessionId}/actions`, "DELETE").catch(() => undefined);
}

function siblingOutput(base, suffix) {
  return base.replace(/\.png$/i, `-${suffix}.png`);
}

async function capture(sessionId, path) {
  const screenshot = await command(`/session/${sessionId}/screenshot`);
  await writeFile(path, Buffer.from(screenshot, "base64"));
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
  await delay(1000);

  const start = await clickButton(sessionId, "START MATCH");
  if (!start?.clicked) throw new Error(`START MATCH was not found: ${JSON.stringify(start)}`);
  await delay(450);

  const enter = await clickButton(sessionId, "ENTER RING");
  if (!enter?.clicked) throw new Error(`ENTER RING was not found: ${JSON.stringify(enter)}`);

  // Wait for match construction, WebGL startup and the async V10 GLB swap.
  await delay(1800);
  const state = await command(`/session/${sessionId}/execute/sync`, "POST", {
    script: `
      return {
        canvasCount: document.querySelectorAll('canvas').length,
        titleVisible: document.body.innerText.includes('START MATCH'),
        selectVisible: document.body.innerText.includes('ENTER RING'),
        fighterHud: document.body.innerText.includes('SERA') && document.body.innerText.includes('KAIRO'),
        bodyText: document.body.innerText.slice(0, 800),
      };
    `,
    args: [],
  });
  if (!state?.canvasCount || !state?.fighterHud || state?.titleVisible || state?.selectVisible) {
    throw new Error(`Match canvas/HUD was not ready: ${JSON.stringify(state)}`);
  }

  await mkdir(output.split("/").slice(0, -1).join("/"), { recursive: true });
  await capture(sessionId, output);

  const guard = await buttonCenter(sessionId, "G");
  const punch = await buttonCenter(sessionId, "P");
  const kick = await buttonCenter(sessionId, "K");
  if (!guard || !punch || !kick) throw new Error(`Combat buttons were not found: ${JSON.stringify({ guard, punch, kick })}`);

  await pointerDown(sessionId, guard);
  await delay(180);
  await capture(sessionId, siblingOutput(output, "guard"));
  await pointerUp(sessionId);
  await delay(120);

  await pointerAction(sessionId, punch, 55);
  await delay(95);
  await capture(sessionId, siblingOutput(output, "punch"));
  await delay(300);

  await pointerAction(sessionId, kick, 55);
  await delay(135);
  await capture(sessionId, siblingOutput(output, "kick"));

  await writeFile("artifacts/visual-audit/webdriver.log", driverLog);
  console.log(JSON.stringify({ output, state, frames: ["idle", "guard", "punch", "kick"] }));
} finally {
  if (sessionId) {
    await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  }
  driverProcess.kill("SIGTERM");
}
