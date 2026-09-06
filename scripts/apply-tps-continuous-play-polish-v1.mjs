import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(before)) throw new Error(`Missing patch target in ${path}: ${before.slice(0, 80)}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`Patch did not modify ${path}`);
  writeFileSync(path, next);
}

const core = "src/game/tps-game-base.ts";
for (const [before, after] of [
  ["const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3.50;", "const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2.80;"],
  ["const TPS_CAMERA_CLOSE_BACK_DELTA = -1.05;", "const TPS_CAMERA_CLOSE_BACK_DELTA = 0.35;"],
  ["const TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.42;", "const TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.36;"],
  ["const TPS_CAMERA_IMPACT_SHOULDER = 0.38;", "const TPS_CAMERA_IMPACT_SHOULDER = 0.18;"],
  ["const TPS_IMPACT_CONTACT_MINIMUM = 1.40;", "const TPS_IMPACT_CONTACT_MINIMUM = 1.52;"],
  ["const TPS_IMPACT_CONTACT_MINIMUM_HEAVY = 1.46;", "const TPS_IMPACT_CONTACT_MINIMUM_HEAVY = 1.58;"],
  ["const TPS_IMPACT_CONTACT_MINIMUM_KICK = 1.50;", "const TPS_IMPACT_CONTACT_MINIMUM_KICK = 1.62;"],
]) replaceOnce(core, before, after);

replaceOnce(
  core,
  "  private readonly cameraTarget = new THREE.Vector3();\n  private readonly cameraDesired = new THREE.Vector3();",
  "  private readonly cameraTarget = new THREE.Vector3();\n  private readonly cameraLookTarget = new THREE.Vector3();\n  private readonly cameraDesired = new THREE.Vector3();",
);
replaceOnce(
  core,
  "    this.camera.lookAt(this.cameraTarget);",
  "    // Smooth the look target as well as camera position. Close-range lock-on can\n    // rotate the target basis quickly during sidesteps, blocks, and hit-stop;\n    // smoothing both halves of the rig prevents a visible aim snap while keeping\n    // the opponent centered.\n    ease(this.cameraLookTarget, this.cameraTarget, 12.0, delta);\n    this.camera.lookAt(this.cameraLookTarget);",
);

const testPath = "tests/tps-mode.test.ts";
for (const [before, after] of [
  ["/TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3\\.50/", "/TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2\\.80/"],
  ["/TPS_CAMERA_CLOSE_BACK_DELTA = -1\\.05/", "/TPS_CAMERA_CLOSE_BACK_DELTA = 0\\.35/"],
  ["/TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\\.42/", "/TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\\.36/"],
  ["/TPS_CAMERA_IMPACT_SHOULDER = 0\\.38/", "/TPS_CAMERA_IMPACT_SHOULDER = 0\\.18/"],
  ["/TPS_IMPACT_CONTACT_MINIMUM = 1\\.40/", "/TPS_IMPACT_CONTACT_MINIMUM = 1\\.52/"],
  ["/TPS_IMPACT_CONTACT_MINIMUM_HEAVY = 1\\.46/", "/TPS_IMPACT_CONTACT_MINIMUM_HEAVY = 1\\.58/"],
  ["/TPS_IMPACT_CONTACT_MINIMUM_KICK = 1\\.50/", "/TPS_IMPACT_CONTACT_MINIMUM_KICK = 1\\.62/"],
]) replaceOnce(testPath, before, after);
replaceOnce(
  testPath,
  "  assert.match(source, /cameraTarget\\.copy\\(this\\.cameraFocus\\)/);",
  "  assert.match(source, /cameraTarget\\.copy\\(this\\.cameraFocus\\)/);\n  assert.match(source, /cameraLookTarget/);\n  assert.match(source, /ease\\(this\\.cameraLookTarget, this\\.cameraTarget, 12\\.0, delta\\)/);",
);

const auditPath = "scripts/capture-tps-visual-audit.mjs";
replaceOnce(
  auditPath,
  "  if (punchProbe?.spacingMode !== \"IMPACT_PAIR\" || !(punchProbe?.spacingMinimum >= 1.40) || !(punchProbe?.impactWorldSeparation >= 1.39) || !(punchProbe?.impactScreenSeparation >= 90)) throw new Error(`TPS resolved impact did not open the v3.1 contact lane: ${JSON.stringify(punchProbe)}`);",
  "  if (punchProbe?.spacingMode !== \"IMPACT_PAIR\" || !(punchProbe?.spacingMinimum >= 1.52) || !(punchProbe?.impactWorldSeparation >= 1.51) || !(punchProbe?.impactScreenSeparation >= 96)) throw new Error(`TPS resolved impact did not open the v3.2 contact lane: ${JSON.stringify(punchProbe)}`);",
);

const insertMarker = "  await screenshot(sessionId, `${outputDir}/tps-damage-afterfeel.png`);\n";
const insertion = String.raw`

  // Verify a real blocked strike at the same close range used by the damage probe.
  // TPS exposes STEP to the player, while the CPU still owns authored GUARD states;
  // this capture checks guard pose -> BLOCK_STUN -> impact spacing as one visual beat.
  const guardProbe = await execute(sessionId, \`${gameLookup}
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
      fighter.guardDamage = 0;
      fighter.hitStop = 0;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 0.76);
    game.p2.position.set(0, 0, -0.44);
    game.p2.state = 'GUARD';
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state !== 'BLOCK_STUN') game.p2.state = 'GUARD';
    };
    for (let index = 0; index < 24; index += 1) game.updateCamera(1 / 60);
    game.press('punch', 'tps-audit-guard-punch');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-audit-guard-punch');
    let steps = 1;
    while (steps < 60 && game.p2.state !== 'BLOCK_STUN') { game.step(); steps += 1; }
    for (let index = 0; index < 8; index += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      moveId,
      steps,
      p2Health: game.p2.health,
      p2State: game.p2.state,
      guardDamage: game.p2.guardDamage,
      spacingMode: game.p1.visual.root.userData.tpsContactSpacingMode ?? null,
      spacingMinimum: game.p1.visual.root.userData.tpsContactSpacingMinimum ?? 0,
      worldSeparation: Math.hypot(game.p2.position.x - game.p1.position.x, game.p2.position.z - game.p1.position.z),
      cameraShoulder: game.camera.userData.tpsShoulderOffset ?? 0,
    };
  \`);
  if (guardProbe.moveId !== 'jab' || guardProbe.p2Health !== 100 || guardProbe.p2State !== 'BLOCK_STUN' || !(guardProbe.guardDamage > 0) || guardProbe.spacingMode !== 'IMPACT_PAIR' || !(guardProbe.spacingMinimum >= 1.52) || !(guardProbe.worldSeparation >= 1.51)) {
    throw new Error(\`TPS guard/block visual sequence failed: \${JSON.stringify(guardProbe)}\`);
  }
  await screenshot(sessionId, \`${outputDir}/tps-guard.png\`);

  // Force the ATTACK button into its far-range kick branch and validate the real
  // contact frame rather than only the isolated motion-library pose.
  const kickContactProbe = await execute(sessionId, \`${gameLookup}
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
      fighter.hitStop = 0;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 0.94);
    game.p2.position.set(0, 0, -0.72);
    game.updateEnemy = () => {
      game.p2.velocity.set(0, 0, 0);
      if (game.p2.state !== 'HIT') game.p2.state = 'IDLE';
    };
    for (let index = 0; index < 24; index += 1) game.updateCamera(1 / 60);
    game.press('punch', 'tps-audit-kick-contact');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-audit-kick-contact');
    let steps = 1;
    while (steps < 80 && game.p2.health === 100) { game.step(); steps += 1; }
    for (let index = 0; index < 8; index += 1) game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      moveId,
      steps,
      p2Health: game.p2.health,
      p2State: game.p2.state,
      spacingMode: game.p1.visual.root.userData.tpsContactSpacingMode ?? null,
      spacingMinimum: game.p1.visual.root.userData.tpsContactSpacingMinimum ?? 0,
      worldSeparation: Math.hypot(game.p2.position.x - game.p1.position.x, game.p2.position.z - game.p1.position.z),
      cameraShoulder: game.camera.userData.tpsShoulderOffset ?? 0,
      cameraBack: game.camera.userData.tpsBackDistance ?? 0,
    };
  \`);
  if (kickContactProbe.moveId !== 'kick' || !(kickContactProbe.p2Health < 100) || kickContactProbe.spacingMode !== 'IMPACT_PAIR' || !(kickContactProbe.spacingMinimum >= 1.62) || !(kickContactProbe.worldSeparation >= 1.61)) {
    throw new Error(\`TPS kick contact visual sequence failed: \${JSON.stringify(kickContactProbe)}\`);
  }
  await screenshot(sessionId, \`${outputDir}/tps-kick-contact.png\`);

  // Drive a continuous approach -> orbit sequence through real gameplay steps and
  // sample every camera frame. This catches sudden shoulder-camera jumps that are
  // invisible in single before/after screenshots.
  const cameraContinuityProbe = await execute(sessionId, \`${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.hitStop = 0;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 2.6);
    game.p2.position.set(0, 0, -0.2);
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    for (let index = 0; index < 30; index += 1) game.updateCamera(1 / 60);
    let previousCamera = game.camera.position.clone();
    let previousLook = game.cameraLookTarget.clone();
    let maxCameraStep = 0;
    let maxLookTargetStep = 0;
    const sampleFrame = () => {
      game.renderTime += 1 / 60;
      game.step();
      game.updateCamera(1 / 60);
      maxCameraStep = Math.max(maxCameraStep, game.camera.position.distanceTo(previousCamera));
      maxLookTargetStep = Math.max(maxLookTargetStep, game.cameraLookTarget.distanceTo(previousLook));
      previousCamera.copy(game.camera.position);
      previousLook.copy(game.cameraLookTarget);
    };
    game.press('up', 'tps-camera-approach');
    for (let index = 0; index < 34; index += 1) sampleFrame();
    game.release('up', 'tps-camera-approach');
    game.press('right', 'tps-camera-orbit');
    for (let index = 0; index < 36; index += 1) sampleFrame();
    game.release('right', 'tps-camera-orbit');
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return {
      maxCameraStep,
      maxLookTargetStep,
      fightDistance: Math.hypot(game.p2.position.x - game.p1.position.x, game.p2.position.z - game.p1.position.z),
      shoulderOffset: game.camera.userData.tpsShoulderOffset ?? 0,
      backDistance: game.camera.userData.tpsBackDistance ?? 0,
      closeFactor: game.camera.userData.tpsCloseReadabilityFactor ?? 0,
    };
  \`);
  if (!(cameraContinuityProbe.maxCameraStep < 0.28) || !(cameraContinuityProbe.maxLookTargetStep < 0.22) || !(cameraContinuityProbe.backDistance > 4.65)) {
    throw new Error(\`TPS camera continuity exceeded the playtest comfort envelope: \${JSON.stringify(cameraContinuityProbe)}\`);
  }
  await screenshot(sessionId, \`${outputDir}/tps-camera-continuity.png\`);
`;
replaceOnce(auditPath, insertMarker, insertMarker + insertion);

replaceOnce(
  auditPath,
  "  const report = { initial, iphone, directorSample, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, damageAfterfeelProbe, attackAfterfeelProbe, throwProbe, comboProbe, comboLinkProbe, whiffComboProbe, dashAttackProbe, flankProbe, afterBoundary, radial };",
  "  const report = { initial, iphone, directorSample, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, damageAfterfeelProbe, guardProbe, kickContactProbe, cameraContinuityProbe, attackAfterfeelProbe, throwProbe, comboProbe, comboLinkProbe, whiffComboProbe, dashAttackProbe, flankProbe, afterBoundary, radial };",
);

const visualWorkflow = ".github/workflows/tps-visual-audit.yml";
replaceOnce(
  visualWorkflow,
  "            tps-idle tps-iphone-idle tps-quickstep tps-punch tps-punch-settled tps-throw \\",
  "            tps-idle tps-iphone-idle tps-quickstep tps-punch tps-punch-settled tps-guard tps-kick-contact tps-camera-continuity tps-throw \\",
);

console.log("Applied TPS continuous-play polish v1.");
