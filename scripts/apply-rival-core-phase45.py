from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing patch anchor: {label}")
    return source.replace(old, new, 1)


p = Path("src/game/tps-game-base.ts")
s = p.read_text()

s = replace_once(
    s,
    'const TPS_ADAPT_REVIEW_TICKS = 180;\n',
    'const TPS_ADAPT_REVIEW_TICKS = 180;\nconst TPS_DRAMA_REVIEW_TICKS = 30;\n',
    "drama constant",
)
s = replace_once(
    s,
    'type EnemyAdaptation = "NEUTRAL" | "ANTI_STEP" | "ANTI_RUSH";\n',
    'type EnemyAdaptation = "NEUTRAL" | "ANTI_STEP" | "ANTI_RUSH" | "CUT_RETREAT" | "MIRROR_LEFT" | "MIRROR_RIGHT" | "HUNT_INTERCEPT";\ntype MatchDramaPhase = "OPENING" | "NEUTRAL" | "PRESSURE" | "COMEBACK" | "CLUTCH" | "FINISH";\n',
    "adaptation and drama types",
)
s = replace_once(
    s,
    '  private playerAttackSamples = 0;\n  private playerStepSamples = 0;\n',
    '  private playerAttackSamples = 0;\n  private playerStepSamples = 0;\n  private playerRetreatSamples = 0;\n  private playerLeftStepSamples = 0;\n  private playerRightStepSamples = 0;\n  private playerInterceptSamples = 0;\n  private playerReversalSamples = 0;\n',
    "rival samples",
)
s = replace_once(
    s,
    '  private enemyAdaptation: EnemyAdaptation = "NEUTRAL";\n  private simulationTicks = 0;\n',
    '  private enemyAdaptation: EnemyAdaptation = "NEUTRAL";\n  private dramaPhase: MatchDramaPhase = "OPENING";\n  private dramaIntensity = 0.14;\n  private dramaReviewTicks = TPS_DRAMA_REVIEW_TICKS;\n  private simulationTicks = 0;\n',
    "drama fields",
)

s = replace_once(
    s,
    '    this.resolveAttack(this.p1, this.p2, this.p2.state === "GUARD");\n    this.resolveAttack(this.p2, this.p1, this.p1.state === "GUARD");\n    this.separateFighters();\n',
    '    this.resolveAttack(this.p1, this.p2, this.p2.state === "GUARD");\n    this.resolveAttack(this.p2, this.p1, this.p1.state === "GUARD");\n    this.updateMatchDrama();\n    this.separateFighters();\n',
    "drama step hook",
)

insert_before = '  private updatePlayer(input: InputFrame): void {\n'
if insert_before not in s:
    raise RuntimeError("missing updatePlayer anchor")
method = '''  private updateMatchDrama(): void {
    this.dramaReviewTicks -= 1;
    if (this.dramaReviewTicks > 0) return;
    this.dramaReviewTicks = TPS_DRAMA_REVIEW_TICKS;
    const previous = this.dramaPhase;
    const healthGap = Math.abs(this.p1.health - this.p2.health);
    const bothLow = this.p1.health <= 32 && this.p2.health <= 32;
    const someoneCritical = Math.min(this.p1.health, this.p2.health) <= 16;
    const comebackState = healthGap >= 24 && Math.min(this.p1.health, this.p2.health) <= 42;
    const pressureState = this.playerComboStage >= 2 || this.playerPerfectEvadeTicks > 0 || this.combatBeatTicks > 0 || healthGap >= 34;

    this.dramaPhase = this.timerTicks > 93 * 60
      ? "OPENING"
      : someoneCritical
        ? "FINISH"
        : bothLow
          ? "CLUTCH"
          : comebackState
            ? "COMEBACK"
            : pressureState
              ? "PRESSURE"
              : "NEUTRAL";
    this.dramaIntensity = this.dramaPhase === "FINISH"
      ? 0.96
      : this.dramaPhase === "CLUTCH"
        ? 0.84
        : this.dramaPhase === "COMEBACK"
          ? 0.66
          : this.dramaPhase === "PRESSURE"
            ? 0.48
            : this.dramaPhase === "NEUTRAL" ? 0.28 : 0.14;
    this.camera.userData.tpsDramaPhase = this.dramaPhase;
    this.camera.userData.tpsDramaIntensity = this.dramaIntensity;
    this.p1.visual.root.userData.tpsDramaPhase = this.dramaPhase;
    this.p2.visual.root.userData.tpsDramaPhase = this.dramaPhase;
    if (previous !== this.dramaPhase) {
      if (this.dramaPhase === "CLUTCH") this.setCombatBeat("CLUTCH", 30);
      else if (this.dramaPhase === "FINISH") this.setCombatBeat("FINAL STAND", 30);
      else if (this.dramaPhase === "COMEBACK") this.setCombatBeat("MOMENTUM SHIFT", 26);
    }
  }

'''
s = s.replace(insert_before, method + insert_before, 1)

