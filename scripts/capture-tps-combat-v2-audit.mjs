import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9524;
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
    if (!button) return { clicked: false, labels: [...document.querySelectorAll('button')].map((entry) => entry.textContent ?? '') };
    button.click();
    return { clicked: true, label: button.textContent ?? '' };
  `, [text]);
}

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Screenshot is not PNG: ${path}`);
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

const resetSnippet = `
  if (!game.__tpsV2OriginalUpdateEnemy) game.__tpsV2OriginalUpdateEnemy = game.updateEnemy.bind(game);
  game.updateEnemy = game.__tpsV2OriginalUpdateEnemy;
  game.input.clear();
  game.finished = false;
  game.finishPending = false;
  game.finishTicks = 0;
  game.finishSettledTicks = 0;
  game.resultWinner = null;
  game.timerTicks = 99 * 60;
  game.p1.resetForRound(0, 0.72, 1);
  game.p2.resetForRound(0, -0.72, -1);
  game.p1.velocity.set(0, 0, 0);
  game.p2.velocity.set(0, 0, 0);
  game.playerEvadeTicks = 0;
  game.playerEvadeCooldown = 0;
  game.playerStepThreatTicks = 0;
  game.playerFlankWindowTicks = 0;
  game.playerFlankAttackTicks = 0;
  game.playerPerfectEvadeTicks = 0;
  game.playerInterceptTicks = 0;
  game.playerReversalTicks = 0;
  game.playerStepThreatWasJust = false;
  game.playerJustStepTicks = 0;
  game.playerBreakCounterTicks = 0;
  game.playerBreakCounterAttackTicks = 0;
  game.playerComboStage = 0;
  game.playerComboGraceTicks = 0;
  game.playerAttackQueued = false;
  game.combatBeatLabel = null;
  game.combatBeatTicks = 0;
  game.enemyOpeningGraceTicks = 0;
  game.enemyDirectorPendingMove = null;
  game.enemyDirectorTelegraphTicks = 0;
  game.enemyDirectorTelegraphTotalTicks = 0;
  game.enemyDirectorDecision = null;
  game.p2.visual.root.userData.tpsEnemyTelegraphProgress = 0;
  game.p2.visual.root.userData.tpsEnemyTelegraphMove = null;
  game.p2.visual.root.userData.tpsEnemyTelegraphPhase = 'NONE';
  game.enemyDirectorHoldTicks = 0;
  game.enemyCooldown = 0;
  game.enemyAdaptation = 'NEUTRAL';
  game.p2.visual.root.userData.tpsReactionType = null;
  game.p2.visual.root.userData.tpsReactionStrength = 0;
`;

