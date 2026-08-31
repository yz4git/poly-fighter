import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(before)) throw new Error(`Missing patch target in ${path}: ${before.slice(0, 140)}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`Patch made no change in ${path}`);
  writeFileSync(path, next);
}

function replaceRegex(path, pattern, replacement, label) {
  const source = readFileSync(path, "utf8");
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} in ${path}, found ${matches.length}`);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Regex patch made no change for ${label} in ${path}`);
  writeFileSync(path, next);
}

function appendOnce(path, marker, block) {
  const source = readFileSync(path, "utf8");
  if (source.includes(marker)) return;
  writeFileSync(path, `${source.trimEnd()}\n\n${block.trim()}\n`);
}

const game = "src/game/tps-game.ts";
replaceOnce(game,
  'import { FighterRuntime } from "./fighter";',
  'import { FighterRuntime, type CpuDifficulty } from "./fighter";',
);
replaceOnce(game,
  '  difficulty?: unknown;',
  '  difficulty?: CpuDifficulty;',
);
replaceOnce(game,
`const ARENA_RADIUS = 6.8;
const FIXED_STEP = 1 / 60;
const ROUND_TICKS = 99 * 60;
const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
`,
`const ARENA_RADIUS = 6.8;
const FIXED_STEP = 1 / 60;
const ROUND_TICKS = 99 * 60;
const TPS_STRIKE_RANGE = 2.12;
const ENEMY_TACTIC_INTERVAL = 72;
const MODEL_FORWARD = new THREE.Vector3(0, 0, 1);
type EnemyTactic = "PRESSURE" | "ORBIT" | "BAIT";
`,
);
replaceOnce(game,
`  private readonly lockRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly lockStem: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly visibilityHandler: () => void;
`,
`  private readonly lockRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly lockStem: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly targetGroundRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly visibilityHandler: () => void;
  private readonly difficulty: CpuDifficulty;
`,
);
replaceOnce(game,
`  private playerEvadeSign = 0;
  private simulationTicks = 0;
  private cameraImpact = 0;
`,
`  private playerEvadeSign = 0;
  private simulationTicks = 0;
  private cameraImpact = 0;
  private enemyTactic: EnemyTactic = "ORBIT";
  private enemyTacticTicks = 0;
  private enemyOrbitSign = 1;
`,
);
replaceOnce(game,
`    this.mount = mount;
    this.options = options;
    const settings = this.settings.load();
`,
`    this.mount = mount;
    this.options = options;
    this.difficulty = options.difficulty ?? "NORMAL";
    const settings = this.settings.load();
`,
);
replaceOnce(game,
`    const lockGeometry = new THREE.TorusGeometry(0.46, 0.022, 8, 48);
    const lockMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false });
`,
`    const lockGeometry = new THREE.TorusGeometry(0.46, 0.022, 8, 48);
    const lockMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.96, depthTest: true, depthWrite: false });