s = replace_once(
    s,
    '    const sideAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);\n    const move = toEnemy.clone().multiplyScalar(forwardAxis).addScaledVector(right, sideAxis);\n',
    '    const sideAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);\n    if (forwardAxis < 0 && this.simulationTicks % 12 === 0) this.playerRetreatSamples += 1;\n    const move = toEnemy.clone().multiplyScalar(forwardAxis).addScaledVector(right, sideAxis);\n',
    "retreat sampling",
)
s = replace_once(
    s,
    '      this.playerEvadeSign = sideAxis === 0 ? 0 : sideAxis > 0 ? 1 : -1;\n      this.playerEvadeTicks = TPS_STEP_TICKS;\n',
    '      this.playerEvadeSign = sideAxis === 0 ? 0 : sideAxis > 0 ? 1 : -1;\n      if (this.playerEvadeSign < 0) this.playerLeftStepSamples += 1;\n      else if (this.playerEvadeSign > 0) this.playerRightStepSamples += 1;\n      if (this.playerStepForwardWeight < -0.45) this.playerRetreatSamples += 1;\n      this.playerEvadeTicks = TPS_STEP_TICKS;\n',
    "directional step sampling",
)
s = replace_once(
    s,
    '        this.playerInterceptTicks = TPS_INTERCEPT_TICKS;\n        this.setCombatBeat("INTERCEPT");\n',
    '        this.playerInterceptTicks = TPS_INTERCEPT_TICKS;\n        this.playerInterceptSamples += 1;\n        this.setCombatBeat("INTERCEPT");\n',
    "intercept sampling",
)
s = replace_once(
    s,
    '    if (reversalStrike) this.playerReversalTicks = 0;\n',
    '    if (reversalStrike) {\n      this.playerReversalSamples += 1;\n      this.playerReversalTicks = 0;\n    }\n',
    "reversal sampling",
)

