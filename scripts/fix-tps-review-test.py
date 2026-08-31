from pathlib import Path

path = Path("tests/tps-mode.test.ts")
source = path.read_text()
old = '  assert.match(source, /moveId = punishGuard \\? "throw"/);'
new = '  assert.match(source, /const moveId = punishGuard/);\n  assert.match(source, /\\? "throw"/);\n  assert.match(source, /punishRecovery/);'
if old not in source:
    raise RuntimeError("TPS guard-punish assertion not found")
path.write_text(source.replace(old, new, 1))
print("Updated TPS tactical CPU regression assertion")
