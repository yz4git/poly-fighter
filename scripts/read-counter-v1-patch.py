from pathlib import Path

ROOT = Path('.')


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, block: str) -> None:
    p = ROOT / path
    text = p.read_text()
    if marker in text:
        return
    p.write_text(text.rstrip() + '\n\n' + block.rstrip() + '\n')

# 1) Give the player time to read the CPU commitment, then expose a narrow late sync window.
replace_once(
    'src/game/tps-game-base.ts',
    '''const TPS_REACTABLE_TELEGRAPH_TICKS: Readonly<Record<CpuDifficulty, number>> = Object.freeze({
  EASY: 22,
  NORMAL: 18,
  HARD: 15,
});
const TPS_REACTIVE_STEP_WINDOW_TICKS: Readonly<Record<CpuDifficulty, number>> = Object.freeze({
  EASY: 14,
  NORMAL: 12,
  HARD: 10,
});
const TPS_HEAVY_TELEGRAPH_BONUS_TICKS = 5;''',
    '''const TPS_REACTABLE_TELEGRAPH_TICKS: Readonly<Record<CpuDifficulty, number>> = Object.freeze({
  EASY: 38,
  NORMAL: 34,
  HARD: 30,
});
const TPS_REACTIVE_STEP_WINDOW_TICKS: Readonly<Record<CpuDifficulty, number>> = Object.freeze({
  EASY: 22,
  NORMAL: 20,
  HARD: 18,
});
const TPS_JUST_STEP_WINDOW_TICKS: Readonly<Record<CpuDifficulty, number>> = Object.freeze({
  EASY: 9,
  NORMAL: 8,
  HARD: 7,
});
const TPS_HEAVY_TELEGRAPH_BONUS_TICKS = 8;'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''type EnemyTactic = "PRESSURE" | "ORBIT" | "BAIT";
type EnemyPersona = "BRAWLER" | "SKIRMISHER";''',
    '''type EnemyTactic = "PRESSURE" | "ORBIT" | "BAIT";
type EnemyThreatPhase = "NONE" | "READ" | "WATCH" | "SLIP";
type EnemyPersona = "BRAWLER" | "SKIRMISHER";'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''  private playerStepThreatTicks = 0;
  private playerStepThreatMoveId: string | null = null;
  private playerInterceptTicks = 0;
  private playerReversalTicks = 0;''',
    '''  private playerStepThreatTicks = 0;
  private playerStepThreatMoveId: string | null = null;
  private playerStepStartedInJustWindow = false;
  private playerBreakCounterAttackTicks = 0;
  private playerInterceptTicks = 0;
  private playerReversalTicks = 0;'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''    if (this.playerPerfectEvadeTicks > 0) this.playerPerfectEvadeTicks -= 1;
    if (this.playerStepThreatTicks > 0) this.playerStepThreatTicks -= 1;
    if (this.playerInterceptTicks > 0) this.playerInterceptTicks -= 1;
    if (this.playerReversalTicks > 0) this.playerReversalTicks -= 1;''',
    '''    if (this.playerPerfectEvadeTicks > 0) this.playerPerfectEvadeTicks -= 1;
    if (this.playerStepThreatTicks > 0) this.playerStepThreatTicks -= 1;
    if (this.playerBreakCounterAttackTicks > 0) this.playerBreakCounterAttackTicks -= 1;
    if (this.playerInterceptTicks > 0) this.playerInterceptTicks -= 1;
    if (this.playerReversalTicks > 0) this.playerReversalTicks -= 1;'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''    if (stepPressed && this.playerEvadeCooldown <= 0) {
      const stepVector = move.lengthSq() > 0.001''',
    '''    if (stepPressed && this.playerEvadeCooldown <= 0) {
      const threatAtStep = this.enemyThreatStatus();
      const stepVector = move.lengthSq() > 0.001'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''      this.playerStepThreatTicks = reactiveSideStep ? Math.max(TPS_STEP_TICKS + 2, incomingFrames + TPS_STEP_TICKS + 2) : 0;
      this.playerStepThreatMoveId = reactiveSideStep ? incomingMove?.id ?? null : null;''',
    '''      this.playerStepThreatTicks = reactiveSideStep ? Math.max(TPS_STEP_TICKS + 2, incomingFrames + TPS_STEP_TICKS + 2) : 0;
      this.playerStepThreatMoveId = reactiveSideStep ? incomingMove?.id ?? null : null;
      // Crucial timing rule: an early READ/WATCH step stays a safe evade. It can
      // never be upgraded later just because the enemy eventually reaches impact.
      this.playerStepStartedInJustWindow = reactiveSideStep && threatAtStep.phase === "SLIP";'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''  private enemyReactionWindowTicks(): number {
    return TPS_REACTIVE_STEP_WINDOW_TICKS[this.difficulty];
  }

  private updateEnemy(): void {''',
    '''  private enemyReactionWindowTicks(): number {
    return TPS_REACTIVE_STEP_WINDOW_TICKS[this.difficulty];
  }

  private enemyJustStepWindowTicks(): number {
    return TPS_JUST_STEP_WINDOW_TICKS[this.difficulty];
  }

  private updateEnemy(): void {'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''        const reactionWindow = this.enemyReactionWindowTicks();
        rootData.tpsEnemyTelegraphProgress = progress;
        rootData.tpsEnemyTelegraphMove = this.enemyDirectorPendingMove;
        rootData.tpsEnemyTelegraphPhase = this.enemyDirectorTelegraphTicks <= reactionWindow ? "REACT" : "LOAD";
        rootData.tpsEnemyReactionWindowTicks = reactionWindow;''',
    '''        const reactionWindow = this.enemyReactionWindowTicks();
        const justStepWindow = this.enemyJustStepWindowTicks();
        rootData.tpsEnemyTelegraphProgress = progress;
        rootData.tpsEnemyTelegraphMove = this.enemyDirectorPendingMove;
        rootData.tpsEnemyTelegraphPhase = this.enemyDirectorTelegraphTicks <= justStepWindow
          ? "SLIP"
          : this.enemyDirectorTelegraphTicks <= reactionWindow ? "WATCH" : "READ";
        rootData.tpsEnemyReactionWindowTicks = reactionWindow;
        rootData.tpsEnemyJustStepWindowTicks = justStepWindow;'''
)

