import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.KICK_FRAME_AUDIT_DIR ?? "artifacts/kick-frame-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9518;
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
    if (!button) return { clicked: false, buttons: [...document.querySelectorAll('button')].map((entry) => entry.textContent) };
    button.click();
    return { clicked: true, label: button.textContent };
  `, [text]);
}

async function waitForViewer(sessionId, fighter) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await execute(sessionId, `
      const fighter = arguments[0];
      const panel = document.querySelector('section[aria-label="Model View"]');
      const canvas = panel?.querySelector('canvas');
      const viewer = document.querySelector('[aria-label="Motion Viewer"]');
      const select = viewer?.querySelector('select[aria-label="Motion clip"]');
      const timeline = viewer?.querySelector('input[aria-label="Motion timeline"]');
      const options = select ? [...select.options].map((option) => option.value) : [];
      return {
        panel: Boolean(panel), canvas: Boolean(canvas), viewer: Boolean(viewer), select: Boolean(select), timeline: Boolean(timeline),
        timelineDisabled: timeline?.disabled ?? true,
        fighterVisible: (panel?.textContent ?? '').includes(fighter),
        front: options.includes('BF_FrontKick_R'), low: options.includes('BF_LowKick_L'), rising: options.includes('BF_RisingKick_R'),
      };
    `, [fighter]);
    if (state?.panel && state?.canvas && state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.fighterVisible && state?.front && state?.low && state?.rising) return state;
    await delay(100);
  }
  throw new Error(`Kick frame viewer did not become ready for ${fighter}`);
}

async function selectClip(sessionId, clipName) {
  const selected = await execute(sessionId, `
    const clipName = arguments[0];
    const select = document.querySelector('select[aria-label="Motion clip"]');
    if (!select || ![...select.options].some((option) => option.value === clipName)) return { selected: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter.call(select, clipName);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const pause = [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Pause motion');
    pause?.click();
    return { selected: true, clip: select.value };
  `, [clipName]);
  if (!selected?.selected) throw new Error(`Motion clip was not selectable: ${clipName}`);
  await delay(140);
}

async function poseFrame(sessionId, normalized) {
  const value = Math.round(normalized * 1000);
  const state = await execute(sessionId, `
    const value = arguments[0];
    const timeline = document.querySelector('input[aria-label="Motion timeline"]');
    if (!timeline) return { posed: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter.call(timeline, String(value));
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
    timeline.dispatchEvent(new Event('change', { bubbles: true }));
    return { posed: true, value: Number(timeline.value) };
  `, [value]);
  if (!state?.posed || Math.abs(state.value - value) > 2) throw new Error(`Timeline failed at ${value}: ${JSON.stringify(state)}`);
  await delay(45);
  return state;
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`Screenshot is not PNG: ${path}`);
  await writeFile(path, bytes);
}

const clips = [
  { clip: "BF_FrontKick_R", slug: "front", start: 1, end: 43, impact: 24 },
  { clip: "BF_LowKick_L", slug: "low", start: 1, end: 46, impact: 25 },
  { clip: "BF_RisingKick_R", slug: "rising", start: 1, end: 49, impact: 28 },
];

let sessionId = null;
const manifest = { version: "KICK_FRAME_AUDIT_V1", fps: 60, fighter: "KAIRO", clips: [] };
try {
  await waitForDriver();
  const session = await command("/session", "POST", {
    capabilities: { alwaysMatch: { browserName: "chrome", "goog:chromeOptions": { args: [
      "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=swiftshader", "--window-size=1536,706", "--hide-scrollbars",
    ] } } },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(650);
  const open = await clickButton(sessionId, "MODEL VIEW");
  if (!open?.clicked) throw new Error(`MODEL VIEW title button not found: ${JSON.stringify(open)}`);
  await waitForViewer(sessionId, "SERA");
  const kairoClick = await clickButton(sessionId, "KAIRO");
  if (!kairoClick?.clicked) throw new Error(`KAIRO selector not found: ${JSON.stringify(kairoClick)}`);
  await waitForViewer(sessionId, "KAIRO");
  await mkdir(outputDir, { recursive: true });

  for (const spec of clips) {
    const clipDir = `${outputDir}/${spec.slug}`;
    await mkdir(clipDir, { recursive: true });
    await selectClip(sessionId, spec.clip);
    const frames = [];
    for (let frame = spec.start; frame <= spec.end; frame += 1) {
      const normalized = (frame - spec.start) / (spec.end - spec.start);
      const timeline = await poseFrame(sessionId, normalized);
      const filename = `${spec.slug}-f${String(frame).padStart(3, "0")}.png`;
      await screenshot(sessionId, `${clipDir}/${filename}`);
      frames.push({ frame, normalized, timeline: timeline.value, filename, isImpact: frame === spec.impact });
    }
    manifest.clips.push({ ...spec, frameCount: spec.end - spec.start + 1, frames });
  }

  await writeFile(`${outputDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  await writeFile(`${outputDir}/webdriver.log`, driverLog);
  console.log(JSON.stringify({ fighter: manifest.fighter, clips: manifest.clips.map(({ clip, frameCount, impact }) => ({ clip, frameCount, impact })) }));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  try { if (!driverProcess.killed) driverProcess.kill("SIGTERM"); } catch {}
}
