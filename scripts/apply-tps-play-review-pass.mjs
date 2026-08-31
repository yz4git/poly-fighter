import { readFile, writeFile } from "node:fs/promises";

async function replaceOrFail(path, from, to) {
  const source = await readFile(path, "utf8");
  if (!source.includes(from)) throw new Error(`Expected source block not found in ${path}: ${from.slice(0, 120)}`);
  await writeFile(path, source.replace(from, to));
}

const tpsPath = "src/game/tps-game.ts";

await replaceOrFail(
  tpsPath,
  `  const pillarGeometry = new THREE.CylinderGeometry(0.13, 0.2, 2.2, 8);\n  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x102844, emissive: 0x06294b, emissiveIntensity: 0.5, roughness: 0.7 });\n  disposables.push(pillarGeometry, pillarMaterial);\n  for (let index = 0; index < 16; index += 1) {\n    const angle = index * Math.PI / 8;\n    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);\n    pillar.position.set(Math.cos(angle) * (ARENA_RADIUS + 0.42), 1.1, Math.sin(angle) * (ARENA_RADIUS + 0.42));\n    group.add(pillar);\n  }`,
  `  // Keep scenery outside the shoulder-camera orbit. The previous pillar ring\n  // sat directly between the camera and fighters and produced large foreground\n  // slabs during strafing. These thinner beacons preserve depth without blocking play.\n  const pillarGeometry = new THREE.CylinderGeometry(0.07, 0.12, 1.45, 8);\n  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x102844, emissive: 0x06294b, emissiveIntensity: 0.58, roughness: 0.7 });\n  disposables.push(pillarGeometry, pillarMaterial);\n  for (let index = 0; index < 12; index += 1) {\n    const angle = index * Math.PI / 6;\n    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);\n    pillar.position.set(Math.cos(angle) * (ARENA_RADIUS + 2.15), 0.725, Math.sin(angle) * (ARENA_RADIUS + 2.15));\n    group.add(pillar);\n  }`,
);

await replaceOrFail(
  tpsPath,
  `    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);`,
  `    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);`,
);

await replaceOrFail(
  tpsPath,
  `    const lockGeometry = new THREE.TorusGeometry(0.62, 0.025, 8, 48);`,
  `    const lockGeometry = new THREE.TorusGeometry(0.34, 0.018, 8, 40);`,
);

await replaceOrFail(
  tpsPath,
  `    this.updatePlayer(input);\n    this.updateEnemy();\n    this.resolveAttack(this.p1, this.p2, this.p2.state === "GUARD");`,
  `    this.updatePlayer(input);\n    this.updateEnemy();\n    // A short authored step-in keeps lock-on melee responsive without pulling a\n    // fighter across the arena. It is only active during startup and only when\n    // the target is already just outside normal contact range.\n    this.applyAttackStepIn(this.p1, this.p2);\n    this.applyAttackStepIn(this.p2, this.p1);\n    this.resolveAttack(this.p1, this.p2, this.p2.state === "GUARD");`,
);

await replaceOrFail(
  tpsPath,
  `    if (input.guard) {\n      this.p1.state = "GUARD";\n    } else if (move.lengthSq() > 0.001) {\n      move.normalize();\n      const speed = this.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;\n      this.p1.position.addScaledVector(move, FIXED_STEP * speed);\n      this.p1.state = "WALK";\n    } else {`,
  `    const moveSpeed = this.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;\n    if (input.guard) {\n      // TPS defense should not root the player in place. Guard-step movement is\n      // deliberately slow enough that offense can still corner or chase it.\n      if (move.lengthSq() > 0.001) {\n        move.normalize();\n        this.p1.position.addScaledVector(move, FIXED_STEP * moveSpeed * 0.42);\n      }\n      this.p1.state = "GUARD";\n    } else if (move.lengthSq() > 0.001) {\n      move.normalize();\n      this.p1.position.addScaledVector(move, FIXED_STEP * moveSpeed);\n      this.p1.state = "WALK";\n    } else {`,
);

await replaceOrFail(tpsPath, `    if (distance > 2.55) movement.add(towardPlayer);`, `    if (distance > 2.35) movement.add(towardPlayer);`);
await replaceOrFail(tpsPath, `    else if (distance < 1.45) movement.addScaledVector(towardPlayer, -0.9);`, `    else if (distance < 1.3) movement.addScaledVector(towardPlayer, -0.9);`);
await replaceOrFail(tpsPath, `    movement.addScaledVector(tangent, orbitSign * 0.58);`, `    movement.addScaledVector(tangent, orbitSign * 0.46);`);
await replaceOrFail(tpsPath, `    } else if (this.enemyCooldown <= 0 && distance < 2.3) {`, `    } else if (this.enemyCooldown <= 0 && distance < 2.05) {`);