`,
);
replaceOnce(game,
`    const stemMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.76, depthTest: false, depthWrite: false });
    this.lockStem = new THREE.Line(stemGeometry, stemMaterial);
    this.lockStem.renderOrder = 20;
    this.scene.add(this.lockStem);
    this.arenaDisposables.push(stemGeometry, stemMaterial);

    this.effects.onShake = (amount) => {
`,
`    const stemMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.76, depthTest: true, depthWrite: false });
    this.lockStem = new THREE.Line(stemGeometry, stemMaterial);
    this.lockStem.renderOrder = 20;
    this.scene.add(this.lockStem);
    this.arenaDisposables.push(stemGeometry, stemMaterial);

    // A ground-space lock marker remains readable when the foreground fighter
    // overlaps the opponent. It communicates target position and strike range
    // without drawing the chest reticle through the player's body.
    const targetGroundGeometry = new THREE.RingGeometry(0.58, 0.70, 48);
    const targetGroundMaterial = new THREE.MeshBasicMaterial({
      color: 0x7ce8ff,
      transparent: true,
      opacity: 0.3,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetGroundRing = new THREE.Mesh(targetGroundGeometry, targetGroundMaterial);
    this.targetGroundRing.name = "tps-target-ground-ring";
    this.targetGroundRing.rotation.x = -Math.PI / 2;
    this.targetGroundRing.position.y = 0.035;
    this.scene.add(this.targetGroundRing);
    this.arenaDisposables.push(targetGroundGeometry, targetGroundMaterial);

    this.effects.onShake = (amount) => {
`,
);

replaceRegex(game,
/  private updateEnemy\(\): void \{[\s\S]*?\n  \}\n\n  private advanceLockedState/,
`  private updateEnemy(): void {
    this.p2.setInput(EMPTY_INPUT);
    if (this.advanceLockedState(this.p2)) return;

    this.enemyCooldown -= 1;
    this.enemyTacticTicks -= 1;
    if (this.enemyTacticTicks <= 0) {
      const slot = Math.floor(this.simulationTicks / ENEMY_TACTIC_INTERVAL);
      const healthPressure = this.p2.health < this.p1.health ? 1 : 0;
      const tacticIndex = (slot + healthPressure + (this.difficulty === "HARD" ? 1 : 0)) % 3;
      this.enemyTactic = tacticIndex === 0 ? "PRESSURE" : tacticIndex === 1 ? "ORBIT" : "BAIT";
      this.enemyOrbitSign = (slot + (this.difficulty === "EASY" ? 1 : 0)) % 2 === 0 ? 1 : -1;
      this.enemyTacticTicks = this.difficulty === "HARD" ? 56 : this.difficulty === "EASY" ? 90 : ENEMY_TACTIC_INTERVAL;
    }

    const towardPlayer = horizontalDirection(this.p2.position, this.p1.position);
    const distance = this.p2.position.distanceTo(this.p1.position);
    const tangent = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x);
    const movement = new THREE.Vector3();
    const desiredDistance = this.enemyTactic === "PRESSURE" ? 1.48 : this.enemyTactic === "BAIT" ? 2.25 : 1.82;
    const orbitStrength = this.enemyTactic === "ORBIT" ? 0.66 : this.enemyTactic === "BAIT" ? 0.34 : 0.22;

    if (distance > desiredDistance + 0.18) movement.add(towardPlayer);
    else if (distance < desiredDistance - 0.24) movement.addScaledVector(towardPlayer, -1);
    movement.addScaledVector(tangent, this.enemyOrbitSign * orbitStrength);

    const playerThreat = this.p1.state === "ATTACK" && this.p1.currentMove && distance < this.p1.currentMove.reach + 0.9;
    const playerGuarding = this.p1.state === "GUARD";
    const reactionLead = this.difficulty === "HARD" ? 4 : this.difficulty === "NORMAL" ? 2 : 0;
    const guardGate = this.difficulty === "EASY" ? 0.55 : this.difficulty === "HARD" ? -0.6 : -0.1;
    const shouldGuard = Boolean(
      playerThreat
      && this.p1.moveTick >= Math.max(0, (this.p1.currentMove?.startup ?? 8) - reactionLead)
      && Math.sin(this.simulationTicks * 0.41) > guardGate
    );

    if (shouldGuard) {
      this.p2.state = "GUARD";
    } else if (this.enemyCooldown <= 0 && distance < (this.enemyTactic === "BAIT" ? 1.82 : 2.12)) {
      const selector = (Math.floor(this.simulationTicks / 17) + (this.enemyTactic === "PRESSURE" ? 1 : 0)) % 5;
      const punishGuard = playerGuarding && distance < 1.42;
      const punishRecovery = this.difficulty !== "EASY"
        && this.p1.state === "ATTACK"
        && Boolean(this.p1.currentMove)
        && this.p1.moveTick > (this.p1.currentMove?.startup ?? 0) + (this.p1.currentMove?.active ?? 0);
      const moveId = punishGuard
        ? "throw"
        : punishRecovery
          ? "straight"
          : selector === 0
            ? "power"
            : selector <= 2
              ? "jab"
              : "kick";
      this.p2.beginMove(moveId);
      const difficultyScale = this.difficulty === "HARD" ? 0.72 : this.difficulty === "EASY" ? 1.3 : 1;
      const baseCooldown = moveId === "throw" ? 72 : moveId === "power" ? 92 : moveId === "straight" ? 64 : 58;
      this.enemyCooldown = Math.round(baseCooldown * difficultyScale);
    } else if (movement.lengthSq() > 0.001) {
      movement.normalize();
      const baseSpeed = this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;
      const difficultySpeed = this.difficulty === "HARD" ? 1.08 : this.difficulty === "EASY" ? 0.9 : 1;
      this.p2.position.addScaledVector(movement, FIXED_STEP * baseSpeed * difficultySpeed);
      this.p2.state = "WALK";
    } else {
      this.p2.state = "IDLE";
    }

    this.p2.updatePhysics(FIXED_STEP);
  }

  private advanceLockedState`,
"TPS tactical CPU",
);

replaceRegex(game,
/  private updateCamera\(delta: number\): void \{[\s\S]*?\n  \}\n\n  private updateLockOn/,
`  private updateCamera(delta: number): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const fightDistance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const closeFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);
    // At close range move laterally around the foreground fighter instead of
    // simply retreating. This preserves the over-shoulder scale while opening
    // a visible lane to the locked opponent.
    const backDistance = 4.85 - closeFactor * 0.45;
    const shoulderOffset = 2.2 + closeFactor * 1.25;
    const cameraHeight = 2.28 + closeFactor * 0.17;
    this.cameraTarget.copy(this.p2.position)
      .addScaledVector(right, -0.28 * closeFactor)
      .add(new THREE.Vector3(0, 1.16 + closeFactor * 0.04, 0));
    this.cameraDesired.copy(this.p1.position)
      .addScaledVector(forward, -backDistance)
      .addScaledVector(right, shoulderOffset)
      .add(new THREE.Vector3(0, cameraHeight, 0));
    ease(this.camera.position, this.cameraDesired, 12.2, delta);
    if (this.cameraImpact > 0.001) {
      const impact = this.cameraImpact;
      this.cameraImpact *= Math.exp(-10 * delta);
      this.camera.position.addScaledVector(right, Math.sin(this.renderTime * 76) * impact);
      this.camera.position.y += Math.cos(this.renderTime * 91) * impact * 0.36;
    }
    this.camera.lookAt(this.cameraTarget);
  }

  private updateLockOn`,
"TPS close-range camera",
);

replaceRegex(game,
/  private updateLockOn\(\): void \{[\s\S]*?\n  \}\n\n  private checkFinish/,
`  private updateLockOn(): void {
    // Keep the chest reticle honest with depth testing; the ground ring carries
    // target location when the player's foreground silhouette crosses the line
    // of sight. Lowering the chest anchor also prevents the ring reading as a
    // head halo on the imported UBC body types.
    this.p2.visual.root.updateMatrixWorld(true);
    const target = this.p2.visual.root.localToWorld(new THREE.Vector3(0, this.p2.visual.layout.ribY + 0.04, 0));
    const distance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const threat = this.p2.state === "ATTACK";
    const inStrikeRange = distance < TPS_STRIKE_RANGE;
    const lockColor = threat ? 0xff667f : inStrikeRange ? 0xffd45c : 0x7ce8ff;
    this.lockRing.material.color.setHex(lockColor);
    this.lockStem.material.color.setHex(lockColor);
    this.targetGroundRing.material.color.setHex(lockColor);
    this.lockRing.position.copy(target);
    this.lockRing.lookAt(this.camera.position);
    const pulseRate = threat ? 11.5 : 5.5;
    const pulse = (threat ? 1.04 : inStrikeRange ? 0.96 : 0.9) + Math.sin(this.renderTime * pulseRate) * 0.055;
    this.lockRing.scale.setScalar(pulse);
    this.lockStem.position.copy(target).add(new THREE.Vector3(0, -0.30, 0));
    this.lockStem.lookAt(this.camera.position);
    this.targetGroundRing.position.set(this.p2.position.x, 0.035, this.p2.position.z);
    const groundPulse = 0.95 + Math.sin(this.renderTime * pulseRate) * 0.06;
    this.targetGroundRing.scale.setScalar(groundPulse);
    this.targetGroundRing.material.opacity = threat ? 0.58 : inStrikeRange ? 0.46 : 0.28;
  }

  private checkFinish`,
"TPS lock/readability",
);

replaceOnce(game,
`    this.enemyCooldown = 52;
    this.playerEvadeTicks = 0;