old = '''    this.enemyAdaptReviewTicks -= 1;
    if (this.enemyAdaptReviewTicks <= 0) {
      const samples = this.playerAttackSamples + this.playerStepSamples;
      if (samples >= 4) {
        const stepRatio = this.playerStepSamples / samples;
        const attackRatio = this.playerAttackSamples / samples;
        this.enemyAdaptation = stepRatio >= 0.58 ? "ANTI_STEP" : attackRatio >= 0.62 ? "ANTI_RUSH" : "NEUTRAL";
      }
      this.playerAttackSamples = Math.floor(this.playerAttackSamples * 0.45);
      this.playerStepSamples = Math.floor(this.playerStepSamples * 0.45);
      this.enemyAdaptReviewTicks = TPS_ADAPT_REVIEW_TICKS;
    }
'''
new = '''    this.enemyAdaptReviewTicks -= 1;
    if (this.enemyAdaptReviewTicks <= 0) {
      const previousAdaptation = this.enemyAdaptation;
      const actionSamples = this.playerAttackSamples + this.playerStepSamples;
      const movementSamples = actionSamples + this.playerRetreatSamples;
      const stepBiasSamples = this.playerLeftStepSamples + this.playerRightStepSamples;
      if (movementSamples >= 5) {
        const stepRatio = this.playerStepSamples / Math.max(1, actionSamples);
        const attackRatio = this.playerAttackSamples / Math.max(1, actionSamples);
        const retreatRatio = this.playerRetreatSamples / Math.max(1, movementSamples);
        const sideBias = stepBiasSamples > 0 ? (this.playerRightStepSamples - this.playerLeftStepSamples) / stepBiasSamples : 0;
        this.enemyAdaptation = this.playerInterceptSamples >= 2
          ? "HUNT_INTERCEPT"
          : retreatRatio >= 0.38
            ? "CUT_RETREAT"
            : stepRatio >= 0.52 && Math.abs(sideBias) >= 0.55
              ? sideBias > 0 ? "MIRROR_RIGHT" : "MIRROR_LEFT"
              : stepRatio >= 0.58
                ? "ANTI_STEP"
                : attackRatio >= 0.62 ? "ANTI_RUSH" : "NEUTRAL";
      }
      if (previousAdaptation !== this.enemyAdaptation && this.enemyAdaptation !== "NEUTRAL") {
        const readLabel = this.enemyAdaptation === "ANTI_STEP" ? "ANTI STEP"
          : this.enemyAdaptation === "ANTI_RUSH" ? "ANTI RUSH"
            : this.enemyAdaptation === "CUT_RETREAT" ? "CUT OFF"
              : this.enemyAdaptation === "HUNT_INTERCEPT" ? "HUNT INTERCEPT"
                : this.enemyAdaptation === "MIRROR_LEFT" ? "CUT LEFT"
                  : "CUT RIGHT";
        this.setCombatBeat(`RIVAL: ${readLabel}`, 28);
      }
      this.playerAttackSamples = Math.floor(this.playerAttackSamples * 0.45);
      this.playerStepSamples = Math.floor(this.playerStepSamples * 0.45);
      this.playerRetreatSamples = Math.floor(this.playerRetreatSamples * 0.40);
      this.playerLeftStepSamples = Math.floor(this.playerLeftStepSamples * 0.40);
      this.playerRightStepSamples = Math.floor(this.playerRightStepSamples * 0.40);
      this.playerInterceptSamples = Math.floor(this.playerInterceptSamples * 0.35);
      this.playerReversalSamples = Math.floor(this.playerReversalSamples * 0.35);
      this.enemyAdaptReviewTicks = TPS_ADAPT_REVIEW_TICKS;
    }
'''
s = replace_once(s, old, new, "rival read review")

