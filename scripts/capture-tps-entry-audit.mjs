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

async function navigateHome(sessionId) {
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(500);
  const viewport = await resizeToCssViewport(sessionId, 932, 430);
  if (Math.abs(viewport.innerWidth - 932) > 2 || Math.abs(viewport.innerHeight - 430) > 2) {
    throw new Error(`Could not establish iPhone landscape viewport: ${JSON.stringify(viewport)}`);
  }
}

const withinViewport = (rect, width, height) => rect
  && rect.left >= -1
  && rect.top >= -1
  && rect.right <= width + 1
  && rect.bottom <= height + 1
  && rect.width > 1
  && rect.height > 1;

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
  await navigateHome(sessionId);
  await mkdir(outputDir, { recursive: true });

  const title = await execute(sessionId, `
    const labels = [...document.querySelectorAll('button')].map((entry) => entry.textContent ?? '');
    const rectFor = (text) => {
      const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.includes(text));
      const rect = button?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      rivalCircuit: labels.some((label) => label.includes('RIVAL CIRCUIT')),
      startFight: labels.some((label) => label.includes('START FIGHT')),
      settings: labels.some((label) => label.includes('SETTINGS')),
      legacyStartMatch: labels.some((label) => label.includes('START MATCH')),
      legacyTpsMode: labels.some((label) => label.includes('TPS LOCK-ON BATTLE')),
      rivalRect: rectFor('RIVAL CIRCUIT'),
      startRect: rectFor('START FIGHT'),
      settingsRect: rectFor('SETTINGS'),
    };
  `);
  if (
    !title.rivalCircuit
    || !title.startFight
    || !title.settings
    || title.legacyStartMatch
    || title.legacyTpsMode
    || title.scrollWidth > title.width + 2
    || title.scrollHeight > title.height + 2
    || !withinViewport(title.rivalRect, title.width, title.height)
    || !withinViewport(title.startRect, title.width, title.height)
    || !withinViewport(title.settingsRect, title.width, title.height)
  ) {
    throw new Error(`TPS iPhone title layout failed: ${JSON.stringify(title)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-title-iphone.png`);

  const circuitClicked = await clickButton(sessionId, "RIVAL CIRCUIT");
  if (!circuitClicked.clicked) throw new Error(`RIVAL CIRCUIT could not open loadout: ${JSON.stringify(circuitClicked)}`);
  await delay(220);
  const circuitLoadout = await execute(sessionId, `
    const visibleRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const buttons = [...document.querySelectorAll('button')];
    const enter = buttons.find((entry) => entry.textContent?.includes('ENTER CIRCUIT'));
    const back = buttons.find((entry) => entry.textContent?.includes('TITLE'));
    const cards = [...document.querySelectorAll('.fighter-card')].map(visibleRect);
    const visualModel = [...document.querySelectorAll('.difficulty span')].find((entry) => entry.textContent?.includes('VISUAL MODEL'));
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      heading: document.body.innerText.includes('RIVAL CIRCUIT LOADOUT'),
      stageOne: document.body.innerText.includes('STAGE 1/5'),
      glassline: document.body.innerText.includes('GLASSLINE'),
      pressure: document.body.innerText.includes('PRESSURE'),
      enter: visibleRect(enter),
      back: visibleRect(back),
      visualModel: visibleRect(visualModel),
      cards,
    };
  `);
  const circuitPass = circuitLoadout.heading
    && circuitLoadout.stageOne
    && circuitLoadout.glassline
    && circuitLoadout.pressure
    && circuitLoadout.scrollWidth <= circuitLoadout.width + 2
    && withinViewport(circuitLoadout.enter, circuitLoadout.width, circuitLoadout.height)
    && withinViewport(circuitLoadout.back, circuitLoadout.width, circuitLoadout.height)
    && withinViewport(circuitLoadout.visualModel, circuitLoadout.width, circuitLoadout.height)
    && circuitLoadout.cards.length === 3
    && circuitLoadout.cards.every((rect) => withinViewport(rect, circuitLoadout.width, circuitLoadout.height));
  if (!circuitPass) throw new Error(`Rival Circuit iPhone loadout failed: ${JSON.stringify(circuitLoadout)}`);
  await screenshot(sessionId, `${outputDir}/rival-circuit-loadout-iphone.png`);

  // Seed a later-run CLEAN LINE reward through the exact protocol-card click
  // contract. The live match below then proves the gameplay runtime carries the
  // installed protocol into a new TpsFightGame instance and actually fires it.
  const protocolSeeded = await execute(sessionId, `
    const fake = document.createElement('button');
    fake.type = 'button';
    fake.className = 'protocol-card';
    fake.textContent = 'TEMPO ROUTE CLEAN LINE';
    document.body.appendChild(fake);
    fake.click();
    fake.remove();
    return true;
  `);
  if (!protocolSeeded) throw new Error('Could not seed CLEAN LINE protocol for runtime audit');

  const circuitEnter = await clickButton(sessionId, "ENTER CIRCUIT");
  if (!circuitEnter.clicked) throw new Error(`ENTER CIRCUIT could not start stage one: ${JSON.stringify(circuitEnter)}`);
  await delay(650);
  await execute(sessionId, `
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    return true;
  `);
  await delay(360);
  await execute(sessionId, `
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    return true;
  `);
  await delay(3300);

  const circuitMatch = await execute(sessionId, `
    const buttons = [...document.querySelectorAll('button')];
    const actionRect = (ariaLabel) => {
      const button = buttons.find((entry) => entry.getAttribute('aria-label') === ariaLabel);
      const rect = button?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    const strip = document.querySelector('.circuit-run-strip');
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      canvas: Boolean(document.querySelector('.scene-host.visible canvas')),
      strip: strip?.textContent ?? '',
      attack: actionRect('Attack'),
      step: actionRect('Step'),
      aiPolicy: document.body.dataset.rivalCircuitAiPolicy ?? '',
      aiStyle: document.body.dataset.rivalCircuitAiStyle ?? '',
      aiPhase: document.body.dataset.rivalCircuitAiPhase ?? '',
      aiTactic: document.body.dataset.rivalCircuitAiTactic ?? '',
      signatures: Number(document.body.dataset.rivalCircuitAiSignatures ?? '0'),
      aiMemoryRead: document.body.dataset.rivalCircuitAiMemoryRead ?? '',
      memoryPolicy: document.body.dataset.rivalCircuitMemoryPolicy ?? '',
      memoryRead: document.body.dataset.rivalCircuitMemoryRead ?? '',
      memoryFights: Number(document.body.dataset.rivalCircuitMemoryFights ?? '-1'),
      arenaStage: document.body.dataset.rivalCircuitArenaStage ?? '',
      arenaId: document.body.dataset.rivalCircuitArenaId ?? '',
      arenaLabel: document.body.dataset.rivalCircuitArenaLabel ?? '',
      protocols: document.body.dataset.rivalCircuitProtocols ?? '',
      protocolCount: Number(document.body.dataset.rivalCircuitProtocolCount ?? '0'),
      cleanActivations: Number(document.body.dataset.rivalCircuitProtocolCleanActivations ?? '0'),
      fallback: document.body.innerText.includes('3D描画を開始できませんでした') || document.body.innerText.includes('描画中にエラーが発生しました'),
    };
  `);
  const circuitMatchPass = circuitMatch.canvas
    && circuitMatch.strip.includes('GLASSLINE')
    && circuitMatch.strip.includes('PRESSURE')
    && circuitMatch.aiPolicy === 'RIVAL_CIRCUIT_V1'
    && circuitMatch.aiStyle === 'PRESSURE'
    && circuitMatch.aiPhase === 'PRESSURE'
    && circuitMatch.aiTactic === 'PRESSURE'
    && circuitMatch.signatures >= 1
    && circuitMatch.memoryPolicy === 'RIVAL_MEMORY_V1'
    && circuitMatch.memoryRead === 'NONE'
    && circuitMatch.memoryFights === 0
    && circuitMatch.aiMemoryRead === 'NONE'
    && circuitMatch.arenaStage === '1'
    && circuitMatch.arenaId === 'GLASSLINE'
    && circuitMatch.arenaLabel.includes('GLASSLINE')
    && circuitMatch.protocols.includes('CLEAN_LINE')
    && circuitMatch.protocolCount === 1
    && circuitMatch.cleanActivations >= 1
    && !circuitMatch.fallback
    && withinViewport(circuitMatch.attack, circuitMatch.width, circuitMatch.height)
    && withinViewport(circuitMatch.step, circuitMatch.width, circuitMatch.height);
  if (!circuitMatchPass) throw new Error(`Rival Circuit runtime audit failed: ${JSON.stringify(circuitMatch)}`);
  await screenshot(sessionId, `${outputDir}/rival-circuit-pressure-match-iphone.png`);

  await navigateHome(sessionId);
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
  const loadoutPass = loadout.tpsLoadout
    && loadout.scrollWidth <= loadout.width + 2
    && loadout.scrollHeight <= loadout.height + 2
    && withinViewport(loadout.engage, loadout.width, loadout.height)
    && withinViewport(loadout.back, loadout.width, loadout.height)
    && withinViewport(loadout.cpuDifficulty, loadout.width, loadout.height)
    && withinViewport(loadout.visualModel, loadout.width, loadout.height)
    && loadout.cards.length === 6
    && loadout.cards.every((rect) => withinViewport(rect, loadout.width, loadout.height));
  if (!loadoutPass) throw new Error(`TPS iPhone loadout layout failed: ${JSON.stringify(loadout)}`);
  await screenshot(sessionId, `${outputDir}/tps-loadout-iphone.png`);
  await writeFile(`${outputDir}/tps-entry-layout.json`, `${JSON.stringify({ title, circuitLoadout, circuitMatch, loadout }, null, 2)}\n`);
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
