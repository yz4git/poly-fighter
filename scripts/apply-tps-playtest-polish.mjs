import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(before)) throw new Error(`Missing patch target in ${path}: ${before.slice(0, 120)}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`Patch made no change in ${path}`);
  writeFileSync(path, next);
}

const game = "src/game/tps-game.ts";
replaceOnce(game,
  '    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);',
  '    this.camera = new THREE.PerspectiveCamera(47, 1, 0.1, 80);',
);
replaceOnce(game,
`  const boundary = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
  boundary.rotation.x = Math.PI / 2;
  boundary.position.y = 0.025;
  group.add(boundary);
  disposables.push(boundaryGeometry, boundaryMaterial);
`,
`  const boundary = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
  boundary.rotation.x = Math.PI / 2;
  boundary.position.y = 0.025;
  group.add(boundary);
  disposables.push(boundaryGeometry, boundaryMaterial);

  // A faint elevated rail gives the shoulder camera a stable horizon reference.
  // It also fills the otherwise empty upper half of the TPS composition without
  // placing opaque scenery between the camera and the fighters.
  const horizonGeometry = new THREE.TorusGeometry(ARENA_RADIUS + 2.15, 0.018, 6, 96);
  const horizonMaterial = new THREE.MeshBasicMaterial({
    color: 0x2d8dbf,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const horizon = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizon.rotation.x = Math.PI / 2;
  horizon.position.y = 1.45;
  group.add(horizon);
  disposables.push(horizonGeometry, horizonMaterial);
`,
);
replaceOnce(game,
`  const pillarGeometry = new THREE.CylinderGeometry(0.07, 0.12, 1.45, 8);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x102844, emissive: 0x06294b, emissiveIntensity: 0.58, roughness: 0.7 });
  disposables.push(pillarGeometry, pillarMaterial);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(Math.cos(angle) * (ARENA_RADIUS + 2.15), 0.725, Math.sin(angle) * (ARENA_RADIUS + 2.15));
    group.add(pillar);
  }
`,
`  const pillarGeometry = new THREE.CylinderGeometry(0.07, 0.12, 1.45, 8);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x143454, emissive: 0x07365d, emissiveIntensity: 0.9, roughness: 0.7 });
  const beaconGeometry = new THREE.OctahedronGeometry(0.11, 0);
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0x61ddff, transparent: true, opacity: 0.72 });
  disposables.push(pillarGeometry, pillarMaterial, beaconGeometry, beaconMaterial);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    const x = Math.cos(angle) * (ARENA_RADIUS + 2.15);
    const z = Math.sin(angle) * (ARENA_RADIUS + 2.15);
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(x, 0.725, z);
    const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
    beacon.position.set(x, 1.5, z);
    group.add(pillar, beacon);
  }
`,
);
replaceOnce(game,
`  private playerEvadeTicks = 0;
  private playerEvadeCooldown = 0;
  private playerEvadeSign = 0;
`,
`  private playerEvadeTicks = 0;
  private playerEvadeCooldown = 0;
  private playerEvadeSign = 0;
  private simulationTicks = 0;
  private cameraImpact = 0;
`,
);
replaceOnce(game,
`    const lockGeometry = new THREE.TorusGeometry(0.34, 0.018, 8, 40);
    const lockMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.92, depthTest: true });
`,
`    const lockGeometry = new THREE.TorusGeometry(0.46, 0.022, 8, 48);
    const lockMaterial = new THREE.MeshBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false });
`,
);
replaceOnce(game,
`    const stemMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.72, depthTest: true });
`,
`    const stemMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.76, depthTest: false, depthWrite: false });
`,
);
replaceOnce(game,
`    this.effects.onShake = () => undefined;
`,
`    this.effects.onShake = (amount) => {
      if (!this.settings.get().cameraShake) return;
      this.cameraImpact = Math.min(0.085, this.cameraImpact + amount * 0.55);
    };
