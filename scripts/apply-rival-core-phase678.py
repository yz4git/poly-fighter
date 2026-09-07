from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing patch anchor: {label}")
    return source.replace(old, new, 1)


# Phase 6: make Fighter DNA authoritative in the real TPS extension and deepen FINAL IMPACT.
p = Path("src/game/tps-game.ts")
s = p.read_text()
s = replace_once(
    s,
    'import type { FighterRuntime } from "./fighter";\n',
    'import type { FighterRuntime } from "./fighter";\nimport { resolveContextAttack, type FighterDna } from "./fighter-dna";\n',
    "TPS DNA import",
)
s = replace_once(
    s,
    '  difficulty: "EASY" | "NORMAL" | "HARD";\n',
    '  difficulty: "EASY" | "NORMAL" | "HARD";\n  p1Dna: FighterDna;\n  p2Dna: FighterDna;\n  playerInterceptTicks: number;\n  playerReversalTicks: number;\n  setCombatBeat(label: string, ticks?: number): void;\n',
    "extended DNA fields",
)
s = replace_once(
    s,
    '  __comboQueuedBranch?: "FORWARD" | "BACK" | "SIDE" | "NEUTRAL";\n',
    '  __comboQueuedBranch?: "FORWARD" | "BACK" | "SIDE" | "NEUTRAL";\n  __finalImpactSeconds?: number;\n  __finalImpactContact?: THREE.Vector3;\n',
    "final impact extension fields",
)

anchor = '''  const stage = Math.min(2, game.playerComboStage);
  const flank = game.playerFlankWindowTicks > 0 && game.playerStepSideWeight > 0.45;
  const perfect = game.playerPerfectEvadeTicks > 0 && flank;

  if (stage === 0 || !game.__comboRoute) {
'''
insert = '''  const stage = Math.min(2, game.playerComboStage);
  const flank = game.playerFlankWindowTicks > 0 && game.playerStepSideWeight > 0.45;
  const perfect = game.playerPerfectEvadeTicks > 0 && flank;
  const reversalOpen = game.playerReversalTicks > 0 && game.playerStepSideWeight > 0.45;
  const interceptOpen = game.playerInterceptTicks > 0;
  const defenderNearWall = Math.hypot(game.p2.position.x, game.p2.position.z) >= 5.45;
  const defenderAttacking = game.p2.state === "ATTACK";
  const desperation = game.p1.health <= 24 && game.p2.health <= 34 && distance <= 1.82;
  const signatureChoice = resolveContextAttack({
    fighterName: game.p1.definition.name,
    distance,
    comboStage: stage,
    flankOpen: flank,
    reversalOpen,
    interceptOpen,
    defenderAttacking,
    defenderNearWall,
    selfHealth: game.p1.health,
    defenderHealth: game.p2.health,
  });
  const useSignatureContext = reversalOpen
    || interceptOpen
    || desperation
    || (flank && stage === 0)
    || (defenderNearWall && stage >= 1)
    || (defenderAttacking && stage === 0 && distance <= 1.48);
  if (useSignatureContext) {
    if (!game.p1.beginMove(signatureChoice.moveId)) return false;
    game.__comboRoute = undefined;
    game.playerComboStage = 1;
    game.playerComboGraceTicks = 34;
    game.p1.visual.root.userData.tpsFighterDna = game.p1Dna.id;
    game.p1.visual.root.userData.tpsContextMove = signatureChoice.moveId;
    game.p1.visual.root.userData.tpsSignatureAction = signatureChoice.signature;
    game.p1.visual.root.userData.tpsContextBeat = signatureChoice.beat;
    if (signatureChoice.beat) game.setCombatBeat(signatureChoice.beat);
    if (reversalOpen) game.playerReversalTicks = 0;
    if (flank) {
      game.playerFlankAttackTicks = 28;
      game.playerFlankWindowTicks = 0;
    }
    return true;
  }

  if (stage === 0 || !game.__comboRoute) {
'''
s = replace_once(s, anchor, insert, "signature-aware combo graph")

s = replace_once(
    s,
    '    const moveSpeed = game.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;\n',
    '    const moveSpeed = (game.p1.definition.archetype === "SPEED" ? 4.0 : 3.35) * game.p1Dna.moveSpeedScale;\n',
    "extension player DNA speed",
)
s = replace_once(
    s,
    '    const stepMultiplier = baseStepMultiplier + directionalStepBonus;\n',
    '    const stepMultiplier = (baseStepMultiplier + directionalStepBonus) * game.p1Dna.stepSpeedScale;\n',
    "extension step DNA speed",
)
s = replace_once(
    s,
    '  const baseSpeed = game.p2.definition.archetype === "SPEED" ? 3.45 : 2.95;\n',
    '  const baseSpeed = (game.p2.definition.archetype === "SPEED" ? 3.45 : 2.95) * game.p2Dna.moveSpeedScale;\n',
    "extension CPU DNA speed",
)

