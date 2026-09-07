from pathlib import Path

p = Path('scripts/capture-tps-visual-audit.mjs')
s = p.read_text()
old = """    game.press('right', 'tps-flank-side');
    game.press('guard', 'tps-flank-step');
    for (let index = 0; index < 9; index += 1) game.step();
    game.release('guard', 'tps-flank-step');"""
new = """    game.press('right', 'tps-flank-side');
    game.press('guard', 'tps-flank-step');
    const evadeTrace = [];
    for (let index = 0; index < 9; index += 1) {
      game.step();
      evadeTrace.push({
        frame: index + 1,
        p2State: game.p2.state,
        p2Move: game.p2.currentMove?.id ?? null,
        p2MoveTick: game.p2.moveTick,
        p2Active: game.p2.isActive(),
        threatTicks: game.playerStepThreatTicks,
        threatMove: game.playerStepThreatMoveId ?? null,
        sideWeight: game.playerStepSideWeight,
        evadeTicks: game.playerEvadeTicks,
        perfectTicks: game.playerPerfectEvadeTicks,
        flankTicks: game.playerFlankWindowTicks,
        p2HitPlayer: game.p2.hitTargets.has(game.p1.id),
        p1Health: game.p1.health,
      });
    }
    game.release('guard', 'tps-flank-step');"""
if old not in s:
    raise SystemExit('flank trace loop anchor not found')
s = s.replace(old, new, 1)
old = """    return { healthAfterEvade, perfectAfterEvade, flankWindowAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks, screenSeparation };"""
new = """    return { healthAfterEvade, perfectAfterEvade, flankWindowAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks, screenSeparation, evadeTrace };"""
if old not in s:
    raise SystemExit('flank trace return anchor not found')
p.write_text(s.replace(old, new, 1))
