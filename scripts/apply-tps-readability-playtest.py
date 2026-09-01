from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# --- TPS core: connect the shared player-fun director to TPS action selection. ---
base_path = Path('src/game/tps-game-base.ts')
base = base_path.read_text()
base = replace_once(
    base,
    'import { FighterRuntime, type CpuDifficulty } from "./fighter";\n',
    'import { FighterRuntime, type CpuDifficulty } from "./fighter";\nimport { CpuFunDirector, isAttackIntent, type CpuActorSnapshot, type CpuDecision, type CpuIntent, type CpuSituation } from "./cpu-director";\n',
    'cpu director import',
)
base = replace_once(
    base,
    'const ENEMY_TACTIC_INTERVAL = 72;\nconst MODEL_FORWARD = new THREE.Vector3(0, 0, 1);\n',
    'const ENEMY_TACTIC_INTERVAL = 72;\nconst TPS_CAMERA_CLOSE_SHOULDER_BONUS = 1.95;\nconst TPS_CAMERA_CLOSE_BACK_BONUS = 0.24;\nconst TPS_CAMERA_CLOSE_TARGET_LIFT = 0.14;\nconst MODEL_FORWARD = new THREE.Vector3(0, 0, 1);\n',
    'camera constants',
)
base = replace_once(
    base,
    '''function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {\n  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);\n  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(1, 0, 0);\n}\n''',
    '''function horizontalDirection(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {\n  const result = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);\n  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector3(1, 0, 0);\n}\n\nconst TPS_CPU_ATTACK_MOVES: Partial<Record<CpuIntent, string>> = {\n  JAB: "jab",\n  STRAIGHT: "straight",\n  BACKFIST: "backfist",\n  BODY_BLOW: "bodyBlow",\n  POWER: "power",\n  KICK: "kick",\n  LOW_KICK: "lowKick",\n  RISING_KICK: "risingKick",\n  DASH_KICK: "dashKick",\n  THROW: "throw",\n  COUNTER: "counter",\n};\n\nfunction cpuActorSnapshot(fighter: FighterRuntime): CpuActorSnapshot {\n  return {\n    health: fighter.health,\n    guardDamage: fighter.guardDamage,\n    state: fighter.state,\n    moveId: fighter.currentMove?.id ?? null,\n    movePower: fighter.currentMove?.power ?? 0,\n    isActive: fighter.isActive(),\n    grounded: fighter.grounded,\n    x: fighter.position.x,\n    z: fighter.position.z,\n    facing: fighter.facing,\n  };\n}\n''',
    'cpu snapshot helper',
)
base = replace_once(
    base,
    '  private enemyTactic: EnemyTactic = "ORBIT";\n  private enemyTacticTicks = 0;\n  private enemyOrbitSign = 1;\n',
    '  private enemyTactic: EnemyTactic = "ORBIT";\n  private enemyTacticTicks = 0;\n  private enemyOrbitSign = 1;\n  private enemyFunDirector: CpuFunDirector;\n  private enemyDirectorDecision: CpuDecision | null = null;\n  private enemyDirectorHoldTicks = 0;\n  private enemyDirectorTelegraphTicks = 0;\n  private enemyDirectorPendingMove: string | null = null;\n',
    'director fields',
)
base = replace_once(
    base,
    '    this.scene.add(this.p1.visual.root, this.p2.visual.root);\n\n    const lockGeometry',
    '    this.scene.add(this.p1.visual.root, this.p2.visual.root);\n    this.enemyFunDirector = new CpuFunDirector(this.difficulty, 47);\n\n    const lockGeometry',
    'director constructor',
)