await replaceOrFail(
  tpsPath,
  `  private separateFighters(): void {`,
  `  private applyAttackStepIn(attacker: FighterRuntime, defender: FighterRuntime): void {\n    const move = attacker.currentMove;\n    if (attacker.state !== "ATTACK" || !move || attacker.moveTick > move.startup) return;\n    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);\n    const desiredContact = Math.max(1.02, move.reach + 0.52);\n    if (distance <= desiredContact || distance > desiredContact + 0.72) return;\n    const remaining = distance - desiredContact;\n    const stepDistance = Math.min(remaining, 0.038 + move.power * 0.014);\n    attacker.position.addScaledVector(horizontalDirection(attacker.position, defender.position), stepDistance);\n  }\n\n  private separateFighters(): void {`,
);

await replaceOrFail(
  tpsPath,
  `  private updateCamera(delta: number): void {\n    const forward = horizontalDirection(this.p1.position, this.p2.position);\n    const right = new THREE.Vector3(-forward.z, 0, forward.x);\n    // A true over-the-shoulder composition: keep the locked opponent near the\n    // center while the player occupies the lower-left third instead of hiding\n    // the target directly behind their torso.\n    this.cameraTarget.copy(this.p2.position).add(new THREE.Vector3(0, 1.22, 0));\n    this.cameraDesired.copy(this.p1.position)\n      .addScaledVector(forward, -5.35)\n      .addScaledVector(right, 1.62)\n      .add(new THREE.Vector3(0, 2.42, 0));\n    ease(this.camera.position, this.cameraDesired, 9.5, delta);\n    this.camera.lookAt(this.cameraTarget);\n  }`,
  `  private updateCamera(delta: number): void {\n    const forward = horizontalDirection(this.p1.position, this.p2.position);\n    const right = new THREE.Vector3(-forward.z, 0, forward.x);\n    const fightDistance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);\n    const closeFactor = THREE.MathUtils.clamp((2.6 - fightDistance) / 1.7, 0, 1);\n    // Pull back and widen the shoulder offset as fighters collapse into striking\n    // range. This keeps both heads and the target reticle readable at contact.\n    const backDistance = 5.65 + closeFactor * 1.35;\n    const shoulderOffset = 2.0 + closeFactor * 0.55;\n    const cameraHeight = 2.5 + closeFactor * 0.34;\n    this.cameraTarget.copy(this.p2.position).add(new THREE.Vector3(0, 1.28 + closeFactor * 0.05, 0));\n    this.cameraDesired.copy(this.p1.position)\n      .addScaledVector(forward, -backDistance)\n      .addScaledVector(right, shoulderOffset)\n      .add(new THREE.Vector3(0, cameraHeight, 0));\n    ease(this.camera.position, this.cameraDesired, 10.5, delta);\n    this.camera.lookAt(this.cameraTarget);\n  }`,
);

await replaceOrFail(
  tpsPath,
  `  private updateLockOn(): void {\n    const target = this.p2.position.clone().add(new THREE.Vector3(0, 1.35, 0));\n    this.lockRing.position.copy(target);\n    this.lockRing.lookAt(this.camera.position);\n    const pulse = 1 + Math.sin(this.renderTime * 5.5) * 0.055;\n    this.lockRing.scale.setScalar(pulse);\n    this.lockStem.position.copy(target).add(new THREE.Vector3(0, -0.72, 0));\n    this.lockStem.lookAt(this.camera.position);\n  }`,
  `  private updateLockOn(): void {\n    const target = this.p2.position.clone().add(new THREE.Vector3(0, 1.56, 0));\n    this.lockRing.position.copy(target);\n    this.lockRing.lookAt(this.camera.position);\n    const pulse = 1 + Math.sin(this.renderTime * 5.5) * 0.04;\n    this.lockRing.scale.setScalar(pulse);\n    this.lockStem.position.copy(target).add(new THREE.Vector3(0, -0.46, 0));\n    this.lockStem.lookAt(this.camera.position);\n  }`,
);

await replaceOrFail(
  tpsPath,
  `    const forward = horizontalDirection(this.p1.position, this.p2.position);\n    const right = new THREE.Vector3(-forward.z, 0, forward.x);\n    this.camera.position.copy(this.p1.position)\n      .addScaledVector(forward, -5.35)\n      .addScaledVector(right, 1.62)\n      .add(new THREE.Vector3(0, 2.42, 0));\n    this.updateCamera(1);`,
  `    const forward = horizontalDirection(this.p1.position, this.p2.position);\n    const right = new THREE.Vector3(-forward.z, 0, forward.x);\n    this.camera.position.copy(this.p1.position)\n      .addScaledVector(forward, -5.65)\n      .addScaledVector(right, 2.0)\n      .add(new THREE.Vector3(0, 2.5, 0));\n    this.updateCamera(1);`,
);