`,
);
replaceOnce(game,
`  private step(): void {
    if (this.paused || this.finished) return;
    this.timerTicks = Math.max(0, this.timerTicks - 1);
`,
`  private step(): void {
    if (this.paused || this.finished) return;
    this.simulationTicks += 1;
    this.timerTicks = Math.max(0, this.timerTicks - 1);
`,
);
replaceOnce(game,
`    const punchPressed = this.p1.justPressed("punch");
    const kickPressed = this.p1.justPressed("kick");
    if (input.punch && input.kick && (punchPressed || kickPressed)) this.p1.beginMove("power");
    else if (punchPressed) this.p1.beginMove(forwardAxis > 0 ? "straight" : "jab");
    else if (kickPressed) this.p1.beginMove(sideAxis !== 0 ? "dashKick" : "kick");
`,
`    const punchPressed = this.p1.justPressed("punch");
    const kickPressed = this.p1.justPressed("kick");
    const guardPressed = this.p1.justPressed("guard");
    const throwPressed = input.guard && input.kick && (guardPressed || kickPressed);
    const counterPressed = input.guard && input.punch && (guardPressed || punchPressed);
    if (throwPressed) this.p1.beginMove("throw");
    else if (counterPressed) this.p1.beginMove("counter");
    else if (input.punch && input.kick && (punchPressed || kickPressed)) this.p1.beginMove("power");
    else if (punchPressed) this.p1.beginMove(forwardAxis > 0 ? "straight" : "jab");
    else if (kickPressed) this.p1.beginMove(sideAxis !== 0 ? "dashKick" : "kick");
`,
);
replaceOnce(game,
`  private updateEnemy(): void {
    this.p2.setInput(EMPTY_INPUT);
    if (this.advanceLockedState(this.p2)) return;

    this.enemyCooldown -= 1;
    const towardPlayer = horizontalDirection(this.p2.position, this.p1.position);
    const distance = this.p2.position.distanceTo(this.p1.position);
    const tangent = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x);
    const orbitSign = Math.sin(this.renderTime * 0.72) >= 0 ? 1 : -1;
    const movement = new THREE.Vector3();

    if (distance > 2.35) movement.add(towardPlayer);
    else if (distance < 1.3) movement.addScaledVector(towardPlayer, -0.9);
    movement.addScaledVector(tangent, orbitSign * 0.46);

    const playerThreat = this.p1.state === "ATTACK" && this.p1.currentMove && distance < this.p1.currentMove.reach + 0.85;
    const shouldGuard = Boolean(playerThreat && this.p1.moveTick >= Math.max(0, (this.p1.currentMove?.startup ?? 8) - 2) && Math.sin(this.renderTime * 7.1) > -0.15);

    if (shouldGuard) {
      this.p2.state = "GUARD";
    } else if (this.enemyCooldown <= 0 && distance < 2.05) {
      const selector = Math.floor(this.renderTime * 3.7) % 5;
      this.p2.beginMove(selector === 0 ? "power" : selector <= 2 ? "jab" : "kick");
      this.enemyCooldown = selector === 0 ? 92 : 58;
    } else if (movement.lengthSq() > 0.001) {
      movement.normalize();
      const speed = this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;
      this.p2.position.addScaledVector(movement, FIXED_STEP * speed);
      this.p2.state = "WALK";
    } else {
      this.p2.state = "IDLE";
    }

    this.p2.updatePhysics(FIXED_STEP);
  }
`,
`  private updateEnemy(): void {
    this.p2.setInput(EMPTY_INPUT);
    if (this.advanceLockedState(this.p2)) return;

    this.enemyCooldown -= 1;
    const aiTime = this.simulationTicks * FIXED_STEP;
    const towardPlayer = horizontalDirection(this.p2.position, this.p1.position);
    const distance = this.p2.position.distanceTo(this.p1.position);
    const tangent = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x);
    const orbitSign = Math.sin(aiTime * 0.72) >= 0 ? 1 : -1;
    const movement = new THREE.Vector3();

    if (distance > 2.35) movement.add(towardPlayer);
    else if (distance < 1.3) movement.addScaledVector(towardPlayer, -0.9);
    movement.addScaledVector(tangent, orbitSign * 0.46);

    const playerThreat = this.p1.state === "ATTACK" && this.p1.currentMove && distance < this.p1.currentMove.reach + 0.85;
    const playerGuarding = this.p1.state === "GUARD";
    const shouldGuard = Boolean(playerThreat && this.p1.moveTick >= Math.max(0, (this.p1.currentMove?.startup ?? 8) - 2) && Math.sin(aiTime * 7.1) > -0.15);

    if (shouldGuard) {
      this.p2.state = "GUARD";
    } else if (this.enemyCooldown <= 0 && distance < 2.05) {
      const selector = Math.floor(aiTime * 3.7) % 5;
      const punishGuard = playerGuarding && distance < 1.38;
      const moveId = punishGuard ? "throw" : selector === 0 ? "power" : selector <= 2 ? "jab" : "kick";
      this.p2.beginMove(moveId);
      this.enemyCooldown = moveId === "throw" ? 72 : selector === 0 ? 92 : 58;
    } else if (movement.lengthSq() > 0.001) {
      movement.normalize();
      const speed = this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;
      this.p2.position.addScaledVector(movement, FIXED_STEP * speed);
      this.p2.state = "WALK";
    } else {
      this.p2.state = "IDLE";
    }

    this.p2.updatePhysics(FIXED_STEP);
  }
