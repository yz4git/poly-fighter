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

async function waitForMotionViewer(sessionId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await execute(sessionId, `
      const viewer = document.querySelector('[aria-label="Motion Viewer"]');
      const select = viewer?.querySelector('select[aria-label="Motion clip"]');
      const timeline = viewer?.querySelector('input[aria-label="Motion timeline"]');
      const options = select ? [...select.options].map((option) => ({ value: option.value, label: option.textContent })) : [];
      return {
        viewer: Boolean(viewer),
        select: Boolean(select),
        timeline: Boolean(timeline),
        timelineDisabled: timeline?.disabled ?? true,
        clip: select?.value ?? '',
        hasBlenderPower: options.some((option) => option.value === 'BF_Power_R'),
        hasProceduralPower: options.some((option) => option.value === 'PF_Power_R'),
        hasBlenderCross: options.some((option) => option.value === 'BF_Cross_R'),
        hasProceduralCross: options.some((option) => option.value === 'PF_Cross_R'),
        hasBlenderJab: options.some((option) => option.value === 'BF_Jab_L'),
        hasProceduralJab: options.some((option) => option.value === 'PF_Jab_L'),
        hasBlenderBodyBlow: options.some((option) => option.value === 'BF_BodyBlow_L'),
        hasProceduralBodyBlow: options.some((option) => option.value === 'PF_BodyBlow_L'),
        hasBlenderBackfist: options.some((option) => option.value === 'BF_Backfist_R'),
        hasProceduralBackfist: options.some((option) => option.value === 'PF_Backfist_R'),
        hasBlenderFrontKick: options.some((option) => option.value === 'BF_FrontKick_R'),
        hasProceduralFrontKick: options.some((option) => option.value === 'PF_FrontKick_R'),
        hasBlenderLowKick: options.some((option) => option.value === 'BF_LowKick_L'),
        hasProceduralLowKick: options.some((option) => option.value === 'PF_LowKick_L'),
        hasBlenderRisingKick: options.some((option) => option.value === 'BF_RisingKick_R'),
        hasProceduralRisingKick: options.some((option) => option.value === 'PF_RisingKick_R'),
        hasBlenderDashKick: options.some((option) => option.value === 'BF_DashKick_R'),
        hasProceduralDashKick: options.some((option) => option.value === 'PF_DashKick_R'),
        hasBlenderHitHeavy: options.some((option) => option.value === 'BF_HitHeavy'),
        hasProceduralHitHeavy: options.some((option) => option.value === 'PF_HitHeavy'),
        hasBlenderGuardBreak: options.some((option) => option.value === 'BF_GuardBreak'),
        hasProceduralGuardBreak: options.some((option) => option.value === 'PF_GuardBreak'),
        hasBlenderHitLightL: options.some((option) => option.value === 'BF_HitLight_L'),
        hasBlenderHitLightR: options.some((option) => option.value === 'BF_HitLight_R'),
        hasBlenderHitMidL: options.some((option) => option.value === 'BF_HitMid_L'),
        hasBlenderHitMidR: options.some((option) => option.value === 'BF_HitMid_R'),
        hasBlenderCounterHitL: options.some((option) => option.value === 'BF_CounterHit_L'),
        hasBlenderCounterHitR: options.some((option) => option.value === 'BF_CounterHit_R'),
        hasBlenderEdgeStagger: options.some((option) => option.value === 'BF_EdgeStagger'),
        optionCount: options.length,
        options: options.slice(0, 80),
      };
    `);
    if (state?.viewer && state?.select && state?.timeline && !state?.timelineDisabled && state?.hasBlenderPower && state?.hasProceduralPower && state?.hasBlenderCross && state?.hasProceduralCross && state?.hasBlenderJab && state?.hasProceduralJab && state?.hasBlenderBodyBlow && state?.hasProceduralBodyBlow && state?.hasBlenderBackfist && state?.hasProceduralBackfist && state?.hasBlenderFrontKick && state?.hasProceduralFrontKick && state?.hasBlenderLowKick && state?.hasProceduralLowKick && state?.hasBlenderRisingKick && state?.hasProceduralRisingKick && state?.hasBlenderDashKick && state?.hasProceduralDashKick && state?.hasBlenderHitHeavy && state?.hasProceduralHitHeavy && state?.hasBlenderGuardBreak && state?.hasProceduralGuardBreak && state?.hasBlenderHitLightL && state?.hasBlenderHitLightR && state?.hasBlenderHitMidL && state?.hasBlenderHitMidR && state?.hasBlenderCounterHitL && state?.hasBlenderCounterHitR && state?.hasBlenderEdgeStagger) return state;
    await delay(100);
  }
  throw new Error("MODEL VIEW Motion Viewer did not become ready");
}