s = replace_once(
    s,
    '  const madeContact = defender.health < beforeHealth || blocked || defender.hitStop > beforeHitStop;\n  if (!madeContact) return;\n\n  const tier = tpsHypeImpactTier(move.id, move.power);\n',
    '  const madeContact = defender.health < beforeHealth || blocked || defender.hitStop > beforeHitStop;\n  if (!madeContact) return;\n  const lethalImpact = !blocked && beforeHealth > 0 && defender.health <= 0;\n  if (lethalImpact) {\n    game.__finalImpactSeconds = 0.68;\n    game.__finalImpactContact = attacker.position.clone().lerp(defender.position, 0.55);\n    game.camera.userData.tpsFinalImpactStage = "HOLD";\n    game.camera.userData.tpsFinalImpactMove = move.id;\n    defender.visual.root.userData.tpsFinalImpact = true;\n    attacker.visual.root.userData.tpsFinalImpact = true;\n  }\n\n  const tier = tpsHypeImpactTier(move.id, move.power);\n',
    "final impact trigger",
)
s = replace_once(
    s,
    '''prototype.updateCamera = function updateCamera(delta: number): void {
  coreUpdateCamera.call(this, delta);
  const game = extended(this as unknown as TpsFightGame);
  hype(game).update(game.camera, delta);
};
''',
    '''prototype.updateCamera = function updateCamera(delta: number): void {
  coreUpdateCamera.call(this, delta);
  const game = extended(this as unknown as TpsFightGame);
  hype(game).update(game.camera, delta);
  const baseFov = game.camera.aspect < 2.4 ? 52 : 47;
  if ((game.__finalImpactSeconds ?? 0) > 0) {
    game.__finalImpactSeconds = Math.max(0, (game.__finalImpactSeconds ?? 0) - delta);
    const factor = THREE.MathUtils.clamp((game.__finalImpactSeconds ?? 0) / 0.68, 0, 1);
    const targetFov = baseFov - factor * 3.2;
    game.camera.fov = THREE.MathUtils.lerp(game.camera.fov, targetFov, Math.min(1, delta * 16));
    game.camera.userData.tpsFinalImpactFactor = factor;
    game.camera.userData.tpsFinalImpactStage = factor > 0.55 ? "HOLD" : factor > 0.12 ? "RELEASE" : "SETTLE";
  } else {
    game.camera.fov = THREE.MathUtils.lerp(game.camera.fov, baseFov, Math.min(1, delta * 9));
    game.camera.userData.tpsFinalImpactFactor = 0;
    game.camera.userData.tpsFinalImpactStage = null;
  }
  game.camera.updateProjectionMatrix();
};
''',
    "final impact camera",
)
s = replace_once(
    s,
    '  game.p1.visual.root.userData.tpsPerfectCounterLunge = 0;\n  hype(game).reset(game.camera);\n',
    '  game.p1.visual.root.userData.tpsPerfectCounterLunge = 0;\n  game.p1.visual.root.userData.tpsSignatureAction = null;\n  game.p1.visual.root.userData.tpsContextBeat = null;\n  game.__finalImpactSeconds = 0;\n  game.__finalImpactContact = undefined;\n  game.camera.userData.tpsFinalImpactFactor = 0;\n  game.camera.userData.tpsFinalImpactStage = null;\n  hype(game).reset(game.camera);\n',
    "reset final impact",
)
p.write_text(s)