new_update_enemy = r'''  private updateEnemy(): void {
    this.p2.setInput(EMPTY_INPUT);
    const liveDistance = Math.hypot(
      this.p1.position.x - this.p2.position.x,
      this.p1.position.z - this.p2.position.z,
    );
    const situation = (): CpuSituation => ({
      self: cpuActorSnapshot(this.p2),
      opponent: cpuActorSnapshot(this.p1),
      distance: Math.hypot(
        this.p1.position.x - this.p2.position.x,
        this.p1.position.z - this.p2.position.z,
      ),
    });
    this.enemyFunDirector.observe(situation());
    if (this.advanceLockedState(this.p2)) return;

    this.enemyCooldown = Math.max(0, this.enemyCooldown - 1);
    if (this.enemyOpeningGraceTicks > 0) this.enemyOpeningGraceTicks -= 1;
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
    const tangent = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x);
    const rootData = this.p2.visual.root.userData;

    const publishDecision = (decision: CpuDecision, moveId: string | null = null): void => {
      rootData.tpsCpuDirectorPolicy = "FUN_DIRECTOR_V1";
      rootData.tpsCpuDirectorIntent = decision.intent;
      rootData.tpsCpuDirectorReason = decision.reason;
      rootData.tpsCpuDirectorComebackMercy = decision.comebackMercy;
      rootData.tpsCpuDirectorPressure = decision.pressure;
      rootData.tpsCpuDirectorTelegraphTicks = this.enemyDirectorTelegraphTicks;
      rootData.tpsCpuDirectorMove = moveId;
    };

    const moveEnemy = (intent: CpuIntent): void => {
      if (intent === "GUARD") {
        this.p2.state = "GUARD";
        return;
      }
      if (intent === "WAIT") {
        this.p2.state = "IDLE";
        return;
      }
      const movement = new THREE.Vector3();
      if (intent === "APPROACH") movement.copy(towardPlayer);
      else if (intent === "RETREAT") movement.copy(towardPlayer).multiplyScalar(-1);
      else if (intent === "SIDESTEP" || intent === "JUMP") movement.copy(tangent).multiplyScalar(this.enemyOrbitSign);
      if (movement.lengthSq() <= 1e-6) {
        this.p2.state = "IDLE";
        return;
      }
      const baseSpeed = this.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;
      const difficultySpeed = this.difficulty === "HARD" ? 1.08 : this.difficulty === "EASY" ? 0.9 : 1;
      this.p2.position.addScaledVector(movement.normalize(), FIXED_STEP * baseSpeed * difficultySpeed);
      this.p2.state = "WALK";
    };

    const beginDirectorMove = (moveId: string, intent: CpuIntent): boolean => {
      const began = this.p2.beginMove(moveId);
      if (!began) return false;
      rootData.tpsCpuDirectorMove = moveId;
      rootData.tpsCpuDirectorIntent = intent;
      rootData.tpsCpuDirectorTelegraphTicks = 0;
      if (moveId === "dashKick") {
        const burstSpeed = this.p2.definition.archetype === "SPEED" ? 5.0 : 4.45;
        this.p2.velocity.x = towardPlayer.x * burstSpeed;
        this.p2.velocity.z = towardPlayer.z * burstSpeed;
      }
      // Mirror the shared director's two neutral post-attack input frames. The
      // hold begins only after ATTACK unlocks, so it creates a real punish/read beat.
      this.enemyDirectorHoldTicks = 2;
      this.enemyCooldown = Math.max(this.enemyCooldown, 2);
      return true;
    };

    if (this.enemyDirectorPendingMove) {
      if (this.enemyDirectorTelegraphTicks > 0) {
        this.enemyDirectorTelegraphTicks -= 1;
        rootData.tpsCpuDirectorTelegraphTicks = this.enemyDirectorTelegraphTicks;
        const intent = this.enemyDirectorDecision?.intent ?? "WAIT";
        this.p2.state = ["POWER", "THROW", "COUNTER"].includes(intent) ? "GUARD" : "IDLE";
        this.p2.updatePhysics(FIXED_STEP);
        return;
      }
      const moveId = this.enemyDirectorPendingMove;
      const intent = this.enemyDirectorDecision?.intent ?? "JAB";
      this.enemyDirectorPendingMove = null;
      if (beginDirectorMove(moveId, intent)) {
        this.p2.updatePhysics(FIXED_STEP);
        return;
      }
    }

    // Keep the title-card/read window non-hostile. It still moves so the enemy
    // feels alive, but no decision is remembered as an attack before play begins.
    if (this.enemyOpeningGraceTicks > 0) {
      const openingIntent: CpuIntent = liveDistance > 2.35 ? "APPROACH" : "SIDESTEP";
      const openingDecision: CpuDecision = {
        intent: openingIntent,
        holdTicks: 1,
        telegraphTicks: 0,
        reason: "opening-read-window",
        comebackMercy: 0,
        pressure: 0,
      };
      publishDecision(openingDecision);
      moveEnemy(openingIntent);
      this.p2.updatePhysics(FIXED_STEP);
      return;
    }

    if (this.enemyDirectorDecision && this.enemyDirectorHoldTicks > 0) {
      const heldIntent = isAttackIntent(this.enemyDirectorDecision.intent) ? "WAIT" : this.enemyDirectorDecision.intent;
      this.enemyDirectorHoldTicks -= 1;
      publishDecision(this.enemyDirectorDecision, isAttackIntent(this.enemyDirectorDecision.intent) ? rootData.tpsCpuDirectorMove ?? null : null);
      moveEnemy(heldIntent);
      this.p2.updatePhysics(FIXED_STEP);
      if (this.enemyDirectorHoldTicks <= 0) this.enemyDirectorDecision = null;
      return;
    }

    let decision = this.enemyFunDirector.decide(situation());
    // TPS is a grounded lock-on mode. Translate the shared neutral hop into an
    // orbital beat rather than introducing camera-hostile bunny hopping.
    if (decision.intent === "JUMP") decision = { ...decision, intent: "SIDESTEP", reason: `${decision.reason}-as-orbit` };
    this.enemyDirectorDecision = decision;
    publishDecision(decision);

    if (isAttackIntent(decision.intent)) {
      const moveId = TPS_CPU_ATTACK_MOVES[decision.intent] ?? null;
      if (moveId) {
        rootData.tpsCpuDirectorMove = moveId;
        if (decision.telegraphTicks > 0) {
          this.enemyDirectorPendingMove = moveId;
          this.enemyDirectorTelegraphTicks = decision.telegraphTicks;
          rootData.tpsCpuDirectorTelegraphTicks = decision.telegraphTicks;
          this.p2.state = ["POWER", "THROW", "COUNTER"].includes(decision.intent) ? "GUARD" : "IDLE";
        } else {
          beginDirectorMove(moveId, decision.intent);
        }
        this.p2.updatePhysics(FIXED_STEP);
        return;
      }
    }

    this.enemyDirectorHoldTicks = Math.max(1, decision.holdTicks - 1);
    moveEnemy(decision.intent);
    this.p2.updatePhysics(FIXED_STEP);
  }
'''
base, count = re.subn(r'  private updateEnemy\(\): void \{.*?\n  \}\n\n  private advanceLockedState', new_update_enemy + '\n  private advanceLockedState', base, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'updateEnemy replacement count {count}')