`,
);
replaceOnce(game,
`  private updateCamera(delta: number): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const fightDistance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const closeFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);
    // Pull back and widen the shoulder offset as fighters collapse into striking
    // range. This keeps both heads and the target reticle readable at contact.
    const backDistance = 5.65 + closeFactor * 1.35;
    const shoulderOffset = 2.0 + closeFactor * 1.15;
    const cameraHeight = 2.5 + closeFactor * 0.34;
    this.cameraTarget.copy(this.p2.position).add(new THREE.Vector3(0, 1.28 + closeFactor * 0.05, 0));
    this.cameraDesired.copy(this.p1.position)
      .addScaledVector(forward, -backDistance)
      .addScaledVector(right, shoulderOffset)
      .add(new THREE.Vector3(0, cameraHeight, 0));
    ease(this.camera.position, this.cameraDesired, 10.5, delta);
    this.camera.lookAt(this.cameraTarget);
  }
`,
`  private updateCamera(delta: number): void {
    const forward = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const fightDistance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const closeFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);
    // Stay close enough that the player body reads as a true shoulder-view
    // foreground anchor. At contact we widen sideways rather than retreating far
    // away, which keeps the opponent visible without shrinking both fighters.
    const backDistance = 5.15 + closeFactor * 0.45;
    const shoulderOffset = 1.85 + closeFactor * 0.82;
    const cameraHeight = 2.28 + closeFactor * 0.22;
    this.cameraTarget.copy(this.p2.position).add(new THREE.Vector3(0, 1.2 + closeFactor * 0.04, 0));
    this.cameraDesired.copy(this.p1.position)
      .addScaledVector(forward, -backDistance)
      .addScaledVector(right, shoulderOffset)
      .add(new THREE.Vector3(0, cameraHeight, 0));
    ease(this.camera.position, this.cameraDesired, 11.5, delta);
    if (this.cameraImpact > 0.001) {
      const impact = this.cameraImpact;
      this.cameraImpact *= Math.exp(-10 * delta);
      this.camera.position.addScaledVector(right, Math.sin(this.renderTime * 76) * impact);
      this.camera.position.y += Math.cos(this.renderTime * 91) * impact * 0.36;
    }
    this.camera.lookAt(this.cameraTarget);
  }
`,
);
replaceOnce(game,
`    const target = this.p2.visual.root.localToWorld(new THREE.Vector3(0, this.p2.visual.layout.ribY + 0.025, 0));
`,
`    const target = this.p2.visual.root.localToWorld(new THREE.Vector3(0, this.p2.visual.layout.ribY + 0.18, 0));
`,
);
replaceOnce(game,
`    const pulseRate = threat ? 10.5 : 5.5;
    const pulse = (threat ? 0.78 : 0.72) + Math.sin(this.renderTime * pulseRate) * 0.035;
`,
`    const pulseRate = threat ? 11.5 : 5.5;
    const pulse = (threat ? 1.04 : inStrikeRange ? 0.96 : 0.9) + Math.sin(this.renderTime * pulseRate) * 0.055;
`,
);
replaceOnce(game,
`    this.enemyCooldown = 52;
    this.playerEvadeTicks = 0;
    this.playerEvadeCooldown = 0;
    this.playerEvadeSign = 0;
`,
`    this.enemyCooldown = 52;
    this.playerEvadeTicks = 0;
    this.playerEvadeCooldown = 0;
    this.playerEvadeSign = 0;
    this.simulationTicks = 0;
    this.cameraImpact = 0;
`,
);
replaceOnce(game,
`    this.camera.position.copy(this.p1.position)
      .addScaledVector(forward, -5.65)
      .addScaledVector(right, 2.0)
      .add(new THREE.Vector3(0, 2.5, 0));
`,
`    this.camera.position.copy(this.p1.position)
      .addScaledVector(forward, -5.15)
      .addScaledVector(right, 1.85)
      .add(new THREE.Vector3(0, 2.28, 0));