`,
`    this.enemyCooldown = 52;
    this.enemyTactic = "ORBIT";
    this.enemyTacticTicks = 0;
    this.enemyOrbitSign = 1;
    this.playerEvadeTicks = 0;
`,
);
replaceOnce(game,
`    this.camera.position.copy(this.p1.position)
      .addScaledVector(forward, -5.15)
      .addScaledVector(right, 1.85)
      .add(new THREE.Vector3(0, 2.28, 0));
`,
`    this.camera.position.copy(this.p1.position)
      .addScaledVector(forward, -4.85)
      .addScaledVector(right, 2.2)
      .add(new THREE.Vector3(0, 2.28, 0));
`,
);
replaceOnce(game,
`          : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < 2.12
            ? "STRIKE RANGE"
`,
`          : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE
            ? "STRIKE RANGE"
`,
);

const page = "app/page.tsx";
replaceOnce(page,
`  const isGameSurface = screen === "MATCH" || screen === "TPS_MATCH" || screen === "RESULT";
`,
`  const isGameSurface = screen === "MATCH" || screen === "TPS_MATCH" || screen === "RESULT";
  const tpsIncoming = battleMode === "TPS" && hud?.message === "INCOMING";
  const tpsStrikeRange = battleMode === "TPS" && hud?.message === "STRIKE RANGE";
