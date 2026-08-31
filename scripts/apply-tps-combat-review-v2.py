from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:100]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"pattern not unique in {path}: {old[:100]!r} count={text.count(old)}")
    p.write_text(text.replace(old, new, 1))

# --- Gameplay tuning: committed steps, confirm-only combos, earned flank punishes. ---
replace_once(
    "src/game/tps-game.ts",
    "const TPS_STEP_COOLDOWN_TICKS = 14;\nconst TPS_COMBO_GRACE_TICKS = 34;\nconst TPS_FLANK_WINDOW_TICKS = 24;",
    "const TPS_STEP_COOLDOWN_TICKS = 18;\nconst TPS_COMBO_GRACE_TICKS = 34;\nconst TPS_FLANK_WINDOW_TICKS = 30;\nconst TPS_PERFECT_EVADE_TICKS = 18;",
)

replace_once(
    "src/game/tps-game.ts",
    "  private playerFlankWindowTicks = 0;\n  private playerFlankAttackTicks = 0;\n  private simulationTicks = 0;",
    "  private playerFlankWindowTicks = 0;\n  private playerFlankAttackTicks = 0;\n  private playerPerfectEvadeTicks = 0;\n  private simulationTicks = 0;",
)

replace_once(
    "src/game/tps-game.ts",
    "    if (this.playerFlankWindowTicks > 0) this.playerFlankWindowTicks -= 1;\n    if (this.playerFlankAttackTicks > 0) this.playerFlankAttackTicks -= 1;",
    "    if (this.playerFlankWindowTicks > 0) this.playerFlankWindowTicks -= 1;\n    if (this.playerFlankAttackTicks > 0) this.playerFlankAttackTicks -= 1;\n    if (this.playerPerfectEvadeTicks > 0) this.playerPerfectEvadeTicks -= 1;",
)

replace_once(
    "src/game/tps-game.ts",
    "    if (this.p1.state === \"ATTACK\") {\n      if (attackPressed && this.playerComboStage < 3) this.playerAttackQueued = true;\n      this.p1.advanceAttack();\n      this.p1.updatePhysics(FIXED_STEP);\n      if (this.p1.state !== \"ATTACK\") {\n        if (this.playerAttackQueued && this.playerComboStage < 3 && this.p1.canAct()) {\n          this.playerAttackQueued = false;\n          this.beginContextAttack();\n        } else {\n          this.playerAttackQueued = false;\n          if (this.playerComboStage >= 3) {\n            this.playerComboStage = 0;\n            this.playerComboGraceTicks = 0;\n          }\n        }\n      }\n      return;\n    }",
    "    if (this.p1.state === \"ATTACK\") {\n      if (attackPressed && this.playerComboStage < 3) this.playerAttackQueued = true;\n      // A repeated ATTACK only chains if the previous strike actually reached the target.\n      // This keeps mash-friendly hit confirms while making whiffs meaningfully punishable.\n      const comboConfirmed = this.p1.hitTargets.has(this.p2.id);\n      this.p1.advanceAttack();\n      this.p1.updatePhysics(FIXED_STEP);\n      if (this.p1.state !== \"ATTACK\") {\n        if (this.playerAttackQueued && this.playerComboStage < 3 && comboConfirmed && this.p1.canAct()) {\n          this.playerAttackQueued = false;\n          this.beginContextAttack();\n        } else {\n          this.playerAttackQueued = false;\n          if (!comboConfirmed || this.playerComboStage >= 3) {\n            this.playerComboStage = 0;\n            this.playerComboGraceTicks = 0;\n          }\n        }\n      }\n      return;\n    }",
)

replace_once(
    "src/game/tps-game.ts",
    "      this.playerEvadeTicks = TPS_STEP_TICKS;\n      this.playerEvadeCooldown = TPS_STEP_COOLDOWN_TICKS;\n      if (this.playerStepSideWeight > 0.45) {\n        // The window lasts beyond the movement itself so a successful sidestep\n        // naturally flows into a flank punish rather than demanding a same-frame tap.\n        this.playerFlankWindowTicks = TPS_STEP_TICKS + TPS_FLANK_WINDOW_TICKS;\n      }",
    "      this.playerEvadeTicks = TPS_STEP_TICKS;\n      this.playerEvadeCooldown = TPS_STEP_COOLDOWN_TICKS;\n      // A side STEP by itself is only movement. Flank advantage is awarded later,\n      // inside resolveAttack, when an in-range enemy strike is actually evaded.\n      this.playerFlankWindowTicks = 0;\n      this.playerPerfectEvadeTicks = 0;",
)

