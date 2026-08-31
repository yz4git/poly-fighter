from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, before: str, after: str) -> None:
    source = read(path)
    if before not in source:
        raise RuntimeError(f"Missing patch target in {path}: {before[:100]!r}")
    write(path, source.replace(before, after, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    source = read(path)
    start_index = source.find(start)
    if start_index < 0:
        raise RuntimeError(f"Missing start marker in {path}: {start!r}")
    end_index = source.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"Missing end marker in {path}: {end!r}")
    write(path, source[:start_index] + replacement + "\n\n" + source[end_index:])


# --- TPS combat runtime -----------------------------------------------------
replace_once(
    "src/game/tps-game.ts",
    'const TPS_STRIKE_RANGE = 2.12;\nconst ENEMY_TACTIC_INTERVAL = 72;',
    'const TPS_STRIKE_RANGE = 2.12;\n'
    'const TPS_CLOSE_ATTACK_RANGE = 1.58;\n'
    'const TPS_STEP_TICKS = 9;\n'
    'const TPS_STEP_COOLDOWN_TICKS = 14;\n'
    'const TPS_COMBO_GRACE_TICKS = 34;\n'
    'const TPS_FLANK_WINDOW_TICKS = 24;\n'
    'const ENEMY_TACTIC_INTERVAL = 72;',
)

replace_once(
    "src/game/tps-game.ts",
    '  private playerEvadeTicks = 0;\n'
    '  private playerEvadeCooldown = 0;\n'
    '  private playerEvadeSign = 0;\n'
    '  private simulationTicks = 0;',
    '  // `guard` remains the internal STEP input so the shared input layer and keyboard mapping stay compatible.\n'
    '  // The TPS UI exposes only ATTACK + STEP.\n'
    '  private playerEvadeTicks = 0;\n'
    '  private playerEvadeCooldown = 0;\n'
    '  private playerEvadeSign = 0;\n'
    '  private readonly playerStepDirection = new THREE.Vector3();\n'
    '  private playerStepForwardWeight = 0;\n'
    '  private playerStepSideWeight = 0;\n'
    '  private playerComboStage = 0;\n'
    '  private playerComboGraceTicks = 0;\n'
    '  private playerAttackQueued = false;\n'
    '  private playerFlankWindowTicks = 0;\n'
    '  private playerFlankAttackTicks = 0;\n'
    '  private simulationTicks = 0;',
)

new_player_runtime = r'''  private updatePlayer(input: InputFrame): void {
    this.p1.setInput(input);
    const attackPressed = this.p1.justPressed("punch");
    const stepPressed = this.p1.justPressed("guard");
    const legacyKickPressed = this.p1.justPressed("kick");

    if (this.playerEvadeCooldown > 0) this.playerEvadeCooldown -= 1;
    if (this.playerComboGraceTicks > 0) this.playerComboGraceTicks -= 1;
    else if (this.p1.state !== "ATTACK") this.playerComboStage = 0;
    if (this.playerFlankWindowTicks > 0) this.playerFlankWindowTicks -= 1;
    if (this.playerFlankAttackTicks > 0) this.playerFlankAttackTicks -= 1;

    const toEnemy = horizontalDirection(this.p1.position, this.p2.position);
    const right = new THREE.Vector3(-toEnemy.z, 0, toEnemy.x);
    const forwardAxis = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const sideAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const move = toEnemy.clone().multiplyScalar(forwardAxis).addScaledVector(right, sideAxis);
    const moveSpeed = this.p1.definition.archetype === "SPEED" ? 4.0 : 3.35;

    // Keep the old keyboard-only G+K throw reachable for regression/debugging,
    // but it is deliberately absent from the TPS touch UI. The player-facing
    // control scheme is ATTACK + STEP only.
    const legacyThrowPressed = input.guard && input.kick && (stepPressed || legacyKickPressed);
    if (legacyThrowPressed && this.p1.canAct()) {
      this.playerEvadeTicks = 0;
      this.playerAttackQueued = false;
      this.playerComboStage = 0;
      this.playerComboGraceTicks = 0;
      this.p1.beginMove("throw");
      this.p1.updatePhysics(FIXED_STEP);
      return;
    }

    // ATTACK taps during recovery are buffered. Once the current move finishes,
    // the next context-sensitive strike starts immediately, giving repeated taps
    // a reliable three-hit combo without requiring frame-perfect timing.
    if (this.p1.state === "ATTACK") {
      if (attackPressed && this.playerComboStage < 3) this.playerAttackQueued = true;
      this.p1.advanceAttack();
      this.p1.updatePhysics(FIXED_STEP);
      if (this.p1.state !== "ATTACK") {
        if (this.playerAttackQueued && this.playerComboStage < 3 && this.p1.canAct()) {
          this.playerAttackQueued = false;
          this.beginContextAttack();
        } else {
          this.playerAttackQueued = false;
          if (this.playerComboStage >= 3) {
            this.playerComboStage = 0;
            this.playerComboGraceTicks = 0;
          }
        }
      }
      return;
    }

    if (this.advanceLockedState(this.p1)) {
      this.playerEvadeTicks = 0;
      this.playerAttackQueued = false;
      this.playerComboStage = 0;
      this.playerComboGraceTicks = 0;
      this.playerFlankAttackTicks = 0;
      return;
    }

    if (stepPressed && this.playerEvadeCooldown <= 0) {
      const stepVector = move.lengthSq() > 0.001
        ? move.clone().normalize()
        : toEnemy.clone().multiplyScalar(-1);
      this.playerStepDirection.copy(stepVector);
      this.playerStepForwardWeight = stepVector.dot(toEnemy);
      this.playerStepSideWeight = Math.abs(stepVector.dot(right));
      this.playerEvadeSign = sideAxis === 0 ? 0 : sideAxis > 0 ? 1 : -1;
      this.playerEvadeTicks = TPS_STEP_TICKS;
      this.playerEvadeCooldown = TPS_STEP_COOLDOWN_TICKS;
      if (this.playerStepSideWeight > 0.45) {
        // The window lasts beyond the movement itself so a successful sidestep
        // naturally flows into a flank punish rather than demanding a same-frame tap.
        this.playerFlankWindowTicks = TPS_STEP_TICKS + TPS_FLANK_WINDOW_TICKS;
      }
    }

    if (this.playerEvadeTicks > 0) {
      if (attackPressed && this.playerStepForwardWeight > 0.45) {
        this.playerEvadeTicks = 0;
        this.playerFlankWindowTicks = 0;
        this.beginDashAttack(toEnemy);
        this.p1.updatePhysics(FIXED_STEP);
        return;
      }
      const stepMultiplier = this.p1.definition.archetype === "SPEED" ? 2.55 : 2.45;
      this.playerEvadeTicks -= 1;
      this.p1.position.addScaledVector(this.playerStepDirection, FIXED_STEP * moveSpeed * stepMultiplier);
      this.p1.state = "SIDESTEP";
      this.p1.updatePhysics(FIXED_STEP);
      return;
    }

    if (move.lengthSq() > 0.001) {
      move.normalize();
      this.p1.position.addScaledVector(move, FIXED_STEP * moveSpeed);
      this.p1.state = "WALK";
    } else {
      this.p1.state = "IDLE";
    }

    if (attackPressed) this.beginContextAttack();
    this.p1.updatePhysics(FIXED_STEP);
  }

  private beginContextAttack(): boolean {
    if (!this.p1.canAct()) return false;
    const distance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);
    const stage = Math.min(2, this.playerComboStage);
    const closeMoves = ["jab", "straight", "power"] as const;
    const farMoves = ["kick", "lowKick", "risingKick"] as const;
    const moveId = distance <= TPS_CLOSE_ATTACK_RANGE ? closeMoves[stage] : farMoves[stage];
    const flankStrike = this.playerFlankWindowTicks > 0 && this.playerStepSideWeight > 0.45;
    if (!this.p1.beginMove(moveId)) return false;
    this.playerComboStage = stage + 1;
    this.playerComboGraceTicks = TPS_COMBO_GRACE_TICKS;
    if (flankStrike) {
      this.playerFlankAttackTicks = 28;
      this.playerFlankWindowTicks = 0;
    }
    return true;
  }

  private beginDashAttack(toEnemy: THREE.Vector3): boolean {
    this.playerAttackQueued = false;
    this.playerComboStage = 0;
    this.playerComboGraceTicks = 0;
    this.playerFlankAttackTicks = 0;
    if (!this.p1.beginMove("dashKick")) return false;
    const burstSpeed = this.p1.definition.archetype === "SPEED" ? 7.4 : 6.8;
    this.p1.velocity.x = toEnemy.x * burstSpeed;
    this.p1.velocity.z = toEnemy.z * burstSpeed;
    return true;
  }'''

replace_between(
    "src/game/tps-game.ts",
    "  private updatePlayer(input: InputFrame): void {",
    "  private updateEnemy(): void {",
    new_player_runtime,
)

replace_once(
    "src/game/tps-game.ts",
    '    // The opening frames of a guard-side quickstep evade strikes, while throws\n'
    '    // still catch the movement. This gives TPS lateral movement a real timing\n'
    '    // purpose without changing the shared deterministic move definitions.\n'
    '    if (defender === this.p1 && this.playerEvadeTicks > 3 && move.hitLevel !== "THROW") return;\n'
    '    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);',
    '    // A lateral STEP is the dedicated strike-avoidance action. Back/forward STEP\n'
    '    // rely on displacement, while throws can still catch lateral movement.\n'
    '    if (defender === this.p1 && defender.state === "SIDESTEP" && this.playerStepSideWeight > 0.45 && move.hitLevel !== "THROW") return;\n'
    '    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);',
)

replace_once(
    "src/game/tps-game.ts",
    '    attacker.hitTargets.add(defender.id);\n    const blocked = defenderGuarding && move.hitLevel !== "THROW";',
    '    attacker.hitTargets.add(defender.id);\n'
    '    const flankStrike = attacker === this.p1 && this.playerFlankAttackTicks > 0 && move.hitLevel !== "THROW";\n'
    '    const blocked = defenderGuarding && move.hitLevel !== "THROW" && !flankStrike;',
)

replace_once(
    "src/game/tps-game.ts",
    '    this.playerEvadeTicks = 0;\n'
    '    this.playerEvadeCooldown = 0;\n'
    '    this.playerEvadeSign = 0;\n'
    '    this.simulationTicks = 0;',
    '    this.playerEvadeTicks = 0;\n'
    '    this.playerEvadeCooldown = 0;\n'
    '    this.playerEvadeSign = 0;\n'
    '    this.playerStepDirection.set(0, 0, 0);\n'
    '    this.playerStepForwardWeight = 0;\n'
    '    this.playerStepSideWeight = 0;\n'
    '    this.playerComboStage = 0;\n'
    '    this.playerComboGraceTicks = 0;\n'
    '    this.playerAttackQueued = false;\n'
    '    this.playerFlankWindowTicks = 0;\n'
    '    this.playerFlankAttackTicks = 0;\n'
    '    this.simulationTicks = 0;',
)

old_message = '''      message: this.finished
        ? "BATTLE COMPLETE"
        : this.enemyOpeningGraceTicks > 0
          ? "READ THE TARGET"
          : this.p2.state === "ATTACK"
          ? "INCOMING"
          : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE
            ? "STRIKE RANGE"
            : "TARGET LOCKED",'''
new_message = '''      message: this.finished
        ? "BATTLE COMPLETE"
        : this.p1.state === "ATTACK" && this.p1.currentMove?.id === "dashKick"
          ? "DASH ATTACK"
          : this.playerEvadeTicks > 0 && this.playerStepSideWeight > 0.45
            ? "EVADE STEP"
            : this.playerFlankWindowTicks > 0 && this.playerStepSideWeight > 0.45
              ? "FLANK OPEN"
              : this.p1.state === "ATTACK" && this.playerComboStage > 1
                ? `COMBO ${this.playerComboStage}`
                : this.enemyOpeningGraceTicks > 0
                  ? "READ THE TARGET"
                  : this.p2.state === "ATTACK"
                    ? "INCOMING"
                    : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE
                      ? "STRIKE RANGE"
                      : "TARGET LOCKED",'''
replace_once("src/game/tps-game.ts", old_message, new_message)

# --- TPS two-button touch UI -----------------------------------------------
old_controls = '''            <div className="action-buttons">
              {pressableAction(gameRef, "guard", "Guard", "G", "guard " + (tpsIncoming ? "tps-threat-action" : ""))}
              {pressableAction(gameRef, "punch", "Punch", "P", "punch " + (tpsStrikeRange ? "tps-ready-action" : ""))}
              {pressableAction(gameRef, "kick", "Kick", "K", "kick " + (tpsStrikeRange ? "tps-ready-action" : ""))}
            </div>
          </section>
          <div className={`input-hint ${battleMode === "TPS" ? "tps-input-hint" : ""}`}>{battleMode === "TPS" ? <><b>G+SIDE</b> QUICKSTEP <span>•</span> <b>G+K</b> THROW <span>•</span> <b>G+P</b> COUNTER <span>•</span> <b>P+K</b> POWER</> : <>PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> HOLD G + 8-WAY TO SIDESTEP</>}</div>'''
new_controls = '''            <div className={`action-buttons ${battleMode === "TPS" ? "tps-two-button-actions" : ""}`}>
              {battleMode === "TPS" ? (
                <>
                  {pressableAction(gameRef, "guard", "Step", "STEP", "guard tps-step-action " + (tpsIncoming ? "tps-threat-action" : ""))}
                  {pressableAction(gameRef, "punch", "Attack", "ATTACK", "punch tps-attack-action " + (tpsStrikeRange ? "tps-ready-action" : ""))}
                </>
              ) : (
                <>
                  {pressableAction(gameRef, "guard", "Guard", "G", "guard")}
                  {pressableAction(gameRef, "punch", "Punch", "P", "punch")}
                  {pressableAction(gameRef, "kick", "Kick", "K", "kick")}
                </>
              )}
            </div>
          </section>
          <div className={`input-hint ${battleMode === "TPS" ? "tps-input-hint" : ""}`}>{battleMode === "TPS" ? <><b>ATTACK</b> AUTO PUNCH / KICK <span>•</span> TAP COMBO <span>•</span> <b>STEP + 8-WAY</b> EVADE / SPACE <span>•</span> FORWARD STEP → ATTACK = DASH</> : <>PUNCH <b>P</b> / KICK <b>K</b> / GUARD <b>G</b> <span>•</span> HOLD G + 8-WAY TO SIDESTEP</>}</div>'''
replace_once("app/page.tsx", old_controls, new_controls)

css_append = r'''

/* TPS two-button combat controls */
.tps-two-button-actions {
  gap: clamp(10px, 2vw, 16px);
  align-items: center;
}
.tps-two-button-actions .touch-action {
  position: relative;
  inset: auto;
  clip-path: polygon(8% 0, 92% 0, 100% 20%, 100% 80%, 92% 100%, 8% 100%, 0 80%, 0 20%);
  border-radius: 18px;
  letter-spacing: .075em;
  font-style: normal;
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 2px 7px rgba(0,0,0,.65);
}
.tps-two-button-actions .tps-step-action {
  width: clamp(76px, 11vw, 96px);
  height: clamp(64px, 9vw, 78px);
  color: #bdeeff;
  background: linear-gradient(145deg, rgba(14, 61, 91, .88), rgba(6, 26, 47, .9));
  border-color: rgba(126, 219, 255, .78);
  font-size: clamp(12px, 1.65vw, 17px);
}
.tps-two-button-actions .tps-attack-action {
  width: clamp(100px, 14vw, 122px);
  height: clamp(74px, 10vw, 88px);
  color: #fff7f8;
  background: linear-gradient(145deg, rgba(202, 30, 62, .92), rgba(93, 10, 31, .94));
  border-color: rgba(255, 132, 151, .92);
  box-shadow: 0 8px 22px rgba(70, 0, 18, .28), inset 0 0 22px rgba(255, 119, 137, .09);
  font-size: clamp(12px, 1.7vw, 18px);
}
.tps-two-button-actions .tps-attack-action:active,
.tps-two-button-actions .tps-step-action:active {
  transform: scale(.93);
}
@media (orientation: landscape) and (max-height: 560px) {
  .tps-two-button-actions { gap: 9px; transform: translateY(-2px); }
  .tps-two-button-actions .tps-step-action {
    width: clamp(66px, 18vh, 78px);
    height: clamp(54px, 15vh, 64px);
    font-size: clamp(10px, 3.2vh, 13px);
  }
  .tps-two-button-actions .tps-attack-action {
    width: clamp(82px, 22vh, 96px);
    height: clamp(60px, 17vh, 72px);
    font-size: clamp(10px, 3.3vh, 14px);
  }
}
@media (orientation: landscape) and (max-height: 430px) {
  .tps-two-button-actions .tps-step-action { width: 68px; height: 52px; }
  .tps-two-button-actions .tps-attack-action { width: 84px; height: 60px; }
}
'''
playtest_css = read("app/playtest-polish.css")
if "/* TPS two-button combat controls */" not in playtest_css:
    write("app/playtest-polish.css", playtest_css + css_append)

# --- Regression tests -------------------------------------------------------
write("tests/tps-mode.test.ts", r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TPS lock-on battle owns circular 360-degree locomotion and over-shoulder camera", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /ARENA_RADIUS = 6\.8/);
  assert.match(source, /new THREE\.CircleGeometry\(ARENA_RADIUS/);
  assert.match(source, /horizontalDirection\(this\.p1\.position, this\.p2\.position\)/);
  assert.match(source, /new THREE\.Vector3\(-toEnemy\.z, 0, toEnemy\.x\)/);
  assert.match(source, /fighter\.visual\.root\.quaternion\.setFromUnitVectors\(MODEL_FORWARD, forward\)/);
  assert.match(source, /cameraTarget\.copy\(this\.p2\.position\)/);
  assert.match(source, /closeFactor = THREE\.MathUtils\.clamp/);
  assert.match(source, /aspect < 2\.4 \? 52 : 47/);
  assert.match(source, /compactLandscapeFactor/);
  assert.match(source, /shoulderOffset = 2\.50 \+ closeFactor \* 1\.70/);
  assert.match(source, /tps-target-ground-ring/);
});

test("TPS player combat is ATTACK plus directional STEP with range attacks, combos, dash attacks, and flank punishment", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /TPS_CLOSE_ATTACK_RANGE = 1\.58/);
  assert.match(source, /TPS_STEP_TICKS = 9/);
  assert.match(source, /playerStepDirection/);
  assert.match(source, /playerStepForwardWeight/);
  assert.match(source, /playerStepSideWeight/);
  assert.match(source, /playerComboStage/);
  assert.match(source, /playerAttackQueued/);
  assert.match(source, /closeMoves = \["jab", "straight", "power"\]/);
  assert.match(source, /farMoves = \["kick", "lowKick", "risingKick"\]/);
  assert.match(source, /distance <= TPS_CLOSE_ATTACK_RANGE \? closeMoves\[stage\] : farMoves\[stage\]/);
  assert.match(source, /this\.playerEvadeTicks = TPS_STEP_TICKS/);
  assert.match(source, /this\.playerStepDirection\.copy\(stepVector\)/);
  assert.match(source, /this\.playerStepForwardWeight > 0\.45/);
  assert.match(source, /beginDashAttack\(toEnemy\)/);
  assert.match(source, /beginMove\("dashKick"\)/);
  assert.match(source, /defender\.state === "SIDESTEP" && this\.playerStepSideWeight > 0\.45/);
  assert.match(source, /playerFlankWindowTicks/);
  assert.match(source, /playerFlankAttackTicks/);
  assert.match(source, /const flankStrike = attacker === this\.p1/);
  assert.match(source, /&& !flankStrike/);
  assert.match(source, /distance > move\.reach \+ 0\.72/);
  assert.match(source, /applyAttackStepIn\(this\.p1, this\.p2\)/);
  assert.match(source, /enemyTactic/);
  assert.match(source, /enemyOpeningGraceTicks = 132/);
});