# 2) Graded evasion: early is safe; only a late, committed side STEP opens reversal.
replace_once(
    'src/game/tps-game-base.ts',
    '''    if (trackedSideEvade) {
      attacker.hitTargets.add(defender.id);
      this.playerStepThreatTicks = 0;
      this.playerStepThreatMoveId = null;
      this.playerFlankWindowTicks = Math.max(this.playerFlankWindowTicks, TPS_FLANK_WINDOW_TICKS);
      this.playerPerfectEvadeTicks = Math.max(this.playerPerfectEvadeTicks, TPS_PERFECT_EVADE_TICKS + this.p1Dna.perfectEvadeBonusTicks);
      this.playerReversalTicks = Math.max(this.playerReversalTicks, TPS_REVERSAL_TICKS);
      this.trainingProgress.perfectEvades += 1;
      this.setCombatBeat("REVERSAL");
      return;
    }''',
    '''    if (trackedSideEvade) {
      const justStep = this.playerStepStartedInJustWindow;
      attacker.hitTargets.add(defender.id);
      this.playerStepThreatTicks = 0;
      this.playerStepThreatMoveId = null;
      this.playerStepStartedInJustWindow = false;
      defender.visual.root.userData.tpsLastEvadeGrade = justStep ? "JUST" : "SAFE";
      defender.visual.root.userData.tpsLastEvadeTick = this.simulationTicks;
      if (justStep) {
        this.playerFlankWindowTicks = Math.max(this.playerFlankWindowTicks, TPS_FLANK_WINDOW_TICKS);
        this.playerPerfectEvadeTicks = Math.max(this.playerPerfectEvadeTicks, TPS_PERFECT_EVADE_TICKS + this.p1Dna.perfectEvadeBonusTicks);
        this.playerReversalTicks = Math.max(this.playerReversalTicks, TPS_REVERSAL_TICKS);
        this.trainingProgress.perfectEvades += 1;
        attacker.hitStop = Math.max(attacker.hitStop, 4);
        this.cameraImpact = Math.max(this.cameraImpact, 0.032);
        this.setCombatBeat("JUST STEP", 32);
        this.audio.combatSignature("REVERSAL", this.p1Dna.id);
        if (this.settings.get().vibration) navigator.vibrate?.([6, 8, 12]);
      } else {
        this.setCombatBeat("EVADE", 16);
      }
      return;
    }'''
)

