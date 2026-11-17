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
  const motionBones = {};
  hero?.traverse(node => {
    if (!node.isBone) return;
    for (const name of ['LeftArm','RightArm','LeftForeArm','RightForeArm',
                         'LeftUpLeg','RightUpLeg','Spine2']) {
      if (!motionBones[name] && node.name.endsWith(name)) {
        motionBones[name] = node.quaternion.toArray();
      }
    }
  });
  return {
    panel: !!panel,
    panelState: panel?.dataset.artistCombatState ?? null,
    localSourcesActive: Number(panel?.dataset.artistLocalActive ?? -1),
    localSourcesLoaded: Number(panel?.dataset.artistLocalLoaded ?? -1),
    localSourcesReleased: Number(panel?.dataset.artistLocalReleased ?? -1),
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
    motionBones,
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
// A skinned actor must also CHANGE its authored joint rotations when the
// actual fight move plays. Merely reporting ATTACK while showing an idle GLB
// does not pass. Compare local bone quaternions, which ignore world dash drift.
function maxPoseAngle(before, after) {
  let maxAngle = 0;
  let pairs = 0;
  for (const [name, oldQ] of Object.entries(before ?? {})) {
    const newQ = after?.[name];
    if (!Array.isArray(oldQ) || !Array.isArray(newQ) || oldQ.length !== 4 || newQ.length !== 4) continue;
    const dot = Math.abs(oldQ.reduce((sum, value, i) => sum + value * newQ[i], 0));
    const angle = 2 * Math.acos(Math.min(1, Math.max(0, dot)));
    if (Number.isFinite(angle)) { maxAngle = Math.max(maxAngle, angle); pairs++; }
  }
  return {maxAngle, pairs};
}
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
  await run("const el=document.querySelector('input[type=file]');if(!el)return false;el.style.display='block';return true;");
  await request("/session/" + session + "/element/" + elementId + "/value", "POST", {
    text: glbPath, value: [...glbPath],
  });
  for (let i = 0; i < 160; i++) {
    const status = await run("return document.querySelector('section[data-asset-intake-state]')?.dataset.assetIntakeState || '';");
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
  // The in-game overlay samples GPU and source-lifetime data each second.
  // Make sure a locally imported asset exists only while the actor is alive.
  for (let i = 0; i < 18; i++) {
    ready = await snapshot();
    if (ready.localSourcesActive === 1 && ready.localSourcesLoaded >= 1) break;
    await delay(120);
  }
  if (ready.localSourcesActive !== 1 || ready.localSourcesReleased !== 0)
    throw new Error("Private artist asset source was not uniquely owned: " + JSON.stringify(ready));
  await capture("01-private-sera-vs-kairo-idle");

  // Use the same game.press()/game.release() entrypoints as the actual
  // iPhone touch-button. A mere input=true frame is NOT enough: the fighter
  // must enter the real ATTACK move state before the screenshot can pass.
  const pressed = await run(`${lookup}
    const game = findGame();
    if (!game) return false;
    game.press('punch', 'qa-touch-attack');
    return game.input.frame().punch === true;
  `);
  if (!pressed) throw new Error("The real touch attack input was not accepted");
  let strike = null;
  const sampledMoves = [];
  for (let i = 0; i < 34; i++) {
    const sample = await snapshot();
    sampledMoves.push({state: sample.p1State, move: sample.p1Move, mappedBones: sample.mappedBones});
    if (sample.p1State === "ATTACK" && sample.p1Move) {
      // The first tick can still look like neutral; capture a genuine
      // authored pose partway through the move.
      await delay(105);
      const active = await snapshot();
      strike = active.p1State === "ATTACK" && active.p1Move ? active : sample;
      await capture("02-private-sera-active-move-with-artist-glb");
      break;
    }
    await delay(45);
  }
  await run(`${lookup}
    const game = findGame();
    if (game) game.release('punch', 'qa-touch-attack');
    return true;
  `);
  if (!strike) throw new Error("Real imported SERA did not enter an ATTACK state: " + JSON.stringify(sampledMoves));
  if (strike.heroState !== "ready" || !strike.heroVisible || strike.mappedBones < 20)
    throw new Error("Artist hero disappeared during a real fighter move: " + JSON.stringify(strike));
  const poseMotion = maxPoseAngle(ready.motionBones, strike.motionBones);
  if (poseMotion.pairs < 4 || poseMotion.maxAngle < 0.045) {
    throw new Error("Artist GLB remained in neutral pose during actual SERA ATTACK: " + JSON.stringify({poseMotion, ready: ready.motionBones, strike: strike.motionBones}));
  }

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

  // Import the very same GLB AGAIN in one browser session. The first source
  // (including GPU textures) must already be released; the second MUST NOT
  // come from a stale map of revoked Blob URLs.
  if (!await click("MODEL VIEW")) throw new Error("Cannot reopen model viewer after private fight cleanup");
  await delay(380);
  if (!await click("ARTIST ASSET LAB / GLB")) throw new Error("Artist lab cannot reopen after cleanup");
  await delay(280);
  await uploadFixture();
  if (!await click("TEST REAL MATCH")) throw new Error("Cannot start second local private fight");
  let repeat = null;
  for (let i = 0; i < 165; i++) {
    repeat = await snapshot();
    if (repeat.heroState === "failed")
      throw new Error("Repeat artist import/retarget failed: " + JSON.stringify(repeat));
    if (repeat.heroState === "ready" && repeat.heroVisible
        && repeat.localSourcesActive === 1 && repeat.localSourcesLoaded >= 2
        && repeat.localSourcesReleased >= 1) break;
    await delay(170);
  }
  if (repeat?.heroState !== "ready" || !repeat.heroVisible
      || repeat.localSourcesActive !== 1 || repeat.localSourcesLoaded < 2
      || repeat.localSourcesReleased < 1 || repeat.p1Model !== "SERA_ARTIST_PREVIEW"
      || repeat.p2Model !== "QUATERNIUS_UBC") {
    throw new Error("Local GLB sources accumulated across private matches: " + JSON.stringify(repeat));
  }
  await capture("04-private-repeat-import-clean-lifetime");
  // Real Chrome display size close to an iPhone landscape 874x402 CSS viewport.
  // This is NOT a native iPhone device/FPS claim. The expanded review panel
  // must remain scrollable and leave actual ATTACK/STEP buttons unobstructed.
  const desktopWindow = await request("/session/" + session + "/window/rect");
  let mobile = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const beforeSize = await run("return {ow:window.outerWidth,oh:window.outerHeight,iw:window.innerWidth,ih:window.innerHeight};");
    await request("/session/" + session + "/window/rect", "POST", {
      width: Math.round(874 + Math.max(0, beforeSize.ow - beforeSize.iw)),
      height: Math.round(402 + Math.max(0, beforeSize.oh - beforeSize.ih)),
    });
    await run("window.dispatchEvent(new Event('resize'));return true;");
    await delay(320);
    mobile = await run("return {width:window.innerWidth,height:window.innerHeight};");
    if (mobile.width >= 854 && mobile.width <= 895
      && mobile.height >= 388 && mobile.height <= 420) break;
  }
  if (!mobile || mobile.width < 854 || mobile.width > 895
      || mobile.height < 388 || mobile.height > 420)
    throw new Error("Cannot establish phone-landscape CSS viewport: " + JSON.stringify(mobile));
  if (!await click("PRIVATE GLB QA")) throw new Error("Second overlay missing");
  const mobileQa = await run(`
    const panel=document.querySelector('aside[data-artist-combat-qa]');
    const attack=document.querySelector('.tps-attack-action');
    const step=document.querySelector('.tps-step-action');
    const pause=document.querySelector('.tps-pause-button');
    if (!panel||!attack||!step||!pause) return null;
    const a=attack.getBoundingClientRect(), s=step.getBoundingClientRect();
    const p=panel.getBoundingClientRect(), q=pause.getBoundingClientRect();
    return {
      innerWidth:window.innerWidth, innerHeight:window.innerHeight,
      panelTop:p.top, panelBottom:p.bottom, panelHeight:p.height,
      pauseBottom:q.bottom, pauseVisible:q.width>15&&q.height>15,
      panelScrollHeight:panel.scrollHeight, panelClientHeight:panel.clientHeight,
      panelScrollY:getComputedStyle(panel).overflowY,
      attackTop:a.top, attackVisible:a.width>32&&a.height>32,
      stepVisible:s.width>32&&s.height>32,
      capturesAvailable:!![...panel.querySelectorAll('button')].find(b=>b.textContent?.includes('SAVE PRIVATE QA METRICS')),
    };
  `);
  if (!mobileQa || !mobileQa.attackVisible || !mobileQa.stepVisible
      || mobileQa.panelScrollY !== "auto"
      || !mobileQa.capturesAvailable
      || !mobileQa.pauseVisible
      || mobileQa.panelTop < mobileQa.pauseBottom + 3
      || mobileQa.panelBottom > mobileQa.attackTop - 3)
    throw new Error("Private QA obscures iPhone landscape controls: " + JSON.stringify(mobileQa));
  await capture("05-private-iphone-landscape-qa-expanded");
  await request("/session/" + session + "/window/rect", "POST", desktopWindow);
  await run("window.dispatchEvent(new Event('resize'));return true;");
  await delay(200);
  if (!await click("END PRIVATE TEST")) throw new Error("Cannot finish repeated private match");
  await writeFile(output + "/qa-result.json", JSON.stringify({
    ready, strike, sampledMoves, poseMotion, expanded, exited, repeat, mobileQa,
    artistResourceRule: "exactly one active local GLB and prior texture source released",
    artApproval: "NOT_APPROVED",
    note: "Legacy V2 GLB is an unapproved technical CI fixture only. Never publish it as SERA.",
  }, null, 2));
  console.log("SERA_PRIVATE_LOCAL_ACTUAL_VERSUS_WEBGL_PASSED", JSON.stringify({
    mappedBones: ready.mappedBones, triangles: ready.triangles,
    strike: strike.p1Move, poseAngle: poseMotion.maxAngle, p1Model: ready.p1Model, p2Model: ready.p2Model,
  }));
} finally {
  if (session) await request("/session/" + session, "DELETE").catch(() => {});
  chromedriver.kill("SIGTERM");
}