base = replace_once(
    base,
    '''    const backDistance = 4.80 + compactLandscapeFactor * 0.20;\n    const shoulderOffset = 2.50 + closeFactor * 1.70 + compactLandscapeFactor * (0.55 + closeFactor * 0.50);\n    const cameraHeight = 2.32 + closeFactor * 0.18 + compactLandscapeFactor * 0.04;\n    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, -0.30 * closeFactor - flankLaneShift)\n      .add(new THREE.Vector3(0, 1.18 + closeFactor * 0.04, 0));\n''',
    '''    const backDistance = 4.88 + closeFactor * TPS_CAMERA_CLOSE_BACK_BONUS + compactLandscapeFactor * 0.24;\n    const shoulderOffset = 2.50 + closeFactor * TPS_CAMERA_CLOSE_SHOULDER_BONUS\n      + compactLandscapeFactor * (0.62 + closeFactor * 0.62);\n    const cameraHeight = 2.36 + closeFactor * 0.24 + compactLandscapeFactor * 0.06;\n    const targetHeight = 1.22 + closeFactor * TPS_CAMERA_CLOSE_TARGET_LIFT;\n    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, -0.34 * closeFactor - flankLaneShift)\n      .add(new THREE.Vector3(0, targetHeight, 0));\n    this.camera.userData.tpsCloseReadabilityFactor = closeFactor;\n    this.camera.userData.tpsShoulderOffset = shoulderOffset;\n    this.camera.userData.tpsTargetHeight = targetHeight;\n''',
    'close camera composition',
)
base = replace_once(
    base,
    '    this.enemyOrbitSign = 1;\n    this.playerEvadeTicks = 0;\n',
    '    this.enemyOrbitSign = 1;\n    this.enemyFunDirector = new CpuFunDirector(this.difficulty, 47);\n    this.enemyDirectorDecision = null;\n    this.enemyDirectorHoldTicks = 0;\n    this.enemyDirectorTelegraphTicks = 0;\n    this.enemyDirectorPendingMove = null;\n    this.playerEvadeTicks = 0;\n',
    'director round reset',
)
base_path.write_text(base)