`,
);
replaceOnce(page,
`          <button type="button" className="primary-button" onClick={() => { setScreen("SELECT"); requestLandscape(); }}>
`,
`          <button type="button" className="primary-button" onClick={() => { setBattleMode("DUEL"); setScreen("SELECT"); requestLandscape(); }}>
`,
);
replaceOnce(page,
`          <button type="button" className="ghost-button tps-mode-button" onClick={startTpsMatch}><span>TPS LOCK-ON BATTLE</span><small>360° CIRCULAR ARENA</small></button>
`,
`          <button type="button" className="ghost-button tps-mode-button" onClick={() => { setBattleMode("TPS"); setScreen("SELECT"); requestLandscape(); }}><span>TPS LOCK-ON BATTLE</span><small>360° CIRCULAR ARENA / LOADOUT SELECT</small></button>
`,
);
replaceOnce(page,
`          <div className="screen-heading"><span>CHARACTER SELECT</span><i>CHOOSE YOUR VECTOR</i></div>
`,
`          <div className="screen-heading"><span>{battleMode === "TPS" ? "TPS LOADOUT" : "CHARACTER SELECT"}</span><i>{battleMode === "TPS" ? "LOCK-ON FIGHTER / CPU / DIFFICULTY" : "CHOOSE YOUR VECTOR"}</i></div>
`,
);
replaceOnce(page,
`            <button type="button" className="primary-button compact" onClick={startMatch}><span>ENTER RING</span><small>{p1.name} / {p2.name}</small></button>
`,
`            <button type="button" className="primary-button compact" onClick={battleMode === "TPS" ? startTpsMatch : startMatch}><span>{battleMode === "TPS" ? "ENGAGE TPS" : "ENTER RING"}</span><small>{p1.name} / {p2.name} / {difficulty}</small></button>
`,
);
replaceOnce(page,
`              {pressableAction(gameRef, "guard", "Guard", "G", "guard")}
              {pressableAction(gameRef, "punch", "Punch", "P", "punch")}
              {pressableAction(gameRef, "kick", "Kick", "K", "kick")}
`,
`              {pressableAction(gameRef, "guard", "Guard", "G", `guard ${tpsIncoming ? "tps-threat-action" : ""}`)}
              {pressableAction(gameRef, "punch", "Punch", "P", `punch ${tpsStrikeRange ? "tps-ready-action" : ""}`)}
              {pressableAction(gameRef, "kick", "Kick", "K", `kick ${tpsStrikeRange ? "tps-ready-action" : ""}`)}
`,
);

const css = "app/playtest-polish.css";
appendOnce(css, "@keyframes tps-threat-pulse", `
/* TPS /goal pass: move tactical information onto the controls and keep the
 * iPhone center lane free for the opponent silhouette. */
.action-buttons .tps-threat-action {
  outline: 2px solid rgba(255, 102, 127, .92);
  outline-offset: 3px;
  animation: tps-threat-pulse .48s ease-in-out infinite alternate;
}

.action-buttons .tps-ready-action {
  box-shadow: 0 0 0 2px rgba(255, 212, 92, .34), 0 0 22px rgba(255, 212, 92, .24), inset 0 0 16px rgba(255, 212, 92, .08);
}

@keyframes tps-threat-pulse {
  from { filter: brightness(1); }
  to { filter: brightness(1.28); }
}

