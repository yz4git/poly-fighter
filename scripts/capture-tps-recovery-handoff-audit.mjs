import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9522;
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
    if (!button) return false;
    button.click();
    return true;
  `, [text]);
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Recovery handoff screenshot is not PNG: ${path}`);
  }
  await writeFile(path, bytes);
}

const gameLookup = `
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
        if (current && current.p1 && current.p2 && current.renderer && current.camera && current.scene) return current;
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    return null;
  }
`;

async function captureScenario(sessionId, targetState, fileStem) {
  const probe = await execute(sessionId, `${gameLookup}
    const targetState = arguments[0];
    const game = findGame();
    if (!game) return { error: 'game-not-found' };
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.p1.resetForRound(0, 0.72, 1);
    game.p2.resetForRound(0, -0.72, -1);
    game.p1.velocity.set(0, 0, 0);
    game.p2.velocity.set(0, 0, 0);
    game.p2.setHitReactionVisual('HEAVY', 'RIGHT', false);
    game.p2.state = 'HIT';
    game.p2.hitStop = 0;
    game.p2.hitStun = 3;

    const renderPair = () => {
      game.renderTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, game.renderTime);
      game.updateVisual(game.p2, game.p1, game.renderTime + 0.001);
    };

    // Author three deterministic HIT frames so the recovery tail has a real
    // outgoing pose before the requested action takes over.
    for (let frame = 0; frame < 3; frame += 1) {
      renderPair();
      game.p2.hitStun = Math.max(0, game.p2.hitStun - 1);
      game.p2.stateMachine.tick();
    }
    game.p2.state = targetState;

    // Three actionable frames are enough to inspect the crossfade while the
    // reaction tail is still alive. This specifically catches the old case
    // where full reaction leg offsets sat on top of WALK/SIDESTEP footwork.
    for (let frame = 0; frame < 3; frame += 1) renderPair();

    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    game.p2.visual.root.updateMatrixWorld(true);
    const data = game.p2.visual.root.userData;
    const leftFoot = game.p2.visual.rig.bones.leftFoot.getWorldPosition(game.p2.position.clone());
    const rightFoot = game.p2.visual.rig.bones.rightFoot.getWorldPosition(game.p2.position.clone());
    return {
      targetState,
      actualState: game.p2.state,
      recovery: data.tpsImpactRecovery ?? 0,
      recoverySeconds: data.tpsImpactRecoverySeconds ?? 0,
      bodyFactor: data.tpsImpactRecoveryFactor ?? 0,
      footwork: data.tpsImpactFootwork ?? 0,
      footworkStep: data.tpsImpactFootworkStep ?? 0,
      handoffState: data.tpsImpactRecoveryHandoffState ?? null,
      handoffBody: data.tpsImpactRecoveryHandoffBody ?? 1,
      handoffFootwork: data.tpsImpactRecoveryHandoffFootwork ?? 1,
      handoffStep: data.tpsImpactRecoveryHandoffStep ?? 1,
      leftFootY: leftFoot.y,
      rightFootY: rightFoot.y,
      rootY: game.p2.visual.root.position.y,
    };
  `, [targetState]);

  if (probe?.error) throw new Error(`TPS recovery handoff setup failed: ${JSON.stringify(probe)}`);
  if (probe.actualState !== targetState || probe.handoffState !== targetState) {
    throw new Error(`TPS recovery handoff state mismatch: ${JSON.stringify(probe)}`);
  }
  if (!(probe.recovery > 0) || !(probe.recoverySeconds > 0) || !(probe.bodyFactor > 0)) {
    throw new Error(`TPS recovery tail disappeared before handoff capture: ${JSON.stringify(probe)}`);
  }
  for (const value of [probe.handoffBody, probe.handoffFootwork, probe.handoffStep, probe.leftFootY, probe.rightFootY, probe.rootY]) {
    if (!Number.isFinite(value)) throw new Error(`TPS recovery handoff produced a non-finite transform: ${JSON.stringify(probe)}`);
  }
  await screenshot(sessionId, `${outputDir}/${fileStem}.png`);
  return probe;
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
  await mkdir(outputDir, { recursive: true });

  if (!(await clickButton(sessionId, "START FIGHT"))) throw new Error("START FIGHT button not found");
  await delay(140);
  if (!(await clickButton(sessionId, "ENGAGE"))) throw new Error("ENGAGE button not found");

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      const canvas = document.querySelector('.scene-host canvas');
      const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) : null;
      return Boolean(game && gl && game.p1?.visual?.root?.userData?.quaterniusModelState === 'ready' && game.p2?.visual?.root?.userData?.quaterniusModelState === 'ready');
    `);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("TPS recovery handoff audit did not reach ready WebGL models");

  const guard = await captureScenario(sessionId, "GUARD", "tps-recovery-handoff-guard");
  const walk = await captureScenario(sessionId, "WALK", "tps-recovery-handoff-walk");
  const sidestep = await captureScenario(sessionId, "SIDESTEP", "tps-recovery-handoff-sidestep");

  // Action ownership should be progressively stronger for movement-heavy states.
  // The numeric ordering is a regression guard for the visual crossfade, not a
  // gameplay tuning rule.
  if (!(guard.handoffFootwork > walk.handoffFootwork && walk.handoffFootwork > sidestep.handoffFootwork)) {
    throw new Error(`TPS recovery footwork handoff ordering regressed: ${JSON.stringify({ guard, walk, sidestep })}`);
  }
  if (!(guard.handoffStep > walk.handoffStep && walk.handoffStep > sidestep.handoffStep)) {
    throw new Error(`TPS recovery root-step handoff ordering regressed: ${JSON.stringify({ guard, walk, sidestep })}`);
  }

  await writeFile(
    `${outputDir}/tps-recovery-handoff.json`,
    `${JSON.stringify({ guard, walk, sidestep }, null, 2)}\n`,
    "utf8",
  );
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => {});
  driverProcess.kill("SIGTERM");
  await writeFile(`${outputDir}/tps-recovery-handoff-webdriver.log`, driverLog, "utf8").catch(() => {});
}
