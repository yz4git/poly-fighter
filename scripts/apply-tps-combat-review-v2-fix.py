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

print("Updated TPS v2 HUD/test expectations.")
