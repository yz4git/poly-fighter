from pathlib import Path

p = Path("src/game/tps-game.ts")
text = p.read_text()
old = ': this.playerEvadeTicks > 0 && this.playerStepSideWeight > 0.45\n            ? "EVADE STEP"'
new = ': this.playerEvadeTicks > 0 && this.playerStepSideWeight > 0.45\n            ? "SIDE STEP"'
if old not in text:
    raise SystemExit("SIDE STEP HUD pattern not found")
p.write_text(text.replace(old, new, 1))

p = Path("tests/tps-mode.test.ts")
text = p.read_text()
old = '  assert.match(page, /STEP \\+ 8-WAY/);\n'
if old not in text:
    raise SystemExit("legacy STEP + 8-WAY assertion not found")
text = text.replace(old, '', 1)
text = text.replace('  assert.match(source, /PERFECT STEP/);', '  assert.match(source, /PERFECT STEP/);\n  assert.match(source, /SIDE STEP/);', 1)
p.write_text(text)

# The flank probe should release the side input at the end of the authored STEP,
# not continue ordinary strafing for three extra ticks. Capture the earned evade
# state immediately, then verify the follow-up attack consumes the flank window.
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

print("Updated TPS v2 HUD/test expectations and perfect-step playcheck timing.")
