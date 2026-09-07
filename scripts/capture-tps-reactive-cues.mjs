import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9524;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const proc = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let driverLog = "";
proc.stdout.on("data", (chunk) => { driverLog += chunk.toString(); });
proc.stderr.on("data", (chunk) => { driverLog += chunk.toString(); });

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
  if (!response.ok || payload?.value?.error) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
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
  await writeFile(path, Buffer.from(encoded, "base64"));
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
            "--window-size=932,430",
            "--hide-scrollbars",
          ],
        },
      },
    },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(650);
  if (!(await clickButton(sessionId, "START FIGHT"))) throw new Error("START FIGHT not found");
  await delay(120);
  if (!(await clickButton(sessionId, "ENGAGE"))) throw new Error("ENGAGE not found");

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    ready = await execute(sessionId, `${gameLookup} const game = findGame(); return Boolean(game?.renderer?.domElement);`);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("TPS game did not become ready");

  // Make the actual CSS viewport deterministic at the target iPhone-landscape size.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const metrics = await execute(sessionId, `return { innerWidth, innerHeight, outerWidth, outerHeight };`);
    const chromeWidth = Math.max(0, metrics.outerWidth - metrics.innerWidth);
    const chromeHeight = Math.max(0, metrics.outerHeight - metrics.innerHeight);
    await command(`/session/${sessionId}/window/rect`, "POST", {
      width: 932 + chromeWidth,
      height: 430 + chromeHeight,
    });
    await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
    await delay(160);
    const next = await execute(sessionId, `return { innerWidth, innerHeight };`);
    if (next.innerWidth === 932 && next.innerHeight === 430) break;
  }

  await mkdir(outputDir, { recursive: true });
  await execute(sessionId, `${gameLookup}
    const game = findGame();
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.finishPending = false;
    game.input.clear();
    return true;
  `);

  const results = {};
  for (const kind of ["WINDUP", "INCOMING", "PUNISH"]) {
    const gameState = await execute(sessionId, `${gameLookup}
      const game = findGame();
      game.enemyOpeningGraceTicks = 0;
      game.finished = false;
      game.finishPending = false;
      game.input.clear();
      game.enemyDirectorPendingMove = null;
      game.enemyDirectorTelegraphTicks = 0;
      game.enemyDirectorTelegraphTotalTicks = 0;
      game.p2.visual.root.userData.tpsEnemyTelegraphProgress = 0;
      game.p2.visual.root.userData.tpsEnemyTelegraphMove = null;
      game.p2.visual.root.userData.tpsEnemyTelegraphPhase = 'NONE';
      game.playerPerfectEvadeTicks = 0;
      game.playerFlankWindowTicks = 0;
      game.playerStepSideWeight = 0;
      game.playerStepThreatTicks = 0;
      game.p1.currentMove = null;
      game.p1.moveTick = 0;
      game.p1.state = 'IDLE';
      game.p1.velocity.set(0, 0, 0);
      game.p2.currentMove = null;
      game.p2.moveTick = 0;
      game.p2.hitStop = 0;
      game.p2.state = 'IDLE';
      game.p2.velocity.set(0, 0, 0);
      game.p1.position.set(0, 0, 0.82);
      game.p2.position.set(0, 0, -0.52);
      if (arguments[0] === 'WINDUP') {
        game.enemyDirectorPendingMove = 'power';
        game.enemyDirectorTelegraphTicks = 18;
        game.enemyDirectorTelegraphTotalTicks = 23;
        game.p2.visual.root.userData.tpsEnemyTelegraphProgress = 1 - 18 / 23;
        game.p2.visual.root.userData.tpsEnemyTelegraphMove = 'power';
        game.p2.visual.root.userData.tpsEnemyTelegraphPhase = 'LOAD';
      } else if (arguments[0] === 'INCOMING') {
        game.p2.beginMove('jab');
        game.p2.state = 'ATTACK';
        game.p2.moveTick = Math.max(0, (game.p2.currentMove?.startup ?? 1) - 1);
      } else {
        game.playerPerfectEvadeTicks = 18;
        game.playerFlankWindowTicks = 30;
        game.playerStepSideWeight = 1;
      }
      game.updateVisual(game.p1, game.p2, game.renderTime);
      game.updateVisual(game.p2, game.p1, game.renderTime + 0.23);
      for (let i = 0; i < 16; i += 1) game.updateCamera(1 / 60);
      game.updateLockOn();
      game.renderer.render(game.scene, game.camera);
      game.publishHud(true);
      return {
        kind: arguments[0],
        threat: game.enemyThreatStatus(),
        p2State: game.p2.state,
        move: game.p2.currentMove?.id ?? null,
      };
    `, [kind]);
    await delay(120);
    const ui = await execute(sessionId, `
      const step = document.querySelector('button[aria-label="Step"]');
      const attack = document.querySelector('button[aria-label="Attack"]');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        stepText: step?.textContent?.trim() ?? null,
        attackText: attack?.textContent?.trim() ?? null,
        stepClass: step?.className ?? null,
        attackClass: attack?.className ?? null,
      };
    `);
    const ok = kind === "WINDUP"
      ? gameState.threat.windup && !gameState.threat.incoming && ui.stepText === "READY" && ui.stepClass.includes("tps-windup-action")
      : kind === "INCOMING"
        ? gameState.threat.incoming && ui.stepText === "STEP NOW" && ui.stepClass.includes("tps-threat-action")
        : ui.attackText === "PUNISH" && ui.attackClass.includes("tps-punish-action");
    if (!ok) throw new Error(`TPS ${kind} cue mismatch: ${JSON.stringify({ gameState, ui })}`);
    results[kind] = { gameState, ui };
    await screenshot(sessionId, `${outputDir}/tps-${kind.toLowerCase()}-cue.png`);
  }

  await writeFile(`${outputDir}/tps-reactive-cues.json`, JSON.stringify(results, null, 2));
  await writeFile(`${outputDir}/tps-reactive-cues-webdriver.log`, driverLog);
  console.log(JSON.stringify(results));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  proc.kill("SIGTERM");
}