# Arm a persistent BREAK COUNTER marker when a JUST STEP reversal attack begins.
replace_once(
    'src/game/tps-game-base.ts',
    '''    this.p1.visual.root.userData.tpsContextBeat = choice.beat;
    if (choice.beat) this.setCombatBeat(choice.beat);
    if (reversalStrike) {
      this.playerReversalSamples += 1;
      this.playerReversalTicks = 0;
    }''',
    '''    this.p1.visual.root.userData.tpsContextBeat = choice.beat;
    if (choice.beat) this.setCombatBeat(choice.beat);
    if (reversalStrike) {
      this.playerBreakCounterAttackTicks = 36;
      this.playerReversalSamples += 1;
      this.playerReversalTicks = 0;
      this.p1.visual.root.userData.tpsSignatureAction = "BREAK COUNTER";
      this.p1.visual.root.userData.tpsBreakCounterArmed = true;
      this.setCombatBeat("BREAK COUNTER", 42);
    }'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''    const interceptStrike = attacker === this.p1 && defender === this.p2 && this.playerInterceptTicks > 0;
    const reversalStrike = attacker === this.p1 && this.playerFlankAttackTicks > 0 && move.hitLevel !== "THROW";
    const blocked = defenderGuarding && move.hitLevel !== "THROW" && !reversalStrike && !interceptStrike;''',
    '''    const interceptStrike = attacker === this.p1 && defender === this.p2 && this.playerInterceptTicks > 0;
    const reversalStrike = attacker === this.p1 && this.playerFlankAttackTicks > 0 && move.hitLevel !== "THROW";
    const breakCounterStrike = reversalStrike && this.playerBreakCounterAttackTicks > 0;
    const blocked = defenderGuarding && move.hitLevel !== "THROW" && !reversalStrike && !interceptStrike;'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''    const damageScale = interceptStrike
      ? 1.22 * this.p1Dna.interceptDamageScale
      : reversalStrike
        ? 1.18 * this.p1Dna.reversalDamageScale
        : defenderWasAttacking ? 1.12 : 1;''',
    '''    const damageScale = breakCounterStrike
      ? 1.32 * this.p1Dna.reversalDamageScale
      : interceptStrike
        ? 1.22 * this.p1Dna.interceptDamageScale
        : reversalStrike
          ? 1.18 * this.p1Dna.reversalDamageScale
          : defenderWasAttacking ? 1.12 : 1;'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''    const reactionStrength = blocked ? 0.72 : 1 + Math.max(0, move.power - 1) * 0.22 + (interceptStrike ? 0.24 : reversalStrike ? 0.18 : defenderWasAttacking ? 0.12 : 0);''',
    '''    const reactionStrength = blocked ? 0.72 : 1 + Math.max(0, move.power - 1) * 0.22 + (breakCounterStrike ? 0.32 : interceptStrike ? 0.24 : reversalStrike ? 0.18 : defenderWasAttacking ? 0.12 : 0);'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''    } else if (reversalStrike) {
      this.setCombatBeat(this.p1Dna.signature.reversal);
    } else if (defenderWasAttacking && !blocked) {''',
    '''    } else if (breakCounterStrike) {
      this.playerBreakCounterAttackTicks = 0;
      this.p1.visual.root.userData.tpsBreakCounterArmed = false;
      this.p2.visual.root.userData.tpsBreakCounterHit = true;
      this.setCombatBeat("BREAK COUNTER", 48);
    } else if (reversalStrike) {
      this.setCombatBeat(this.p1Dna.signature.reversal);
    } else if (defenderWasAttacking && !blocked) {'''
)