const pagePath = "app/page.tsx";
await replaceOrFail(
  pagePath,
  `          <div className={\`match-badge \${battleMode === "TPS" ? "tps-badge" : ""}\`}>{battleMode === "TPS" ? <>TPS LOCK-ON <span>•</span> CIRCULAR ARENA</> : <>HIGH-POLY FLAT SHADING <span>•</span> RING OUT ACTIVE</>}</div>\n          {battleMode === "TPS" && <div className="tps-mode-hud"><span>LOCK</span><b>{hud?.p2Name ?? p2.name}</b><i>◇</i></div>}`,
  `          <div className={\`match-badge \${battleMode === "TPS" ? "tps-badge" : ""}\`}>{battleMode === "TPS" ? <>TARGET <b>{hud?.p2Name ?? p2.name}</b> <span>•</span> LOCKED <span>•</span> CIRCULAR ARENA</> : <>HIGH-POLY FLAT SHADING <span>•</span> RING OUT ACTIVE</>}</div>`,
);
await replaceOrFail(
  pagePath,
  `MOVE <b>8-WAY</b> / PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> TARGET LOCKED`,
  `MOVE <b>8-WAY</b> / PUNCH <b>P</b> / KICK <b>K</b> / HOLD <b>G + MOVE</b> GUARD STEP`,
);

const cssPath = "app/globals.css";
await replaceOrFail(
  cssPath,
  `.tps-badge { border-color: rgba(90, 226, 255, .75) !important; color: #a9f3ff !important; }\n.tps-mode-hud {\n  position: fixed;\n  left: 50%;\n  top: max(14%, calc(env(safe-area-inset-top) + 58px));\n  transform: translateX(-50%);\n  display: grid;\n  place-items: center;\n  pointer-events: none;\n  z-index: 7;\n  color: #aaf4ff;\n  text-shadow: 0 0 12px rgba(65, 214, 255, .75);\n}\n.tps-mode-hud span { font-size: .52rem; letter-spacing: .34em; opacity: .8; }\n.tps-mode-hud b { font-size: .72rem; letter-spacing: .16em; margin-top: .1rem; }\n.tps-mode-hud i { font-style: normal; font-size: 1.5rem; line-height: 1; animation: tps-lock-pulse .9s ease-in-out infinite alternate; }\n@keyframes tps-lock-pulse { from { transform: scale(.86); opacity: .58; } to { transform: scale(1.08); opacity: 1; } }`,
  `.tps-badge { border-color: rgba(90, 226, 255, .75) !important; color: #a9f3ff !important; }\n.tps-badge b { color: #e9fdff; font-weight: 900; text-shadow: 0 0 10px rgba(65, 214, 255, .6); }`,
);

await replaceOrFail(
  cssPath,
  `  .touch-controls { bottom: max(9px, env(safe-area-inset-bottom)); }\n  .input-hint { display: none; }\n  .match-badge { top: 79px; }\n  .pause-button { display: block; }`,
  `  .fight-hud { grid-template-columns: 1fr 88px 1fr; gap: 10px; top: max(8px, env(safe-area-inset-top)); }\n  .hud-name { margin-bottom: 4px; }\n  .hud-name strong { font-size: clamp(14px, 2.5vw, 20px); }\n  .health-track { height: 12px; }\n  .round-readout { padding: 4px 6px 6px; }\n  .round-readout b { font-size: 25px; }\n  .touch-controls { bottom: max(8px, env(safe-area-inset-bottom)); }\n  .virtual-pad { width: 132px; }\n  .virtual-pad-knob { width: 44px; }\n  .action-buttons { gap: 10px; }\n  .action-buttons .touch-action { width: 58px; height: 58px; font-size: 24px; }\n  .input-hint { display: none; }\n  .match-badge { top: 70px; font-size: 7px; }\n  .pause-button { display: block; top: max(76px, calc(env(safe-area-inset-top) + 68px)); width: 31px; height: 31px; }`,
);