`,
);
replaceOnce(game,
`      message: this.finished ? "BATTLE COMPLETE" : "TARGET LOCKED",
`,
`      message: this.finished
        ? "BATTLE COMPLETE"
        : this.p2.state === "ATTACK"
          ? "INCOMING"
          : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < 2.12
            ? "STRIKE RANGE"
            : "TARGET LOCKED",
`,
);

const page = "app/page.tsx";
replaceOnce(page,
`          <div className={\`match-badge \${battleMode === "TPS" ? "tps-badge" : ""}\`}>{battleMode === "TPS" ? <>TARGET <b>{hud?.p2Name ?? p2.name}</b> <span>•</span> LOCKED <span>•</span> CIRCULAR ARENA</> : <>HIGH-POLY FLAT SHADING <span>•</span> RING OUT ACTIVE</>}</div>
          <button type="button" className="pause-button" aria-label={paused ? "Resume" : "Pause"} onClick={() => { const next = !paused; setPaused(next); if (next) gameRef.current?.pause(); else gameRef.current?.resume(); }}> {paused ? "▶" : "Ⅱ"} </button>
`,
`          <div className={\`match-badge \${battleMode === "TPS" ? "tps-badge" : ""}\`}>{battleMode === "TPS" ? <><strong>{hud?.message ?? "TARGET LOCKED"}</strong><span>•</span><b>{hud?.p2Name ?? p2.name}</b></> : <>HIGH-POLY FLAT SHADING <span>•</span> RING OUT ACTIVE</>}</div>
          <button type="button" className={\`pause-button \${battleMode === "TPS" ? "tps-pause-button" : ""}\`} aria-label={paused ? "Resume" : "Pause"} onClick={() => { const next = !paused; setPaused(next); if (next) gameRef.current?.pause(); else gameRef.current?.resume(); }}> {paused ? "▶" : "Ⅱ"} </button>
`,
);
replaceOnce(page,
`          <div className="input-hint">{battleMode === "TPS" ? <>MOVE <b>8-WAY</b> / PUNCH <b>P</b> / KICK <b>K</b> / HOLD <b>G + MOVE</b> GUARD STEP / <b>G + SIDE</b> QUICKSTEP</> : <>PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> HOLD G + 8-WAY TO SIDESTEP</>}</div>
`,
`          <div className={\`input-hint \${battleMode === "TPS" ? "tps-input-hint" : ""}\`}>{battleMode === "TPS" ? <><b>G+SIDE</b> QUICKSTEP <span>•</span> <b>G+K</b> THROW <span>•</span> <b>G+P</b> COUNTER <span>•</span> <b>P+K</b> POWER</> : <>PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> HOLD G + 8-WAY TO SIDESTEP</>}</div>
`,
);

const css = "app/globals.css";
const cssSource = readFileSync(css, "utf8");
const cssMarker = "/* TPS PLAYTEST POLISH v2 */";
if (cssSource.includes(cssMarker)) throw new Error("TPS polish CSS already applied");
writeFileSync(css, `${cssSource}\n\n${cssMarker}\n.tps-badge {\n  top: 72px;\n  padding: 5px 11px;\n  border: 1px solid rgba(90, 226, 255, .42);\n  background: rgba(3, 14, 28, .7);\n  font-size: clamp(8px, 1vw, 10px);\n  font-weight: 800;\n  letter-spacing: .12em;\n  clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%);\n}\n.tps-badge strong { color: #ffd86a; font-weight: 900; }\n.tps-badge span { color: #5de5ff; padding: 0 7px; }\n.tps-pause-button { top: max(58px, calc(env(safe-area-inset-top) + 46px)); right: max(12px, env(safe-area-inset-right)); width: 30px; height: 30px; }\n.tps-input-hint {\n  bottom: max(10px, env(safe-area-inset-bottom));\n  padding: 4px 9px;\n  color: rgba(212, 235, 248, .8);\n  background: rgba(3, 13, 26, .68);\n  border: 1px solid rgba(124, 213, 255, .18);\n  font-size: clamp(7px, .9vw, 9px);\n  letter-spacing: .08em;\n}\n@media (max-width: 760px) {\n  .tps-badge { top: 62px; font-size: 8px; padding: 4px 9px; }\n  .tps-pause-button { top: 57px; right: max(9px, env(safe-area-inset-right)); }\n  .tps-input-hint { font-size: 7px; bottom: max(7px, env(safe-area-inset-bottom)); }\n}\n`);