replace_once(
    "src/game/tps-game.ts",
    "      const stepMultiplier = this.p1.definition.archetype === \"SPEED\" ? 2.55 : 2.45;\n      this.playerEvadeTicks -= 1;\n      this.p1.position.addScaledVector(this.playerStepDirection, FIXED_STEP * moveSpeed * stepMultiplier);",
    "      const baseStepMultiplier = this.p1.definition.archetype === \"SPEED\" ? 2.55 : 2.45;\n      const directionalStepBonus = this.playerStepForwardWeight < -0.45\n        ? 0.48\n        : this.playerStepForwardWeight > 0.45\n          ? -0.16\n          : 0.08;\n      const stepMultiplier = baseStepMultiplier + directionalStepBonus;\n      this.playerEvadeTicks -= 1;\n      this.p1.position.addScaledVector(this.playerStepDirection, FIXED_STEP * moveSpeed * stepMultiplier);",
)

replace_once(
    "src/game/tps-game.ts",
    "    // A lateral STEP is the dedicated strike-avoidance action. Back/forward STEP\n    // rely on displacement, while throws can still catch lateral movement.\n    if (defender === this.p1 && defender.state === \"SIDESTEP\" && this.playerStepSideWeight > 0.45 && move.hitLevel !== \"THROW\") return;\n    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);\n    if (distance > move.reach + 0.72) return;\n\n    attacker.hitTargets.add(defender.id);",
    "    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);\n    if (distance > move.reach + 0.72) return;\n    // Lateral STEP avoids a strike only when that strike was genuinely active and in range.\n    // That successful read earns the short flank window; orbiting with STEP alone does not.\n    if (defender === this.p1 && defender.state === \"SIDESTEP\" && this.playerStepSideWeight > 0.45 && move.hitLevel !== \"THROW\") {\n      attacker.hitTargets.add(defender.id);\n      this.playerFlankWindowTicks = TPS_FLANK_WINDOW_TICKS;\n      this.playerPerfectEvadeTicks = TPS_PERFECT_EVADE_TICKS;\n      return;\n    }\n\n    attacker.hitTargets.add(defender.id);",
)

replace_once(
    "src/game/tps-game.ts",
    "    const compactLandscapeFactor = THREE.MathUtils.clamp((2.45 - this.camera.aspect) / 0.45, 0, 1);",
    "    const compactLandscapeFactor = THREE.MathUtils.clamp((2.45 - this.camera.aspect) / 0.45, 0, 1);\n    const flankCameraFactor = THREE.MathUtils.clamp(\n      Math.max(this.playerPerfectEvadeTicks, this.playerFlankWindowTicks, this.playerFlankAttackTicks) / TPS_FLANK_WINDOW_TICKS,\n      0,\n      1,\n    );\n    const flankLaneShift = this.playerEvadeSign * flankCameraFactor * 0.56;",
)

replace_once(
    "src/game/tps-game.ts",
    "    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, -0.30 * closeFactor)\n      .add(new THREE.Vector3(0, 1.18 + closeFactor * 0.04, 0));\n    this.cameraDesired.copy(this.p1.position)\n      .addScaledVector(forward, -backDistance)\n      .addScaledVector(right, shoulderOffset)\n      .add(new THREE.Vector3(0, cameraHeight, 0));",
    "    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, -0.30 * closeFactor - flankLaneShift)\n      .add(new THREE.Vector3(0, 1.18 + closeFactor * 0.04, 0));\n    this.cameraDesired.copy(this.p1.position)\n      .addScaledVector(forward, -backDistance)\n      .addScaledVector(right, shoulderOffset + flankLaneShift * 0.36)\n      .add(new THREE.Vector3(0, cameraHeight, 0));",
)

replace_once(
    "src/game/tps-game.ts",
    "    const threat = this.p2.state === \"ATTACK\";\n    const inStrikeRange = distance < TPS_STRIKE_RANGE;\n    const lockColor = threat ? 0xff667f : inStrikeRange ? 0xffd45c : 0x7ce8ff;",
    "    const threat = this.p2.state === \"ATTACK\";\n    const inStrikeRange = distance < TPS_STRIKE_RANGE;\n    const perfectEvade = this.playerPerfectEvadeTicks > 0;\n    const lockColor = perfectEvade ? 0x6dffb8 : threat ? 0xff667f : inStrikeRange ? 0xffd45c : 0x7ce8ff;",
)

