import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const driver = process.env.WEBDRIVER_BIN;
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const outputDir = process.env.TPS_AUDIT_DIR ?? "artifacts/tps-visual-audit";
if (!driver) throw new Error("WEBDRIVER_BIN is required");

const port = 9521;
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

async function screenshot(sessionId, path) {
  const encoded = await command(`/session/${sessionId}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 128 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Motion screenshot is not PNG: ${path}`);
  }
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

const resetAndPose = `
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

  function resetTpsTransient(game) {
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerEvadeSign = 0;
    game.playerStepForwardWeight = 0;
    game.playerStepSideWeight = 0;
    game.effects?.update?.(10);
    game.__hypeDirector?.reset?.(game.camera);
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
      spine02: point(get('spine_02')),
      chest: point(get('spine_03')),
      neck: point(get('neck_01')),
      head: point(get('head')),
      upperArmL: point(get('upperarm_l')),
      upperArmR: point(get('upperarm_r')),
      elbowL: point(get('lowerarm_l')),
      elbowR: point(get('lowerarm_r')),
      handL: point(get('hand_l')),
      handR: point(get('hand_r')),
      footL: point(get('foot_l')),
      footR: point(get('foot_r')),
    };
  }
`;

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function poseDistance(a, b) {
  if (!a?.points || !b?.points) return 0;
  const keys = ["head", "handL", "handR", "footL", "footR"];
  return keys.reduce((sum, key) => sum + distance(a.points[key], b.points[key]), 0);
}

function torsoPosture(points, neutralPoints) {
  if (!points?.pelvis || !points?.upperArmL || !points?.upperArmR || !points?.chest || !points?.neck
      || !neutralPoints?.pelvis || !neutralPoints?.upperArmL || !neutralPoints?.upperArmR || !neutralPoints?.chest || !neutralPoints?.neck) return null;
  const midpoint = (p) => ({
    x: (p.upperArmL.x + p.upperArmR.x) * 0.5,
    y: (p.upperArmL.y + p.upperArmR.y) * 0.5,
    z: (p.upperArmL.z + p.upperArmR.z) * 0.5,
  });
  const ratioFor = (top, pelvis) => {
    const vertical = Math.abs(top.y - pelvis.y);
    const horizontal = Math.hypot(top.x - pelvis.x, top.z - pelvis.z);
    return { horizontal, vertical, ratio: vertical > 1e-5 ? horizontal / vertical : 99 };
  };
  const shoulder = midpoint(points);
  const neutralShoulder = midpoint(neutralPoints);
  const shoulderMetric = ratioFor(shoulder, points.pelvis);
  const chestMetric = ratioFor(points.chest, points.pelvis);
  const neckMetric = ratioFor(points.neck, points.pelvis);
  const neutralVertical = Math.abs(neutralShoulder.y - neutralPoints.pelvis.y);
  return {
    horizontal: shoulderMetric.horizontal,
    vertical: shoulderMetric.vertical,
    leanRatio: shoulderMetric.ratio,
    chestLeanRatio: chestMetric.ratio,
    neckLeanRatio: neckMetric.ratio,
    heightRetention: neutralVertical > 1e-5 ? shoulderMetric.vertical / neutralVertical : 0,
  };
}

const expectedClips = {
  jab: "PF_Jab_L",
  straight: "PF_Cross_R",
  bodyBlow: "PF_BodyBlow_L",
  backfist: "PF_Backfist_R",
  power: "PF_Power_R",
  kick: "PF_FrontKick_R",
  lowKick: "PF_LowKick_L",
  risingKick: "PF_RisingKick_R",
  dashKick: "PF_DashKick_R",
  throw: "PF_Throw",
  counter: "PF_Counter_L",
};

const authoredExpectedClips = {
  jab: "BF_Jab_L",
  straight: "BF_Cross_R",
  bodyBlow: "BF_BodyBlow_L",
  backfist: "BF_Backfist_R",
  power: "BF_Power_R",
  kick: "BF_FrontKick_R",
  lowKick: "BF_LowKick_L",
  risingKick: "BF_RisingKick_R",
  dashKick: "BF_DashKick_R",
};