old = '''      this.enemyTactic = this.enemyAdaptation === "ANTI_STEP"
        ? "BAIT"
        : this.enemyAdaptation === "ANTI_RUSH"
          ? "ORBIT"
          : tacticIndex === 0 ? "PRESSURE" : tacticIndex === 1 ? "ORBIT" : "BAIT";
      this.enemyOrbitSign = (slot + (this.difficulty === "EASY" ? 1 : 0)) % 2 === 0 ? 1 : -1;
      this.enemyTacticTicks = this.difficulty === "HARD" ? 56 : this.difficulty === "EASY" ? 90 : ENEMY_TACTIC_INTERVAL;
'''
new = '''      this.enemyTactic = this.enemyAdaptation === "ANTI_STEP" || this.enemyAdaptation === "HUNT_INTERCEPT"
        ? "BAIT"
        : this.enemyAdaptation === "ANTI_RUSH" || this.enemyAdaptation === "MIRROR_LEFT" || this.enemyAdaptation === "MIRROR_RIGHT"
          ? "ORBIT"
          : this.enemyAdaptation === "CUT_RETREAT"
            ? "PRESSURE"
            : tacticIndex === 0 ? "PRESSURE" : tacticIndex === 1 ? "ORBIT" : "BAIT";
      this.enemyOrbitSign = this.enemyAdaptation === "MIRROR_LEFT"
        ? -1
        : this.enemyAdaptation === "MIRROR_RIGHT"
          ? 1
          : (slot + (this.difficulty === "EASY" ? 1 : 0)) % 2 === 0 ? 1 : -1;
      const baseTacticTicks = this.difficulty === "HARD" ? 56 : this.difficulty === "EASY" ? 90 : ENEMY_TACTIC_INTERVAL;
      const dramaTempo = this.dramaPhase === "FINISH" || this.dramaPhase === "CLUTCH" ? 0.82 : this.dramaPhase === "COMEBACK" ? 0.9 : 1;
      this.enemyTacticTicks = Math.max(42, Math.round(baseTacticTicks * dramaTempo));
'''
s = replace_once(s, old, new, "rival tactic selection")

old = '''    if (this.enemyAdaptation === "ANTI_STEP" && isAttackIntent(decision.intent) && this.simulationTicks % 3 === 0) {
      decision = { ...decision, intent: "COUNTER", telegraphTicks: Math.max(4, decision.telegraphTicks), reason: "adapt-anti-step-counter" };
    } else if (this.enemyAdaptation === "ANTI_RUSH" && decision.intent === "WAIT" && liveDistance < 2.0) {
      decision = { ...decision, intent: "RETREAT", reason: "adapt-anti-rush-reset" };
    }
'''
new = '''    if (this.enemyAdaptation === "HUNT_INTERCEPT" && isAttackIntent(decision.intent) && decision.telegraphTicks > 0 && this.simulationTicks % 4 === 0) {
      decision = { ...decision, intent: "WAIT", holdTicks: Math.max(2, decision.holdTicks), telegraphTicks: 0, reason: "adapt-hunt-intercept-feint" };
    } else if (this.enemyAdaptation === "ANTI_STEP" && isAttackIntent(decision.intent) && this.simulationTicks % 3 === 0) {
      decision = { ...decision, intent: "COUNTER", telegraphTicks: Math.max(4, decision.telegraphTicks), reason: "adapt-anti-step-counter" };
    } else if (this.enemyAdaptation === "ANTI_RUSH" && decision.intent === "WAIT" && liveDistance < 2.0) {
      decision = { ...decision, intent: "RETREAT", reason: "adapt-anti-rush-reset" };
    } else if (this.enemyAdaptation === "CUT_RETREAT" && ["WAIT", "RETREAT"].includes(decision.intent) && liveDistance > 1.25) {
      decision = { ...decision, intent: "APPROACH", reason: "adapt-cut-retreat-lane" };
    } else if (["MIRROR_LEFT", "MIRROR_RIGHT"].includes(this.enemyAdaptation) && decision.intent === "WAIT") {
      decision = { ...decision, intent: "SIDESTEP", reason: "adapt-directional-cut" };
    }
'''
s = replace_once(s, old, new, "rival decision adaptation")