# --- TPS extension: preserve director-selected attacks/movement instead of replacing them. ---
ext_path = Path('src/game/tps-game.ts')
ext = ext_path.read_text()
ext = replace_once(
    ext,
    '  if (startedAttack && game.p2.currentMove && ["jab", "straight", "kick"].includes(game.p2.currentMove.id)) {\n',
    '  const directorMove = game.p2.visual.root.userData.tpsCpuDirectorMove as string | null | undefined;\n  if (startedAttack && game.p2.currentMove && game.p2.currentMove.id !== directorMove && ["jab", "straight", "kick"].includes(game.p2.currentMove.id)) {\n',
    'director attack ownership',
)
old_spacing = '''  const currentToward = horizontalDirection(beforePosition, game.p1.position);\n  const distance = Math.hypot(\n    game.p1.position.x - beforePosition.x,\n    game.p1.position.z - beforePosition.z,\n  );\n  const tangent = new THREE.Vector3(-currentToward.z, 0, currentToward.x);\n  const desiredDistance = game.enemyTactic === "PRESSURE"\n    ? 1.72\n    : game.enemyTactic === "BAIT"\n      ? 2.55\n      : 2.08;\n  const distanceError = distance - desiredDistance;\n  const movement = new THREE.Vector3();\n\n  if (distanceError > ENEMY_SPACING_DEAD_ZONE) movement.add(currentToward);\n  else if (distanceError < -ENEMY_SPACING_DEAD_ZONE) movement.addScaledVector(currentToward, -1);\n\n  const orbitActive = game.enemyTactic === "ORBIT"\n    && Math.abs(distanceError) <= 0.82\n    && game.simulationTicks % ENEMY_TACTIC_INTERVAL < ENEMY_ORBIT_ACTIVE_TICKS;\n  if (orbitActive) movement.addScaledVector(tangent, game.enemyOrbitSign * 0.58);\n'''
new_spacing = '''  const currentToward = horizontalDirection(beforePosition, game.p1.position);\n  const distance = Math.hypot(\n    game.p1.position.x - beforePosition.x,\n    game.p1.position.z - beforePosition.z,\n  );\n  const tangent = new THREE.Vector3(-currentToward.z, 0, currentToward.x);\n  const desiredDistance = game.enemyTactic === "PRESSURE"\n    ? 1.72\n    : game.enemyTactic === "BAIT"\n      ? 2.55\n      : 2.08;\n  const distanceError = distance - desiredDistance;\n  const movement = new THREE.Vector3();\n  const directorIntent = game.p2.visual.root.userData.tpsCpuDirectorIntent as string | undefined;\n\n  if (directorIntent === "APPROACH") movement.add(currentToward);\n  else if (directorIntent === "RETREAT") movement.addScaledVector(currentToward, -1);\n  else if (directorIntent === "SIDESTEP" || directorIntent === "JUMP") movement.addScaledVector(tangent, game.enemyOrbitSign);\n  else {\n    if (distanceError > ENEMY_SPACING_DEAD_ZONE) movement.add(currentToward);\n    else if (distanceError < -ENEMY_SPACING_DEAD_ZONE) movement.addScaledVector(currentToward, -1);\n\n    const orbitActive = game.enemyTactic === "ORBIT"\n      && Math.abs(distanceError) <= 0.82\n      && game.simulationTicks % ENEMY_TACTIC_INTERVAL < ENEMY_ORBIT_ACTIVE_TICKS;\n    if (orbitActive) movement.addScaledVector(tangent, game.enemyOrbitSign * 0.58);\n  }\n'''
ext = replace_once(ext, old_spacing, new_spacing, 'director movement ownership')
ext_path.write_text(ext)

