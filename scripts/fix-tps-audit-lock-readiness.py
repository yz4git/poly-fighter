from pathlib import Path

path = Path('scripts/capture-tps-visual-audit.mjs')
text = path.read_text()
old = "      targetLocked: document.body.innerText.includes('TARGET LOCKED'),\n"
new = "      targetLocked: Boolean(game?.scene?.getObjectByName?.('tps-target-ground-ring')),\n"
if old not in text:
    raise SystemExit('targetLocked audit line not found')
path.write_text(text.replace(old, new, 1))
print('TPS audit now detects the actual lock marker instead of HUD wording')