replace_once(
    'src/game/tps-game-base.ts',
    '''        : interceptStrike
          ? [8, 14, 16]
          : reversalStrike
            ? [12, 12, 22]''',
    '''        : breakCounterStrike
          ? [16, 10, 28]
          : interceptStrike
            ? [8, 14, 16]
            : reversalStrike
              ? [12, 12, 22]'''
)

# 3) Threat state becomes a readable three-stage cadence.
start = '''  private enemyThreatStatus(): { windup: boolean; incoming: boolean } {
    const pending = this.enemyDirectorPendingMove !== null && this.enemyDirectorTelegraphTicks > 0;
    const pendingMove = this.enemyDirectorPendingMove ? this.p2.definition.moves[this.enemyDirectorPendingMove] ?? null : null;
    const pendingDistance = Math.hypot(
      this.p2.position.x - this.p1.position.x,
      this.p2.position.z - this.p1.position.z,
    );
    const pendingThreatReach = pendingMove
      ? pendingMove.reach + (pendingMove.id === "dashKick" ? 1.8 : 0.9)
      : 0;
    const lateWindup = Boolean(
      pending
      && pendingMove
      && this.enemyDirectorTelegraphTicks <= this.enemyReactionWindowTicks()
      && pendingDistance <= pendingThreatReach
    );
    const windup = pending && !lateWindup;
    const move = this.p2.currentMove;
    if (this.p2.state !== "ATTACK" || !move) return { windup, incoming: lateWindup };
    const distance = Math.hypot(
      this.p2.position.x - this.p1.position.x,
      this.p2.position.z - this.p1.position.z,
    );
    const canStillHit = this.p2.moveTick < move.startup + Math.max(1, move.active);
    const inThreatReach = distance <= move.reach + 0.9;
    return { windup, incoming: canStillHit && inThreatReach };
  }'''
replacement = '''  private enemyThreatStatus(): { windup: boolean; incoming: boolean; phase: EnemyThreatPhase } {
    const pending = this.enemyDirectorPendingMove !== null && this.enemyDirectorTelegraphTicks > 0;
    const pendingMove = this.enemyDirectorPendingMove ? this.p2.definition.moves[this.enemyDirectorPendingMove] ?? null : null;
    const pendingDistance = Math.hypot(
      this.p2.position.x - this.p1.position.x,
      this.p2.position.z - this.p1.position.z,
    );
    const pendingThreatReach = pendingMove
      ? pendingMove.reach + (pendingMove.id === "dashKick" ? 1.8 : 0.9)
      : 0;
    const inPendingReach = Boolean(pendingMove && pendingDistance <= pendingThreatReach);
    const watchWindow = Boolean(
      pending
      && pendingMove
      && this.enemyDirectorTelegraphTicks <= this.enemyReactionWindowTicks()
      && inPendingReach
    );
    const slipWindow = Boolean(
      watchWindow
      && this.enemyDirectorTelegraphTicks <= this.enemyJustStepWindowTicks()
    );
    const pendingPhase: EnemyThreatPhase = slipWindow ? "SLIP" : watchWindow ? "WATCH" : pending ? "READ" : "NONE";
    const windup = pending && !slipWindow;
    const move = this.p2.currentMove;
    if (this.p2.state !== "ATTACK" || !move) return { windup, incoming: slipWindow, phase: pendingPhase };
    const distance = Math.hypot(
      this.p2.position.x - this.p1.position.x,
      this.p2.position.z - this.p1.position.z,
    );
    const canStillHit = this.p2.moveTick < move.startup + Math.max(1, move.active);
    const inThreatReach = distance <= move.reach + 0.9;
    const incoming = canStillHit && inThreatReach;
    return { windup, incoming, phase: incoming ? "SLIP" : pendingPhase };
  }'''
replace_once('src/game/tps-game-base.ts', start, replacement)

