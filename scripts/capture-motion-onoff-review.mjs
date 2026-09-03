import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.AUDIT_DIR ?? "artifacts/motion-onoff-review";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9530;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const proc = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let driverLog = "";
proc.stdout.on("data", (chunk) => { driverLog += chunk.toString(); });
proc.stderr.on("data", (chunk) => { driverLog += chunk.toString(); });

async function waitForDriver() {
  for (let i = 0; i < 150; i += 1) {
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

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`Not a PNG: ${path}`);
  await writeFile(path, bytes);
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

const helpers = `
  function resetFighter(fighter) {
    fighter.currentMove = null;
    fighter.moveTick = 0;
    fighter.hitStop = 0;
    fighter.hitStun = 0;
    fighter.blockStun = 0;
    fighter.knockdownTicks = 0;
    fighter.guardDamage = 0;
    fighter.velocity.set(0, 0, 0);
    fighter.hitTargets.clear();
    fighter.health = 100;
    fighter.state = 'IDLE';
    fighter.grounded = true;
    const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
    fighter.input = { ...neutral };
    fighter.previousInput = { ...neutral };
  }
  function importedModel(fighter) {
    const host = fighter.visual.root.children.find((child) => child.name?.startsWith('quaternius-ubc-'));
    if (!host) return null;
    return host.children.find((child) => child.type === 'Group' || child.children?.length > 0) ?? host.children[0] ?? null;
  }
  function point(object) {
    if (!object) return null;
    const Vector3 = object.position.constructor;
    const p = object.getWorldPosition(new Vector3());
    return { x: p.x, y: p.y, z: p.z };
  }
  function bonePoints(fighter) {
    const model = importedModel(fighter);
    if (!model) return null;
    const get = (name) => model.getObjectByName(name);
    return {
      pelvis: point(get('pelvis')),
      chest: point(get('spine_03')),
      head: point(get('head')),
      elbowL: point(get('lowerarm_l')),
      elbowR: point(get('lowerarm_r')),
      handL: point(get('hand_l')),
      handR: point(get('hand_r')),
      footL: point(get('foot_l')),
      footR: point(get('foot_r')),
    };
  }
`;

const cases = [
  { id: "idle", move: null },
  { id: "jab", move: "jab" },
  { id: "bodyblow", move: "bodyBlow" },
  { id: "backfist", move: "backfist" },
  { id: "power", move: "power" },
  { id: "frontkick", move: "kick" },
  { id: "risingkick", move: "risingKick" },
];

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
            "--window-size=1200,650",
            "--hide-scrollbars",
          ],
        },
      },
    },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(700);
  if (!(await clickButton(sessionId, "TPS LOCK-ON BATTLE"))) throw new Error("TPS title button not found");
  await delay(120);
  if (!(await clickButton(sessionId, "ENGAGE TPS"))) throw new Error("TPS engage button not found");

  let ready = null;
  for (let i = 0; i < 180; i += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      if (!game) return null;
      const roots = [game.p1.visual.root, game.p2.visual.root];
      return {
        modelReady: roots.every((root) => root.userData.quaterniusModelState === 'ready'),
        motionReady: roots.every((root) => root.userData.motionExpansionHasProcedural === true),
        p1Model: roots[0].userData.quaterniusModelState ?? null,
        p2Model: roots[1].userData.quaterniusModelState ?? null,
      };
    `);
    if (ready?.modelReady && ready?.motionReady) break;
    await delay(100);
  }
  if (!ready?.modelReady) throw new Error(`Quaternius models not ready: ${JSON.stringify(ready)}`);
  if (!ready?.motionReady) throw new Error(`Motion Expansion assets not ready for ON comparison: ${JSON.stringify(ready)}`);

  await mkdir(outputDir, { recursive: true });
  await execute(sessionId, `${gameLookup}
    const game = findGame();
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.enemyOpeningGraceTicks = 9999;
    return true;
  `);

  const report = { ready, captures: [] };
  for (const enabled of [false, true]) {
    const mode = enabled ? "on" : "off";
    for (const entry of cases) {
      const result = await execute(sessionId, `${gameLookup}${helpers}
        const enabled = arguments[0];
        const moveId = arguments[1];
        const game = findGame();
        game.updateSettings({ motionCorrections: enabled });
        resetFighter(game.p1);
        resetFighter(game.p2);
        game.finished = false;
        game.input.clear();
        game.p1.position.set(0, 0, 0.72);
        game.p2.position.set(0, 0, -0.52);
        game.p1.facing = 1;
        game.p2.facing = -1;
        if (moveId) {
          if (!game.p1.beginMove(moveId)) return { error: 'move-not-found', moveId };
          const move = game.p1.currentMove;
          game.p1.state = 'ATTACK';
          game.p1.hitStop = 0;
          game.p1.moveTick = move.startup + Math.max(0, Math.floor(Math.max(1, move.active) / 2));
        }
        let time = 10;
        for (let i = 0; i < 18; i += 1) {
          time += 1 / 60;
          game.updateVisual(game.p2, game.p1, time + 0.007);
          game.updateVisual(game.p1, game.p2, time);
        }
        for (let i = 0; i < 28; i += 1) game.updateCamera(1 / 60);
        game.updateLockOn();
        game.renderer.render(game.scene, game.camera);
        const root = game.p1.visual.root;
        const host = root.children.find((child) => child.name?.startsWith('quaternius-ubc-'));
        const points = bonePoints(game.p1);
        const defender = bonePoints(game.p2);
        return {
          enabled,
          moveId,
          fighterState: game.p1.state,
          moveTick: game.p1.moveTick,
          currentMove: game.p1.currentMove?.id ?? null,
          points,
          defender,
          rootMode: root.userData.motionCorrectionsEnabled ?? null,
          expansionPhase: root.userData.motionExpansionPhase ?? null,
          expansionClip: root.userData.motionExpansionCurrentClip ?? null,
          expansionMove: root.userData.motionExpansionCurrentMove ?? null,
          quaterniusMode: host?.userData.quaterniusMotionMode ?? null,
          quaterniusCorrections: host?.userData.quaterniusMotionCorrectionsEnabled ?? null,
        };
      `, [enabled, entry.move]);
      if (result?.error) throw new Error(`Capture failed: ${JSON.stringify(result)}`);
      report.captures.push({ mode, case: entry.id, ...result });
      await screenshot(sessionId, `${outputDir}/${mode}-${entry.id}.png`);
    }
  }

  await writeFile(`${outputDir}/motion-onoff.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  proc.kill("SIGTERM");
}
