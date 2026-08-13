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

function siblingOutput(base, suffix) {
  return base.replace(/\.png$/i, `-${suffix}.png`);
}

async function capture(sessionId, path) {
  const screenshot = await command(`/session/${sessionId}/screenshot`);
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
          // Production bundles minify class names, so identify the ref by its
          // stable public runtime surface instead of constructor.name.
          if (current && current.p1 && current.p2 && current.animation && current.renderer && current.scene && current.camera) return current;
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      return null;
    }

    const game = findGame();
    if (!game) return { ok: false, reason: 'PolyFightGame ref not found' };
    game.pause();
    game.input.clear();
    const fighter = game.p1;
    const opponent = game.p2;
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
      if (!fighter.beginMove('jab')) return { ok: false, reason: 'jab did not begin' };
      fighter.moveTick = fighter.currentMove.startup + 1;
    } else if (pose === 'KICK') {
      if (!fighter.beginMove('kick')) return { ok: false, reason: 'kick did not begin' };
      fighter.moveTick = fighter.currentMove.startup + 1;
    }

    const time = pose === 'IDLE' ? 4.0 : pose === 'GUARD' ? 4.2 : pose === 'PUNCH' ? 4.4 : 4.6;
    game.animation.update(fighter, opponent, time);
    game.animation.update(opponent, fighter, time + 0.22);
    game.fightCamera.update(fighter, opponent, 1 / 60);
    game.renderer.render(game.scene, game.camera);
    const visual = fighter.visual;
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
    };
  `, [pose]);
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

  // Wait for React match construction and the async V10 GLB swap. The visual
  // audit then freezes gameplay and drives FighterRuntime states directly,
  // avoiding CPU timing or synthetic input ambiguity while still using the
  // actual animation/IK, Three.js scene and WebGL renderer.
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

  await mkdir(output.split("/").slice(0, -1).join("/"), { recursive: true });
  const poses = ["IDLE", "GUARD", "PUNCH", "KICK"];
  const poseStates = {};
  for (const pose of poses) {
    const result = await setRuntimePose(sessionId, pose);
    if (!result?.ok) throw new Error(`Unable to set ${pose} visual audit pose: ${JSON.stringify(result)}`);
    poseStates[pose] = result;
    await delay(70);
    const path = pose === "IDLE" ? output : siblingOutput(output, pose.toLowerCase());
    await capture(sessionId, path);
  }

  await writeFile("artifacts/visual-audit/webdriver.log", driverLog);
  await writeFile("artifacts/visual-audit/pose-states.json", JSON.stringify(poseStates, null, 2));
  console.log(JSON.stringify({ output, state, selectedP1, selectedP2, poseStates }));
} finally {
  if (sessionId) {
    await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  }
  driverProcess.kill("SIGTERM");
}