replace_once(
    'src/game/tps-game-base.ts',
    '''    const { windup, incoming: threat } = this.enemyThreatStatus();
    const inStrikeRange = distance < TPS_STRIKE_RANGE;''',
    '''    const { windup, incoming: threat, phase: threatPhase } = this.enemyThreatStatus();
    const inStrikeRange = distance < TPS_STRIKE_RANGE;'''
)
replace_once(
    'src/game/tps-game-base.ts',
    '''    const lockColor = perfectEvade ? 0x6dffb8 : threat ? 0xff506f : windup ? 0xffc45a : inStrikeRange ? 0xffd45c : 0x7ce8ff;''',
    '''    const lockColor = perfectEvade ? 0x6dffb8 : threat ? 0xff506f : threatPhase === "WATCH" ? 0xffc45a : threatPhase === "READ" ? 0x83d9ff : inStrikeRange ? 0xffd45c : 0x7ce8ff;'''
)

# Reset new timing state.
replace_once(
    'src/game/tps-game-base.ts',
    '''    this.playerStepThreatTicks = 0;
    this.playerStepThreatMoveId = null;
    this.playerInterceptTicks = 0;
    this.playerReversalTicks = 0;''',
    '''    this.playerStepThreatTicks = 0;
    this.playerStepThreatMoveId = null;
    this.playerStepStartedInJustWindow = false;
    this.playerBreakCounterAttackTicks = 0;
    this.playerInterceptTicks = 0;
    this.playerReversalTicks = 0;'''
)

# HUD cues: READ -> WATCH -> SLIP. PUNISH remains the post-JUST-STEP action state.
replace_once(
    'src/game/tps-game-base.ts',
    '''      tpsCue: this.finishPending || this.finished ? "NONE"
        : enemyThreat.incoming ? "INCOMING"
          : this.playerReversalTicks > 0 || this.playerPerfectEvadeTicks > 0 ? "PUNISH"
            : enemyThreat.windup ? "WINDUP"
              : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE ? "RANGE" : "NONE",''',
    '''      tpsCue: this.finishPending || this.finished ? "NONE"
        : enemyThreat.phase === "SLIP" ? "SLIP"
          : this.playerReversalTicks > 0 || this.playerPerfectEvadeTicks > 0 ? "PUNISH"
            : enemyThreat.phase === "WATCH" ? "WATCH"
              : enemyThreat.phase === "READ" ? "READ"
                : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE ? "RANGE" : "NONE",'''
)
replace_once(
    'src/game/tps-game-base.ts',
    '''                  : enemyThreat.windup
                    ? "WINDUP"
                    : enemyThreat.incoming
                      ? "INCOMING"
                      : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE''',
    '''                  : enemyThreat.phase === "READ"
                    ? "READ"
                    : enemyThreat.phase === "WATCH"
                      ? "WATCH"
                      : enemyThreat.phase === "SLIP"
                        ? "SLIP NOW"
                        : Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z) < TPS_STRIKE_RANGE'''
)

# 4) Extend the typed HUD contract.
replace_once(
    'src/game/types.ts',
    '''  tpsCue?: "INCOMING" | "WINDUP" | "PUNISH" | "RANGE" | "NONE";''',
    '''  tpsCue?: "READ" | "WATCH" | "SLIP" | "PUNISH" | "RANGE" | "NONE";'''
)