# --- Hype effects: preserve impact but stop covering the defender silhouette. ---
hype_path = Path('src/game/tps-hype.ts')
hype = hype_path.read_text()
hype = replace_once(
    hype,
    '  maxShockRings: 10,\n  maxBurstSpokes: 4,\n',
    '  maxShockRings: 10,\n  maxBurstSpokes: 4,\n  lightImpactRingCount: 2,\n  mediumImpactRingCount: 2,\n  heavyImpactRingCount: 3,\n  impactRingExpansion: 2.2,\n  heavyBurstScale: 0.64,\n',
    'hype readability profile',
)
hype = replace_once(
    hype,
    '    const ringCount = event.blocked ? 1 : tier === 3 ? 5 : tier === 2 ? 3 : 2;\n',
    '    const ringCount = event.blocked ? 1 : tier === 3 ? TPS_HYPE_PROFILE.heavyImpactRingCount : tier === 2 ? TPS_HYPE_PROFILE.mediumImpactRingCount : TPS_HYPE_PROFILE.lightImpactRingCount;\n',
    'ring count',
)
hype = replace_once(
    hype,
    '      ring.startScale = 0.72 + tier * 0.18 + index * 0.14;\n',
    '      ring.startScale = 0.56 + tier * 0.14 + index * 0.10;\n',
    'ring start scale',
)
hype = replace_once(
    hype,
    '    burst.startScale = event.blocked ? 0.36 : tier === 3 ? 0.78 : tier === 2 ? 0.58 : 0.42;\n',
    '    burst.startScale = event.blocked ? 0.34 : tier === 3 ? TPS_HYPE_PROFILE.heavyBurstScale : tier === 2 ? 0.50 : 0.40;\n',
    'burst scale',
)
hype = replace_once(
    hype,
    '    burst.lines.material.opacity = event.blocked ? 0.34 : tier === 3 ? 0.95 : 0.72;\n',
    '    burst.lines.material.opacity = event.blocked ? 0.32 : tier === 3 ? 0.82 : 0.68;\n',
    'burst opacity',
)
hype = replace_once(
    hype,
    '      ring.mesh.scale.setScalar(ring.startScale * (1 + progress * 2.9));\n',
    '      ring.mesh.scale.setScalar(ring.startScale * (1 + progress * TPS_HYPE_PROFILE.impactRingExpansion));\n',
    'ring expansion',
)
hype_path.write_text(hype)

# --- Static contracts: make sure later refactors cannot silently bypass the director/readability pass. ---
mode_path = Path('tests/tps-mode.test.ts')
mode = mode_path.read_text()
mode = replace_once(
    mode,
    '  assert.match(source, /shoulderOffset = 2\\.50 \\+ closeFactor \\* 1\\.70/);\n',
    '  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 1\\.95/);\n  assert.match(source, /TPS_CAMERA_CLOSE_BACK_BONUS = 0\\.24/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\\.14/);\n  assert.match(source, /tpsCloseReadabilityFactor/);\n',
    'camera test contract',
)
insert_test = '''\ntest("TPS enemy decisions use the shared player-fun director without losing circular movement", async () => {\n  const source = await readTpsSource();\n  assert.match(source, /new CpuFunDirector\\(this\\.difficulty, 47\\)/);\n  assert.match(source, /this\\.enemyFunDirector\\.observe\\(situation\\(\\)\\)/);\n  assert.match(source, /this\\.enemyFunDirector\\.decide\\(situation\\(\\)\\)/);\n  assert.match(source, /tpsCpuDirectorPolicy = "FUN_DIRECTOR_V1"/);\n  assert.match(source, /tpsCpuDirectorReason/);\n  assert.match(source, /tpsCpuDirectorComebackMercy/);\n  assert.match(source, /tpsCpuDirectorTelegraphTicks/);\n  assert.match(source, /directorIntent === "APPROACH"/);\n  assert.match(source, /directorIntent === "RETREAT"/);\n  assert.match(source, /directorIntent === "SIDESTEP"/);\n  assert.match(source, /game\\.p2\\.currentMove\\.id !== directorMove/);\n});\n'''
mode = replace_once(mode, '\ntest("TPS result records a visible winner instead of a zero-zero duel score", async () => {', insert_test + '\ntest("TPS result records a visible winner instead of a zero-zero duel score", async () => {', 'director test insertion')
mode_path.write_text(mode)

graphics_path = Path('tests/tps-graphics.test.ts')
graphics = graphics_path.read_text()
graphics = replace_once(
    graphics,
    '  assert.ok(TPS_HYPE_PROFILE.maxShockRings <= 12);\n  assert.ok(TPS_HYPE_PROFILE.maxBurstSpokes <= 4);\n',
    '  assert.ok(TPS_HYPE_PROFILE.maxShockRings <= 12);\n  assert.ok(TPS_HYPE_PROFILE.maxBurstSpokes <= 4);\n  assert.equal(TPS_HYPE_PROFILE.heavyImpactRingCount, 3);\n  assert.ok(TPS_HYPE_PROFILE.mediumImpactRingCount <= 2);\n  assert.ok(TPS_HYPE_PROFILE.impactRingExpansion <= 2.2);\n  assert.ok(TPS_HYPE_PROFILE.heavyBurstScale <= 0.64);\n',
    'hype test contract',
)
graphics_path.write_text(graphics)