@media (orientation: landscape) and (max-height: 560px) {
  .tps-badge {
    display: none;
  }
}
`);

const tests = "tests/tps-mode.test.ts";
let testSource = readFileSync(tests, "utf8");
testSource = testSource
  .replace(/assert\.match\(source, \/cameraTarget\\\.copy\\\(this\\\.p2\\\.position\\\)\/\);/, 'assert.match(source, /cameraTarget\\.copy\\(this\\.p2\\.position\\)/);')
  .replace('  assert.match(source, /backDistance = 5\\.15 \\+ closeFactor \\* 0\\.45/);', '  assert.match(source, /backDistance = 4\\.85 - closeFactor \\* 0\\.45/);')
  .replace('  assert.match(source, /shoulderOffset = 1\\.85 \\+ closeFactor \\* 0\\.82/);', '  assert.match(source, /shoulderOffset = 2\\.2 \\+ closeFactor \\* 1\\.25/);')
  .replace('  assert.match(source, /depthTest: false, depthWrite: false/);', '  assert.match(source, /depthTest: true, depthWrite: false/);\n  assert.match(source, /new THREE\\.RingGeometry\\(0\\.58, 0\\.70/);\n  assert.match(source, /tps-target-ground-ring/);')
  .replace('  assert.match(source, /simulationTicks \\* FIXED_STEP/);', '  assert.match(source, /enemyTactic/);\n  assert.match(source, /ENEMY_TACTIC_INTERVAL/);\n  assert.match(source, /this\\.difficulty === "HARD"/);')
  .replace('  assert.match(page, /startTpsMatch/);', '  assert.match(page, /startTpsMatch/);\n  assert.match(page, /TPS LOADOUT/);\n  assert.match(page, /ENGAGE TPS/);\n  assert.match(page, /setBattleMode\\("TPS"\\)/);\n  assert.match(page, /tps-threat-action/);\n  assert.match(page, /tps-ready-action/);');
writeFileSync(tests, testSource);

const capture = "scripts/capture-tps-visual-audit.mjs";
replaceOnce(capture,
`  const click = await clickButton(sessionId, "TPS LOCK-ON BATTLE");
  if (!click?.clicked) throw new Error(`TPS title button not found: ${JSON.stringify(click)}`);

  let initial = null;
`,
`  const click = await clickButton(sessionId, "TPS LOCK-ON BATTLE");
  if (!click?.clicked) throw new Error(`TPS title button not found: ${JSON.stringify(click)}`);
  await delay(120);
  const engage = await clickButton(sessionId, "ENGAGE TPS");
  if (!engage?.clicked) throw new Error(`TPS loadout engage button not found: ${JSON.stringify(engage)}`);

  let initial = null;
`,
);
replaceOnce(capture,
`    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    game.press('punch', 'tps-audit-punch');
`,
`    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    const canvas = game.renderer.domElement;
    const playerScreen = game.p1.position.clone();
    const enemyScreen = game.p2.position.clone();
    playerScreen.y = 1.2;
    enemyScreen.y = 1.2;
    playerScreen.project(game.camera);
    enemyScreen.project(game.camera);
    const screenSeparation = Math.abs(enemyScreen.x - playerScreen.x) * canvas.width * 0.5;
    const targetGroundRing = Boolean(game.scene.getObjectByName('tps-target-ground-ring'));
    game.press('punch', 'tps-audit-punch');
`,
);
replaceOnce(capture,
`    return { steps, p1Health: game.p1.health, p2Health: game.p2.health, p1State: game.p1.state, p2State: game.p2.state };
`,
`    return { steps, p1Health: game.p1.health, p2Health: game.p2.health, p1State: game.p1.state, p2State: game.p2.state, screenSeparation, targetGroundRing };
`,
);
replaceOnce(capture,
`  if (!(afterPunch?.p2?.health < 100)) throw new Error(`TPS punch failed to damage locked target: ${JSON.stringify({ punchProbe, afterPunch })}`);
`,
`  if (!(afterPunch?.p2?.health < 100)) throw new Error(`TPS punch failed to damage locked target: ${JSON.stringify({ punchProbe, afterPunch })}`);
  if (!(punchProbe?.screenSeparation >= 55)) throw new Error(`TPS close-range camera still overlaps fighter centers too heavily: ${JSON.stringify(punchProbe)}`);
  if (!punchProbe?.targetGroundRing) throw new Error(`TPS target ground ring was not present: ${JSON.stringify(punchProbe)}`);
`,
);

const docs = "docs/TPS_PLAYTEST.md";
appendOnce(docs, "## 2026-08-31 — /goal visual gameplay review pass", `
## 2026-08-31 — /goal visual gameplay review pass

Observed in real-WebGL baseline captures:
- close-range shoulder framing still let the foreground fighter cover too much of the target;
- the chest reticle could read through the foreground body and sat too high on UBC characters;
- iPhone landscape duplicated tactical status in the center lane;
- CPU orbit/attack rhythm was deterministic but too mechanically uniform;
- TPS launched directly from title, bypassing fighter/model/difficulty loadout choice.

Implemented:
- stronger close-range lateral shoulder camera with target-side framing bias;
- depth-tested chest lock plus a target ground ring for occlusion-safe spatial read;
- tactical CPU states (PRESSURE / ORBIT / BAIT), contextual guard/throw/recovery punish, and real EASY/NORMAL/HARD tuning;
- TPS loadout selection before battle;
- context glow on Guard during INCOMING and P/K during STRIKE RANGE;
- removed redundant center TPS badge on iPhone-height landscape;
- visual audit now asserts close-range screen separation and target ground marker presence.
`);

console.log("Applied TPS /goal visual gameplay review pass");