# 5) Touch UI makes waiting/readability the primary action language; ATTACK stays secondary until the reversal.
replace_once(
    'app/page.tsx',
    '''  const tpsIncoming = hud?.tpsCue === "INCOMING";
  const tpsWindup = hud?.tpsCue === "WINDUP";
  const tpsPunish = hud?.tpsCue === "PUNISH";
  const tpsIntercept = hud?.tpsCue === "WINDUP";
  const tpsStrikeRange = hud?.tpsCue === "RANGE";''',
    '''  const tpsRead = hud?.tpsCue === "READ";
  const tpsWatch = hud?.tpsCue === "WATCH";
  const tpsIncoming = hud?.tpsCue === "SLIP";
  const tpsWindup = tpsRead || tpsWatch;
  const tpsPunish = hud?.tpsCue === "PUNISH";
  const tpsStrikeRange = hud?.tpsCue === "RANGE";'''
)
replace_once(
    'app/page.tsx',
    '''              {pressableAction(gameRef, "guard", "Step", tpsIncoming ? "STEP NOW" : tpsWindup ? "READY" : "STEP", "guard tps-step-action " + (tpsIncoming ? "tps-threat-action" : tpsWindup ? "tps-windup-action" : ""))}
              {pressableAction(gameRef, "punch", "Attack", tpsPunish ? "PUNISH" : tpsIntercept ? "INTERCEPT" : "ATTACK", "punch tps-attack-action " + (tpsPunish ? "tps-punish-action" : tpsIntercept ? "tps-intercept-action" : tpsStrikeRange ? "tps-ready-action" : ""))}''',
    '''              {pressableAction(gameRef, "guard", "Step", tpsIncoming ? "SLIP NOW" : tpsWatch ? "WATCH" : tpsRead ? "READ" : "STEP", "guard tps-step-action " + (tpsIncoming ? "tps-threat-action" : tpsWatch ? "tps-watch-action" : tpsRead ? "tps-read-action" : ""))}
              {pressableAction(gameRef, "punch", "Attack", tpsPunish ? "BREAK COUNTER" : "ATTACK", "punch tps-attack-action " + (tpsPunish ? "tps-punish-action" : tpsStrikeRange ? "tps-ready-action" : ""))}'''
)
replace_once(
    'app/page.tsx',
    '''          <div className="input-hint tps-input-hint"><b>ATTACK</b> AUTO PUNCH / KICK <span>•</span> <b>WINDUP</b> STEP OR INTERCEPT <span>•</span> <b>PERFECT STEP</b> → REVERSAL <span>•</span> FORWARD STEP → ATTACK = DASH</div>''',
    '''          <div className="input-hint tps-input-hint"><b>READ</b> SEE THE STARTUP <span>•</span> <b>WATCH</b> HOLD YOUR NERVE <span>•</span> <b>SLIP NOW</b> STEP LATE <span>•</span> <b>JUST STEP</b> → BREAK COUNTER</div>'''
)

# 6) New visual hierarchy for the observation phases.
append_once(
    'app/playtest-polish.css',
    '/* Read & Counter combat rhythm */',
    '''/* Read & Counter combat rhythm */
.action-buttons .tps-step-action.tps-read-action {
  outline: 2px solid rgba(131, 217, 255, .68);
  outline-offset: 3px;
  color: #c9f1ff;
  box-shadow: 0 0 18px rgba(89, 198, 255, .18), inset 0 0 14px rgba(112, 218, 255, .07);
  font-size: clamp(10px, 1.25vw, 13px);
}
.action-buttons .tps-step-action.tps-watch-action {
  outline: 2px solid rgba(255, 196, 90, .92);
  outline-offset: 3px;
  color: #ffe3a1;
  box-shadow: 0 0 24px rgba(255, 184, 76, .30), inset 0 0 16px rgba(255, 207, 100, .10);
  animation: tps-watch-breathe .72s ease-in-out infinite alternate;
  font-size: clamp(9px, 1.18vw, 12px);
}
@keyframes tps-watch-breathe {
  from { filter: brightness(.98); transform: scale(1); }
  to { filter: brightness(1.14); transform: scale(1.025); }
}
@media (orientation: landscape) and (max-height: 430px) {
  .action-buttons .tps-step-action.tps-read-action,
  .action-buttons .tps-step-action.tps-watch-action { font-size: 9px; letter-spacing: 0; }
  .action-buttons .tps-attack-action.tps-punish-action { font-size: 8px; line-height: 1.02; }
}'''
)