const testPath = "tests/tps-mode.test.ts";
await replaceOrFail(
  testPath,
  `  assert.match(source, /addScaledVector\\(forward, -5\\.35\\)/);\n  assert.match(source, /addScaledVector\\(right, 1\\.62\\)/);\n  assert.match(source, /lockRing/);`,
  `  assert.match(source, /closeFactor = THREE\\.MathUtils\\.clamp/);\n  assert.match(source, /backDistance = 5\\.65 \\+ closeFactor \\* 1\\.35/);\n  assert.match(source, /shoulderOffset = 2\\.0 \\+ closeFactor \\* 0\\.55/);\n  assert.match(source, /new THREE\\.TorusGeometry\\(0\\.34/);\n  assert.match(source, /ARENA_RADIUS \\+ 2\\.15/);`,
);
await replaceOrFail(
  testPath,
  `  assert.match(source, /resolveAttack\\(this\\.p2, this\\.p1, this\\.p1\\.state === "GUARD"\\)/);`,
  `  assert.match(source, /resolveAttack\\(this\\.p2, this\\.p1, this\\.p1\\.state === "GUARD"\\)/);\n  assert.match(source, /applyAttackStepIn\\(this\\.p1, this\\.p2\\)/);\n  assert.match(source, /moveSpeed \\* 0\\.42/);`,
);
await replaceOrFail(
  testPath,
  `  assert.match(page, /TARGET LOCKED/);`,
  `  assert.match(page, /CIRCULAR ARENA/);\n  assert.match(page, /GUARD STEP/);`,
);

const auditPath = "scripts/capture-tps-visual-audit.mjs";
await replaceOrFail(
  auditPath,
  `  initial = await state(sessionId);\n  await screenshot(sessionId, \`${outputDir}/tps-idle.png\`);\n\n  // Real-time input probes stay on requestAnimationFrame`,
  `  initial = await state(sessionId);\n  await screenshot(sessionId, \`${outputDir}/tps-idle.png\`);\n\n  // Capture an iPhone-landscape-sized CSS viewport as a permanent UI regression\n  // target. Chrome's headless outer window is taller than its content viewport,\n  // so 573px yields roughly a 430px gameplay canvas.\n  await command(\`/session/${sessionId}/window/rect\`, "POST", { width: 932, height: 573, x: 0, y: 0 });\n  await delay(260);\n  const iphone = await state(sessionId);\n  if (!(iphone?.canvasWidth >= 800 && iphone?.canvasHeight >= 340 && iphone?.canvasHeight <= 480)) {\n    throw new Error(\`TPS iPhone viewport probe is outside the expected range: ${JSON.stringify(iphone)}\`);\n  }\n  await screenshot(sessionId, \`${outputDir}/tps-iphone-idle.png\`);\n  await command(\`/session/${sessionId}/window/rect\`, "POST", { width: 1536, height: 706, x: 0, y: 0 });\n  await delay(260);\n\n  // Real-time input probes stay on requestAnimationFrame`,
);
await replaceOrFail(
  auditPath,
  `  await screenshot(sessionId, \`${outputDir}/tps-punch.png\`);\n\n  await execute(sessionId, \`${gameLookup}`,
  `  await screenshot(sessionId, \`${outputDir}/tps-punch.png\`);\n  await execute(sessionId, \`${gameLookup}\n    const game = findGame();\n    game.effects.update(0.3);\n    for (let index = 0; index < 10; index += 1) game.step();\n    game.updateCamera(1 / 30);\n    game.updateLockOn();\n    game.renderer.render(game.scene, game.camera);\n    return true;\n  \`);\n  await screenshot(sessionId, \`${outputDir}/tps-punch-settled.png\`);\n\n  await execute(sessionId, \`${gameLookup}`,
);
await replaceOrFail(
  auditPath,
  `  const report = { initial, afterStrafe, beforeForwardDistance, afterForward, afterForwardDistance, punchProbe, afterPunch, afterBoundary, radial };`,
  `  const report = { initial, iphone, afterStrafe, beforeForwardDistance, afterForward, afterForwardDistance, punchProbe, afterPunch, afterBoundary, radial };`,
);

const workflowPath = ".github/workflows/tps-visual-audit.yml";
await replaceOrFail(
  workflowPath,
  `          test -s artifacts/tps-visual-audit/tps-idle.png\n          test -s artifacts/tps-visual-audit/tps-punch.png\n          test -s artifacts/tps-visual-audit/tps-runtime-state.json\n          file artifacts/tps-visual-audit/tps-idle.png | grep -q "PNG image data"\n          file artifacts/tps-visual-audit/tps-punch.png | grep -q "PNG image data"`,
  `          test -s artifacts/tps-visual-audit/tps-idle.png\n          test -s artifacts/tps-visual-audit/tps-iphone-idle.png\n          test -s artifacts/tps-visual-audit/tps-punch.png\n          test -s artifacts/tps-visual-audit/tps-punch-settled.png\n          test -s artifacts/tps-visual-audit/tps-runtime-state.json\n          file artifacts/tps-visual-audit/tps-idle.png | grep -q "PNG image data"\n          file artifacts/tps-visual-audit/tps-iphone-idle.png | grep -q "PNG image data"\n          file artifacts/tps-visual-audit/tps-punch.png | grep -q "PNG image data"\n          file artifacts/tps-visual-audit/tps-punch-settled.png | grep -q "PNG image data"`,
);

console.log("TPS play-review quality pass applied.");
