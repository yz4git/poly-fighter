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

async function execute(sessionId, script, args = []) {
  return command(`/session/${sessionId}/execute/sync`, "POST", { script, args });
}

async function clickButton(sessionId, text) {
  return execute(sessionId, `
    const wanted = arguments[0];
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes(wanted));
    if (!button) return { clicked: false, text: document.body.innerText.slice(0, 1000) };
    button.click();
    return { clicked: true, label: button.textContent };
  `, [text]);
}

async function chooseFighter(sessionId, name, playerLabel) {
  return execute(sessionId, `
    const name = arguments[0];
    const playerLabel = arguments[1];
    const candidates = [...document.querySelectorAll('button')];
    const button = candidates.find((entry) => {
      const text = entry.textContent ?? '';
      return text.includes(name) && text.includes(playerLabel);
    });
    if (!button) return { clicked: false, buttons: candidates.map((entry) => entry.textContent).slice(0, 30) };
    button.click();
    return { clicked: true, label: button.textContent };
  `, [name, playerLabel]);
}

async function buttonCenter(sessionId, text) {
  return execute(sessionId, `
    const wanted = arguments[0];
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === wanted);
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  `, [text]);
}

async function touchDown(sessionId, point, pointerId) {
  await command(`/session/${sessionId}/actions`, "POST", {
    actions: [{
      type: "pointer",
      id: `audit-touch-${pointerId}`,
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", x: point.x, y: point.y },
        { type: "pointerDown", button: 0 },
      ],
    }],
  });
}

async function touchUp(sessionId, point, pointerId) {
  await command(`/session/${sessionId}/actions`, "POST", {
    actions: [{
      type: "pointer",
      id: `audit-touch-${pointerId}`,
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", x: point.x, y: point.y },
        { type: "pointerUp", button: 0 },
      ],
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
  await delay(350);

  const selectedP1 = await chooseFighter(sessionId, "SERA", "PLAYER 1 / SPEED");
  if (!selectedP1?.clicked) throw new Error(`PLAYER 1 SERA was not found: ${JSON.stringify(selectedP1)}`);
  const selectedP2 = await chooseFighter(sessionId, "KAIRO", "PLAYER 2 / POWER");
  if (!selectedP2?.clicked) throw new Error(`PLAYER 2 KAIRO was not found: ${JSON.stringify(selectedP2)}`);
  await delay(150);

  const enter = await clickButton(sessionId, "ENTER RING");
  if (!enter?.clicked) throw new Error(`ENTER RING was not found: ${JSON.stringify(enter)}`);

  await delay(1800);
  const state = await execute(sessionId, `
    return {
      canvasCount: document.querySelectorAll('canvas').length,
      titleVisible: document.body.innerText.includes('START MATCH'),
      selectVisible: document.body.innerText.includes('ENTER RING'),
      fighterHud: document.body.innerText.includes('SERA') && document.body.innerText.includes('KAIRO'),
      bodyText: document.body.innerText.slice(0, 1000),
    };
  `);
  if (!state?.canvasCount || !state?.fighterHud || state?.titleVisible || state?.selectVisible) {
    throw new Error(`Match canvas/HUD was not ready: ${JSON.stringify(state)}`);
  }

  await mkdir(output.split("/").slice(0, -1).join("/"), { recursive: true });
  await capture(sessionId, output);

  const guard = await buttonCenter(sessionId, "G");
  const punch = await buttonCenter(sessionId, "P");
  const kick = await buttonCenter(sessionId, "K");
  if (!guard || !punch || !kick) throw new Error(`Combat buttons were not found: ${JSON.stringify({ guard, punch, kick })}`);

  await touchDown(sessionId, guard, 91);
  await delay(220);
  await capture(sessionId, siblingOutput(output, "guard"));
  await touchUp(sessionId, guard, 91);
  await delay(160);

  await touchDown(sessionId, punch, 92);
  await delay(58);
  await capture(sessionId, siblingOutput(output, "punch"));
  await touchUp(sessionId, punch, 92);
  await delay(360);

  await touchDown(sessionId, kick, 93);
  await delay(74);
  await capture(sessionId, siblingOutput(output, "kick"));
  await touchUp(sessionId, kick, 93);

  await writeFile("artifacts/visual-audit/webdriver.log", driverLog);
  console.log(JSON.stringify({ output, state, selectedP1, selectedP2, frames: ["idle", "guard", "punch", "kick"] }));
} finally {
  if (sessionId) {
    await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  }
  driverProcess.kill("SIGTERM");
}