replace_once(
    "src/game/tps-game.ts",
    "    this.playerFlankWindowTicks = 0;\n    this.playerFlankAttackTicks = 0;\n    this.simulationTicks = 0;",
    "    this.playerFlankWindowTicks = 0;\n    this.playerFlankAttackTicks = 0;\n    this.playerPerfectEvadeTicks = 0;\n    this.simulationTicks = 0;",
)

replace_once(
    "src/game/tps-game.ts",
    "        : this.p1.state === \"ATTACK\" && this.p1.currentMove?.id === \"dashKick\"\n          ? \"DASH ATTACK\"\n          : this.playerEvadeTicks > 0 && this.playerStepSideWeight > 0.45",
    "        : this.p1.state === \"ATTACK\" && this.p1.currentMove?.id === \"dashKick\"\n          ? \"DASH ATTACK\"\n          : this.playerPerfectEvadeTicks > 0\n            ? \"PERFECT STEP\"\n          : this.playerEvadeTicks > 0 && this.playerStepSideWeight > 0.45",
)

# --- Touch readability: ATTACK glows after a genuine perfect step / flank opening. ---
replace_once(
    "app/page.tsx",
    "  const tpsStrikeRange = battleMode === \"TPS\" && hud?.message === \"STRIKE RANGE\";",
    "  const tpsStrikeRange = battleMode === \"TPS\" && [\"STRIKE RANGE\", \"PERFECT STEP\", \"FLANK OPEN\"].includes(hud?.message ?? \"\");",
)
replace_once(
    "app/page.tsx",
    "<b>STEP + 8-WAY</b> EVADE / SPACE <span>•</span> FORWARD STEP → ATTACK = DASH",
    "<b>SIDE STEP</b> ENEMY STRIKE → FLANK <span>•</span> BACK STEP = SPACE <span>•</span> FORWARD STEP → ATTACK = DASH",
)

# --- Static tests lock in the revised combat contract. ---
test_path = Path("tests/tps-mode.test.ts")
test_text = test_path.read_text()
test_text = test_text.replace("assert.match(source, /TPS_STEP_TICKS = 9/);", "assert.match(source, /TPS_STEP_TICKS = 9/);\n  assert.match(source, /TPS_STEP_COOLDOWN_TICKS = 18/);\n  assert.match(source, /TPS_PERFECT_EVADE_TICKS = 18/);")
test_text = test_text.replace("assert.match(source, /playerAttackQueued/);", "assert.match(source, /playerAttackQueued/);\n  assert.match(source, /const comboConfirmed = this\\.p1\\.hitTargets\\.has\\(this\\.p2\\.id\\)/);\n  assert.match(source, /!comboConfirmed \\|\\| this\\.playerComboStage >= 3/);")
test_text = test_text.replace("assert.match(source, /defender\\.state === \"SIDESTEP\" && this\\.playerStepSideWeight > 0\\.45/);", "assert.match(source, /defender\\.state === \"SIDESTEP\" && this\\.playerStepSideWeight > 0\\.45/);\n  assert.match(source, /this\\.playerFlankWindowTicks = TPS_FLANK_WINDOW_TICKS/);\n  assert.match(source, /this\\.playerPerfectEvadeTicks = TPS_PERFECT_EVADE_TICKS/);\n  assert.doesNotMatch(source, /this\\.playerFlankWindowTicks = TPS_STEP_TICKS \\+ TPS_FLANK_WINDOW_TICKS/);")
test_text = test_text.replace("assert.match(source, /playerFlankAttackTicks/);", "assert.match(source, /playerFlankAttackTicks/);\n  assert.match(source, /directionalStepBonus/);\n  assert.match(source, /flankLaneShift/);\n  assert.match(source, /PERFECT STEP/);")
test_text = test_text.replace("assert.match(page, /TAP COMBO/);", "assert.match(page, /TAP COMBO/);\n  assert.match(page, /PERFECT STEP/);\n  assert.match(page, /SIDE STEP/);\n  assert.match(page, /BACK STEP = SPACE/);")
test_path.write_text(test_text)

