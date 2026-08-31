from pathlib import Path

p = Path("src/game/tps-game.ts")
text = p.read_text()
old = ': this.playerEvadeTicks > 0 && this.playerStepSideWeight > 0.45\n            ? "EVADE STEP"'
new = ': this.playerEvadeTicks > 0 && this.playerStepSideWeight > 0.45\n            ? "SIDE STEP"'
if old not in text:
    raise SystemExit("SIDE STEP HUD pattern not found")
text = text.replace(old, new, 1)

old = "  private playerPerfectEvadeTicks = 0;\n  private simulationTicks = 0;"
new = "  private playerPerfectEvadeTicks = 0;\n  private playerStepThreatTicks = 0;\n  private simulationTicks = 0;"
if old not in text:
    raise SystemExit("perfect evade field pattern not found")
text = text.replace(old, new, 1)

old = "    if (this.playerPerfectEvadeTicks > 0) this.playerPerfectEvadeTicks -= 1;"
new = "    if (this.playerPerfectEvadeTicks > 0) this.playerPerfectEvadeTicks -= 1;\n    if (this.playerStepThreatTicks > 0) this.playerStepThreatTicks -= 1;"
if old not in text:
    raise SystemExit("perfect evade decrement pattern not found")
text = text.replace(old, new, 1)

old = "      this.playerFlankWindowTicks = 0;\n      this.playerPerfectEvadeTicks = 0;"
new = "      this.playerFlankWindowTicks = 0;\n      this.playerPerfectEvadeTicks = 0;\n      const incomingMove = this.p2.state === \"ATTACK\" ? this.p2.currentMove : null;\n      const incomingDistance = Math.hypot(this.p2.position.x - this.p1.position.x, this.p2.position.z - this.p1.position.z);\n      const incomingFrames = incomingMove ? incomingMove.startup + incomingMove.active - this.p2.moveTick : 0;\n      this.playerStepThreatTicks = this.playerStepSideWeight > 0.45\n        && incomingMove\n        && incomingMove.hitLevel !== \"THROW\"\n        && incomingFrames > 0\n        && incomingDistance <= incomingMove.reach + 0.9\n          ? Math.max(TPS_STEP_TICKS, incomingFrames + 2)\n          : 0;"
if old not in text:
    raise SystemExit("step threat arm pattern not found")
text = text.replace(old, new, 1)

old = "    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);\n    if (distance > move.reach + 0.72) return;\n    // Lateral STEP avoids a strike only when that strike was genuinely active and in range.\n    // That successful read earns the short flank window; orbiting with STEP alone does not.\n    if (defender === this.p1 && defender.state === \"SIDESTEP\" && this.playerStepSideWeight > 0.45 && move.hitLevel !== \"THROW\") {\n      attacker.hitTargets.add(defender.id);\n      this.playerFlankWindowTicks = TPS_FLANK_WINDOW_TICKS;\n      this.playerPerfectEvadeTicks = TPS_PERFECT_EVADE_TICKS;\n      return;\n    }\n\n    attacker.hitTargets.add(defender.id);"
new = "    const trackedSideEvade = defender === this.p1\n      && attacker === this.p2\n      && this.playerStepThreatTicks > 0\n      && this.playerStepSideWeight > 0.45\n      && move.hitLevel !== \"THROW\";\n    // The STEP remembers a nearby enemy attack that was already winding up when\n    // the player committed to the lateral dodge. When that same strike becomes\n    // active, leaving its contact radius counts as a successful read rather than\n    // erasing the evade reward simply because the STEP was fast enough.\n    if (trackedSideEvade) {\n      attacker.hitTargets.add(defender.id);\n      this.playerStepThreatTicks = 0;\n      this.playerFlankWindowTicks = TPS_FLANK_WINDOW_TICKS;\n      this.playerPerfectEvadeTicks = TPS_PERFECT_EVADE_TICKS;\n      return;\n    }\n    const distance = Math.hypot(defender.position.x - attacker.position.x, defender.position.z - attacker.position.z);\n    if (distance > move.reach + 0.72) return;\n\n    attacker.hitTargets.add(defender.id);"
if old not in text:
    raise SystemExit("tracked side evade resolve pattern not found")
text = text.replace(old, new, 1)

old = "    this.playerPerfectEvadeTicks = 0;\n    this.simulationTicks = 0;"
new = "    this.playerPerfectEvadeTicks = 0;\n    this.playerStepThreatTicks = 0;\n    this.simulationTicks = 0;"
if old not in text:
    raise SystemExit("perfect evade reset pattern not found")
text = text.replace(old, new, 1)
p.write_text(text)

p = Path("tests/tps-mode.test.ts")
text = p.read_text()
old = '  assert.match(page, /STEP \\+ 8-WAY/);\n'
if old not in text:
    raise SystemExit("legacy STEP + 8-WAY assertion not found")
text = text.replace(old, '', 1)
old = '  assert.match(source, /defender\\.state === "SIDESTEP" && this\\.playerStepSideWeight > 0\\.45/);\n'
if old not in text:
    raise SystemExit("legacy direct SIDESTEP assertion not found")
text = text.replace(old, '', 1)
text = text.replace('  assert.match(source, /PERFECT STEP/);', '  assert.match(source, /PERFECT STEP/);\n  assert.match(source, /SIDE STEP/);\n  assert.match(source, /playerStepThreatTicks/);\n  assert.match(source, /incomingDistance <= incomingMove\\.reach \\+ 0\\.9/);\n  assert.match(source, /const trackedSideEvade/);', 1)
p.write_text(text)

# The flank probe releases side input at the authored STEP end. Capture the earned
# evade state immediately, then verify that its follow-up attack consumes the flank.
p = Path("scripts/capture-tps-visual-audit.mjs")
text = p.read_text()
old = "    for (let index = 0; index < 12; index += 1) game.step();\n    game.release('guard', 'tps-flank-step');\n    game.release('right', 'tps-flank-side');\n    const healthAfterEvade = game.p1.health;"
new = "    for (let index = 0; index < 9; index += 1) game.step();\n    game.release('guard', 'tps-flank-step');\n    game.release('right', 'tps-flank-side');\n    const healthAfterEvade = game.p1.health;\n    const perfectAfterEvade = game.playerPerfectEvadeTicks;\n    const flankWindowAfterEvade = game.playerFlankWindowTicks;"
if old not in text:
    raise SystemExit("flank probe timing pattern not found")
text = text.replace(old, new, 1)
old = "return { healthAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks, perfectEvadeTicks: game.playerPerfectEvadeTicks, screenSeparation };"
new = "return { healthAfterEvade, perfectAfterEvade, flankWindowAfterEvade, p2Health: game.p2.health, p2State: game.p2.state, moveId, flankTicks: game.playerFlankAttackTicks, screenSeparation };"
if old not in text:
    raise SystemExit("flank probe return pattern not found")
text = text.replace(old, new, 1)
old = "  if (!(flankProbe.perfectEvadeTicks > 0)) throw new Error(`TPS successful lateral dodge did not award PERFECT STEP: ${JSON.stringify(flankProbe)}`);"
new = "  if (!(flankProbe.perfectAfterEvade > 0) || !(flankProbe.flankWindowAfterEvade > 0)) throw new Error(`TPS successful lateral dodge did not award PERFECT STEP: ${JSON.stringify(flankProbe)}`);"
if old not in text:
    raise SystemExit("perfect-step assertion pattern not found")
text = text.replace(old, new, 1)
p.write_text(text)

print("Updated TPS v2 with reactive threat tracking, current assertions, and perfect-step audit timing.")