const test = "tests/tps-mode.test.ts";
replaceOnce(test,
`  assert.match(source, /backDistance = 5\\.65 \\+ closeFactor \\* 1\\.35/);
  assert.match(source, /shoulderOffset = 2\\.0 \\+ closeFactor \\* 1\\.15/);
  assert.match(source, /new THREE\\.TorusGeometry\\(0\\.34/);
`,
`  assert.match(source, /new THREE\\.PerspectiveCamera\\(47/);
  assert.match(source, /backDistance = 5\\.15 \\+ closeFactor \\* 0\\.45/);
  assert.match(source, /shoulderOffset = 1\\.85 \\+ closeFactor \\* 0\\.82/);
  assert.match(source, /new THREE\\.TorusGeometry\\(0\\.46/);
  assert.match(source, /depthTest: false, depthWrite: false/);
  assert.match(source, /horizonGeometry = new THREE\\.TorusGeometry\\(ARENA_RADIUS \\+ 2\\.15/);
`,
);
replaceOnce(test,
`  assert.match(source, /beginMove\\("power"\\)/);
`,
`  assert.match(source, /beginMove\\("power"\\)/);
  assert.match(source, /throwPressed/);
  assert.match(source, /counterPressed/);
  assert.match(source, /this\\.p1\\.beginMove\\("throw"\\)/);
  assert.match(source, /this\\.p1\\.beginMove\\("counter"\\)/);
`,
);
replaceOnce(test,
`  assert.match(source, /visual\\.layout\\.ribY/);
  assert.match(source, /threat \\? 0xff667f : inStrikeRange \\? 0xffd45c/);
`,
`  assert.match(source, /visual\\.layout\\.ribY/);
  assert.match(source, /threat \\? 0xff667f : inStrikeRange \\? 0xffd45c/);
  assert.match(source, /punishGuard/);
  assert.match(source, /moveId = punishGuard \\? "throw"/);
  assert.match(source, /simulationTicks \\* FIXED_STEP/);
  assert.match(source, /cameraImpact/);
`,
);
replaceOnce(test,
`  assert.match(page, /GUARD STEP/);
`,
`  assert.match(page, /G\\+SIDE/);
  assert.match(page, /G\\+K/);
  assert.match(page, /G\\+P/);
  assert.match(page, /P\\+K/);
`,
);

const audit = "scripts/capture-tps-visual-audit.mjs";
replaceOnce(audit,
`    game.running = false;
    game.finished = false;
    game.input.clear();
    game.p1.setInput({ left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false });
`,
`    game.running = false;
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.p1.setInput({ left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false });
`,
);
replaceOnce(audit,
`  await screenshot(sessionId, \`${outputDir}/tps-punch-settled.png\`);

  await execute(sessionId, \`${gameLookup}
`,
`  await screenshot(sessionId, \`${outputDir}/tps-punch-settled.png\`);

  const throwProbe = await execute(sessionId, \`${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.state = 'IDLE';
      fighter.setInput({ left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false });
    }
    game.p1.position.set(0, 0, 0.48);
    game.p2.position.set(0, 0, -0.48);
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); if (game.p2.state !== 'HIT' && game.p2.state !== 'KNOCKDOWN') game.p2.state = 'IDLE'; };
    game.press('guard', 'tps-audit-throw-g');
    game.step();
    game.press('kick', 'tps-audit-throw-k');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('guard', 'tps-audit-throw-g');
    game.release('kick', 'tps-audit-throw-k');
    let steps = 2;
    while (steps < 45 && game.p2.health === 100) { game.step(); steps += 1; }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { moveId, steps, p2Health: game.p2.health, p2State: game.p2.state };
  \`);
  if (throwProbe.moveId !== 'throw' || !(throwProbe.p2Health < 100)) throw new Error(\`TPS G+K throw failed: \${JSON.stringify(throwProbe)}\`);
  await screenshot(sessionId, \`${outputDir}/tps-throw.png\`);

  await execute(sessionId, \`${gameLookup}
`,
);
replaceOnce(audit,
`  const report = { initial, iphone, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, afterBoundary, radial };
`,
`  const report = { initial, iphone, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, throwProbe, afterBoundary, radial };
`,
);

const workflow = ".github/workflows/tps-visual-audit.yml";
replaceOnce(workflow,
`          for image in tps-idle tps-iphone-idle tps-quickstep tps-punch tps-punch-settled; do
`,
`          for image in tps-idle tps-iphone-idle tps-quickstep tps-punch tps-punch-settled tps-throw; do
`,
);

console.log("TPS playtest polish patch applied.");
