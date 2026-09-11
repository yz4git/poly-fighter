import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/rook-webgl-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9534;
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
  if (!response.ok || payload?.value?.error) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload.value;
}

async function execute(sessionId, script, args = []) {
  return command(`/session/${sessionId}/execute/sync`, "POST", { script, args });
}

async function clickByText(sessionId, text) {
  return execute(sessionId, `
    const wanted = arguments[0];
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes(wanted));
    if (!button) return false;
    button.click();
    return true;
  `, [text]);
}

async function clickSelector(sessionId, selector) {
  return execute(sessionId, `
    const selector = arguments[0];
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  `, [selector]);
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`ROOK playable audit screenshot is not PNG: ${path}`);
  }
  await writeFile(path, bytes);
}

async function resizeToCssViewport(sessionId, width, height) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
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
    await delay(180);
    const next = await execute(sessionId, `return { innerWidth: window.innerWidth, innerHeight: window.innerHeight };`);
    if (Math.abs(next.innerWidth - width) <= 2 && Math.abs(next.innerHeight - height) <= 2) return next;
  }
  return execute(sessionId, `return { innerWidth: window.innerWidth, innerHeight: window.innerHeight };`);
}

async function openLoadout(sessionId) {
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(600);
  const viewport = await resizeToCssViewport(sessionId, 932, 430);
  if (Math.abs(viewport.innerWidth - 932) > 2 || Math.abs(viewport.innerHeight - 430) > 2) {
    throw new Error(`Could not establish ROOK iPhone viewport: ${JSON.stringify(viewport)}`);
  }
  if (!await clickByText(sessionId, "START FIGHT")) throw new Error("Could not open TPS loadout");
  await delay(300);
}

const withinViewport = (rect, width, height) => rect
  && rect.left >= -1
  && rect.top >= -1
  && rect.right <= width + 1
  && rect.bottom <= height + 1
  && rect.width > 1
  && rect.height > 1;

async function inspectLoadout(sessionId) {
  return execute(sessionId, `
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const p1Cards = [...document.querySelectorAll('[data-fighter-slot="P1"]')];
    const p2Cards = [...document.querySelectorAll('[data-fighter-slot="P2"]')];
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      p1Count: p1Cards.length,
      p2Count: p2Cards.length,
      p1Names: p1Cards.map((entry) => entry.querySelector('strong')?.textContent ?? ''),
      p2Names: p2Cards.map((entry) => entry.querySelector('strong')?.textContent ?? ''),
      p1Rook: Boolean(document.querySelector('[data-fighter-slot="P1"][data-fighter-id="amber"]')),
      p2Rook: Boolean(document.querySelector('[data-fighter-slot="P2"][data-fighter-id="amber"]')),
      cards: [...p1Cards, ...p2Cards].map(rect),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  `);
}

async function inspectMatch(sessionId) {
  return execute(sessionId, `
    const actions = [...document.querySelectorAll('.tps-two-button-actions .touch-action')];
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const attack = actions.find((entry) => entry.getAttribute('aria-label') === 'Attack');
    const step = actions.find((entry) => entry.getAttribute('aria-label') === 'Step');
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      canvas: Boolean(document.querySelector('.scene-host.visible canvas')),
      p1Name: document.querySelector('.left-player .hud-name strong')?.textContent ?? '',
      p2Name: document.querySelector('.right-player .hud-name strong')?.textContent ?? '',
      actionCount: actions.length,
      actionLabels: actions.map((entry) => entry.getAttribute('aria-label')),
      attack: rect(attack),
      step: rect(step),
      visual: document.body.dataset.rookFighterVisual ?? '',
      fighterName: document.body.dataset.rookFighterName ?? '',
      armorPieces: Number(document.body.dataset.rookFighterArmorPieces ?? '0'),
      palette: document.body.dataset.rookFighterPalette ?? '',
      fallback: document.body.innerText.includes('3D描画を開始できませんでした') || document.body.innerText.includes('描画中にエラーが発生しました'),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  `);
}

function matchPass(state, p1Name, p2Name) {
  return state.width === 932
    && state.height === 430
    && state.canvas
    && state.p1Name === p1Name
    && state.p2Name === p2Name
    && state.actionCount === 2
    && state.actionLabels.includes("Attack")
    && state.actionLabels.includes("Step")
    && withinViewport(state.attack, state.width, state.height)
    && withinViewport(state.step, state.width, state.height)
    && state.visual === "ROOK_V1"
    && state.fighterName === "ROOK"
    && state.armorPieces === 5
    && state.palette === "AMBER_GUNMETAL_STEEL"
    && !state.fallback
    && !state.horizontalOverflow
    && !state.verticalOverflow;
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
  await mkdir(outputDir, { recursive: true });

  await openLoadout(sessionId);
  const loadout = await inspectLoadout(sessionId);
  const expectedNames = "KAIRO|SERA|VANTA|ROOK";
  if (
    loadout.p1Count !== 4
    || loadout.p2Count !== 4
    || loadout.p1Names.join("|") !== expectedNames
    || loadout.p2Names.join("|") !== expectedNames
    || !loadout.p1Rook
    || !loadout.p2Rook
    || !loadout.cards.every((entry) => withinViewport(entry, loadout.width, loadout.height))
    || loadout.horizontalOverflow
    || loadout.verticalOverflow
  ) {
    throw new Error(`ROOK four-fighter loadout failed: ${JSON.stringify(loadout)}`);
  }

  if (!await clickSelector(sessionId, '[data-fighter-slot="P1"][data-fighter-id="amber"]')) {
    throw new Error("Could not select ROOK for P1");
  }
  const selected = await execute(sessionId, `
    const card = document.querySelector('[data-fighter-slot="P1"][data-fighter-id="amber"]');
    return {
      selected: card?.classList.contains('selected-amber') ?? false,
      engageCopy: [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes('ENGAGE'))?.textContent ?? '',
    };
  `);
  if (!selected.selected || !selected.engageCopy.includes("ROOK")) {
    throw new Error(`ROOK P1 selection did not commit: ${JSON.stringify(selected)}`);
  }
  await screenshot(sessionId, `${outputDir}/rook-playable-loadout-iphone.png`);

  if (!await clickByText(sessionId, "ENGAGE")) throw new Error("Could not engage ROOK P1 match");
  await delay(1500);
  const p1Match = await inspectMatch(sessionId);
  if (!matchPass(p1Match, "ROOK", "SERA")) {
    throw new Error(`Playable ROOK P1 WebGL runtime failed: ${JSON.stringify(p1Match)}`);
  }
  await screenshot(sessionId, `${outputDir}/rook-playable-p1-iphone.png`);

  await openLoadout(sessionId);
  if (!await clickSelector(sessionId, '[data-fighter-slot="P2"][data-fighter-id="amber"]')) {
    throw new Error("Could not select ROOK for P2");
  }
  if (!await clickByText(sessionId, "ENGAGE")) throw new Error("Could not engage ROOK P2 match");
  await delay(1500);
  const p2Match = await inspectMatch(sessionId);
  if (!matchPass(p2Match, "KAIRO", "ROOK")) {
    throw new Error(`Selectable ROOK P2 WebGL runtime failed: ${JSON.stringify(p2Match)}`);
  }
  await screenshot(sessionId, `${outputDir}/rook-playable-p2-iphone.png`);

  await writeFile(
    `${outputDir}/rook-playable.json`,
    `${JSON.stringify({ loadout, selected, p1Match, p2Match }, null, 2)}\n`,
  );
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
