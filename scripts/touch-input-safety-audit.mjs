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
        if (current && current.input && current.p1 && current.p2 && current.renderer) return current;
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    return null;
  }
`;

async function readPadState(sessionId) {
  return execute(sessionId, `${gameLookup}
    const game = findGame();
    const pad = document.querySelector('.virtual-pad');
    const frame = game?.input?.frame?.() ?? null;
    const rect = pad?.getBoundingClientRect?.();
    return {
      ready: Boolean(game && pad && rect),
      direction: pad?.getAttribute('data-direction') ?? null,
      frame,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    };
  `);
}

function heldDragActions(cx, cy, tx, ty) {
  return {
    actions: [{
      type: "pointer",
      id: "touch-safety-probe",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, x: Math.round(cx), y: Math.round(cy), origin: "viewport" },
        { type: "pointerDown", button: 0 },
        { type: "pointerMove", duration: 140, x: Math.round(tx), y: Math.round(ty), origin: "viewport" },
        { type: "pause", duration: 80 },
      ],
    }],
  };
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
  if (!(await clickButton(sessionId, "TPS LOCK-ON BATTLE"))) throw new Error("TPS title button not found");
  await delay(120);
  if (!(await clickButton(sessionId, "ENGAGE TPS"))) throw new Error("TPS engage button not found");

  let neutral = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    neutral = await readPadState(sessionId);
    if (neutral?.ready) break;
    await delay(100);
  }
  if (!neutral?.ready || !neutral.rect) throw new Error(`Virtual pad did not become ready: ${JSON.stringify(neutral)}`);

  const { x, y, width, height } = neutral.rect;
  const cx = x + width * 0.5;
  const cy = y + height * 0.5;

  // Reproduce the failure mode: hold a direction, then lose browser focus before
  // the control receives its normal pointerup. Keep pointerDown + drag in one W3C
  // action sequence so Chrome preserves the pressed button throughout the move.
  await command(
    `/session/${sessionId}/actions`,
    "POST",
    heldDragActions(cx, cy, cx + width * 0.34, cy),
  );
  const heldRight = await readPadState(sessionId);
  if (heldRight?.direction !== "RIGHT" || !heldRight?.frame?.right) {
    throw new Error(`Virtual pad did not enter RIGHT before interruption: ${JSON.stringify(heldRight)}`);
  }

  await execute(sessionId, `window.dispatchEvent(new Event('blur')); return true;`);
  await delay(80);
  const afterBlur = await readPadState(sessionId);
  const afterBlurFrame = afterBlur?.frame ?? {};
  if (afterBlur?.direction !== "NEUTRAL" || afterBlurFrame.left || afterBlurFrame.right || afterBlurFrame.up || afterBlurFrame.down) {
    throw new Error(`Virtual pad remained stuck after blur recovery: ${JSON.stringify(afterBlur)}`);
  }
  // ChromeDriver still owns the physical mouse button even though the app has
  // recovered logically. Release that driver-side state before the next probe.
  await command(`/session/${sessionId}/actions`, "DELETE");

  // A stale VirtualPadTracker pointer used to make the next touch a no-op. Prove
  // a fresh gesture is accepted immediately after forced recovery.
  await command(
    `/session/${sessionId}/actions`,
    "POST",
    heldDragActions(cx, cy, cx - width * 0.34, cy),
  );
  const heldLeft = await readPadState(sessionId);
  if (heldLeft?.direction !== "LEFT" || !heldLeft?.frame?.left) {
    throw new Error(`Virtual pad did not accept a fresh LEFT gesture after recovery: ${JSON.stringify(heldLeft)}`);
  }

  // Releasing the WebDriver input source emits the normal pointerup path. It must
  // leave both the knob state and all directional game inputs neutral.
  await command(`/session/${sessionId}/actions`, "DELETE");
  await delay(80);
  const afterNormalRelease = await readPadState(sessionId);
  const finalFrame = afterNormalRelease?.frame ?? {};
  if (afterNormalRelease?.direction !== "NEUTRAL" || finalFrame.left || finalFrame.right || finalFrame.up || finalFrame.down) {
    throw new Error(`Virtual pad failed normal release after recovery: ${JSON.stringify(afterNormalRelease)}`);
  }

  const diagnostics = { neutral, heldRight, afterBlur, heldLeft, afterNormalRelease };
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/touch-input-safety.json`, JSON.stringify(diagnostics, null, 2));
  console.log(JSON.stringify(diagnostics, null, 2));
} finally {
  if (sessionId) {
    await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  }
  driverProcess.kill("SIGTERM");
}