const authoredMoves = new Set(Object.keys(authoredExpectedClips));
const moves = Object.keys(expectedClips);
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
  await delay(650);
  await execute(sessionId, `
    const current = JSON.parse(window.localStorage.getItem('poly-fighter-settings-v1') ?? '{}');
    window.localStorage.setItem('poly-fighter-settings-v1', JSON.stringify({ ...current, motionCorrections: true }));
    window.location.reload();
    return true;
  `);
  await delay(650);
  if (!(await clickButton(sessionId, "TPS LOCK-ON BATTLE"))) throw new Error("TPS title button not found");
  await delay(120);
  if (!(await clickButton(sessionId, "ENGAGE TPS"))) throw new Error("TPS engage button not found");

  let preload = null;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    preload = await execute(sessionId, `${gameLookup}
      const game = findGame();
      if (!game) return null;
      const root = game.p1.visual.root;
      return {
        ready: root.userData.motionExpansionHasProcedural === true && root.userData.motionExpansionProceduralClipCount === 23,
        clips: root.userData.motionExpansionClipCount ?? 0,
        version: root.userData.motionExpansionVersion ?? null,
        proceduralVersion: root.userData.motionExpansionProceduralVersion ?? null,
        proceduralClips: root.userData.motionExpansionProceduralClipCount ?? 0,
        procedural: root.userData.motionExpansionHasProcedural ?? false,
        loading: root.userData.motionExpansionLoading ?? null,
      };
    `);
    if (preload?.ready) break;
    await delay(100);
  }
  if (!preload?.ready || preload.version !== "MOTION_QUALITY_V3" || preload.proceduralVersion !== "PROCEDURAL_FIGHT_V3") {
    throw new Error(`Motion packs were not preloaded in neutral: ${JSON.stringify(preload)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const freeze = await execute(sessionId, `${gameLookup}
    const game = findGame();
    cancelAnimationFrame(game.raf);
    game.running = false;
    game.finished = false;
    game.input.clear();
    game.enemyOpeningGraceTicks = 9999;
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (!['HIT', 'KNOCKDOWN', 'KO', 'THROW'].includes(game.p2.state)) game.p2.state = 'IDLE';
    };
    return true;
  `);
  if (!freeze) throw new Error("Could not freeze TPS game for deterministic motion audit");

  const neutral = await execute(sessionId, `${gameLookup}${resetAndPose}
    const game = findGame();
    resetFighter(game.p1);
    resetFighter(game.p2);
    resetTpsTransient(game);
    game.p1.position.set(0, 0, 0.74);
    game.p2.position.set(0, 0, -0.48);
    game.p1.facing = 1;
    game.p2.facing = -1;
    let auditTime = performance.now() / 1000;
    for (let step = 0; step < 8; step += 1) {
      auditTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, auditTime);
      game.updateVisual(game.p2, game.p1, auditTime + 0.007);
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const host = game.p1.visual.root.children.find((child) => child.name?.startsWith('quaternius-ubc-') && child.name?.endsWith('-runtime'));
    let fistMeshCount = 0;
    game.p1.visual.root.traverse((object) => { if (object.name?.endsWith('-fist')) fistMeshCount += 1; });
    return {
      points: bonePoints(game.p1),
      visibleClip: host?.userData?.quaterniusCurrentClip ?? null,
      fistMeshCount,
      correctionsEnabled: game.p1.visual.root.userData.motionCorrectionsEnabled === true,
      correctionPolicy: game.p1.visual.root.userData.motionCorrectionPolicy ?? null,
    };
  `);
  await screenshot(sessionId, `${outputDir}/tps-motion-neutral-arm.png`);
  if (!neutral?.points) throw new Error(`Neutral imported arm points missing: ${JSON.stringify(neutral)}`);
  for (const side of ['L', 'R']) {
    const elbow = neutral.points[`elbow${side}`];
    const hand = neutral.points[`hand${side}`];
    if (!elbow || !hand) throw new Error(`Neutral ${side} arm chain missing: ${JSON.stringify(neutral)}`);
    const chest = neutral.points.chest;
    if (!chest) throw new Error(`Neutral chest point missing: ${JSON.stringify(neutral)}`);
    // Safe-assist intentionally avoids forcing a high fist. A compact fighting
    // forearm may slope down from the elbow; only reject a truly hanging arm.
    if (hand.y < elbow.y - 0.17 || hand.y < chest.y - 0.12) {
      throw new Error(`Neutral ${side} forearm hangs too low: ${JSON.stringify({ elbow, hand, chest, neutral })}`);
    }
  }
  if (!neutral.correctionsEnabled || neutral.correctionPolicy !== "PROCEDURAL_ASSIST") {
    throw new Error(`Motion readability audit is not running with safe assist enabled: ${JSON.stringify(neutral)}`);
  }
  if (neutral.fistMeshCount < 2) throw new Error(`Readable fist geometry missing: ${JSON.stringify(neutral)}`);

  const results = {};
  for (const moveId of moves) {
    const result = await execute(sessionId, `${gameLookup}${resetAndPose}
      const moveId = arguments[0];
      const game = findGame();
      resetFighter(game.p1);
      resetFighter(game.p2);
      resetTpsTransient(game);
      game.finished = false;
      game.input.clear();
      game.p1.position.set(0, 0, 0.74);
      game.p2.position.set(0, 0, -0.48);
      game.p1.facing = 1;
      game.p2.facing = -1;
      // resetFighter clears gameplay state but the Three.js mixer still contains
      // the previous sampled move. Let Idle_Loop fully win its short crossfade
      // before capturing a new move so every readability sample starts from the
      // same grounded neutral pose instead of inheriting a prior ACTIVE kick.
      let auditTime = performance.now() / 1000;
      for (let settle = 0; settle < 8; settle += 1) {
        auditTime += 1 / 60;
        game.updateVisual(game.p1, game.p2, auditTime);
        game.updateVisual(game.p2, game.p1, auditTime + 0.007);
      }
      if (!game.p1.beginMove(moveId)) return { error: 'move-not-found', moveId };
      const move = game.p1.currentMove;
      let activeReached = false;
      let steps = 0;
      for (; steps < 90; steps += 1) {
        // Hits in the previous or current frame are allowed to create normal
        // presentation hit-stop, but the audit itself must not let that freeze
        // obscure the requested move's ACTIVE pose.
        game.p1.hitStop = 0;
        game.p2.hitStop = 0;
        game.step();
        game.p1.hitStop = 0;
        game.p2.hitStop = 0;
        auditTime += 1 / 60;
        game.updateVisual(game.p1, game.p2, auditTime);
        game.updateVisual(game.p2, game.p1, auditTime + 0.007);
        const policy = game.p1.visual.root.userData.motionCorrectionPolicy;
        const phase = game.p1.visual.root.userData.motionExpansionPhase;
        const authoredContactTick = move.startup + move.active - 1;
        const authoredContactReady = game.p1.isActive() && game.p1.moveTick >= authoredContactTick;
        if (game.p1.state === 'ATTACK' && (policy === 'AUTHORED_ATTACK_PRESERVE' ? authoredContactReady : phase === 'ACTIVE')) {
          activeReached = true;
          break;
        }
        if (game.p1.state !== 'ATTACK') break;
      }
      game.updateCamera(1 / 60);
      game.updateLockOn();
      game.renderer.render(game.scene, game.camera);
      const root = game.p1.visual.root;
      const importedHost = root.children.find((child) => child.name?.startsWith('quaternius-ubc-') && child.name?.endsWith('-runtime'));
      let fistMeshCount = 0;
      root.traverse((object) => { if (object.name?.endsWith('-fist')) fistMeshCount += 1; });
      const points = bonePoints(game.p1);
      const contact = move.visualContact ?? null;
      const strikePoint = !points ? null
        : contact === 'LEFT_FIST' ? points.handL
        : contact === 'RIGHT_FIST' ? points.handR
        : contact === 'LEFT_FOOT' ? points.footL
        : contact === 'RIGHT_FOOT' ? points.footR
        : points.pelvis;
      return {
        moveId,
        activeReached,
        steps,
        moveTick: game.p1.moveTick,
        state: game.p1.state,
        clip: root.userData.motionExpansionCurrentClip ?? null,
        baselineClip: importedHost?.userData?.quaterniusCurrentClip ?? null,
        visibleTarget: root.userData.motionExpansionTargetsVisibleQuaternius === true,
        targetHost: root.userData.motionExpansionTargetHost ?? null,
        targetModelName: root.userData.motionExpansionTargetModelName ?? null,
        fistMeshCount,
        phase: root.userData.motionExpansionPhase ?? null,
        correctionPolicy: root.userData.motionCorrectionPolicy ?? null,
        contactMode: root.userData.motionExpansionContactMode ?? null,
        contact,
        points,
        strikePoint,
        targetHealth: game.p2.health,
        balanceVersion: root.userData.motionExpansionBalanceVersion ?? null,
        poseGraph: root.userData.motionExpansionPoseGraph ?? null,
        footLockPolicy: root.userData.motionExpansionFootLockPolicy ?? null,
        footLockError: root.userData.motionExpansionFootLockError ?? null,
        comPolicy: root.userData.motionExpansionComPolicy ?? null,
        motionDna: root.userData.motionExpansionMotionDna ?? null,
        visualReadabilityVersion: root.userData.motionExpansionVisualReadabilityVersion ?? null,
        kickContactSolver: root.userData.motionExpansionKickContactSolver ?? null,
        strikeContactError: root.userData.motionExpansionStrikeContactError ?? null,
        strikeContactBlend: root.userData.motionExpansionStrikeContactBlend ?? null,
      };
    `, [moveId]);
    if (result?.error) throw new Error(`Motion pose failed for ${moveId}: ${JSON.stringify(result)}`);
    results[moveId] = result;
    await screenshot(sessionId, `${outputDir}/tps-motion-${moveId.toLowerCase()}.png`);
  }

  for (const [moveId, expected] of Object.entries(expectedClips)) {
    const result = results[moveId];
    if (!result) throw new Error(`Missing motion result for ${moveId}`);
    if (!result.activeReached || result.state !== "ATTACK") {
      throw new Error(`Motion ${moveId} was not captured during ACTIVE: ${JSON.stringify(result)}`);
    }

    if (authoredMoves.has(moveId)) {
      const authoredClip = authoredExpectedClips[moveId];
      if (result.correctionPolicy !== "AUTHORED_ATTACK_PRESERVE") {
        throw new Error(`Motion ${moveId} did not preserve authored correction policy: ${JSON.stringify(result)}`);
      }
      if (result.baselineClip !== authoredClip) {
        throw new Error(`Motion ${moveId} rendered ${result.baselineClip}, expected authored ${authoredClip}: ${JSON.stringify(result)}`);
      }
      if (result.fistMeshCount < 2) {
        throw new Error(`User-facing fist silhouette missing during ${moveId}: ${JSON.stringify(result)}`);
      }
      continue;
    }

    if (result.phase !== "ACTIVE" || result.clip !== expected) {
      throw new Error(`Motion ${moveId} resolved to ${result.clip}/${result.phase}, expected ${expected}/ACTIVE: ${JSON.stringify(result)}`);
    }
    if (!result.visibleTarget || typeof result.targetHost !== "string" || !result.targetHost.endsWith("-runtime")) {
      throw new Error(`Motion Expansion is not driving the rendered Quaternius model during ${moveId}: ${JSON.stringify(result)}`);
    }
    if (result.fistMeshCount < 2) {
      throw new Error(`User-facing fist silhouette missing during ${moveId}: ${JSON.stringify(result)}`);
    }
    if (result.contactMode !== "V3_FULL_BODY_TARGET_IK") {
      throw new Error(`Motion ${moveId} did not use V3 full-body target IK: ${JSON.stringify(result)}`);
    }
    if (result.balanceVersion !== "FULL_BODY_SOLVER_V3") {
      throw new Error(`Motion ${moveId} did not publish the V3 full-body solver contract: ${JSON.stringify(result)}`);
    }
    if (result.poseGraph !== "9_POSE_GRAPH" || result.comPolicy !== "PLANT_WEIGHTED_BOUNDED_COM") {
      throw new Error(`Motion ${moveId} did not publish Pose Graph / COM V3 contracts: ${JSON.stringify(result)}`);
    }
    if (result.motionDna !== "KAIRO_POWER") {
      throw new Error(`KAIRO motion DNA was not active for ${moveId}: ${JSON.stringify(result)}`);
    }
    if (result.visualReadabilityVersion !== "PROCEDURAL_FIGHT_V3_READABILITY_3") {
      throw new Error(`Motion ${moveId} did not publish v3.2 readability telemetry: ${JSON.stringify(result)}`);
    }
    if (result.footLockPolicy !== "WORLD_SPACE_SUPPORT_FOOT_IK" || !Number.isFinite(result.footLockError) || result.footLockError > 0.025) {
      throw new Error(`Motion ${moveId} support foot lock drifted: ${JSON.stringify(result)}`);
    }
  }

  const impactPair = await execute(sessionId, `${gameLookup}${resetAndPose}
    const game = findGame();
    resetFighter(game.p1);
    resetFighter(game.p2);
    resetTpsTransient(game);
    game.finished = false;
    game.input.clear();
    game.p1.position.set(0, 0, 0.54);
    game.p2.position.set(0, 0, -0.42);
    game.p1.facing = 1;
    game.p2.facing = -1;
    if (!game.p1.beginMove('power')) return { error: 'power-not-found' };
    let auditTime = performance.now() / 1000;
    let hit = false;
    for (let step = 0; step < 70; step += 1) {
      game.step();
      auditTime += 1 / 60;
      if (['HIT', 'KNOCKDOWN', 'THROW', 'KO', 'RING_OUT'].includes(game.p2.state) && (game.p1.hitStop > 0 || game.p2.hitStop > 0)) {
        game.updateVisual(game.p1, game.p2, auditTime);
        game.updateVisual(game.p2, game.p1, auditTime + 0.007);
        hit = true;
        break;
      }
      if (game.p1.state !== 'ATTACK') break;
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      hit,
      attackerRole: game.p1.visual.root.userData.motionExpansionImpactPairRole ?? null,
      victimRole: game.p2.visual.root.userData.motionExpansionImpactPairRole ?? null,
      attackerPolicy: game.p1.visual.root.userData.motionCorrectionPolicy ?? null,
      attackerDna: game.p1.visual.root.userData.motionExpansionMotionDna ?? null,
      victimHealth: game.p2.health,
      victimState: game.p2.state,
    };
  `);
  await screenshot(sessionId, `${outputDir}/tps-motion-impact-pair.png`);
  if (!impactPair?.hit
      || impactPair.attackerPolicy !== "AUTHORED_ATTACK_PRESERVE"
      || impactPair.attackerRole === "ATTACKER"
      || impactPair.victimRole !== "VICTIM") {
    throw new Error(`Authored-impact / victim-reaction contract failed: ${JSON.stringify(impactPair)}`);
  }

  const torsoPostures = Object.fromEntries(
    Object.entries(results).map(([moveId, result]) => [moveId, torsoPosture(result.points, neutral.points)]),
  );
  for (const moveId of ["jab", "straight", "bodyBlow", "backfist", "power", "kick", "lowKick", "risingKick", "throw", "counter"]) {
    const posture = torsoPostures[moveId];
    if (!posture || posture.leanRatio > 0.52 || posture.chestLeanRatio > 0.42 || posture.neckLeanRatio > 0.48 || posture.heightRetention < 0.68) {
      throw new Error(`Motion ${moveId} collapses the torso chain: ${JSON.stringify(posture)}`);
    }
  }
  const dashPosture = torsoPostures.dashKick;
  if (!dashPosture || dashPosture.leanRatio > 0.72 || dashPosture.chestLeanRatio > 0.65 || dashPosture.neckLeanRatio > 0.72 || dashPosture.heightRetention < 0.55) {
    throw new Error(`Dash kick folds the body instead of driving through the target: ${JSON.stringify(dashPosture)}`);
  }

  const distinctPairs = [
    ["jab", "straight"],
    ["backfist", "bodyBlow"],
    ["backfist", "power"],
    ["bodyBlow", "power"],
  ];
  const pairDistances = {};
  for (const [a, b] of distinctPairs) {
    const value = poseDistance(results[a], results[b]);
    const pairKey = `${a}:${b}`;
    pairDistances[pairKey] = value;
    // Raw Blender backfist/power remain visually distinct but no longer receive
    // Motion Expansion's artificial endpoint separation. Keep the old 0.08
    // floor everywhere else and use the audited authored baseline for this pair.
    const minimumDistance = pairKey === "backfist:power" ? 0.06 : 0.08;
    if (value < minimumDistance) {
      throw new Error(`Motion silhouettes remain too similar for ${a}/${b}: ${value.toFixed(4)} < ${minimumDistance.toFixed(4)}`);
    }
  }

  const kickY = results.kick?.strikePoint?.y;
  const lowY = results.lowKick?.strikePoint?.y;
  const risingY = results.risingKick?.strikePoint?.y;
  if (![kickY, lowY, risingY].every(Number.isFinite)) {
    throw new Error(`Kick strike points missing: ${JSON.stringify({ kickY, lowY, risingY })}`);
  }
  const minimumLowKickDrop = 0.04;
  if (!(lowY < kickY - minimumLowKickDrop)) {
    throw new Error(`LOW KICK is not visibly lower than front kick: ${JSON.stringify({ lowY, kickY, minimumLowKickDrop })}`);
  }
  if (!(risingY > kickY + 0.08)) {
    throw new Error(`RISING KICK is not visibly higher than front kick: ${JSON.stringify({ risingY, kickY })}`);
  }

  const diagnostics = {
    preload,
    neutral,
    allMovesActive: Object.values(results).every((result) => result.activeReached === true),
    pairDistances,
    torsoPostures,
    kickHeights: { lowY, kickY, risingY },
    impactPair,
    moves: results,
  };
  await writeFile(`${outputDir}/motion-readability.json`, JSON.stringify(diagnostics, null, 2));
  console.log(JSON.stringify(diagnostics, null, 2));
} finally {
  if (sessionId) await command(`/session/${sessionId}`, "DELETE").catch(() => undefined);
  driverProcess.kill("SIGTERM");
}
