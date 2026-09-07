import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const driver = process.env.WEBDRIVER_BIN;
if (!driver) throw new Error("WEBDRIVER_BIN is required");
const output = process.env.MOTION_FRAMERATE_AUDIT_DIR ?? "artifacts/motion-framerate-audit";
const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
const port = 9528;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const driverProcess = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
let session;
driverProcess.stdout.on("data", data => { logs += data; });
driverProcess.stderr.on("data", data => { logs += data; });

async function command(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || json.value?.error) throw new Error(JSON.stringify(json));
  return json.value;
}

const execute = (script, args = []) => command(`/session/${session}/execute/sync`, "POST", { script, args });

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
      const game = value && typeof value === 'object' && 'current' in value ? value.current : null;
      if (game?.p1 && game?.p2 && game.renderer && game.scene && game.camera) return game;
      hook = hook.next;
    }
    fiber = fiber.return;
  }
  return null;
}
`;

const helpers = `
function resetFighter(f) {
  f.currentMove = null;
  f.moveTick = 0;
  f.hitStop = 0;
  f.hitStun = 0;
  f.blockStun = 0;
  f.knockdownTicks = 0;
  f.guardDamage = 0;
  f.velocity.set(0, 0, 0);
  f.hitTargets.clear();
  f.health = 100;
  f.state = 'IDLE';
  f.grounded = true;
  f.stateMachine.stateTicks = 0;
}
function modelFor(f) {
  const host = f.visual.root.children.find(c => c.name?.startsWith('quaternius-ubc-'));
  return host?.children?.[0] ?? null;
}
function poseFor(f) {
  const model = modelFor(f);
  if (!model) return null;
  const names = ['pelvis','spine_01','spine_02','spine_03','neck_01','Head','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r','hand_l','hand_r','thigh_l','thigh_r','calf_l','calf_r','foot_l','foot_r'];
  return Object.fromEntries(names.map(name => {
    const bone = model.getObjectByName(name);
    return [name, { position: bone.position.toArray(), quaternion: bone.quaternion.toArray() }];
  }));
}
function motionMeta(f) {
  const host = f.visual.root.children.find(c => c.name?.startsWith('quaternius-ubc-'));
  const data = host?.userData ?? f.visual.root.userData;
  return {
    owner: data.combatMotionPoseOwner ?? f.visual.root.userData.combatMotionPoseOwner,
    transitionPolicy: data.combatMotionTransitionPolicy ?? f.visual.root.userData.combatMotionTransitionPolicy,
    previousPoseWeight: data.combatMotionTransitionPreviousPoseWeight ?? f.visual.root.userData.combatMotionTransitionPreviousPoseWeight,
    phase: data.combatMotionSampledPhase ?? f.visual.root.userData.combatMotionSampledPhase,
    contact: data.combatMotionContactPhase ?? f.visual.root.userData.combatMotionContactPhase,
    clip: host?.userData?.quaterniusCurrentClip ?? f.visual.root.userData.combatMotionCurrentClip,
  };
}
function renderAt(g, time) {
  g.updateVisual(g.p1, g.p2, time);
  g.updateVisual(g.p2, g.p1, time + .0001);
  g.updateCamera(1 / 60);
  g.updateLockOn();
  g.renderer.render(g.scene, g.camera);
}
`;

function poseDelta(a, b) {
  let maxPosition = 0;
  let maxAngle = 0;
  let worstPositionBone = "";
  let worstAngleBone = "";
  for (const name of Object.keys(a)) {
    const pa = a[name].position;
    const pb = b[name].position;
    const position = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    if (position > maxPosition) { maxPosition = position; worstPositionBone = name; }
    const qa = a[name].quaternion;
    const qb = b[name].quaternion;
    const normA = Math.hypot(qa[0], qa[1], qa[2], qa[3]);
    const normB = Math.hypot(qb[0], qb[1], qb[2], qb[3]);
    const rawDot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
    const dot = Math.min(1, Math.abs(rawDot / Math.max(1e-12, normA * normB)));
    const angle = 2 * Math.acos(dot);
    if (angle > maxAngle) { maxAngle = angle; worstAngleBone = name; }
  }
  return { maxPosition, maxAngle, worstPositionBone, worstAngleBone };
}

async function screenshot(name) {
  const encoded = await command(`/session/${session}/screenshot`);
  const bytes = Buffer.from(encoded, "base64");
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await writeFile(`${output}/${name}.png`, bytes);
}

const report = {
  version: "MOTION_FRAMERATE_AUDIT_V1",
  fps: [30, 60, 120],
  actors: {},
  maxima: { position: 0, angleRadians: 0 },
  hitstop: {},
  screenshots: 0,
  errors: [],
};

try {
  await mkdir(output, { recursive: true });
  for (let i = 0; i < 100; i += 1) {
    try { await command("/status"); break; }
    catch { if (i === 99) throw new Error(logs); await wait(100); }
  }
  const created = await command("/session", "POST", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        "goog:loggingPrefs": { browser: "ALL" },
        "goog:chromeOptions": {
          args: [
            "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--ignore-gpu-blocklist",
            "--enable-webgl", "--use-angle=swiftshader", "--window-size=1120,700", "--hide-scrollbars",
          ],
        },
      },
    },
  });
  session = created.sessionId;
  await command(`/session/${session}/url`, "POST", { url });
  await wait(650);
  for (const label of ["TPS LOCK-ON BATTLE", "ENGAGE TPS"]) {
    const clicked = await execute(`const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(arguments[0]));b?.click();return !!b;`, [label]);
    assert.ok(clicked, label);
    await wait(200);
  }
  let ready;
  for (let i = 0; i < 240; i += 1) {
    ready = await execute(`${lookup}const g=findGame();return g && [g.p1,g.p2].map(f=>({state:f.visual.root.userData.quaterniusModelState,clips:f.visual.root.userData.combatMotionClipCount}));`);
    if (ready?.every(item => item.state === "ready" && item.clips >= 27)) break;
    await wait(100);
  }
  assert.ok(ready?.every(item => item.state === "ready" && item.clips >= 27), `motion preload failed: ${JSON.stringify(ready)}`);
  await execute(`${lookup}const g=findGame();cancelAnimationFrame(g.raf);g.running=false;g.finished=false;g.input.clear();g.__frActors=[g.p1,g.p2];g.__frTime=100;return true;`);

  const defaultMoves = ["jab", "straight", "bodyBlow", "backfist", "power", "kick", "lowKick", "risingKick", "dashKick", "counter", "throw"];
  const requestedMoves = process.env.MOTION_AUDIT_MOVES?.split(",").map(value => value.trim()).filter(Boolean);
  const moves = requestedMoves?.length ? requestedMoves : defaultMoves;
  for (const [actorIndex, actorName] of [[0, "kairo"], [1, "sera"]]) {
    const actorReport = {};
    report.actors[actorName] = actorReport;
    for (const move of moves) {
      const samples = {};
      for (const fps of report.fps) {
        const sample = await execute(`${lookup}${helpers}
          const g=findGame();
          g.p1=g.__frActors[arguments[0]]; g.p2=g.__frActors[1-arguments[0]];
          resetFighter(g.p1); resetFighter(g.p2);
          g.p1.position.set(0,0,.8); g.p2.position.set(0,0,-1.4);
          g.__enemyVisualForward=null;
          let time=(g.__frTime ?? 100);
          const fps=arguments[2];
          // Normalize the pre-attack history. The audit varies ATTACK render
          // cadence only; Ready-loop phase must not be an accidental variable.
          for(let i=0;i<30;i++){time+=1/60;renderAt(g,time);}
          g.p1.beginMove(arguments[1]);
          const m=g.p1.currentMove;
          const renderTick=(tick, dt) => {
            g.p1.moveTick=tick; g.p1.stateMachine.stateTicks=tick;
            time+=dt; renderAt(g,time);
          };
          if(fps===120){
            for(let tick=0;tick<=m.startup;tick++) { renderTick(tick,1/120); renderTick(tick,1/120); }
          } else if(fps===60) {
            for(let tick=0;tick<=m.startup;tick++) renderTick(tick,1/60);
          } else {
            for(let tick=0;tick<=m.startup;tick++) if(tick===0 || tick===m.startup || tick%2===0) renderTick(tick,1/30);
          }
          g.__frTime=time;
          return { startup:m.startup, pose:poseFor(g.p1), meta:motionMeta(g.p1) };
        `, [actorIndex, move, fps]);
        assert.ok(sample.pose, `${actorName}/${move}/${fps}: missing model pose`);
        assert.equal(sample.meta.owner, "AUTHORED_COMBAT_TIMELINE", `${actorName}/${move}/${fps}: pose owner`);
        assert.equal(sample.meta.transitionPolicy, "GAMEPLAY_TICK_ATTACK_ENTRY", `${actorName}/${move}/${fps}: transition policy`);
        assert.ok(Math.abs(Number(sample.meta.previousPoseWeight ?? 0)) < 1e-12, `${actorName}/${move}/${fps}: previous pose leaked into contact`);
        assert.ok(Math.abs(Number(sample.meta.phase) - Number(sample.meta.contact)) < 1e-6, `${actorName}/${move}/${fps}: contact phase drift`);
        samples[fps] = sample;
        if (move === "risingKick") {
          await screenshot(`${actorName}-rising-contact-${fps}fps`);
          report.screenshots += 1;
        }
      }
      const baseline = samples[60].pose;
      const comparisons = {};
      for (const fps of [30, 120]) {
        const delta = poseDelta(baseline, samples[fps].pose);
        comparisons[fps] = delta;
        report.maxima.position = Math.max(report.maxima.position, delta.maxPosition);
        report.maxima.angleRadians = Math.max(report.maxima.angleRadians, delta.maxAngle);
        assert.ok(delta.maxPosition < 1e-5, `${actorName}/${move}/${fps}: position delta ${JSON.stringify(delta)}`);
        assert.ok(delta.maxAngle < 1e-5, `${actorName}/${move}/${fps}: rotation delta ${JSON.stringify(delta)}`);
      }
      actorReport[move] = { startup: samples[60].startup, comparisons, clip: samples[60].meta.clip };
    }

    const freeze = await execute(`${lookup}${helpers}
      const g=findGame();
      g.p1=g.__frActors[arguments[0]]; g.p2=g.__frActors[1-arguments[0]];
      resetFighter(g.p1); resetFighter(g.p2);
      g.p1.position.set(0,0,.8); g.p2.position.set(0,0,-1.4);
      let time=(g.__frTime ?? 100)+.25;
      for(let i=0;i<30;i++){time+=1/60;renderAt(g,time);}
      g.p1.beginMove('risingKick');
      g.p1.moveTick=0; g.p1.stateMachine.stateTicks=0; time+=1/60; renderAt(g,time);
      g.p1.hitStop=8;
      const before={pose:poseFor(g.p1),meta:motionMeta(g.p1)};
      for(let i=0;i<8;i++){time+=1/30;renderAt(g,time);}
      const after={pose:poseFor(g.p1),meta:motionMeta(g.p1)};
      g.p1.hitStop=0; g.__frTime=time;
      return {before,after};
    `, [actorIndex]);
    const freezeDelta = poseDelta(freeze.before.pose, freeze.after.pose);
    assert.deepEqual(freeze.after.pose, freeze.before.pose, `${actorName}: startup hitstop changed raw local bone pose`);
    assert.equal(freeze.before.meta.previousPoseWeight, freeze.after.meta.previousPoseWeight, `${actorName}: hitstop changed entry blend weight`);
    report.hitstop[actorName] = freezeDelta;
  }

  const browser = await command(`/session/${session}/log`, "POST", { type: "browser" });
  report.errors = browser.filter(entry => entry.level === "SEVERE" && !entry.message.includes("favicon"));
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ maxima: report.maxima, hitstop: report.hitstop, screenshots: report.screenshots }));
} finally {
  await writeFile(`${output}/webdriver.log`, logs);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  if (session) await command(`/session/${session}`, "DELETE").catch(() => {});
  driverProcess.kill("SIGTERM");
}