# Phase 7: layered signature audio + distinct haptic patterns.
p = Path("src/game/audio.ts")
s = p.read_text()
s = replace_once(
    s,
    'import type { HitEvent } from "./types";\n',
    'import type { HitEvent } from "./types";\n\nexport type CombatSignatureKind = "INTERCEPT" | "REVERSAL" | "FINAL_IMPACT";\n',
    "audio signature type",
)
anchor = '''  rush(perfect = false, dash = false): void {
'''
method = '''  combatSignature(kind: CombatSignatureKind, fighter: string): void {
    if (!this.enabled || !this.context) return;
    const sera = fighter.toUpperCase() === "SERA";
    if (kind === "INTERCEPT") {
      this.noise(0.055, 0.032, sera ? 1450 : 880, true);
      this.tone(sera ? 720 : 118, 0.10, sera ? "triangle" : "sawtooth", 0.034, sera ? 420 : -48);
      this.tone(sera ? 1380 : 620, 0.035, "square", 0.018, sera ? -540 : -260);
      return;
    }
    if (kind === "REVERSAL") {
      this.noise(0.075, 0.044, sera ? 1750 : 640, false);
      this.tone(sera ? 960 : 92, 0.15, sera ? "triangle" : "sawtooth", 0.046, sera ? 520 : -42);
      window.setTimeout(() => this.tone(sera ? 1540 : 54, 0.12, "triangle", 0.032, sera ? -620 : -10), 18);
      return;
    }
    this.noise(0.13, 0.068, 430, false);
    this.noise(0.055, 0.034, 2100, true);
    this.tone(44, 0.34, "sawtooth", 0.072, -8);
    this.tone(sera ? 1680 : 1120, 0.055, "square", 0.032, -760);
    window.setTimeout(() => this.tone(38, 0.42, "triangle", 0.052, -5), 34);
  }

'''
if anchor not in s:
    raise RuntimeError("missing audio rush anchor")
s = s.replace(anchor, method + anchor, 1)
p.write_text(s)

p = Path("src/game/tps-game-base.ts")
s = p.read_text()
s = replace_once(
    s,
    '    this.audio.impact(event);\n    if (!blocked && this.settings.get().vibration && attacker.id === "p1") navigator.vibrate?.(lethalImpact ? 34 : move.power > 1.45 ? 22 : 9);\n',
    '''    this.audio.impact(event);
    if (!blocked) {
      const attackerDna = attacker === this.p1 ? this.p1Dna : this.p2Dna;
      if (lethalImpact) this.audio.combatSignature("FINAL_IMPACT", attackerDna.id);
      else if (interceptStrike) this.audio.combatSignature("INTERCEPT", attackerDna.id);
      else if (reversalStrike) this.audio.combatSignature("REVERSAL", attackerDna.id);
    }
    if (!blocked && this.settings.get().vibration && attacker.id === "p1") {
      const hapticPattern: number | number[] = lethalImpact
        ? [28, 18, 42]
        : interceptStrike
          ? [8, 14, 16]
          : reversalStrike
            ? [12, 12, 22]
            : move.power > 1.45 ? 22 : 9;
      navigator.vibrate?.(hapticPattern);
    }
''',
    "signature audio and haptics",
)
p.write_text(s)

# Phase 8: lightweight interactive training coach over the same audited TPS runtime.
Path("src/game/tps-training.ts").write_text('''import type { HudSnapshot } from "./types";\n\nexport type TpsTrainingStage = 0 | 1 | 2 | 3 | 4 | 5;\n\nexport const TPS_TRAINING_STEPS = [\n  { title: "ATTACK", detail: "Close distance and land one ATTACK." },\n  { title: "STEP", detail: "Use a sideways STEP. Direction matters." },\n  { title: "PERFECT STEP", detail: "Read STEP NOW and evade the committed strike." },\n  { title: "PUNISH", detail: "Attack the opening. A REVERSAL also clears this lesson." },\n  { title: "INTERCEPT", detail: "When READY appears, ATTACK during WINDUP to intercept." },\n  { title: "RIVAL READY", detail: "Training complete. Continue sparring or return to title." },\n] as const;\n\nfunction isSignature(message: string): boolean {\n  return ["BREAK LINE", "BLUE SHIFT", "INTERCEPT"].some((token) => message.includes(token));\n}\n\nfunction isReversal(message: string): boolean {\n  return ["REVERSAL", "RED REVERSAL", "PHANTOM COUNTER"].some((token) => message.includes(token));\n}\n\nexport function advanceTpsTrainingStage(\n  stage: TpsTrainingStage,\n  hud: HudSnapshot,\n  previousEnemyHealth: number,\n): TpsTrainingStage {\n  const message = hud.message ?? "";\n  const landedHit = hud.p2Health < previousEnemyHealth;\n  if (stage === 0 && landedHit) return 1;\n  if (stage === 1 && ["SIDE STEP", "PERFECT STEP", "REVERSAL"].some((token) => message.includes(token))) return 2;\n  if (stage === 2 && isReversal(message)) return 4;\n  if (stage === 2 && message.includes("PERFECT STEP")) return 3;\n  if (stage === 3 && (landedHit || isReversal(message))) return 4;\n  if (stage === 4 && isSignature(message)) return 5;\n  return stage;\n}\n''')

