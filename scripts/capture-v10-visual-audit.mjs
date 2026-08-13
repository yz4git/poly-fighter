import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const output = process.env.AUDIT_OUTPUT ?? "artifacts/visual-audit/sera-v10-3-game.png";
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

function siblingOutput(base, suffix) {
  return base.replace(/-idle\.png$/i, `-${suffix}.png`).replace(/\.png$/i, `-${suffix}.png`);
}

function webdriverElementId(element) {
  return element?.["element-6066-11e4-a52e-4f735466cecf"] ?? element?.ELEMENT ?? null;
}

async function inspectWebglCanvas(sessionId) {
  const state = await execute(sessionId, `
    const canvas = document.querySelector('.scene-host canvas');
    if (!canvas) return { ok: false, reason: 'scene-host canvas not found' };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return {
      ok: Boolean(gl),
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      context: gl ? gl.constructor?.name ?? 'WebGLRenderingContext' : null,
    };
  `);
  if (!state?.ok || state.width < 2 || state.height < 2) {
    throw new Error(`The production page did not expose a live WebGL canvas: ${JSON.stringify(state)}`);
  }
  return state;
}

async function captureCanvas(sessionId, path) {
  const element = await command(`/session/${sessionId}/element`, "POST", {
    using: "css selector",
    value: ".scene-host canvas",
  });
  const elementId = webdriverElementId(element);
  if (!elementId) throw new Error(`ChromeDriver returned no canvas element id: ${JSON.stringify(element)}`);
  const screenshot = await command(`/session/${sessionId}/element/${encodeURIComponent(elementId)}/screenshot`);
  const bytes = Buffer.from(screenshot, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Canvas screenshot is not a non-empty PNG: ${path} (${bytes.length} bytes)`);
  }
  await writeFile(path, Buffer.from(screenshot, "base64"));
}

async function setRuntimePose(sessionId, pose) {
  return execute(sessionId, `
    const pose = arguments[0];
    function findGame() {
      const host = document.querySelector('main.poly-app');
      if (!host) return null;
      const key = Object.keys(host).find((entry) => entry.startsWith('__reactFiber$'));
      let fiber = key ? host[key] : null;
      const visited = new Set();
      while (fiber && !visited.has(fiber)) {
        visited.add(fiber);
        let hook = fiber.memoizedState;
        while (hook) {
          const value = hook.memoizedState;
          const current = value && typeof value === 'object' && 'current' in value ? value.current : null;
          if (current && current.p1 && current.p2 && current.animation && current.renderer && current.scene && current.camera) return current;
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      return null;
    }

    function worldPoint(object) {
      const point = object.position.clone();
      object.getWorldPosition(point);
      return { x: point.x, y: point.y, z: point.z };
    }

    function screenPoint(object, camera, width, height) {
      const point = object.position.clone();
      object.getWorldPosition(point);
      point.project(camera);
      return {
        x: (point.x * 0.5 + 0.5) * width,
        y: (-point.y * 0.5 + 0.5) * height,
        z: point.z,
      };
    }

    function visualSignature(renderer, camera, visual) {
      const canvas = renderer.domElement;
      const width = canvas.width;
      const height = canvas.height;
      const root = visual.root.position.clone();
      visual.root.getWorldPosition(root);
      root.project(camera);
      const rootX = (root.x * 0.5 + 0.5) * width;
      const rootY = (-root.y * 0.5 + 0.5) * height;
      const cropWidth = Math.min(240, width);
      const cropHeight = Math.min(360, height);
      const cropX = Math.max(0, Math.min(width - cropWidth, rootX - cropWidth * 0.5));
      const cropY = Math.max(0, Math.min(height - cropHeight, rootY - cropHeight * 0.90));
      const sample = document.createElement('canvas');
      sample.width = 48;
      sample.height = 72;
      const context = sample.getContext('2d', { willReadFrequently: true });
      if (!context) return { crop: [cropX, cropY, cropWidth, cropHeight], values: [] };
      context.imageSmoothingEnabled = false;
      context.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, sample.width, sample.height);
      const rgba = context.getImageData(0, 0, sample.width, sample.height).data;
      const values = [];
      for (let index = 0; index < rgba.length; index += 4) {
        values.push(Math.round(rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114));
      }
      return { crop: [cropX, cropY, cropWidth, cropHeight], width: sample.width, height: sample.height, values };
    }

    const game = findGame();
    if (!game) return { ok: false, reason: 'PolyFightGame ref not found' };
    game.pause();
    game.input.clear();
    const fighter = game.p1;
    const opponent = game.p2;
    const visual = fighter.visual;

    fighter.currentMove = null;
    fighter.moveTick = 0;
    fighter.hitTargets.clear();
    fighter.grounded = true;
    fighter.position.y = 0;
    fighter.velocity.set(0, 0, 0);
    fighter.state = 'IDLE';
    opponent.currentMove = null;
    opponent.moveTick = 0;
    opponent.state = 'IDLE';
    opponent.velocity.set(0, 0, 0);

    if (pose === 'GUARD') {
      fighter.state = 'GUARD';
    } else if (pose === 'PUNCH') {
      if (!fighter.beginMove('straight')) return { ok: false, reason: 'straight did not begin' };
      fighter.moveTick = fighter.currentMove.startup + Math.max(1, Math.floor(fighter.currentMove.active / 2));
    } else if (pose === 'KICK') {
      if (!fighter.beginMove('dashKick')) return { ok: false, reason: 'dashKick did not begin' };
      fighter.moveTick = fighter.currentMove.startup + Math.max(1, Math.floor(fighter.currentMove.active / 2));
    }

    const time = pose === 'IDLE' ? 4.0 : pose === 'GUARD' ? 4.2 : pose === 'PUNCH' ? 4.4 : 4.6;
    game.animation.update(fighter, opponent, time);
    game.animation.update(opponent, fighter, time + 0.22);

    // Attack aura is intentionally hidden in the audit so pose comparison is
    // based on the actual reconstructed fighter surface.
    visual.aura.visible = false;
    opponent.visual.aura.visible = false;

    game.fightCamera.update(fighter, opponent, 1 / 60);
    game.renderer.render(game.scene, game.camera);
    visual.root.updateMatrixWorld(true);

    const width = game.renderer.domElement.width;
    const height = game.renderer.domElement.height;
    const contacts = {
      leftFist: worldPoint(visual.leftArm.end),
      rightFist: worldPoint(visual.rightArm.end),
      leftFoot: worldPoint(visual.leftLeg.end),
      rightFoot: worldPoint(visual.rightLeg.end),
    };
    const screens = {
      leftFist: screenPoint(visual.leftArm.end, game.camera, width, height),
      rightFist: screenPoint(visual.rightArm.end, game.camera, width, height),
      leftFoot: screenPoint(visual.leftLeg.end, game.camera, width, height),
      rightFoot: screenPoint(visual.rightLeg.end, game.camera, width, height),
    };

    return {
      ok: true,
      pose,
      state: fighter.state,
      move: fighter.currentMove?.id ?? null,
      moveTick: fighter.moveTick,
      visualVersion: visual.visualVersion,
      assetState: visual.root.userData.reconstructionAssetState ?? null,
      presentationMode: visual.bodyMesh.userData.v10PresentationMode ?? null,
      skinningPresentation: visual.root.userData.skinningPresentation ?? null,
      colorPipeline: visual.root.userData.colorPipeline ?? null,
      fragmentCount: visual.root.userData.v10FragmentCount ?? null,
      regionCounts: visual.root.userData.v10RegionCounts ?? null,
      contacts,
      screens,
      signature: visualSignature(game.renderer, game.camera, visual),
    };
  `, [pose]);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function signatureDifference(a, b) {
  const first = a?.values ?? [];
  const second = b?.values ?? [];
  const count = Math.min(first.length, second.length);
  if (!count) return { meanAbs: 0, changedFraction: 0, samples: 0 };
  let total = 0;
  let changed = 0;
  for (let index = 0; index < count; index += 1) {
    const delta = Math.abs(first[index] - second[index]);
    total += delta;
    if (delta >= 18) changed += 1;
  }
  return { meanAbs: total / count, changedFraction: changed / count, samples: count };
}

function validatePoseSeparation(poseStates) {
  const idle = poseStates.IDLE;
  const guard = poseStates.GUARD;
  const punch = poseStates.PUNCH;
  const kick = poseStates.KICK;
  const metrics = {
    guardFistWorld: Math.max(distance(idle.contacts.leftFist, guard.contacts.leftFist), distance(idle.contacts.rightFist, guard.contacts.rightFist)),
    punchFistWorld: distance(idle.contacts.rightFist, punch.contacts.rightFist),
    kickFootWorld: distance(idle.contacts.rightFoot, kick.contacts.rightFoot),
    guardFistScreen: Math.max(distance(idle.screens.leftFist, guard.screens.leftFist), distance(idle.screens.rightFist, guard.screens.rightFist)),
    punchFistScreen: distance(idle.screens.rightFist, punch.screens.rightFist),
    kickFootScreen: distance(idle.screens.rightFoot, kick.screens.rightFoot),
    guardPixels: signatureDifference(idle.signature, guard.signature),
    punchPixels: signatureDifference(idle.signature, punch.signature),
    kickPixels: signatureDifference(idle.signature, kick.signature),
  };
  if (metrics.guardFistWorld < 0.18) throw new Error(`GUARD pose is not materially distinct: ${JSON.stringify(metrics)}`);
  if (metrics.punchFistWorld < 0.45) throw new Error(`PUNCH pose is not materially distinct: ${JSON.stringify(metrics)}`);
  if (metrics.kickFootWorld < 0.45) throw new Error(`KICK pose is not materially distinct: ${JSON.stringify(metrics)}`);
  for (const [label, pixel] of [["GUARD", metrics.guardPixels], ["PUNCH", metrics.punchPixels], ["KICK", metrics.kickPixels]]) {
    if (pixel.meanAbs < 2.5 || pixel.changedFraction < 0.035) {
      throw new Error(`${label} rendered pixels are too similar to IDLE: ${JSON.stringify(metrics)}`);
    }
  }
  return metrics;
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

  await delay(2300);
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
  const canvasState = await inspectWebglCanvas(sessionId);

  await mkdir(output.split("/").slice(0, -1).join("/"), { recursive: true });
  const poses = ["IDLE", "GUARD", "PUNCH", "KICK"];
  const poseStates = {};
  for (const pose of poses) {
    const result = await setRuntimePose(sessionId, pose);
    if (!result?.ok) throw new Error(`Unable to set ${pose} visual audit pose: ${JSON.stringify(result)}`);
    poseStates[pose] = result;
    await delay(70);
    const path = pose === "IDLE" ? output : siblingOutput(output, pose.toLowerCase());
    await captureCanvas(sessionId, path);
  }

  const poseSeparation = validatePoseSeparation(poseStates);
  const compactStates = Object.fromEntries(Object.entries(poseStates).map(([pose, value]) => [
    pose,
    { ...value, signature: { ...value.signature, values: undefined } },
  ]));
  await writeFile("artifacts/visual-audit/webdriver.log", driverLog);
  await writeFile("artifacts/visual-audit/canvas-state.json", JSON.stringify(canvasState, null, 2));
  await writeFile("artifacts/visual-audit/pose-states.json", JSON.stringify(compactStates, null, 2));
  await writeFile("artifacts/visual-audit/pose-separation.json", JSON.stringify(poseSeparation, null, 2));
  console.log(JSON.stringify({ output, state, selectedP1, selectedP2, poseStates: compactStates, poseSeparation }));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
