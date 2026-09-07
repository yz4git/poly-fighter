from pathlib import Path

p = Path('scripts/capture-tps-visual-audit.mjs')
s = p.read_text()

old = """    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.velocity.set(0, 0, 0);
    game.p1.state = 'IDLE';
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerEvadeSign = 0;"""
new = """    game.p2.currentMove = null;
    game.p2.moveTick = 0;
    game.p2.hitStop = 0;
    game.p2.hitStun = 0;
    game.p2.blockStun = 0;
    game.p2.hitTargets.clear();
    game.p2.velocity.set(0, 0, 0);
    game.p2.state = 'IDLE';
    game.enemyDirectorPendingMove = null;
    game.enemyDirectorTelegraphTicks = 0;
    game.enemyDirectorTelegraphTotalTicks = 0;
    game.updateEnemy = () => { game.p2.velocity.set(0, 0, 0); game.p2.state = 'IDLE'; };
    game.p1.currentMove = null;
    game.p1.moveTick = 0;
    game.p1.hitStop = 0;
    game.p1.hitStun = 0;
    game.p1.blockStun = 0;
    game.p1.velocity.set(0, 0, 0);
    game.p1.state = 'IDLE';
    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerEvadeSign = 0;
    game.playerFlankWindowTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerStepThreatTicks = 0;
    game.playerStepThreatMoveId = null;"""
if old not in s:
    raise SystemExit('quickstep isolation anchor not found')
s = s.replace(old, new, 1)

old = """      fighter.hitTargets.clear();
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };"""
new = """      fighter.hitTargets.clear();
      fighter.hitStop = 0;
      fighter.hitStun = 0;
      fighter.blockStun = 0;
      fighter.knockdownTicks = 0;
      fighter.health = 100;
      fighter.state = 'IDLE';
      const neutral = { left: false, right: false, up: false, down: false, punch: false, kick: false, guard: false };"""
# This reset shape occurs in several deterministic probes. Strengthening all of them is intentional.
if old not in s:
    raise SystemExit('fighter deterministic reset anchor not found')
s = s.replace(old, new)

old = """    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.p2.beginMove('straight');"""
new = """    game.playerEvadeTicks = 0;
    game.playerEvadeCooldown = 0;
    game.playerFlankWindowTicks = 0;
    game.playerFlankAttackTicks = 0;
    game.playerPerfectEvadeTicks = 0;
    game.playerStepThreatTicks = 0;
    game.playerStepThreatMoveId = null;
    game.enemyDirectorPendingMove = null;
    game.enemyDirectorTelegraphTicks = 0;
    game.enemyDirectorTelegraphTotalTicks = 0;
    game.p2.beginMove('straight');"""
if old not in s:
    raise SystemExit('flank isolation anchor not found')
s = s.replace(old, new, 1)

p.write_text(s)