# 7) Static regression tests move to the new vocabulary and assert the anti-mash timing gate.
test_path = ROOT / 'tests/tps-mode.test.ts'
tests = test_path.read_text()
tests = tests.replace(
    'assert.match(page, /"guard", "Step", tpsIncoming \\? "STEP NOW" : tpsWindup \\? "READY" : "STEP"/);',
    'assert.match(page, /"guard", "Step", tpsIncoming \\? "SLIP NOW" : tpsWatch \\? "WATCH" : tpsRead \\? "READ" : "STEP"/);'
)
tests = tests.replace(
    'assert.match(page, /"punch", "Attack", tpsPunish \\? "PUNISH" : tpsIntercept \\? "INTERCEPT" : "ATTACK"/);',
    'assert.match(page, /"punch", "Attack", tpsPunish \\? "BREAK COUNTER" : "ATTACK"/);'
)
tests = tests.replace('assert.match(page, /STEP OR INTERCEPT/);', 'assert.match(page, /HOLD YOUR NERVE/);')
tests = tests.replace('assert.match(page, /PERFECT STEP/);', 'assert.match(page, /JUST STEP/);')
tests = tests.replace('assert.match(page, /→ REVERSAL/);', 'assert.match(page, /→ BREAK COUNTER/);')
tests = tests.replace('assert.match(page, /WINDUP/);', 'assert.match(page, /SLIP NOW/);')
tests = tests.replace('assert.match(page, /FORWARD STEP → ATTACK = DASH/);', 'assert.match(page, /STEP LATE/);')
tests = tests.replace(
    'assert.match(page, /hud\\?\\.tpsCue === "WINDUP"/);',
    'assert.match(page, /hud\\?\\.tpsCue === "READ"/);\n  assert.match(page, /hud\\?\\.tpsCue === "WATCH"/);\n  assert.match(page, /hud\\?\\.tpsCue === "SLIP"/);'
)
tests = tests.replace(
    'assert.match(page, /tpsIncoming \\? "STEP NOW" : tpsWindup \\? "READY" : "STEP"/);',
    'assert.match(page, /tpsIncoming \\? "SLIP NOW" : tpsWatch \\? "WATCH" : tpsRead \\? "READ" : "STEP"/);'
)
tests = tests.replace(
    'assert.match(page, /tpsPunish \\? "PUNISH" : tpsIntercept \\? "INTERCEPT" : "ATTACK"/);',
    'assert.match(page, /tpsPunish \\? "BREAK COUNTER" : "ATTACK"/);'
)
if 'Read & Counter rhythm grades early evasion' not in tests:
    tests = tests.rstrip() + '''\n\n\ntest("Read & Counter rhythm grades early evasion and rewards only late JUST STEP", async () => {
  const [source, page, types, css] = await Promise.all([
    readFile(new URL("../src/game/tps-game-base.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/game/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/playtest-polish.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /TPS_REACTABLE_TELEGRAPH_TICKS[\\s\\S]*NORMAL: 34/);
  assert.match(source, /TPS_JUST_STEP_WINDOW_TICKS[\\s\\S]*NORMAL: 8/);
  assert.match(source, /type EnemyThreatPhase = "NONE" \\| "READ" \\| "WATCH" \\| "SLIP"/);
  assert.match(source, /playerStepStartedInJustWindow/);
  assert.match(source, /threatAtStep\\.phase === "SLIP"/);
  assert.match(source, /const justStep = this\\.playerStepStartedInJustWindow/);
  assert.match(source, /setCombatBeat\\("EVADE", 16\\)/);
  assert.match(source, /setCombatBeat\\("JUST STEP", 32\\)/);
  assert.match(source, /playerBreakCounterAttackTicks = 36/);
  assert.match(source, /setCombatBeat\\("BREAK COUNTER", 48\\)/);
  assert.match(source, /1\\.32 \\* this\\.p1Dna\\.reversalDamageScale/);
  assert.match(types, /"READ" \\| "WATCH" \\| "SLIP" \\| "PUNISH"/);
  assert.match(page, /SLIP NOW/);
  assert.match(page, /BREAK COUNTER/);
  assert.match(css, /Read & Counter combat rhythm/);
  assert.doesNotMatch(page, /tpsIntercept = hud/);
});\n'''
test_path.write_text(tests)

print('Read & Counter combat patch applied')
