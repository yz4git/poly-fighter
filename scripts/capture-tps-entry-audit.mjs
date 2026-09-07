import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9519;
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
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`TPS entry screenshot is not PNG: ${path}`);
  await writeFile(path, bytes);
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

async function resizeToCssViewport(sessionId, width, height) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const metrics = await execute(sessionId, `return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
    };`);
    const chromeWidth = Math.max(0, metrics.outerWidth - metrics.innerWidth);
    const chromeHeight = Math.max(0, metrics.outerHeight - metrics.innerHeight);
    await command(`/session/${sessionId}/window/rect`, "POST", {
      width: Math.round(width + chromeWidth),
      height: Math.round(height + chromeHeight),
    });
    await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
    await delay(180);
    const next = await execute(sessionId, `return { innerWidth: window.innerWidth, innerHeight: window.innerHeight };`);
    if (Math.abs(next.innerWidth - width) <= 2 && Math.abs(next.innerHeight - height) <= 2) return next;
  }
  return execute(sessionId, `return { innerWidth: window.innerWidth, innerHeight: window.innerHeight };`);
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
            "--hide-scrollbars",
            "--window-size=932,430",
          ],
        },
      },
    },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(500);
  const viewport = await resizeToCssViewport(sessionId, 932, 430);
  if (Math.abs(viewport.innerWidth - 932) > 2 || Math.abs(viewport.innerHeight - 430) > 2) {
    throw new Error(`Could not establish iPhone landscape viewport: ${JSON.stringify(viewport)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const title = await execute(sessionId, `
    const labels = [...document.querySelectorAll('button')].map((entry) => entry.textContent ?? '');
    const start = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('START FIGHT'));
    const rect = start?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      startFight: Boolean(start),
      legacyStartMatch: labels.some((label) => label.includes('START MATCH')),
      legacyTpsMode: labels.some((label) => label.includes('TPS LOCK-ON BATTLE')),
      startRect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
    };
  `);
  if (!title.startFight || title.legacyStartMatch || title.legacyTpsMode || title.scrollWidth > title.width + 2 || title.scrollHeight > title.height + 2 || !title.startRect || title.startRect.bottom > title.height || title.startRect.top < 0) {
    throw new Error(`TPS iPhone title layout failed: ${JSON.stringify(title)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-title-iphone.png`);

  const clicked = await clickButton(sessionId, "START FIGHT");
  if (!clicked.clicked) throw new Error(`START FIGHT could not open loadout: ${JSON.stringify(clicked)}`);
  await delay(180);

  const loadout = await execute(sessionId, `
    const visibleRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const buttons = [...document.querySelectorAll('button')];
    const engage = buttons.find((entry) => entry.textContent?.includes('ENGAGE'));
    const back = buttons.find((entry) => entry.textContent?.includes('TITLE'));
    const cards = [...document.querySelectorAll('.fighter-card')].map(visibleRect);
    const labels = [...document.querySelectorAll('.difficulty span')];
    const cpuDifficulty = labels.find((entry) => entry.textContent?.includes('CPU DIFFICULTY'));
    const visualModel = labels.find((entry) => entry.textContent?.includes('VISUAL MODEL'));
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      tpsLoadout: document.body.innerText.includes('TPS LOADOUT'),
      engage: visibleRect(engage),
      back: visibleRect(back),
      cpuDifficulty: visibleRect(cpuDifficulty),
      visualModel: visibleRect(visualModel),
      cards,
    };
  `);
  const within = (rect) => rect && rect.left >= -1 && rect.top >= -1 && rect.right <= loadout.width + 1 && rect.bottom <= loadout.height + 1 && rect.width > 1 && rect.height > 1;
  const loadoutPass = loadout.tpsLoadout
    && loadout.scrollWidth <= loadout.width + 2
    && loadout.scrollHeight <= loadout.height + 2
    && within(loadout.engage)
    && within(loadout.back)
    && within(loadout.cpuDifficulty)
    && within(loadout.visualModel)
    && loadout.cards.length === 4
    && loadout.cards.every(within);
  if (!loadoutPass) throw new Error(`TPS iPhone loadout layout failed: ${JSON.stringify(loadout)}`);
  await screenshot(sessionId, `${outputDir}/tps-loadout-iphone.png`);
  await writeFile(`${outputDir}/tps-entry-layout.json`, `${JSON.stringify({ title, loadout }, null, 2)}\n`);
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