# --- Real WebGL audit: no free flank, no whiff chaining, actual dodge earns perfect step. ---
audit_path = Path("scripts/capture-tps-visual-audit.mjs")
audit = audit_path.read_text()
audit = audit.replace(
    "return { start, end: { x: game.p1.position.x, z: game.p1.position.z }, state: game.p1.state };",
    "return { start, end: { x: game.p1.position.x, z: game.p1.position.z }, state: game.p1.state, flankWindowTicks: game.playerFlankWindowTicks };",
    1,
)
audit = audit.replace(
    "if (quickstepTravel < 0.45) throw new Error(`TPS quickstep travel too small: ${JSON.stringify({ quickstepProbe, quickstepTravel })}`);",
    "if (quickstepTravel < 0.45) throw new Error(`TPS quickstep travel too small: ${JSON.stringify({ quickstepProbe, quickstepTravel })}`);\n  if (quickstepProbe.flankWindowTicks !== 0) throw new Error(`TPS neutral lateral STEP incorrectly granted free flank advantage: ${JSON.stringify(quickstepProbe)}`);",
    1,
)

whiff_probe = r'''
  const whiffComboProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    for (const fighter of [game.p1, game.p2]) {
      fighter.currentMove = null;
      fighter.moveTick = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };
      fighter.input = { ...neutral };
      fighter.previousInput = { ...neutral };
    }
    game.p1.position.set(0, 0, 3.1);
    game.p2.position.set(0, 0, -2.1);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    game.press('punch', 'tps-whiff-1');
    game.step();
    game.release('punch', 'tps-whiff-1');
    const firstMove = game.p1.currentMove?.id ?? null;
    let queued = false;
    let chainedMove = null;
    for (let index = 0; index < 150; index += 1) {
      if (!queued && game.p1.state === 'ATTACK' && game.p1.moveTick >= 4) {
        game.press('punch', 'tps-whiff-2');
        game.step();
        game.release('punch', 'tps-whiff-2');
        queued = true;
      } else {
        game.step();
      }
      const current = game.p1.currentMove?.id ?? null;
      if (current && firstMove && current !== firstMove) { chainedMove = current; break; }
      if (queued && game.p1.state !== 'ATTACK') break;
    }
    return { firstMove, chainedMove, comboStage: game.playerComboStage, p2Health: game.p2.health };
  `);
  if (whiffComboProbe.chainedMove !== null || whiffComboProbe.comboStage !== 0 || whiffComboProbe.p2Health !== 100) {
    throw new Error(`TPS whiff incorrectly continued ATTACK combo: ${JSON.stringify(whiffComboProbe)}`);
  }

'''
marker = "  const dashAttackProbe = await execute(sessionId, `${gameLookup}\n"
if marker not in audit:
    raise SystemExit("dashAttackProbe marker not found")
audit = audit.replace(marker, whiff_probe + marker, 1)

audit = audit.replace(
    "    game.updateCamera(1 / 60);\n    game.updateLockOn();\n    game.renderer.render(game.scene, game.camera);\n    return { healthAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks };",
    "    for (let index = 0; index < 16; index += 1) game.updateCamera(1 / 60);\n    game.updateLockOn();\n    game.renderer.render(game.scene, game.camera);\n    const canvas = game.renderer.domElement;\n    const playerScreen = game.p1.position.clone();\n    const enemyScreen = game.p2.position.clone();\n    playerScreen.y = 1.2;\n    enemyScreen.y = 1.2;\n    playerScreen.project(game.camera);\n    enemyScreen.project(game.camera);\n    const screenSeparation = Math.abs(enemyScreen.x - playerScreen.x) * canvas.width * 0.5;\n    return { healthAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks, perfectEvadeTicks: game.playerPerfectEvadeTicks, screenSeparation };",
    1,
)
audit = audit.replace(
    "  if (!(flankProbe.p2Health < 100) || flankProbe.p2State === 'BLOCK_STUN') throw new Error(`TPS flank attack did not beat guard: ${JSON.stringify(flankProbe)}`);",
    "  if (!(flankProbe.perfectEvadeTicks > 0)) throw new Error(`TPS successful lateral dodge did not award PERFECT STEP: ${JSON.stringify(flankProbe)}`);\n  if (!(flankProbe.p2Health < 100) || flankProbe.p2State === 'BLOCK_STUN') throw new Error(`TPS flank attack did not beat guard: ${JSON.stringify(flankProbe)}`);\n  if (!(flankProbe.screenSeparation >= 75)) throw new Error(`TPS flank camera still lets the player obscure the target: ${JSON.stringify(flankProbe)}`);",
    1,
)
audit = audit.replace(
    "comboProbe, dashAttackProbe, flankProbe, afterBoundary",
    "comboProbe, whiffComboProbe, dashAttackProbe, flankProbe, afterBoundary",
    1,
)
audit_path.write_text(audit)

print("Applied TPS combat review v2: earned flank, whiff-confirm combos, directional steps, flank camera.")