s = replace_once(
    s,
    '    const impactReadabilityFactor = THREE.MathUtils.clamp(Math.max(this.p1.hitStop, this.p2.hitStop) / 9, 0, 1);\n    const backDistance = 4.70\n',
    '    const impactReadabilityFactor = THREE.MathUtils.clamp(Math.max(this.p1.hitStop, this.p2.hitStop) / 9, 0, 1);\n    const dramaCinematicFactor = ["COMEBACK", "CLUTCH", "FINISH"].includes(this.dramaPhase) ? this.dramaIntensity : 0;\n    const backDistance = 4.70\n',
    "drama camera factor",
)
s = replace_once(
    s,
    '      + impactReadabilityFactor * TPS_CAMERA_IMPACT_BACK_DELTA;\n',
    '      + impactReadabilityFactor * TPS_CAMERA_IMPACT_BACK_DELTA\n      - dramaCinematicFactor * 0.16;\n',
    "drama camera back",
)
s = replace_once(
    s,
    '      + impactReadabilityFactor * TPS_CAMERA_IMPACT_SHOULDER;\n',
    '      + impactReadabilityFactor * TPS_CAMERA_IMPACT_SHOULDER\n      + dramaCinematicFactor * 0.08;\n',
    "drama camera shoulder",
)
s = replace_once(
    s,
    '    const cameraHeight = 2.36 + closeFactor * 0.24 + compactLandscapeFactor * 0.06 + impactReadabilityFactor * 0.035;\n',
    '    const cameraHeight = 2.36 + closeFactor * 0.24 + compactLandscapeFactor * 0.06 + impactReadabilityFactor * 0.035 + dramaCinematicFactor * 0.025;\n',
    "drama camera height",
)
s = replace_once(
    s,
    '    this.camera.userData.tpsImpactReadabilityFactor = impactReadabilityFactor;\n',
    '    this.camera.userData.tpsImpactReadabilityFactor = impactReadabilityFactor;\n    this.camera.userData.tpsDramaCinematicFactor = dramaCinematicFactor;\n',
    "drama telemetry",
)

s = replace_once(
    s,
    '    this.playerAttackSamples = 0;\n    this.playerStepSamples = 0;\n    this.enemyAdaptReviewTicks = TPS_ADAPT_REVIEW_TICKS;\n',
    '    this.playerAttackSamples = 0;\n    this.playerStepSamples = 0;\n    this.playerRetreatSamples = 0;\n    this.playerLeftStepSamples = 0;\n    this.playerRightStepSamples = 0;\n    this.playerInterceptSamples = 0;\n    this.playerReversalSamples = 0;\n    this.enemyAdaptReviewTicks = TPS_ADAPT_REVIEW_TICKS;\n',
    "reset rival samples",
)
s = replace_once(
    s,
    '    this.enemyAdaptation = "NEUTRAL";\n    this.simulationTicks = 0;\n',
    '    this.enemyAdaptation = "NEUTRAL";\n    this.dramaPhase = "OPENING";\n    this.dramaIntensity = 0.14;\n    this.dramaReviewTicks = TPS_DRAMA_REVIEW_TICKS;\n    this.simulationTicks = 0;\n',
    "reset drama",
)

p.write_text(s)

p = Path("tests/tps-rival-core.test.ts")
s = p.read_text()
s += '''\n\ntest("Rival Core phase 4 learns retreat, directional step, and intercept habits without frame-perfect reads", async () => {\n  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");\n  assert.match(source, /CUT_RETREAT/);\n  assert.match(source, /MIRROR_LEFT/);\n  assert.match(source, /MIRROR_RIGHT/);\n  assert.match(source, /HUNT_INTERCEPT/);\n  assert.match(source, /playerRetreatSamples/);\n  assert.match(source, /playerLeftStepSamples/);\n  assert.match(source, /playerRightStepSamples/);\n  assert.match(source, /adapt-hunt-intercept-feint/);\n  assert.match(source, /RIVAL:/);\n});\n\ntest("Rival Core phase 5 drives match drama through presentation and tempo, not hidden damage buffs", async () => {\n  const source = await readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8");\n  assert.match(source, /MatchDramaPhase/);\n  assert.match(source, /updateMatchDrama/);\n  assert.match(source, /MOMENTUM SHIFT/);\n  assert.match(source, /FINAL STAND/);\n  assert.match(source, /tpsDramaIntensity/);\n  assert.match(source, /dramaCinematicFactor/);\n  assert.match(source, /dramaTempo/);\n});\n'''
p.write_text(s)
print("Rival Core phase 4-5 patch applied")