# --- Browser audit: prove live TPS is using the director and raise close-range framing bar. ---
audit_path = Path('scripts/capture-tps-visual-audit.mjs')
audit = audit_path.read_text()
audit = replace_once(
    audit,
    '''      p2: p2 ? { x: p2.x, y: p2.y, z: p2.z, health: game.p2.health, state: game.p2.state } : null,\n      camera: game ? { x: game.camera.position.x, y: game.camera.position.y, z: game.camera.position.z } : null,\n''',
    '''      p2: p2 ? { x: p2.x, y: p2.y, z: p2.z, health: game.p2.health, state: game.p2.state } : null,\n      cpuDirector: game?.p2?.visual?.root?.userData ? {\n        policy: game.p2.visual.root.userData.tpsCpuDirectorPolicy ?? null,\n        intent: game.p2.visual.root.userData.tpsCpuDirectorIntent ?? null,\n        reason: game.p2.visual.root.userData.tpsCpuDirectorReason ?? null,\n        move: game.p2.visual.root.userData.tpsCpuDirectorMove ?? null,\n        telegraphTicks: game.p2.visual.root.userData.tpsCpuDirectorTelegraphTicks ?? 0,\n        comebackMercy: game.p2.visual.root.userData.tpsCpuDirectorComebackMercy ?? 0,\n        pressure: game.p2.visual.root.userData.tpsCpuDirectorPressure ?? 0,\n      } : null,\n      camera: game ? {\n        x: game.camera.position.x, y: game.camera.position.y, z: game.camera.position.z,\n        closeReadabilityFactor: game.camera.userData.tpsCloseReadabilityFactor ?? 0,\n        shoulderOffset: game.camera.userData.tpsShoulderOffset ?? 0,\n        targetHeight: game.camera.userData.tpsTargetHeight ?? 0,\n      } : null,\n''',
    'audit state telemetry',
)
audit = replace_once(
    audit,
    '''  await command(`/session/${sessionId}/goog/cdp/execute`, "POST", {\n    cmd: "Emulation.clearDeviceMetricsOverride",\n    params: {},\n  });\n  await delay(300);\n  // The screenshots above intentionally exercise the live tactical CPU. From this\n''',
    '''  await command(`/session/${sessionId}/goog/cdp/execute`, "POST", {\n    cmd: "Emulation.clearDeviceMetricsOverride",\n    params: {},\n  });\n  await delay(300);\n\n  let directorSample = null;\n  for (let attempt = 0; attempt < 45; attempt += 1) {\n    directorSample = await state(sessionId);\n    if (directorSample?.cpuDirector?.policy === 'FUN_DIRECTOR_V1'\n      && directorSample.cpuDirector.reason\n      && directorSample.cpuDirector.reason !== 'opening-read-window') break;\n    await delay(100);\n  }\n  if (directorSample?.cpuDirector?.policy !== 'FUN_DIRECTOR_V1' || !directorSample?.cpuDirector?.reason || directorSample.cpuDirector.reason === 'opening-read-window') {\n    throw new Error(`TPS live CPU never entered FUN_DIRECTOR_V1 decision-making: ${JSON.stringify(directorSample)}`);\n  }\n  await screenshot(sessionId, `${outputDir}/tps-cpu-director.png`);\n\n  // The screenshots above intentionally exercise the live tactical CPU. From this\n''',
    'live director capture',
)
audit = replace_once(
    audit,
    '  if (!(punchProbe?.screenSeparation >= 55)) throw new Error(`TPS close-range camera still overlaps fighter centers too heavily: ${JSON.stringify(punchProbe)}`);\n',
    '  if (!(punchProbe?.screenSeparation >= 72)) throw new Error(`TPS close-range camera still overlaps fighter centers too heavily: ${JSON.stringify(punchProbe)}`);\n',
    'camera audit threshold',
)
audit = replace_once(
    audit,
    '  const report = { initial, iphone, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, throwProbe, comboProbe, whiffComboProbe, dashAttackProbe, flankProbe, afterBoundary, radial };\n',
    '  const report = { initial, iphone, directorSample, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, throwProbe, comboProbe, whiffComboProbe, dashAttackProbe, flankProbe, afterBoundary, radial };\n',
    'audit report director sample',
)
audit_path.write_text(audit)

print('TPS readability + FUN_DIRECTOR integration patch applied')
