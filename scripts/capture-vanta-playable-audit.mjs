import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/vanta-webgl-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9533;
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
    throw new Error(`Roster playable audit screenshot is not PNG: ${path}`);
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

async function openLoadout(sessionId) {
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(600);
  await resizeToCssViewport(sessionId, 932, 430);
  if (!await clickByText(sessionId, "START FIGHT")) throw new Error("Could not open TPS loadout");
  await delay(300);
}

async function inspectLoadout(sessionId) {
  return execute(sessionId, `
    const p1Cards = [...document.querySelectorAll('[data-fighter-slot="P1"]')];
    const p2Cards = [...document.querySelectorAll('[data-fighter-slot="P2"]')];
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      p1Count: p1Cards.length,
      p2Count: p2Cards.length,
      p1Names: p1Cards.map((entry) => entry.querySelector('strong')?.textContent ?? ''),
      p2Names: p2Cards.map((entry) => entry.querySelector('strong')?.textContent ?? ''),
      p1Vanta: Boolean(document.querySelector('[data-fighter-slot="P1"][data-fighter-id="violet"]')),
      p2Vanta: Boolean(document.querySelector('[data-fighter-slot="P2"][data-fighter-id="violet"]')),
      p1Bront: Boolean(document.querySelector('[data-fighter-slot="P1"][data-fighter-id="amber"]')),
      p2Bront: Boolean(document.querySelector('[data-fighter-slot="P2"][data-fighter-id="amber"]')),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  `);
}

async function inspectMatch(sessionId) {
  return execute(sessionId, `
    const actions = [...document.querySelectorAll('.tps-two-button-actions .touch-action')];
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      canvas: Boolean(document.querySelector('.scene-host.visible canvas')),
      p1Name: document.querySelector('.left-player .hud-name strong')?.textContent ?? '',
      p2Name: document.querySelector('.right-player .hud-name strong')?.textContent ?? '',
      actionCount: actions.length,
      actionLabels: actions.map((entry) => entry.getAttribute('aria-label')),
      vantaVisual: document.body.dataset.vantaFighterVisual ?? '',
      vantaName: document.body.dataset.vantaFighterName ?? '',
      vantaOrbiters: Number(document.body.dataset.vantaFighterOrbiters ?? '0'),
      brontVisual: document.body.dataset.brontFighterVisual ?? '',
      brontName: document.body.dataset.brontFighterName ?? '',
      brontPlates: Number(document.body.dataset.brontFighterPlates ?? '0'),
      brontPalette: document.body.dataset.brontFighterPalette ?? '',
      fallback: document.body.innerText.includes('3D描画を開始できませんでした') || document.body.innerText.includes('描画中にエラーが発生しました'),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  `);
}

