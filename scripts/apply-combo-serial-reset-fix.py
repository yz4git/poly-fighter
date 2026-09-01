from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    file.write_text(text.replace(old, new, 1))

replace_once(
    "src/game/motion-expansion-runtime.ts",
    '''  const comboLinkSerial = Number(fighter.visual.root.userData.tpsComboLinkSerial ?? 0);\n  const comboLinked = restartedMove && comboLinkSerial > runtime.lastComboLinkSerial;\n  if (comboLinkSerial > runtime.lastComboLinkSerial) runtime.lastComboLinkSerial = comboLinkSerial;''',
    '''  const comboLinkSerial = Number(fighter.visual.root.userData.tpsComboLinkSerial ?? 0);\n  const comboLinkState = fighter.visual.root.userData.tpsComboLinkState;\n  // Link serials intentionally reset with each round. Comparing only with `>`\n  // made the first links of later rounds miss their visual crossfade whenever a\n  // previous round had already reached a larger serial. A real linked restart is\n  // defined by the published LINKED state plus a serial change in either direction.\n  const comboLinked = restartedMove\n    && comboLinkState === "LINKED"\n    && comboLinkSerial !== runtime.lastComboLinkSerial;\n  if (comboLinkSerial !== runtime.lastComboLinkSerial) runtime.lastComboLinkSerial = comboLinkSerial;''',
    "combo serial detection",
)

replace_once(
    "tests/motion-expansion.test.ts",
    '''  assert.match(source, /COMBO_LINK_BLEND_SECONDS = 0\\.075/);\n  assert.match(source, /currentPhase = "SETTLE"/);''',
    '''  assert.match(source, /COMBO_LINK_BLEND_SECONDS = 0\\.075/);\n  assert.match(source, /comboLinkState === "LINKED"/);\n  assert.match(source, /comboLinkSerial !== runtime\\.lastComboLinkSerial/);\n  assert.match(source, /currentPhase = "SETTLE"/);''',
    "combo serial regression assertions",
)

print("combo serial reset handling fixed")