test("TPS result records a visible winner instead of a zero-zero duel score", async () => {
  const source = await readFile(new URL("../src/game/tps-game.ts", import.meta.url), "utf8");
  assert.match(source, /resultWinner/);
  assert.match(source, /this\.resultWinner = winner/);
  assert.match(source, /p1Wins: this\.resultWinner === "p1" \? 1 : 0/);
  assert.match(source, /p2Wins: this\.resultWinner === "p2" \? 1 : 0/);
});

test("TPS touch UI exposes exactly ATTACK and STEP while the duel mode keeps legacy controls", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /TPS_MATCH/);
  assert.match(page, /TPS LOCK-ON BATTLE/);
  assert.match(page, /tps-two-button-actions/);
  assert.match(page, /"guard", "Step", "STEP"/);
  assert.match(page, /"punch", "Attack", "ATTACK"/);
  assert.match(page, /AUTO PUNCH \/ KICK/);
  assert.match(page, /TAP COMBO/);
  assert.match(page, /STEP \+ 8-WAY/);
  assert.match(page, /FORWARD STEP → ATTACK = DASH/);
  assert.doesNotMatch(page, /G\+K/);
  assert.doesNotMatch(page, /G\+P/);
  assert.doesNotMatch(page, /P\+K/);
  assert.match(page, /battleMode === "TPS" \? "TPS_MATCH" : "MATCH"/);
});
''')

# --- Extend real-WebGL audit with the new combat loop ----------------------
capture_path = "scripts/capture-tps-visual-audit.mjs"
capture = read(capture_path)
insert_marker = '''  await screenshot(sessionId, `${outputDir}/tps-throw.png`);\n\n'''
if insert_marker not in capture:
    raise RuntimeError("Missing TPS audit insertion marker")
new_probes = r'''  const comboProbe = await execute(sessionId, `${gameLookup}
    const game = findGame();
    game.finished = false;
    game.input.clear();
    game.effects.update(2);
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); if (!['HIT', 'KNOCKDOWN', 'KO'].includes(game.p2.state)) game.p2.state = 'IDLE'; };
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
    game.p1.position.set(0, 0, 0.78);
    game.p2.position.set(0, 0, -0.42);
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.playerAttackQueued = false;
    const moves = [];
    const tap = (owner) => { game.press('punch', owner); game.step(); game.release('punch', owner); };
    tap('tps-combo-1');
    if (game.p1.currentMove?.id) moves.push(game.p1.currentMove.id);
    let queued2 = false;
    let queued3 = false;
    for (let index = 0; index < 150 && moves.length < 3; index += 1) {
      const current = game.p1.currentMove?.id ?? null;
      if (!queued2 && current === moves[0] && game.p1.moveTick >= 4) { tap('tps-combo-2'); queued2 = true; continue; }
      if (queued2 && moves.length === 1 && current && current !== moves[0]) moves.push(current);
      if (!queued3 && moves.length === 2 && current === moves[1] && game.p1.moveTick >= 4) { tap('tps-combo-3'); queued3 = true; continue; }
      if (moves.length === 2 && current && current !== moves[1]) moves.push(current);
      game.step();
    }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { moves, p2Health: game.p2.health, comboStage: game.playerComboStage };
  `);
  if (comboProbe.moves.join(',') !== 'jab,straight,power') throw new Error(`TPS ATTACK combo sequence failed: ${JSON.stringify(comboProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-combo.png`);

  const dashAttackProbe = await execute(sessionId, `${gameLookup}
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
    game.p1.position.set(0, 0, 1.8);
    game.p2.position.set(0, 0, -0.2);
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerComboStage = 0;
    game.playerComboGraceTicks = 0;
    game.press('up', 'tps-dash-forward');
    game.press('guard', 'tps-dash-step');
    game.step();
    game.step();
    game.press('punch', 'tps-dash-attack');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-dash-attack');
    game.release('guard', 'tps-dash-step');
    game.release('up', 'tps-dash-forward');
    let steps = 3;
    while (steps < 60 && game.p2.health === 100) { game.step(); steps += 1; }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { moveId, steps, p2Health: game.p2.health };
  `);
  if (dashAttackProbe.moveId !== 'dashKick' || !(dashAttackProbe.p2Health < 100)) throw new Error(`TPS forward STEP + ATTACK dash failed: ${JSON.stringify(dashAttackProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-dash-attack.png`);

  const flankProbe = await execute(sessionId, `${gameLookup}
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
    game.p1.position.set(0, 0, 0.78);
    game.p2.position.set(0, 0, -0.42);
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.p2.beginMove('straight');
    game.updateEnemy = () => {
      if (game.p2.state === 'ATTACK') game.p2.advanceAttack();
      game.p2.updatePhysics(1 / 60);
    };
    game.press('right', 'tps-flank-side');
    game.press('guard', 'tps-flank-step');
    for (let index = 0; index < 12; index += 1) game.step();
    game.release('guard', 'tps-flank-step');
    game.release('right', 'tps-flank-side');
    const healthAfterEvade = game.p1.health;
    game.p2.currentMove = null;
    game.p2.moveTick = 0;
    game.p2.velocity.set(0, 0, 0);
    game.p2.state = 'GUARD';
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); if (!['HIT', 'KNOCKDOWN', 'KO'].includes(game.p2.state)) game.p2.state = 'GUARD'; game.p2.updatePhysics(1 / 60); };
    game.press('punch', 'tps-flank-attack');
    game.step();
    const moveId = game.p1.currentMove?.id ?? null;
    game.release('punch', 'tps-flank-attack');
    let steps = 1;
    while (steps < 60 && game.p2.health === 100) { game.step(); steps += 1; }
    game.updateCamera(1 / 60);
    game.updateLockOn();
    game.renderer.render(game.scene, game.camera);
    return { healthAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks };
  `);
  if (flankProbe.healthAfterEvade !== 100) throw new Error(`TPS lateral STEP failed to evade strike: ${JSON.stringify(flankProbe)}`);
  if (!(flankProbe.p2Health < 100) || flankProbe.p2State === 'BLOCK_STUN') throw new Error(`TPS flank attack did not beat guard: ${JSON.stringify(flankProbe)}`);
  await screenshot(sessionId, `${outputDir}/tps-flank.png`);

'''
capture = capture.replace(insert_marker, insert_marker + new_probes, 1)
capture = capture.replace(
    'const report = { initial, iphone, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, throwProbe, afterBoundary, radial };',
    'const report = { initial, iphone, afterStrafe, lateralTravel, beforeForwardDistance, afterForward, afterForwardDistance, quickstepProbe, quickstepTravel, punchProbe, afterPunch, throwProbe, comboProbe, dashAttackProbe, flankProbe, afterBoundary, radial };',
    1,
)
write(capture_path, capture)

replace_once(
    ".github/workflows/tps-visual-audit.yml",
    '          for image in tps-idle tps-iphone-idle tps-quickstep tps-punch tps-punch-settled tps-throw; do',
    '          for image in tps-idle tps-iphone-idle tps-quickstep tps-punch tps-punch-settled tps-throw tps-combo tps-dash-attack tps-flank; do',
)

print("Applied TPS ATTACK + STEP combat implementation.")