async function poseMotionViewer(sessionId, clipName, normalized) {
  const selected = await execute(sessionId, `
    const clipName = arguments[0];
    const select = document.querySelector('select[aria-label="Motion clip"]');
    if (!select || ![...select.options].some((option) => option.value === clipName)) return { selected: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!setter) return { selected: false, reason: 'select setter unavailable' };
    setter.call(select, clipName);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: true, clip: select.value };
  `, [clipName]);
  if (!selected?.selected) throw new Error(`Motion clip was not selectable: ${clipName} ${JSON.stringify(selected)}`);
  await delay(120);

  const posed = await execute(sessionId, `
    const pause = [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Pause motion');
    pause?.click();
    const timeline = document.querySelector('input[aria-label="Motion timeline"]');
    if (!timeline) return { posed: false, reason: 'timeline unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return { posed: false, reason: 'input setter unavailable' };
    setter.call(timeline, String(Math.round(arguments[0] * 1000)));
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
    timeline.dispatchEvent(new Event('change', { bubbles: true }));
    return { posed: true, value: timeline.value };
  `, [normalized]);
  if (!posed?.posed) throw new Error(`Motion timeline was not controllable: ${JSON.stringify(posed)}`);
  await delay(120);

  return execute(sessionId, `
    const select = document.querySelector('select[aria-label="Motion clip"]');
    const timeline = document.querySelector('input[aria-label="Motion timeline"]');
    const play = [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Play motion');
    const timeText = document.querySelector('[aria-label="Motion Viewer"]')?.textContent ?? '';
    return {
      clip: select?.value ?? '',
      timeline: Number(timeline?.value ?? -1),
      paused: Boolean(play),
      motionViewerText: timeText.slice(0, 500),
    };
  `);
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
  const motionReady = await waitForMotionViewer(sessionId);
  await screenshot(sessionId, `${outputDir}/model-view-sera.png`);
  const proceduralPower = await poseMotionViewer(sessionId, "PF_Power_R", 0.5);
  if (proceduralPower.clip !== "PF_Power_R" || Math.abs(proceduralPower.timeline - 500) > 2 || !proceduralPower.paused) {
    throw new Error(`Motion Viewer did not hold PF_Power_R at 50%: ${JSON.stringify(proceduralPower)}`);
  }
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-power.png`);

  const blenderPower = await poseMotionViewer(sessionId, "BF_Power_R", 0.5);
  if (blenderPower.clip !== "BF_Power_R" || Math.abs(blenderPower.timeline - 500) > 2 || !blenderPower.paused) {
    throw new Error(`Motion Viewer did not hold BF_Power_R at 50%: ${JSON.stringify(blenderPower)}`);
  }
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-power.png`);

  const proceduralCross = await poseMotionViewer(sessionId, "PF_Cross_R", 0.5);
  if (proceduralCross.clip !== "PF_Cross_R" || Math.abs(proceduralCross.timeline - 500) > 2 || !proceduralCross.paused) {
    throw new Error(`Motion Viewer did not hold PF_Cross_R at 50%: ${JSON.stringify(proceduralCross)}`);
  }
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-cross.png`);

  const blenderCross = await poseMotionViewer(sessionId, "BF_Cross_R", 0.5);
  if (blenderCross.clip !== "BF_Cross_R" || Math.abs(blenderCross.timeline - 500) > 2 || !blenderCross.paused) {
    throw new Error(`Motion Viewer did not hold BF_Cross_R at 50%: ${JSON.stringify(blenderCross)}`);
  }
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-cross.png`);

  const proceduralJab = await poseMotionViewer(sessionId, "PF_Jab_L", 0.5);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-jab.png`);
  const blenderJab = await poseMotionViewer(sessionId, "BF_Jab_L", 0.5);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-jab.png`);

  const proceduralBodyBlow = await poseMotionViewer(sessionId, "PF_BodyBlow_L", 0.5);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-body-blow.png`);
  const blenderBodyBlow = await poseMotionViewer(sessionId, "BF_BodyBlow_L", 0.5);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-body-blow.png`);

  const proceduralBackfist = await poseMotionViewer(sessionId, "PF_Backfist_R", 0.5);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-backfist.png`);
  const blenderBackfist = await poseMotionViewer(sessionId, "BF_Backfist_R", 0.5);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-backfist.png`);

  const proceduralFrontKick = await poseMotionViewer(sessionId, "PF_FrontKick_R", 0.55);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-front-kick.png`);
  const blenderFrontKick = await poseMotionViewer(sessionId, "BF_FrontKick_R", 0.55);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-front-kick.png`);

  const proceduralLowKick = await poseMotionViewer(sessionId, "PF_LowKick_L", 0.55);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-low-kick.png`);
  const blenderLowKick = await poseMotionViewer(sessionId, "BF_LowKick_L", 0.55);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-low-kick.png`);

  const proceduralRisingKick = await poseMotionViewer(sessionId, "PF_RisingKick_R", 0.55);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-rising-kick.png`);
  const blenderRisingKick = await poseMotionViewer(sessionId, "BF_RisingKick_R", 0.55);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-rising-kick.png`);

  const proceduralDashKick = await poseMotionViewer(sessionId, "PF_DashKick_R", 0.52);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-dash-kick.png`);
  const blenderDashKick = await poseMotionViewer(sessionId, "BF_DashKick_R", 0.52);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-dash-kick.png`);

  const proceduralHitHeavy = await poseMotionViewer(sessionId, "PF_HitHeavy", 0.34);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-hit-heavy.png`);
  const blenderHitHeavy = await poseMotionViewer(sessionId, "BF_HitHeavy", 0.34);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-heavy.png`);

  const proceduralGuardBreak = await poseMotionViewer(sessionId, "PF_GuardBreak", 0.34);
  await screenshot(sessionId, `${outputDir}/model-view-motion-procedural-guard-break.png`);
  const blenderGuardBreak = await poseMotionViewer(sessionId, "BF_GuardBreak", 0.34);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-guard-break.png`);

  await poseMotionViewer(sessionId, "BF_HitLight_L", 0.30);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-light-left.png`);
  await poseMotionViewer(sessionId, "BF_HitLight_R", 0.30);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-light-right.png`);
  await poseMotionViewer(sessionId, "BF_HitMid_L", 0.30);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-mid-left.png`);
  await poseMotionViewer(sessionId, "BF_HitMid_R", 0.30);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-hit-mid-right.png`);
  await poseMotionViewer(sessionId, "BF_CounterHit_L", 0.24);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-counter-hit-left.png`);
  await poseMotionViewer(sessionId, "BF_CounterHit_R", 0.24);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-counter-hit-right.png`);
  await poseMotionViewer(sessionId, "BF_EdgeStagger", 0.30);
  await screenshot(sessionId, `${outputDir}/model-view-motion-blender-edge-stagger.png`);

  const kairoClick = await clickButton(sessionId, "KAIRO");
  if (!kairoClick?.clicked) throw new Error(`KAIRO Model View selector not found: ${JSON.stringify(kairoClick)}`);
  const kairo = await waitForModelView(sessionId, "KAIRO");
  await delay(250);
  const kairoMotionReady = await waitForMotionViewer(sessionId);
  await screenshot(sessionId, `${outputDir}/model-view-kairo.png`);

  const reset = await clickButton(sessionId, "RESET VIEW");
  if (!reset?.clicked) throw new Error(`RESET VIEW button not found: ${JSON.stringify(reset)}`);
  const back = await clickButton(sessionId, "TITLE");
  if (!back?.clicked) throw new Error(`TITLE button not found from Model View: ${JSON.stringify(back)}`);
  await delay(150);
  const titleState = await execute(sessionId, `return { title: document.body.innerText.includes('START MATCH'), modelView: document.body.innerText.includes('CHARACTER LAB') };`);
  if (!titleState?.title || titleState?.modelView) throw new Error(`MODEL VIEW did not return cleanly to title: ${JSON.stringify(titleState)}`);

  await writeFile(`${outputDir}/model-view-state.json`, JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, proceduralJab, blenderJab, proceduralBodyBlow, blenderBodyBlow, proceduralBackfist, blenderBackfist, proceduralFrontKick, blenderFrontKick, proceduralLowKick, blenderLowKick, proceduralRisingKick, blenderRisingKick, proceduralDashKick, blenderDashKick, proceduralHitHeavy, blenderHitHeavy, proceduralGuardBreak, blenderGuardBreak, kairo, kairoMotionReady, titleState }, null, 2));
  await writeFile(`${outputDir}/model-view-webdriver.log`, driverLog);
  console.log(JSON.stringify({ sera, seraAfterLoad, motionReady, proceduralPower, blenderPower, proceduralCross, blenderCross, proceduralJab, blenderJab, proceduralBodyBlow, blenderBodyBlow, proceduralBackfist, blenderBackfist, proceduralHitHeavy, blenderHitHeavy, proceduralGuardBreak, blenderGuardBreak, kairo, kairoMotionReady, titleState }));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  try {
    if (!driverProcess.killed) driverProcess.kill("SIGTERM");
  } catch {
    // ChromeDriver may already have exited.
  }
}
