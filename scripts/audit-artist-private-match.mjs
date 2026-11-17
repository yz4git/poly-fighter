// Test the actual private import -> real TPS fight, not just Model View.
// Existing bundled SERA V2 is only an unapproved fixture; it is NOT new art.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const driverPath = process.env.WEBDRIVER_BIN;
if (!driverPath) throw new Error("WEBDRIVER_BIN required");
const url = process.env.PREVIEW_URL ?? "http://127.0.0.1:3000/";
const output = process.env.ARTIST_PRIVATE_AUDIT_DIR ?? "artifacts/artist-private-combat";
const glbPath = path.resolve("public/models/hero/sera-hero-pbr.glb");
const port = 9579;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const chromedriver = spawn(driverPath, ["--port=" + port, "--allowed-ips="], { stdio: "ignore" });
let session = null;

async function request(route, method = "GET", body) {
  const response = await fetch("http://127.0.0.1:" + port + route, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.value?.error) throw new Error(method + " " + route + ": " + JSON.stringify(data));
  return data.value;
}
const run = (script, args = []) => request("/session/" + session + "/execute/sync", "POST", { script, args });
const click = async label => run(
  "const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes(arguments[0]));"
  + "if(!b || b.disabled)return false;b.click();return true;", [label]);
const lookup = `
function findGame() {
  const host = document.querySelector('main.poly-app');
  const key = host && Object.keys(host).find(k => k.startsWith('__reactFiber$'));
  let fiber = key ? host[key] : null;
  const seen = new Set();
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    let hook = fiber.memoizedState;
    while (hook) {
      const value = hook.memoizedState;
      const current = value && typeof value === 'object' && 'current' in value ? value.current : null;
      if (current && current.p1 && current.p2 && current.renderer && current.scene && current.camera) return current;
      hook = hook.next;
    }
    fiber = fiber.return;
  }
  return null;
}
`;
const snapshot = () => run(`${lookup}
  const game = findGame();
  const panel = document.querySelector('aside[data-artist-combat-qa]');
  const root = game?.p1?.visual?.root;
  const cpu = game?.p2?.visual?.root;
  const hero = root?.children?.find(o => o.name === 'sera-artist-local-test-runtime');
  const driver = root?.children?.find(o => o.name?.startsWith('quaternius-ubc-') && o.name?.endsWith('-runtime'));
  return {
    panel: !!panel,
    panelState: panel?.dataset.artistCombatState ?? null,
    player: game?.p1?.definition?.name ?? game?.p1?.name ?? null,
    opponent: game?.p2?.definition?.name ?? game?.p2?.name ?? null,
    p1Model: root?.userData?.modelSkin ?? null,
    p2Model: cpu?.userData?.modelSkin ?? null,
    heroState: root?.userData?.heroModelState ?? null,
    heroVisible: hero?.visible === true,
    driverPresent: !!driver,
    mappedBones: root?.userData?.heroModelMappedBones ?? 0,
    triangles: root?.userData?.heroPbrTriangleCount ?? 0,
    texturedMaterials: root?.userData?.heroPbrTextureMaterials ?? 0,
    heroError: root?.userData?.heroModelError ?? null,
    p1Move: game?.p1?.currentMove?.id ?? null,
    p1State: game?.p1?.state ?? null,
    inputPunch: game?.input?.frame?.()?.punch ?? false,
    p1X: game?.p1?.position?.x ?? null,
    p1Z: game?.p1?.position?.z ?? null,
    canvas: Boolean(document.querySelector('.scene-host canvas')),
    drawCalls: game?.renderer?.info?.render?.calls ?? 0,
    renderTriangles: game?.renderer?.info?.render?.triangles ?? 0,
    localGlbLeak: Object.entries(localStorage).some(([key, value]) =>
      /artist.*glb|artist.*blob|localpreview/i.test(key)
      || typeof value === 'string' && value.includes('blob:http')),
  };
`);
async function capture(label) {
  const bytes = Buffer.from(await request("/session/" + session + "/screenshot"), "base64");
  if (bytes.length < 2500 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("Real browser screenshot failed: " + label);
  await writeFile(output + "/" + label + ".png", bytes);
}
async function uploadFixture() {
  const list = await request("/session/" + session + "/elements", "POST", {
    using: "css selector", value: "section[aria-label='SERA Artist Asset Lab'] input[type=file]",
  });
  const elementId = list?.[0]?.["element-6066-11e4-a52e-4f735466cecf"];
  if (!elementId) throw new Error("GLB input not available");
  await run("const el=document.querySelector('section[aria-label=\\\"SERA Artist Asset Lab\\\"] input[type=file]');el.style.display='block';return true;");
  await request("/session/" + session + "/element/" + elementId + "/value", "POST", {
    text: glbPath, value: [...glbPath],
  });
  for (let i = 0; i < 160; i++) {
    const status = await run("return document.querySelector('section[aria-label=\\\"SERA Artist Asset Lab\\\"]')?.dataset.assetIntakeState || '';");
    if (status === "tech-pass") return;
    if (status === "rejected") throw new Error("Bundled GLB failed technical fixture validation");
    await delay(175);
  }
  throw new Error("Timed out importing local test GLB");
}

try {
  for (let i = 0; i < 200; i++) {
    try { await request("/status"); break; } catch {
      if (i === 199) throw new Error("ChromeDriver unavailable");
      await delay(100);
    }
  }
  const response = await request("/session", "POST", {
    capabilities: { alwaysMatch: { browserName: "chrome",
      "goog:chromeOptions": { args: [
        "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
        "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=swiftshader",
        "--window-size=1450,770", "--hide-scrollbars",
      ] },
    } },
  });
  session = response.sessionId;
  await mkdir(output, { recursive: true });
  await request("/session/" + session + "/url", "POST", { url });
  await delay(900);
  if (!await click("MODEL VIEW")) throw new Error("MODEL VIEW is unavailable");
  await delay(350);
  if (!await click("ARTIST ASSET LAB / GLB")) throw new Error("Artist lab unavailable");
  await delay(350);
  await uploadFixture();
  if (!await click("TEST REAL MATCH")) throw new Error("Private match action missing");
  let ready = null;
  for (let i = 0; i < 160; i++) {
    ready = await snapshot();
    if (ready?.heroState === "failed") throw new Error("Private fight rejected rig: " + JSON.stringify(ready));
    if (ready?.heroState === "ready" && ready?.panel && ready.heroVisible && ready.mappedBones >= 20) break;
    await delay(170);
  }
  if (ready?.heroState !== "ready" || !ready.panel || !ready.heroVisible
      || ready.p1Model !== "SERA_ARTIST_PREVIEW" || ready.p2Model !== "QUATERNIUS_UBC"
      || ready.mappedBones < 20 || ready.triangles < 10000 || ready.texturedMaterials < 1
      || !ready.driverPresent || !ready.canvas || ready.localGlbLeak) {
    throw new Error("Actual private SERA versus KAIRO model handoff failed: " + JSON.stringify(ready));
  }
  await capture("01-private-sera-vs-kairo-idle");

  await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));return true;");
  await delay(95);
  const strike = await snapshot();
  await capture("02-private-sera-jab-with-artist-glb");
  await run("document.dispatchEvent(new KeyboardEvent('keyup',{key:'j',bubbles:true}));return true;");
  if (!strike.inputPunch && strike.p1State !== "ATTACK" && !strike.p1Move)
    throw new Error("Live private fight ignored player attack input: " + JSON.stringify(strike));
  if (strike.heroState !== "ready" || !strike.heroVisible)
    throw new Error("Artist hero disappeared during a real combat action: " + JSON.stringify(strike));

  if (!await click("PRIVATE GLB QA")) throw new Error("In-battle QA telemetry cannot expand");
  const expanded = await run(
    "const panel=document.querySelector('aside[data-artist-combat-qa]');"
    + "return { visible:!!panel, expanded:panel?.querySelector('button[aria-expanded=true]')!==null,"
    + "hasCapture:!![...panel?.querySelectorAll('button')??[]].find(x=>x.textContent?.includes('SAVE FIGHT SCREENSHOT')),"
    + "hasExit:!![...panel?.querySelectorAll('button')??[]].find(x=>x.textContent?.includes('END PRIVATE TEST')) };"
  );
  if (!expanded.visible || !expanded.expanded || !expanded.hasCapture || !expanded.hasExit)
    throw new Error("In-match iPhone QA panel controls missing: " + JSON.stringify(expanded));

  if (!await click("END PRIVATE TEST")) throw new Error("Cannot exit ephemeral local fight");
  await delay(250);
  const exited = await run("return {title:!!document.querySelector('.title-screen'),"
    + "privateQa:!!document.querySelector('aside[data-artist-combat-qa]'),"
    + "publicLocalChoice:[...document.querySelectorAll('.select-screen button')].some(x=>x.textContent?.includes('LOCAL ARTIST'))};");
  if (!exited.title || exited.privateQa || exited.publicLocalChoice)
    throw new Error("Private GLB leaked into normal game mode: " + JSON.stringify(exited));
  await capture("03-private-qa-exited-no-glb-persisted");
  await writeFile(output + "/qa-result.json", JSON.stringify({
    ready, strike, expanded, exited,
    artApproval: "NOT_APPROVED",
    note: "Legacy V2 GLB is an unapproved technical CI fixture only. Never publish it as SERA.",
  }, null, 2));
  console.log("SERA_PRIVATE_LOCAL_ACTUAL_VERSUS_WEBGL_PASSED", JSON.stringify({
    mappedBones: ready.mappedBones, triangles: ready.triangles,
    strike: strike.p1Move, p1Model: ready.p1Model, p2Model: ready.p2Model,
  }));
} finally {
  if (session) await request("/session/" + session, "DELETE").catch(() => {});
  chromedriver.kill("SIGTERM");
}