async function setIphoneViewport(sessionId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const windowProbe = await execute(sessionId, `return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
    };`);
    const chromeWidth = Math.max(0, windowProbe.outerWidth - windowProbe.innerWidth);
    const chromeHeight = Math.max(0, windowProbe.outerHeight - windowProbe.innerHeight);
    await command(`/session/${sessionId}/window/rect`, "POST", {
      width: Math.round(932 + chromeWidth),
      height: Math.round(430 + chromeHeight),
    });
    await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
    await delay(250);
    const measured = await execute(sessionId, `return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      dpr: window.devicePixelRatio,
    };`);
    if (measured.width === 932 && measured.height === 430) return measured;
  }
  const measured = await execute(sessionId, `return { width: window.innerWidth, height: window.innerHeight };`);
  throw new Error(`Unable to establish 932x430 CSS viewport: ${JSON.stringify(measured)}`);
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
            "--window-size=1100,560",
            "--hide-scrollbars",
          ],
        },
      },
    },
  });
  sessionId = session.sessionId;
  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(550);
  await mkdir(outputDir, { recursive: true });

  const start = await clickButton(sessionId, "START FIGHT");
  if (!start?.clicked) throw new Error(`START FIGHT unavailable: ${JSON.stringify(start)}`);
  await delay(120);
  const engage = await clickButton(sessionId, "ENGAGE");
  if (!engage?.clicked) throw new Error(`ENGAGE unavailable: ${JSON.stringify(engage)}`);

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ready = await execute(sessionId, `${gameLookup}
      const game = findGame();
      const canvas = document.querySelector('.scene-host canvas');
      return Boolean(game && canvas && canvas.width > 2 && canvas.height > 2);
    `);
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("TPS Combat v2 WebGL runtime did not become ready");

  const viewport = await setIphoneViewport(sessionId);
  if (viewport.scrollWidth !== 932 || viewport.scrollHeight !== 430) {
    throw new Error(`TPS Combat v2 viewport overflow: ${JSON.stringify(viewport)}`);
  }

  await execute(sessionId, `${gameLookup}
    const game = findGame();
    cancelAnimationFrame(game.raf);
    game.running = false;
    return true;
  `);

  const adaptationProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    ${resetSnippet}
    game.p1.position.set(0, 0, 2.4);
    game.p2.position.set(0, 0, -2.4);
    game.playerStepSamples = 8;
    game.playerAttackSamples = 1;
    game.enemyAdaptReviewTicks = 1;
    game.enemyOpeningGraceTicks = 12;
    game.step();
    const antiStep = game.enemyAdaptation;
    const persona = game.enemyPersona;
    game.playerStepSamples = 1;
    game.playerAttackSamples = 8;
    game.enemyAdaptReviewTicks = 1;
    game.step();
    const antiRush = game.enemyAdaptation;
    return { persona, antiStep, antiRush };
  `);
  if (!['BRAWLER', 'SKIRMISHER'].includes(adaptationProbe?.persona)
    || adaptationProbe?.antiStep !== 'ANTI_STEP'
    || adaptationProbe?.antiRush !== 'ANTI_RUSH') {
    throw new Error(`CPU adaptation probe failed: ${JSON.stringify(adaptationProbe)}`);
  }

  const earlyStep = await execute(sessionId, `${gameLookup}
    const game = findGame();
    ${resetSnippet}
    game.p1.position.set(0, 0, 0.72);
    game.p2.position.set(0, 0, -0.72);
    game.enemyDirectorPendingMove = 'jab';
    game.enemyDirectorTelegraphTicks = 10;
    game.enemyDirectorTelegraphTotalTicks = 18;
    game.enemyDirectorDecision = {
      intent: 'JAB', holdTicks: 1, telegraphTicks: 18,
      reason: 'watch-step-audit', comebackMercy: 0, pressure: 0,
    };
    game.p2.visual.root.userData.tpsEnemyTelegraphProgress = 1 - 10 / 18;
    game.p2.visual.root.userData.tpsEnemyTelegraphMove = 'jab';
    game.p2.visual.root.userData.tpsEnemyTelegraphPhase = 'REACT';
    const threatBefore = game.enemyThreatStatus();
    game.press('right', 'watch-step-side');
    game.press('guard', 'watch-step');
    game.step();
    game.release('guard', 'watch-step');
    game.release('right', 'watch-step-side');
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      threatBefore,
      tracked: game.playerStepThreatTicks,
      justStepTicks: game.playerJustStepTicks,
      breakCounterTicks: game.playerBreakCounterTicks,
      perfectEvades: game.trainingProgress.perfectEvades,
    };
  `);
  await delay(60);
  if (earlyStep?.threatBefore?.timing !== 'WATCH' || earlyStep?.tracked !== 0 || earlyStep?.justStepTicks !== 0 || earlyStep?.breakCounterTicks !== 0 || earlyStep?.perfectEvades !== 0) {
    throw new Error(`EARLY WATCH STEP incorrectly earned reward: ${JSON.stringify(earlyStep)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-watch-step.png`);

  const reactableStep = await execute(sessionId, `${gameLookup}
    const game = findGame();
    ${resetSnippet}
    game.p1.position.set(0, 0, 0.72);
    game.p2.position.set(0, 0, -0.72);
    game.enemyDirectorPendingMove = 'jab';
    game.enemyDirectorTelegraphTicks = 6;
    game.enemyDirectorTelegraphTotalTicks = 18;
    game.enemyDirectorDecision = {
      intent: 'JAB', holdTicks: 1, telegraphTicks: 18,
      reason: 'reactable-step-audit', comebackMercy: 0, pressure: 0,
    };
    game.p2.visual.root.userData.tpsEnemyTelegraphProgress = 1 - 6 / 18;
    game.p2.visual.root.userData.tpsEnemyTelegraphMove = 'jab';
    game.p2.visual.root.userData.tpsEnemyTelegraphPhase = 'REACT';
    const threatBefore = game.enemyThreatStatus();
    game.press('right', 'reactable-step-side');
    game.press('guard', 'reactable-step');
    game.step();
    game.release('guard', 'reactable-step');
    game.release('right', 'reactable-step-side');
    const trackedBeforeAttack = game.playerStepThreatTicks;
    let steps = 1;
    while (steps < 60 && game.trainingProgress.perfectEvades < 1) {
      game.renderTime += 1 / 60;
      game.step();
      steps += 1;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      steps,
      threatBefore,
      trackedBeforeAttack,
      perfectEvades: game.trainingProgress.perfectEvades,
      p1Health: game.p1.health,
      reversalTicks: game.playerReversalTicks,
      justStepTicks: game.playerJustStepTicks,
      breakCounterTicks: game.playerBreakCounterTicks,
      timing: game.enemyThreatStatus().timing,
      beat: game.combatBeatLabel,
    };
  `);
  await delay(60);
  if (!reactableStep?.threatBefore?.incoming || reactableStep?.threatBefore?.timing !== 'SLIP' || reactableStep?.trackedBeforeAttack <= 0 || reactableStep?.perfectEvades < 1 || reactableStep?.breakCounterTicks <= 0 || reactableStep?.beat !== 'JUST STEP' || reactableStep?.p1Health < 100) {
    throw new Error(`REACTABLE STEP browser probe failed: ${JSON.stringify(reactableStep)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-reactable-step.png`);

  const intercept = await execute(sessionId, `${gameLookup}
    const game = findGame();
    ${resetSnippet}
    game.enemyDirectorPendingMove = 'power';
    game.enemyDirectorTelegraphTicks = 18;
    game.enemyDirectorTelegraphTotalTicks = 23;
    game.enemyDirectorDecision = {
      intent: 'POWER', holdTicks: 1, telegraphTicks: 18,
      reason: 'tps-v2-audit-windup', comebackMercy: 0, pressure: 0,
    };
    game.p2.state = 'GUARD';
    game.press('punch', 'tps-v2-intercept');
    game.step();
    game.release('punch', 'tps-v2-intercept');
    let steps = 1;
    while (steps < 50 && game.p2.visual.root.userData.tpsReactionType !== 'INTERCEPT') {
      game.renderTime += 1 / 60;
      game.step();
      steps += 1;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      steps,
      move: game.p1.currentMove?.id ?? null,
      p2Health: game.p2.health,
      p2State: game.p2.state,
      reaction: game.p2.visual.root.userData.tpsReactionType ?? null,
      reactionStrength: game.p2.visual.root.userData.tpsReactionStrength ?? 0,
      beat: game.combatBeatLabel,
      pendingMove: game.enemyDirectorPendingMove,
      telegraphTicks: game.enemyDirectorTelegraphTicks,
    };
  `);
  await delay(60);
  if (intercept?.reaction !== 'INTERCEPT' || intercept?.p2Health >= 100 || !['INTERCEPT', 'BREAK LINE', 'BLUE SHIFT'].includes(intercept?.beat)) {
    throw new Error(`INTERCEPT browser probe failed: ${JSON.stringify(intercept)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-v2-intercept.png`);

  const reversal = await execute(sessionId, `${gameLookup}
    const game = findGame();
    ${resetSnippet}
    if (!game.p2.beginMove('power')) return { error: 'enemy-power-begin-failed' };
    game.p2.moveTick = Math.max(0, game.p2.currentMove.startup - 1);
    game.press('right', 'tps-v2-reversal-side');
    game.press('guard', 'tps-v2-reversal-step');
    game.step();
    game.release('guard', 'tps-v2-reversal-step');
    game.release('right', 'tps-v2-reversal-side');
    let evadeSteps = 1;
    while (evadeSteps < 12 && game.playerReversalTicks <= 0) {
      game.renderTime += 1 / 60;
      game.step();
      evadeSteps += 1;
    }
    const earnedWindow = game.playerReversalTicks;
    game.p2.currentMove = null;
    game.p2.moveTick = 0;
    game.p2.state = 'IDLE';
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (!['HIT', 'KNOCKDOWN', 'KO'].includes(game.p2.state)) game.p2.state = 'IDLE';
    };
    const bufferedDuringStep = game.playerEvadeTicks > 0;
    game.press('punch', 'tps-v2-reversal-attack');
    game.step();
    const didNotCancelStep = game.p1.state === 'SIDESTEP';
    game.release('punch', 'tps-v2-reversal-attack');
    while (game.playerEvadeTicks > 0 && evadeSteps < 20) {
      game.renderTime += 1 / 60;
      game.step();
      evadeSteps += 1;
    }
    game.step();
    const move = game.p1.currentMove?.id ?? null;
    let attackSteps = 1;
    while (attackSteps < 55 && game.p2.visual.root.userData.tpsReactionType !== 'BREAK_COUNTER') {
      game.renderTime += 1 / 60;
      game.step();
      attackSteps += 1;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      earnedWindow,
      bufferedDuringStep,
      didNotCancelStep,
      evadeSteps,
      attackSteps,
      move,
      reaction: game.p2.visual.root.userData.tpsReactionType ?? null,
      reactionStrength: game.p2.visual.root.userData.tpsReactionStrength ?? 0,
      p2Health: game.p2.health,
      beat: game.combatBeatLabel,
    };
  `);
  await delay(60);
  if (!reversal?.bufferedDuringStep || !reversal?.didNotCancelStep || reversal?.earnedWindow <= 0 || reversal?.move !== 'counter' || reversal?.reaction !== 'BREAK_COUNTER' || reversal?.p2Health >= 100) {
    throw new Error(`REVERSAL browser probe failed: ${JSON.stringify(reversal)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-v2-reversal.png`);

  const finalImpact = await execute(sessionId, `${gameLookup}
    const game = findGame();
    ${resetSnippet}
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (!['HIT', 'KNOCKDOWN', 'KO'].includes(game.p2.state)) game.p2.state = 'IDLE';
    };
    game.p2.health = 1;
    if (!game.p1.beginMove('power')) return { error: 'player-power-begin-failed' };
    let steps = 0;
    while (steps < 60 && game.p2.visual.root.userData.tpsReactionType !== 'FINISHER') {
      game.renderTime += 1 / 60;
      game.step();
      steps += 1;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      steps,
      p2Health: game.p2.health,
      p2State: game.p2.state,
      reaction: game.p2.visual.root.userData.tpsReactionType ?? null,
      reactionStrength: game.p2.visual.root.userData.tpsReactionStrength ?? 0,
      beat: game.combatBeatLabel,
      beatTicks: game.combatBeatTicks,
      finishPending: game.finishPending,
      cameraImpact: game.cameraImpact,
    };
  `);
  await delay(60);
  if (finalImpact?.reaction !== 'FINISHER' || finalImpact?.p2Health > 0 || finalImpact?.beat !== 'FINAL IMPACT' || !finalImpact?.finishPending) {
    throw new Error(`FINAL IMPACT browser probe failed: ${JSON.stringify(finalImpact)}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-v2-final-impact.png`);

  const uiProbe = await execute(sessionId, `return {
    stepButton: [...document.querySelectorAll('button')].some((entry) => entry.getAttribute('aria-label') === 'Step'),
    attackButton: [...document.querySelectorAll('button')].some((entry) => entry.getAttribute('aria-label') === 'Attack'),
    touchActionLabels: [...document.querySelectorAll('.action-buttons button')].map((entry) => entry.getAttribute('aria-label')),
    bodyText: document.body.innerText,
  };`);
  if (!uiProbe?.stepButton || !uiProbe?.attackButton || JSON.stringify(uiProbe.touchActionLabels) !== JSON.stringify(['Step', 'Attack'])) {
    throw new Error(`TPS v2 two-button contract failed: ${JSON.stringify(uiProbe)}`);
  }

  await command(`/session/${sessionId}/url`, "POST", { url });
  await delay(650);
  const trainingStart = await clickButton(sessionId, "TRAINING");
  if (!trainingStart?.clicked) throw new Error("Training entry missing");
  let trainingReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    trainingReady = await execute(sessionId, `${gameLookup}
      const game = findGame();
      return Boolean(game && document.querySelector('.scene-host canvas'));
    `);
    if (trainingReady) break;
    await delay(100);
  }
  if (!trainingReady) throw new Error("Training runtime unavailable");
  await delay(1200);
  const trainingProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    if (!game || !game.options.training) return { error: 'not-training' };
    cancelAnimationFrame(game.raf);
    game.paused = false;
    game.input.clear();
    game.p1.resetForRound(0, .72, 1);
    game.p2.resetForRound(0, -.72, -1);
    game.updateEnemy = () => game.p2.updatePhysics(1 / 60);
    game.p1.beginMove('jab');
    for (let n = 0; n < 40; n++) game.step();
    game.publishHud(true);
    return { hits: game.trainingProgress.hits, timer: game.timerTicks, training: game.options.training };
  `);
  await delay(100);
  const lessonAfterHit = await execute(sessionId, `return document.querySelector('.training-coach strong')?.textContent;`);
  if (trainingProbe?.hits !== 1 || lessonAfterHit !== 'STEP') throw new Error('Training hit did not advance: ' + JSON.stringify({trainingProbe, lessonAfterHit}));
  const practiceReset = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.p2.health = 0;
    for (let n = 0; n < 165; n++) game.step();
    game.publishHud(true);
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { health: game.p2.health, finished: game.finished, hits: game.trainingProgress.hits, timer: game.timerTicks };
  `);
  await delay(100);
  const trainingLayout = await execute(sessionId, `
    const coach = document.querySelector('.training-coach');
    const box = coach?.getBoundingClientRect();
    return { lesson: coach?.querySelector('strong')?.textContent, fontSize: coach ? getComputedStyle(coach.querySelector('p')).fontSize : null,
      onScreen: !!box && box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth };
  `);
  if (practiceReset?.health !== 100 || practiceReset?.finished || practiceReset?.hits !== 1 || trainingLayout?.lesson !== 'STEP' || !trainingLayout.onScreen) {
    throw new Error('Training KO incorrectly completed or froze practice: ' + JSON.stringify({practiceReset, trainingLayout}));
  }
  await screenshot(sessionId, `${outputDir}/tps-training-practice.png`);

  const report = { viewport, adaptationProbe, earlyStep, justStep: reactableStep, intercept, breakCounter: reversal, finalImpact, trainingProbe, practiceReset, trainingLayout, ui: {
    stepButton: uiProbe.stepButton,
    attackButton: uiProbe.attackButton,
    touchActionLabels: uiProbe.touchActionLabels,
  } };
  await writeFile(`${outputDir}/tps-combat-v2.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}