p = Path("app/page.tsx")
s = p.read_text()
s = replace_once(
    s,
    'import type { HudSnapshot, InputAction } from "@/src/game/types";\n',
    'import type { HudSnapshot, InputAction } from "@/src/game/types";\nimport { advanceTpsTrainingStage, TPS_TRAINING_STEPS, type TpsTrainingStage } from "@/src/game/tps-training";\n',
    "training import",
)
s = replace_once(
    s,
    'type Screen = "TITLE" | "SELECT" | "MODEL_VIEW" | "TPS_MATCH" | "RESULT";\n',
    'type Screen = "TITLE" | "SELECT" | "MODEL_VIEW" | "TPS_MATCH" | "TRAINING" | "RESULT";\n',
    "training screen type",
)
s = replace_once(
    s,
    '  const [paused, setPaused] = useState(false);\n',
    '  const [paused, setPaused] = useState(false);\n  const [trainingStage, setTrainingStage] = useState<TpsTrainingStage>(0);\n  const trainingEnemyHealthRef = useRef(100);\n',
    "training state",
)
s = replace_once(
    s,
    '    if (screen !== "TPS_MATCH" || !mountRef.current) return undefined;\n',
    '    if (!["TPS_MATCH", "TRAINING"].includes(screen) || !mountRef.current) return undefined;\n',
    "training runtime surface",
)
s = replace_once(
    s,
    '        difficulty,\n        onHud: setHud,\n',
    '        difficulty: screen === "TRAINING" ? "EASY" : difficulty,\n        onHud: setHud,\n',
    "training easy CPU",
)
s = replace_once(
    s,
    '        onResult: (winner) => {\n          setHud((current) => (current ? { ...current, message: winner === "draw" ? "DRAW" : `${winner === "p1" ? "PLAYER 1" : "PLAYER 2"} WINS` } : current));\n          setScreen("RESULT");\n        },\n',
    '        onResult: (winner) => {\n          setHud((current) => (current ? { ...current, message: winner === "draw" ? "DRAW" : `${winner === "p1" ? "PLAYER 1" : "PLAYER 2"} WINS` } : current));\n          if (screen === "TRAINING") {\n            setTrainingStage(5);\n          } else {\n            setScreen("RESULT");\n          }\n        },\n',
    "training result",
)
s = replace_once(
    s,
    '  const startMatch = () => {\n',
    '''  useEffect(() => {
    if (screen !== "TRAINING" || !hud) return;
    const previousHealth = trainingEnemyHealthRef.current;
    setTrainingStage((stage) => advanceTpsTrainingStage(stage, hud, previousHealth));
    trainingEnemyHealthRef.current = hud.p2Health;
  }, [hud, screen]);

  const startTraining = () => {
    requestLandscape();
    trainingEnemyHealthRef.current = 100;
    setTrainingStage(0);
    setHud(null);
    setPaused(false);
    setP1Choice("red");
    setP2Choice("blue");
    setScreen("TRAINING");
  };

  const startMatch = () => {
''',
    "training launch",
)
s = replace_once(
    s,
    '  const isGameSurface = screen === "TPS_MATCH";\n',
    '  const isGameSurface = screen === "TPS_MATCH" || screen === "TRAINING";\n  const trainingStep = TPS_TRAINING_STEPS[trainingStage];\n',
    "training surface flag",
)
s = replace_once(
    s,
    '          <button type="button" className="ghost-button" onClick={() => { requestLandscape(); setScreen("MODEL_VIEW"); }}>MODEL VIEW</button>\n',
    '          <button type="button" className="ghost-button" onClick={startTraining}>TRAINING</button>\n          <button type="button" className="ghost-button" onClick={() => { requestLandscape(); setScreen("MODEL_VIEW"); }}>MODEL VIEW</button>\n',
    "training title entry",
)
training_overlay_anchor = '          <div className="input-hint tps-input-hint"><b>ATTACK</b> AUTO PUNCH / KICK <span>•</span> <b>WINDUP</b> STEP OR INTERCEPT <span>•</span> <b>PERFECT STEP</b> → REVERSAL <span>•</span> FORWARD STEP → ATTACK = DASH</div>\n'
training_overlay = training_overlay_anchor + '''          {screen === "TRAINING" && (
            <section className={`training-coach ${trainingStage === 5 ? "complete" : ""}`} aria-live="polite">
              <span>RIVAL CORE TRAINING // {Math.min(trainingStage + 1, 6)}/6</span>
              <strong>{trainingStep.title}</strong>
              <p>{trainingStep.detail}</p>
              <div>{TPS_TRAINING_STEPS.map((_, index) => <i key={index} className={index <= trainingStage ? "done" : ""} />)}</div>
              {trainingStage === 5 && <button type="button" onClick={backToTitle}>RETURN TO TITLE</button>}
            </section>
          )}
'''
s = replace_once(s, training_overlay_anchor, training_overlay, "training overlay")
p.write_text(s)

