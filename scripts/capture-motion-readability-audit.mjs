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
      head: point(get('Head') ?? get('head')),
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
  // The main TPS route has used baked video-reference choreography for these
  // four basic moves since the clip-level attack override. Require the exact
  // rendered clip, not the retired Blender source that produced the pre-V2 pose.
  jab: "CM_Video_Jab",
  straight: "BF_Cross_R",
  bodyBlow: "BF_BodyBlow_L",
  backfist: "CM_Video_Palm",
  power: "BF_Power_R",
  kick: "CM_Video_SideKick",
  lowKick: "BF_LowKick_L",
  risingKick: "CM_Video_SpinKick",
  dashKick: "BF_DashKick_R",
  counter: "CM_Counter_L",
  throw: "CM_Throw",
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
  if (!(await clickButton(sessionId, "START FIGHT"))) throw new Error("TPS title button not found");
  await delay(120);
  if (!(await clickButton(sessionId, "ENGAGE"))) throw new Error("TPS engage button not found");

  let preload = null;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    preload = await execute(sessionId, `${gameLookup}
      const game = findGame();
      if (!game) return null;
      const root = game.p1.visual.root;
      return {
        ready: root.userData.combatMotionClipCount >= 27,
        clips: root.userData.combatMotionClipCount ?? 0,
        version: root.userData.combatMotionVersion ?? null,
        timeline: root.userData.combatMotionTimelineVersion ?? null,
      };
    `);
    if (preload?.ready) break;
    await delay(100);
  }
  // The clip-library version describes source assets (V10_REFERENCE_KICKS).
  // Verify the independently published authoritative gameplay-tick timeline,
  // rather than assuming an obsolete suffix in an unrelated version string.
  const timelineRuntime = preload?.timeline === "GAMEPLAY_TICK_AUTHORED_EVENT_V1";
  if (!preload?.ready || preload.clips < 27 || !timelineRuntime) {
    throw new Error(`Motion packs were not preloaded with unified timeline runtime: ${JSON.stringify(preload)}`);
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
      gameplayPosition: { x: game.p1.position.x, y: game.p1.position.y, z: game.p1.position.z },
      visualRootPosition: point(game.p1.visual.root),
      importedHostPosition: point(host),
      importedHostLocalX: host?.position?.x ?? null,
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
  if (!neutral.correctionsEnabled || neutral.correctionPolicy !== "AUTHORED_COMBAT_PRESERVE" || !["CM_Ready", "CM_Turn_L", "CM_Turn_R"].includes(neutral.visibleClip)) {
    throw new Error(`Motion readability audit is not preserving the authored combat stance: ${JSON.stringify(neutral)}`);
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
      let peakStrikeY = -Infinity;
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
        // Gameplay ACTIVE ticks and the Blender-authored foot trajectory do not
        // share the same normalized clock. Track the actual rendered striking
        // foot through the sampled window instead of assuming the last ACTIVE
        // tick is the visual apex.
        if (moveId === 'risingKick') {
          const framePoints = bonePoints(game.p1);
          const frameStrikeY = move.visualContact === 'LEFT_FOOT'
            ? framePoints?.footL?.y
            : move.visualContact === 'RIGHT_FOOT'
              ? framePoints?.footR?.y
              : null;
          if (Number.isFinite(frameStrikeY)) peakStrikeY = Math.max(peakStrikeY, frameStrikeY);
        }
        const policy = game.p1.visual.root.userData.motionCorrectionPolicy;
        const phase = game.p1.visual.root.userData.motionExpansionPhase;
        const authoredContactTick = move.startup + move.active - 1;
        const lateContactSample = moveId === 'risingKick';
        const authoredContactReady = game.p1.isActive() && (!lateContactSample || game.p1.moveTick >= authoredContactTick);
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
        peakStrikeY: Number.isFinite(peakStrikeY) ? peakStrikeY : null,
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
      victimRole: game.p2.visual.root.userData.combatMotionCurrentClip ?? null,
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
      || !["CM_Down", "CM_Thrown", "CM_Launch"].includes(impactPair.victimRole)) {
    throw new Error(`Authored-impact / victim-reaction contract failed: ${JSON.stringify(impactPair)}`);
  }

  const torsoPostures = Object.fromEntries(
    Object.entries(results).map(([moveId, result]) => [moveId, torsoPosture(result.points, neutral.points)]),
  );
  // Print every actual rendered skeletal ratio BEFORE the first strict
  // assertion. One malformed move must never hide the other failure modes
  // behind repeated multi-minute CI reruns. Do not relax the thresholds.
  console.log("MOTION_TORSO_AUDIT=" + JSON.stringify(torsoPostures));
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

  // Punch contact should retain a grounded two-foot base. This is deliberately
  // measured from the rendered WebGL skeleton rather than gameplay position so
  // retarget/inertial changes cannot silently make a standing punch look airborne.
  for (const moveId of ["jab", "straight", "bodyBlow", "backfist", "power", "counter"]) {
    const leftY = results[moveId]?.points?.footL?.y;
    const rightY = results[moveId]?.points?.footR?.y;
    if (![leftY, rightY].every(Number.isFinite)) {
      throw new Error(`Punch foot samples missing for ${moveId}: ${JSON.stringify({ leftY, rightY })}`);
    }
    const highestFoot = Math.max(leftY, rightY);
    const lowestFoot = Math.min(leftY, rightY);
    if (!(highestFoot < 0.55) || !(lowestFoot > -0.25)) {
      throw new Error(`Punch lost its grounded base for ${moveId}: ${JSON.stringify({ leftY, rightY })}`);
    }
  }

  const kickY = results.kick?.strikePoint?.y;
  const lowY = results.lowKick?.strikePoint?.y;
  const risingY = results.risingKick?.peakStrikeY ?? results.risingKick?.strikePoint?.y;
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

  // Sakurai 036/049/062/077: capture actual motion beats, not just a
  // contact screenshot. Windup is sampled partway through STARTUP and
  // followthrough well into RECOVERY; the old first/last boundary-only
  // capture concealed almost all movement after the hit.
  // These are source-authored poses at exact game ticks, not stepped hitboxes.
  const sakuraiStoryboard = {};
  for (const moveId of ["jab", "power", "risingKick"]) {
    sakuraiStoryboard[moveId] = {};
    for (const stage of ["startup", "contact", "overtravel", "followthrough"]) {
      const frame = await execute(sessionId, `${gameLookup}${resetAndPose}
        const [moveId, stage] = arguments;
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
        let auditTime = performance.now() / 1000;
        for (let settle = 0; settle < 10; settle += 1) {
          auditTime += 1 / 60;
          game.updateVisual(game.p1, game.p2, auditTime);
          game.updateVisual(game.p2, game.p1, auditTime + 0.007);
        }
        // Report the outgoing close-neutral host lane so an apparent foot
        // slide cannot be confused with an authored skeleton weight shift.
        const beforeMove = {
          p1Mode: game.p1.visual.root.userData.tpsCloseNeutralLaneMode ?? "UNSET",
          p1Lane: Number(game.p1.visual.root.userData.tpsCloseNeutralLaneX ?? 0),
          p1Factor: Number(game.p1.visual.root.userData.tpsCloseNeutralLane ?? 0),
          p2Mode: game.p2.visual.root.userData.tpsCloseNeutralLaneMode ?? "UNSET",
          p2Lane: Number(game.p2.visual.root.userData.tpsCloseNeutralLaneX ?? 0),
          p1Residue: {
            attack: Number(game.p1.visual.root.userData.tpsAttackAfterfeel ?? 0),
            damage: Number(game.p1.visual.root.userData.tpsDamageAfterfeel ?? 0),
            punish: Number(game.p1.visual.root.userData.tpsPunishReadyPose ?? 0),
          },
          p2Residue: {
            attack: Number(game.p2.visual.root.userData.tpsAttackAfterfeel ?? 0),
            damage: Number(game.p2.visual.root.userData.tpsDamageAfterfeel ?? 0),
            punish: Number(game.p2.visual.root.userData.tpsPunishReadyPose ?? 0),
          },
        };
        if (!game.p1.beginMove(moveId)) return { error: "move-not-found", moveId };
        const move = game.p1.currentMove;
        const tick = stage === "startup"
          ? Math.max(1, Math.floor(move.startup * 0.45))
          : stage === "contact" ? move.startup
          : stage === "overtravel" ? move.startup + move.active - 1
          : Math.min(move.startup + move.active + move.recovery - 1,
            move.startup + move.active + Math.max(1, Math.round(move.recovery * 0.45)));
        game.p1.moveTick = tick;
        // Let imported-blender inertialization settle without advancing the
        // gameplay tick. This makes each still measure its authored pose.
        for (let settle = 0; settle < 10; settle += 1) {
          auditTime += 1 / 60;
          game.updateVisual(game.p1, game.p2, auditTime);
          game.updateVisual(game.p2, game.p1, auditTime + 0.007);
        }
        game.updateCamera(1 / 60);
        game.updateLockOn();
        game.renderer.render(game.scene, game.camera);
        const host = game.p1.visual.root.children.find((child) =>
          child.name?.startsWith("quaternius-ubc-") && child.name?.endsWith("-runtime"));
        return {
          moveId, stage, tick,
          clip: game.p1.visual.root.userData.combatMotionCurrentClip ?? null,
          phase: host?.userData?.combatMotionSampledPhase ?? null,
          timelineStage: host?.userData?.combatMotionTimelineStage ?? null,
          points: bonePoints(game.p1),
          gameplayPosition: { x: game.p1.position.x, y: game.p1.position.y, z: game.p1.position.z },
          visualRootPosition: point(game.p1.visual.root),
          importedHostPosition: point(host),
          importedHostLocalX: host?.position?.x ?? null,
          beforeMove,
          neutralLaneMode: game.p1.visual.root.userData.tpsCloseNeutralLaneMode ?? "UNSET",
          neutralLaneX: Number(game.p1.visual.root.userData.tpsCloseNeutralLaneX ?? 0),
          punchLaneX: Number(game.p1.visual.root.userData.tpsClosePunchLaneX ?? 0),
          punchLaneFactor: Number(game.p1.visual.root.userData.tpsClosePunchLane ?? 0),
          fighterState: game.p1.state,
        };
      `, [moveId, stage]);
      if (frame?.error || !frame?.points?.head || !Number.isFinite(frame?.phase)
          || !Number.isFinite(frame?.visualRootPosition?.x)
          || !Number.isFinite(frame?.importedHostPosition?.x)
          || frame.fighterState !== "ATTACK") {
        throw new Error(`Sakurai storyboard pose missing for ${moveId}/${stage}: ${JSON.stringify(frame)}`);
      }
      sakuraiStoryboard[moveId][stage] = frame;
      await screenshot(sessionId, `${outputDir}/tps-sakurai-${moveId.toLowerCase()}-${stage}.png`);
    }
    const frames = sakuraiStoryboard[moveId];
    if (!(frames.startup.phase < frames.contact.phase
        && frames.contact.phase <= frames.overtravel.phase
        && frames.overtravel.phase + 0.045 < frames.followthrough.phase)
        || frames.startup.timelineStage !== "STARTUP"
        || frames.contact.timelineStage !== "ACTIVE"
        || frames.overtravel.timelineStage !== "ACTIVE"
        || frames.followthrough.timelineStage !== "RECOVERY") {
      throw new Error(`Sakurai motion frames failed to show four distinct beats for ${moveId}: ${JSON.stringify(frames)}`);
    }
  }

  // Distinguish real IK foot travel from a presentation-root translation.
  // Do not classify every boot position change as an animation defect:
  // a kick intentionally lifts the striking leg, while a jab should not.
  const sakuraiRootAndFootTravel = Object.fromEntries(
    Object.entries(sakuraiStoryboard).map(([moveId, stages]) => {
      const rootTravel = distance(stages.startup.visualRootPosition, stages.contact.visualRootPosition);
      const hostTravel = distance(stages.startup.importedHostPosition, stages.contact.importedHostPosition);
      const footLTravel = distance(stages.startup.points.footL, stages.contact.points.footL);
      const footRTravel = distance(stages.startup.points.footR, stages.contact.points.footR);
      return [moveId, { rootTravel, hostTravel, footLTravel, footRTravel }];
    }),
  );
  // The independent storyboard resets each pose, so it cannot measure
  // the real standby-to-jab transition across continuous 60 Hz frames.
  const neutralToJab = await execute(sessionId, `${gameLookup}${resetAndPose}
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
    let sampleTime = performance.now() / 1000;
    const update = () => {
      sampleTime += 1 / 60;
      game.updateVisual(game.p1, game.p2, sampleTime);
      game.updateVisual(game.p2, game.p1, sampleTime + 0.007);
    };
    for (let i = 0; i < 48; i += 1) update();
    const sample = (label, tick) => {
      const root = game.p1.visual.root;
      const data = root.userData;
      const host = root.children.find((child) =>
        child.name?.startsWith("quaternius-ubc-") && child.name?.endsWith("-runtime"));
      const bones = bonePoints(game.p1);
      return {
        label, tick, fighterState: game.p1.state,
        gamePosition: { x: game.p1.position.x, y: game.p1.position.y, z: game.p1.position.z },
        root: point(root), host: point(host), hostLocalX: host?.position?.x ?? null,
        footL: bones?.footL ?? null, footR: bones?.footR ?? null,
        leftHand: bones?.handL ?? null,
        neutralMode: data.tpsCloseNeutralLaneMode ?? null,
        neutralFactor: Number(data.tpsCloseNeutralLane ?? 0),
        neutralX: Number(data.tpsCloseNeutralLaneX ?? 0),
        punchFactor: Number(data.tpsClosePunchLane ?? 0),
        punchLaneVersion: data.tpsClosePunchLaneVersion ?? null,
        punchX: Number(data.tpsClosePunchLaneX ?? 0),
        attackAfterfeel: Number(data.tpsAttackAfterfeel ?? 0),
        footlockVersion: data.tpsPunchFootlockVersion ?? null,
        footlockWeight: Number(data.tpsPunchFootlockWeight ?? 0),
        footlockActive: data.tpsPunchFootlockActive === true,
        leftFootImprovement: Number(data.tpsPunchFootlockLeftImprovement ?? 0),
        rightFootImprovement: Number(data.tpsPunchFootlockRightImprovement ?? 0),
      };
    };
    const idle = sample("idle", -1);
    if (!game.p1.beginMove("jab")) return { error: "jab-begin-failed", idle };
    const move = game.p1.currentMove;
    const samples = [];
    for (let tick = 0; tick < move.startup + move.active; tick += 1) {
      game.p1.moveTick = tick;
      update();
      samples.push(sample("jab", tick));
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const distance = (a, b) => a && b
      ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : NaN;
    const first = samples[0];
    const maxStep = (key) => Math.max(...samples.map((s, i) =>
      distance(s[key], i === 0 ? idle[key] : samples[i - 1][key])));
    return {
      idle, samples, startupTicks: move.startup,
      firstFrameHostTravel: distance(idle.host, first.host),
      firstFrameFootLTravel: distance(idle.footL, first.footL),
      firstFrameFootRTravel: distance(idle.footR, first.footR),
      maxFootLStep: maxStep("footL"),
      maxFootRStep: maxStep("footR"),
      maxHostStep: maxStep("host"),
      maxRootStep: maxStep("root"),
      totalAnkleImprovement: samples.reduce((total, frame) =>
        total + frame.leftFootImprovement + frame.rightFootImprovement, 0),
      correctedTicks: samples.filter((frame) => frame.footlockActive).length,
      atContact: samples[move.startup],
      lastStartup: samples[move.startup - 1],
    };
  `);
  if (neutralToJab?.error || !neutralToJab?.idle?.footL
      || neutralToJab.idle.neutralMode !== "NEUTRAL"
      || neutralToJab.idle.neutralFactor < 0.7
      || neutralToJab.samples[0]?.neutralMode !== "ATTACK_HANDOFF"
      || neutralToJab.samples[0]?.neutralFactor < 0.7
      || !neutralToJab.samples.every((s) => Number.isFinite(s.hostLocalX)
          && s.footL && s.footR && s.leftHand)) {
    throw new Error(`Continuous neutral-to-jab lane missing: ${JSON.stringify(neutralToJab)}`);
  }
  // Guard the actually observed transition, not just the existence of a
  // lane flag. A sudden imported-host translation shifts both planted feet
  // even when the gameplay position and authored punch keys remain stable.
  const continuousBudget = {
    firstFrame: 0.06,
    maximumPerTick: 0.16,
  };
  if (neutralToJab.firstFrameHostTravel > continuousBudget.firstFrame
      || neutralToJab.firstFrameFootLTravel > continuousBudget.firstFrame
      || neutralToJab.firstFrameFootRTravel > continuousBudget.firstFrame
      || neutralToJab.maxHostStep > continuousBudget.maximumPerTick
      || neutralToJab.maxFootLStep > continuousBudget.maximumPerTick
      || neutralToJab.maxFootRStep > continuousBudget.maximumPerTick
      || neutralToJab.maxRootStep > 1e-6) {
    throw new Error(`Neutral-to-jab planted-foot continuity budget exceeded: ${JSON.stringify({ continuousBudget, neutralToJab })}`);
  }
  // The baseline rigid-host lane could pass the instant-jump check while
  // both boots slid around 0.25 / 0.22 world units during five startup ticks.
  // Assert the *measured* horizontal glide is smaller, not merely that an IK
  // telemetry flag was enabled. This contract is intentionally jab-only.
  const planarDisplacement = (from, to) =>
    Math.hypot(to.x - from.x, to.z - from.z);
  const maxPlantedGlide = (side) => Math.max(...neutralToJab.samples.map((frame) =>
    planarDisplacement(neutralToJab.idle[side], frame[side])));
  const visibleLeftGlide = maxPlantedGlide("footL");
  const visibleRightGlide = maxPlantedGlide("footR");
  const contactHandTravel = planarDisplacement(
    neutralToJab.idle.leftHand, neutralToJab.atContact.leftHand);
  const groundedPunchFootlockQuality = {
    version: neutralToJab.samples[0].footlockVersion,
    punchLaneVersion: neutralToJab.atContact.punchLaneVersion,
    correctedTicks: neutralToJab.correctedTicks,
    leftGlide: visibleLeftGlide,
    rightGlide: visibleRightGlide,
    strikeTravel: contactHandTravel,
  };
  if (groundedPunchFootlockQuality.version !== "CONTACT_FOOT_IK_V2"
      || groundedPunchFootlockQuality.punchLaneVersion !== "SHOULDER_CONTACT_LANE_V3"
      || groundedPunchFootlockQuality.correctedTicks < neutralToJab.startupTicks
      || neutralToJab.totalAnkleImprovement < 0.45
      || visibleLeftGlide > 0.045
      || visibleRightGlide > 0.025
      || neutralToJab.maxFootLStep > 0.022
      || neutralToJab.maxFootRStep > 0.022
      || neutralToJab.maxHostStep > 0.085
      || contactHandTravel < 1.15) {
    throw new Error(`Grounded jab foot IK did not reduce real screen-space foot skating: ${JSON.stringify({ groundedPunchFootlockQuality, neutralToJab })}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-sakurai-jab-continuous-contact.png`);
  await writeFile(`${outputDir}/neutral-to-jab-continuity.json`,
    JSON.stringify({ continuousBudget, groundedPunchFootlockQuality, neutralToJab }, null, 2));
  // Exercise *actual* TPS hit-confirm/cancel routing rather than faking an
  // ATTACK->ATTACK pose switch. Only the clean-hit flag is seeded: this audit
  // deliberately isolates the animation handoff from damage and CPU timing.
  // Both directions (neutral straight and BACK body blow), plus the whiff
  // control, run from a 48-frame settled close stance at deterministic 60 Hz.
  const confirmedComboHandoffs = {};
  for (const spec of [
    { label: "straight", branch: "NEUTRAL", expected: "straight", confirmed: true },
    { label: "backfist", branch: "BACK", expected: "backfist", confirmed: true },
    { label: "whiff", branch: "NEUTRAL", expected: null, confirmed: false },
  ]) {
    const result = await execute(sessionId, `${gameLookup}${resetAndPose}
      const spec = arguments[0];
      const game = findGame();
      if (!game || typeof game.updatePlayer !== "function") {
        return { error: "TPS updatePlayer missing" };
      }
      resetFighter(game.p1);
      resetFighter(game.p2);
      resetTpsTransient(game);
      game.input.clear();
      game.finished = false;
      game.p1.position.set(0, 0, 0.74);
      game.p2.position.set(0, 0, -0.48);
      game.p1.facing = 1;
      game.p2.facing = -1;
      game.p1.visual.root.userData.tpsCleanHitConfirmed = false;
      game.p1.visual.root.userData.tpsComboLinkState = "NONE";
      game.p1.visual.root.userData.tpsComboLinkFromMove = "";
      game.__comboRoute = "CLOSE_A";
      game.playerComboStage = 0;
      game.playerComboGraceTicks = 0;
      game.__comboQueuedBranch = undefined;
      game.__comboQueuedSideSign = undefined;
      game.__neutralMashAttackCount = 0;
      let time = performance.now() / 1000;
      const update = () => {
        time += 1 / 60;
        game.updateVisual(game.p1, game.p2, time);
        game.updateVisual(game.p2, game.p1, time + 0.007);
      };
      for (let i = 0; i < 48; i += 1) update();
      const neutral = {
        left: false, right: false, up: false, down: false,
        punch: false, kick: false, guard: false,
      };
      const sample = (index) => {
        const root = game.p1.visual.root;
        const d = root.userData;
        const host = root.children.find((node) =>
          node.name?.startsWith("quaternius-ubc-") && node.name?.endsWith("-runtime"));
        const bones = bonePoints(game.p1);
        return {
          index, moveId: game.p1.currentMove?.id ?? null,
          moveBase: game.p1.currentMove?.motionBase ?? game.p1.currentMove?.id ?? null,
          moveTick: game.p1.moveTick, moveStartup: game.p1.currentMove?.startup ?? null,
          state: game.p1.state,
          gamePosition: { x: game.p1.position.x, y: game.p1.position.y, z: game.p1.position.z },
          root: point(root), host: point(host), pelvis: bones?.pelvis ?? null,
          footL: bones?.footL ?? null, footR: bones?.footR ?? null,
          handL: bones?.handL ?? null, handR: bones?.handR ?? null,
          footlockActive: d.tpsPunchFootlockActive === true,
          footlockWeight: Number(d.tpsPunchFootlockWeight ?? 0),
          bridgeVersion: d.tpsComboLaneBridgeVersion ?? null,
          bridgeFactor: Number(d.tpsComboLaneBridgeFactor ?? 0),
          bridgeLocalX: Number(d.tpsComboLaneBridgeLocalX ?? 0),
          bridgeLocalZ: Number(d.tpsComboLaneBridgeLocalZ ?? 0),
          neutralFactor: Number(d.tpsCloseNeutralLane ?? 0),
          neutralMode: d.tpsCloseNeutralLaneMode ?? "NONE",
          punchFactor: Number(d.tpsClosePunchLane ?? 0),
          comboLink: d.tpsComboLinkState ?? null,
          comboLinkFrom: d.tpsComboLinkFromMove ?? null,
          comboLinkTick: Number(d.tpsComboLinkTick ?? -1),
        };
      };
      const idle = sample(-1);
      if (!game.p1.beginMove("jab")) return { error: "jab-start-failed" };
      game.__comboRoute = "CLOSE_A";
      game.playerComboStage = 1;
      game.playerComboGraceTicks = 34;
      update();
      const frames = [sample(0)];
      const openingMove = game.p1.currentMove;
      const queueTick = openingMove.startup + openingMove.active + 1;
      const total = openingMove.startup + openingMove.active + openingMove.recovery;
      let queued = false, linkedAt = -1, linkedMove = null, cleanWasSeeded = false;
      for (let frame = 1; frame <= total + 25; frame += 1) {
        const duringJab = game.p1.currentMove?.id === "jab";
        if (duringJab && spec.confirmed && !cleanWasSeeded
            && game.p1.moveTick >= openingMove.startup) {
          // A known CLEAN hit at the authored ACTIVE frame permits the game's
          // own cancellable input path. No direct animation state replacement.
          game.p1.hitTargets.add(game.p2.id);
          game.p1.visual.root.userData.tpsCleanHitConfirmed = true;
          cleanWasSeeded = true;
        }
        const press = duringJab && !queued && game.p1.moveTick >= queueTick;
        if (press) queued = true;
        game.updatePlayer({
          ...neutral, punch: press,
          down: press && spec.branch === "BACK",
        });
        update();
        const current = sample(frame);
        frames.push(current);
        if (linkedAt < 0 && current.moveId && current.moveId !== "jab") {
          linkedAt = frames.length - 1;
          linkedMove = current.moveId;
        }
        if (linkedAt >= 0 && frames.length - linkedAt > 10) break;
        if (!spec.confirmed && !game.p1.currentMove) break;
      }
      game.updateCamera(1 / 60);
      game.updateLockOn();
      game.renderer.render(game.scene, game.camera);
      const d2 = (a, b) => a && b
        ? Math.hypot(a.x-b.x, a.z-b.z) : NaN;
      const delta = (a, b, key) => d2(a[key], b[key]);
      const from = linkedAt > 0 ? frames[linkedAt - 1] : null;
      const to = linkedAt >= 0 ? frames[linkedAt] : null;
      const next = linkedAt >= 0 ? frames.slice(linkedAt, linkedAt + 8) : [];
      const maxStep = (key, entries) => entries.length >= 2
        ? Math.max(...entries.slice(1).map((sample, i) => delta(sample, entries[i], key))) : null;
      return {
        spec, idle, queued, cleanWasSeeded, total, queueTick,
        linkedAt, linkedMove, linkedBase: to?.moveBase ?? null,
        beforeLink: from, afterLink: to,
        atLinkStep: from && to ? {
          footL: delta(from, to, "footL"),
          footR: delta(from, to, "footR"),
          pelvis: delta(from, to, "pelvis"),
          handL: delta(from, to, "handL"),
          handR: delta(from, to, "handR"),
          host: delta(from, to, "host"),
          root: delta(from, to, "root"),
        } : null,
        followupPeakStep: {
          footL: maxStep("footL", next), footR: maxStep("footR", next),
          pelvis: maxStep("pelvis", next), handL: maxStep("handL", next),
          handR: maxStep("handR", next),
        },
        followupFootlockActiveTicks: next.filter((f) => f.footlockActive).length,
        frames,
      };
    `, [spec]);
    if (result?.error || !result?.queued || result?.cleanWasSeeded !== spec.confirmed
        || !result?.frames?.every((frame) =>
          Number.isFinite(frame?.footL?.x) && Number.isFinite(frame?.footR?.z)
            && Number.isFinite(frame?.pelvis?.x) && Number.isFinite(frame?.handL?.z))) {
      throw new Error(`Combo foot continuity telemetry missing for ${spec.label}: ${JSON.stringify(result)}`);
    }
    if (spec.confirmed) {
      if (result.linkedBase !== spec.expected || result.linkedAt <= 0
          || result.afterLink.comboLink !== "LINKED"
          || result.afterLink.comboLinkFrom !== "jab"
          || result.followupFootlockActiveTicks !== 0
          || result.afterLink.footlockWeight !== 0
          || result.afterLink.bridgeVersion !== "CONFIRMED_COMBO_HOST_CONTINUITY_V2"
          || result.afterLink.bridgeFactor < 0.99
          || result.atLinkStep.host > 0.04
          || result.atLinkStep.footL > 0.18
          || result.atLinkStep.footR > 0.14
          || result.atLinkStep.pelvis > 0.20
          || result.atLinkStep.root > 1e-6
          || result.followupPeakStep.footL > 0.20
          || result.followupPeakStep.footR > 0.20
          || result.frames.some((frame) =>
            frame.moveBase === spec.expected && frame.moveTick >= frame.moveStartup
              && frame.bridgeFactor > 1e-4)) {
        throw new Error(`Real confirmed ${spec.label} combo handoff lost or inherited planted jab anchors: ${JSON.stringify(result)}`);
      }
    } else if ((result.linkedAt >= 0 && result.linkedAt < result.total)
        || result.frames.some((frame) => frame.comboLink === "LINKED"
          && frame.comboLinkFrom === "jab")
        || result.frames.some((frame) => frame.bridgeFactor > 0)) {
      // A whiff may start another independent neutral attack after the jab's
      // COMPLETE recovery. It must never receive the confirmed combo bridge.
      throw new Error(`Whiff prematurely cancelled or inherited a clean-hit bridge: ${JSON.stringify(result)}`);
    }
    console.log("TPS_COMBO_CONTINUITY=" + JSON.stringify({
      scenario: spec.label, queued: result.queued,
      linkedAt: result.linkedAt, linkedBase: result.linkedBase,
      firstTransition: result.atLinkStep,
      bridgeFactor: result.afterLink?.bridgeFactor ?? 0,
      followupPeakStep: result.followupPeakStep,
      neutralAfterWhiff: !spec.confirmed && result.linkedAt >= result.total,
    }));
    confirmedComboHandoffs[spec.label] = result;
    await screenshot(sessionId, `${outputDir}/tps-combo-${spec.label}-followup.png`);
  }
  await writeFile(`${outputDir}/tps-confirmed-combo-foot-continuity.json`,
    JSON.stringify(confirmedComboHandoffs, null, 2));

  // Phase 13: actual three-strike TPS buffered link routing at 60Hz. The
  // previous two-move tests cannot catch a second transition that starts
  // from a backfist or a cross's already-inertialized imported model.
  // CLEAN is seeded at each ACTIVE frame to isolate model continuity from
  // opponent damage, but ALL links/branches run through updatePlayer.
  const tripleCombos = {};
  for (const spec of [
    { label: "close-a", route: "CLOSE_A", expected: ["jab", "straight", "power"] },
    { label: "close-b", route: "CLOSE_B", expected: ["jab", "backfist", "power"] },
  ]) {
    const result = await execute(sessionId, `${gameLookup}${resetAndPose}
      const spec = arguments[0];
      const game = findGame();
      if (!game || typeof game.updatePlayer !== "function") return { error: "no-TPS-updatePlayer" };
      resetFighter(game.p1);
      resetFighter(game.p2);
      resetTpsTransient(game);
      game.input.clear();
      game.finished = false;
      game.p1.position.set(0, 0, 0.74);
      game.p2.position.set(0, 0, -0.48);
      game.p1.facing = 1;
      game.p2.facing = -1;
      const data = game.p1.visual.root.userData;
      data.tpsCleanHitConfirmed = false;
      data.tpsComboLinkState = "NONE";
      data.tpsComboLinkFromMove = "";
      game.__comboRoute = spec.route;
      game.__comboRouteSeed = 0;
      game.playerComboStage = 1;
      game.playerComboGraceTicks = 34;
      game.__comboQueuedBranch = undefined;
      game.__comboQueuedSideSign = undefined;
      game.__neutralMashAttackCount = 0;
      // A previous audit's neutral-mash phrase may survive resetRound.
      // Reset the phrase so CLOSE_A/B test authored route continuity instead
      // of selecting a legitimate but unrelated changing mash variation.
      game.__neutralMashPhrase = -1;
      game.__neutralMashLastBase = null;
      game.__neutralMashLastOutcome = undefined;
      let time = performance.now() / 1000;
      const render = () => {
        time += 1/60;
        game.updateVisual(game.p1, game.p2, time);
        game.updateVisual(game.p2, game.p1, time + 0.007);
      };
      for (let i = 0; i < 48; i += 1) render();
      const neutral = {
        left: false, right: false, up: false, down: false,
        punch: false, kick: false, guard: false,
      };
      if (!game.p1.beginMove("jab")) return { error: "three-hit-jab-not-started" };
      render();
      const sample = (tick) => {
        const root = game.p1.visual.root;
        const d = root.userData;
        const host = root.children.find((node) =>
          node.name?.startsWith("quaternius-ubc-") && node.name?.endsWith("-runtime"));
        const bones = bonePoints(game.p1);
        return {
          tick, move: game.p1.currentMove?.id ?? null,
          family: game.p1.currentMove?.motionBase ?? game.p1.currentMove?.id ?? null,
          moveTick: game.p1.moveTick,
          startup: game.p1.currentMove?.startup ?? 0,
          state: game.p1.state,
          host: point(host), root: point(root),
          footL: bones?.footL ?? null, footR: bones?.footR ?? null,
          pelvis: bones?.pelvis ?? null, handL: bones?.handL ?? null,
          handR: bones?.handR ?? null,
          comboLink: d.tpsComboLinkState ?? null,
          linkFrom: d.tpsComboLinkFromMove ?? null,
          linkSerial: Number(d.tpsComboLinkSerial ?? 0),
          bridge: Number(d.tpsComboLaneBridgeFactor ?? 0),
          bridgeFrom: d.tpsComboLaneBridgeSourceMove ?? null,
          bridgeTo: d.tpsComboLaneBridgeTargetMove ?? null,
          footlock: Number(d.tpsPunchFootlockWeight ?? 0),
          gamePosition: { x: game.p1.position.x, y: game.p1.position.y, z: game.p1.position.z },
        };
      };
      const samples = [sample(0)];
      const movePhases = [];
      const transitions = [];
      let lastMove = "jab";
      let lastMoveRef = game.p1.currentMove;
      let queuedFor = new Set();
      let seededFor = new Set();
      const planar = (a,b) => a && b ? Math.hypot(a.x-b.x, a.z-b.z) : NaN;
      for (let frame = 1; frame < 110; frame += 1) {
        const move = game.p1.currentMove;
        if (!move) break;
        if (!seededFor.has(move.id) && game.p1.moveTick >= move.startup) {
          game.p1.hitTargets.add(game.p2.id);
          data.tpsCleanHitConfirmed = true;
          seededFor.add(move.id);
          movePhases.push({ type: "confirmed", move: move.id, tick: frame });
        }
        const pressed = !queuedFor.has(move.id) && game.p1.moveTick >= move.startup + move.active + 1
          && queuedFor.size < 2;
        if (pressed) {
          queuedFor.add(move.id);
          movePhases.push({ type: "queued", move: move.id, tick: frame });
        }
        game.updatePlayer({ ...neutral, punch: pressed });
        render();
        const current = sample(frame);
        const previous = samples[samples.length - 1];
        samples.push(current);
        if (current.move && current.move !== lastMove) {
          transitions.push({
            from: lastMove, to: current.move, frame,
            before: previous, after: current,
            host: planar(previous.host, current.host),
            footL: planar(previous.footL, current.footL),
            footR: planar(previous.footR, current.footR),
            pelvis: planar(previous.pelvis, current.pelvis),
            handL: planar(previous.handL, current.handL),
            handR: planar(previous.handR, current.handR),
            gameplay: planar(previous.gamePosition, current.gamePosition),
          });
          lastMove = current.move;
          lastMoveRef = game.p1.currentMove;
          movePhases.push({type: "linked", move: current.move, tick: frame});
        }
        if (transitions.length === 2 && current.move === spec.expected[2]
            && current.moveTick >= current.startup + 2) break;
      }
      game.updateCamera(1/60);
      game.updateLockOn();
      game.renderer.render(game.scene, game.camera);
      const followups = transitions.map((t) => {
        const frames = samples.filter((s) => s.tick >= t.frame && s.move === t.to);
        return {
          move: t.to,
          frames: frames.length,
          bridgeAtEntry: frames[0]?.bridge ?? 0,
          bridgeAtContact: frames.find((s) => s.moveTick >= s.startup)?.bridge ?? null,
          invalidFootlockTicks: frames.filter((s) => s.footlock > 0).length,
          peakFootLStep: Math.max(0,...frames.slice(1).map((s,i) =>
            planar(s.footL, frames[i].footL))),
          peakFootRStep: Math.max(0,...frames.slice(1).map((s,i) =>
            planar(s.footR, frames[i].footR))),
        };
      });
      return { spec, transitions, followups, queued: [...queuedFor], seeded: [...seededFor],
        movePhases, samples, lastMove, lastMoveStillValid: !!lastMoveRef };
    `, [spec]);
    if (result?.error || result?.transitions?.length !== 2
        || result.transitions[0].from !== "jab"
        || result.transitions[0].to !== spec.expected[1]
        || result.transitions[1].from !== spec.expected[1]
        || result.transitions[1].to !== spec.expected[2]
        || result.followups?.length !== 2
        || result.followups.some((stage) => stage.invalidFootlockTicks !== 0
          || stage.bridgeAtContact !== 0)
        || result.transitions.some((step) =>
          step.host > 0.04 || step.gameplay > 1e-6
            || step.footL > 0.28 || step.footR > 0.20
            || step.pelvis > 0.23)
        || result.followups.some((stage) => stage.bridgeAtEntry < 0.99)
        || !result.transitions.every((t) =>
          Number.isFinite(t.host) && Number.isFinite(t.footL)
          && Number.isFinite(t.footR) && Number.isFinite(t.pelvis))) {
      throw new Error(`Real three-hit combo route/foot telemetry failed: ${JSON.stringify(result)}`);
    }
    console.log("TPS_TRIPLE_COMBO=" + JSON.stringify({
      route: spec.route,
      transitions: result.transitions.map((t) => ({
        from:t.from,to:t.to,host:t.host,footL:t.footL,footR:t.footR,
        pelvis:t.pelvis,handL:t.handL,handR:t.handR,gameplay:t.gameplay,
      })),
      followups: result.followups,
    }));
    tripleCombos[spec.label] = result;
    await screenshot(sessionId, `${outputDir}/tps-combo-triple-${spec.label}.png`);
  }
  await writeFile(`${outputDir}/tps-triple-combo-continuity.json`,
    JSON.stringify(tripleCombos, null, 2));
  const diagnostics = {
    neutralToJab,
    confirmedComboHandoffs,
    tripleCombos,
    sakuraiRootAndFootTravel,
    sakuraiStoryboard,
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