function commonMatchPass(state) {
  return state.canvas
    && state.actionCount === 2
    && state.actionLabels.includes("Attack")
    && state.actionLabels.includes("Step")
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
  const names = "KAIRO|SERA|VANTA|BRONT";
  if (
    loadout.width !== 932 || loadout.height !== 430
    || loadout.p1Count !== 4 || loadout.p2Count !== 4
    || loadout.p1Names.join('|') !== names || loadout.p2Names.join('|') !== names
    || !loadout.p1Vanta || !loadout.p2Vanta || !loadout.p1Bront || !loadout.p2Bront
    || loadout.horizontalOverflow || loadout.verticalOverflow
  ) throw new Error(`Four-fighter TPS loadout failed: ${JSON.stringify(loadout)}`);

  if (!await clickSelector(sessionId, '[data-fighter-slot="P1"][data-fighter-id="violet"]')) throw new Error("Could not select VANTA for P1");
  const selectedVanta = await execute(sessionId, `
    const card = document.querySelector('[data-fighter-slot="P1"][data-fighter-id="violet"]');
    return { selected: card?.classList.contains('selected-violet') ?? false };
  `);
  if (!selectedVanta.selected) throw new Error("VANTA P1 selection did not commit");
  await screenshot(sessionId, `${outputDir}/vanta-playable-loadout-iphone.png`);
  if (!await clickByText(sessionId, "ENGAGE")) throw new Error("Could not engage VANTA P1 match");
  await delay(1500);
  const vantaP1 = await inspectMatch(sessionId);
  if (!(commonMatchPass(vantaP1) && vantaP1.p1Name === "VANTA" && vantaP1.p2Name === "SERA" && vantaP1.vantaVisual === "VANTA_V2" && vantaP1.vantaName === "VANTA" && vantaP1.vantaOrbiters === 3)) {
    throw new Error(`Playable VANTA P1 WebGL runtime failed: ${JSON.stringify(vantaP1)}`);
  }
  await screenshot(sessionId, `${outputDir}/vanta-playable-p1-iphone.png`);

  await openLoadout(sessionId);
  if (!await clickSelector(sessionId, '[data-fighter-slot="P2"][data-fighter-id="violet"]')) throw new Error("Could not select VANTA for P2");
  if (!await clickByText(sessionId, "ENGAGE")) throw new Error("Could not engage VANTA P2 match");
  await delay(1500);
  const vantaP2 = await inspectMatch(sessionId);
  if (!(commonMatchPass(vantaP2) && vantaP2.p1Name === "KAIRO" && vantaP2.p2Name === "VANTA" && vantaP2.vantaVisual === "VANTA_V2" && vantaP2.vantaName === "VANTA" && vantaP2.vantaOrbiters === 3)) {
    throw new Error(`Selectable VANTA P2 WebGL runtime failed: ${JSON.stringify(vantaP2)}`);
  }
  await screenshot(sessionId, `${outputDir}/vanta-playable-p2-iphone.png`);

  await openLoadout(sessionId);
  if (!await clickSelector(sessionId, '[data-fighter-slot="P1"][data-fighter-id="amber"]')) throw new Error("Could not select BRONT for P1");
  const selectedBront = await execute(sessionId, `
    const card = document.querySelector('[data-fighter-slot="P1"][data-fighter-id="amber"]');
    return { selected: card?.classList.contains('selected-amber') ?? false };
  `);
  if (!selectedBront.selected) throw new Error("BRONT P1 selection did not commit");
  await screenshot(sessionId, `${outputDir}/bront-playable-loadout-iphone.png`);
  if (!await clickByText(sessionId, "ENGAGE")) throw new Error("Could not engage BRONT P1 match");
  await delay(1500);
  const brontP1 = await inspectMatch(sessionId);
  if (!(commonMatchPass(brontP1) && brontP1.p1Name === "BRONT" && brontP1.p2Name === "SERA" && brontP1.brontVisual === "BRONT_V1" && brontP1.brontName === "BRONT" && brontP1.brontPlates >= 6 && brontP1.brontPalette === "AMBER_BLACK_STEEL")) {
    throw new Error(`Playable BRONT P1 WebGL runtime failed: ${JSON.stringify(brontP1)}`);
  }
  await screenshot(sessionId, `${outputDir}/bront-playable-p1-iphone.png`);

  await openLoadout(sessionId);
  if (!await clickSelector(sessionId, '[data-fighter-slot="P2"][data-fighter-id="amber"]')) throw new Error("Could not select BRONT for P2");
  if (!await clickByText(sessionId, "ENGAGE")) throw new Error("Could not engage BRONT P2 match");
  await delay(1500);
  const brontP2 = await inspectMatch(sessionId);
  if (!(commonMatchPass(brontP2) && brontP2.p1Name === "KAIRO" && brontP2.p2Name === "BRONT" && brontP2.brontVisual === "BRONT_V1" && brontP2.brontName === "BRONT" && brontP2.brontPlates >= 6 && brontP2.brontPalette === "AMBER_BLACK_STEEL")) {
    throw new Error(`Selectable BRONT P2 WebGL runtime failed: ${JSON.stringify(brontP2)}`);
  }
  await screenshot(sessionId, `${outputDir}/bront-playable-p2-iphone.png`);

  await writeFile(`${outputDir}/vanta-playable.json`, `${JSON.stringify({ loadout, selectedVanta, vantaP1, vantaP2, selectedBront, brontP1, brontP2 }, null, 2)}\n`);
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