p = Path("app/playtest-polish.css")
s = p.read_text()
s += '''\n\n.training-coach {\n  position: fixed;\n  z-index: 55;\n  left: max(16px, env(safe-area-inset-left));\n  top: max(78px, calc(env(safe-area-inset-top) + 62px));\n  width: min(280px, 34vw);\n  padding: 10px 12px;\n  border: 1px solid rgba(124, 232, 255, .42);\n  background: rgba(3, 11, 22, .82);\n  backdrop-filter: blur(8px);\n  pointer-events: none;\n}\n.training-coach > span { display:block; font-size:8px; letter-spacing:.14em; color:#7ce8ff; }\n.training-coach > strong { display:block; margin-top:4px; font-size:17px; letter-spacing:.06em; }\n.training-coach > p { margin:3px 0 7px; font-size:10px; line-height:1.25; color:#b9cbd9; }\n.training-coach > div { display:flex; gap:4px; }\n.training-coach > div i { width:20px; height:3px; background:rgba(124,232,255,.18); }\n.training-coach > div i.done { background:rgba(124,232,255,.92); }\n.training-coach.complete { border-color:rgba(109,255,184,.78); }\n.training-coach button { pointer-events:auto; margin-top:8px; border:1px solid rgba(109,255,184,.72); background:rgba(4,24,24,.86); color:#baffdf; font:inherit; padding:6px 10px; }\n@media (orientation: landscape) and (max-height: 430px) {\n  .training-coach { top:max(62px, calc(env(safe-area-inset-top) + 50px)); width:min(250px,32vw); padding:7px 9px; }\n  .training-coach > strong { font-size:14px; }\n  .training-coach > p { font-size:9px; }\n}\n'''
p.write_text(s)

# Ensure the new product regression tests actually run in both normal and TPS CI suites.
p = Path("package.json")
s = p.read_text()
s = s.replace('tests/tps-mode.test.ts tests/tps-graphics.test.ts', 'tests/tps-mode.test.ts tests/tps-rival-core.test.ts tests/tps-graphics.test.ts')
p.write_text(s)

p = Path("tests/tps-rival-core.test.ts")
s = p.read_text()
s += '''\n\ntest("Rival Core phase 6 makes DNA authoritative in the real TPS extension and adds a bounded final-impact lens beat", async () => {\n  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");\n  assert.match(source, /resolveContextAttack/);\n  assert.match(source, /useSignatureContext/);\n  assert.match(source, /game\\.p1Dna\\.stepSpeedScale/);\n  assert.match(source, /game\\.p2Dna\\.moveSpeedScale/);\n  assert.match(source, /__finalImpactSeconds/);\n  assert.match(source, /tpsFinalImpactFactor/);\n  assert.match(source, /baseFov - factor \\* 3\\.2/);\n});\n\ntest("Rival Core phase 7 layers signature audio and distinct haptic patterns", async () => {\n  const [audio, source] = await Promise.all([\n    readFile(new URL("../src/game/audio.ts", import.meta.url), "utf8"),\n    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),\n  ]);\n  assert.match(audio, /combatSignature/);\n  assert.match(audio, /FINAL_IMPACT/);\n  assert.match(source, /combatSignature\\("INTERCEPT"/);\n  assert.match(source, /combatSignature\\("REVERSAL"/);\n  assert.match(source, /\\[28, 18, 42\\]/);\n});\n\ntest("Rival Core phase 8 exposes a six-step interactive training path on the audited TPS runtime", async () => {\n  const [training, page, css] = await Promise.all([\n    readFile(new URL("../src/game/tps-training.ts", import.meta.url), "utf8"),\n    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),\n    readFile(new URL("../app/playtest-polish.css", import.meta.url), "utf8"),\n  ]);\n  assert.match(training, /PERFECT STEP/);\n  assert.match(training, /INTERCEPT/);\n  assert.match(training, /advanceTpsTrainingStage/);\n  assert.match(page, /TRAINING/);\n  assert.match(page, /startTraining/);\n  assert.match(page, /training-coach/);\n  assert.match(css, /\\.training-coach/);\n});\n'''
p.write_text(s)
print("Rival Core phase 6-8 patch applied")
