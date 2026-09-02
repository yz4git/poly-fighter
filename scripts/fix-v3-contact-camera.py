from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'patch target not found: {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

replace_once(
    'src/game/tps-game-base.ts',
    '''const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3.15;\nconst TPS_CAMERA_CLOSE_BACK_DELTA = 0.18;\nconst TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.42;\nconst TPS_CAMERA_CLOSE_TARGET_LIFT = 0.12;\nconst TPS_CAMERA_IMPACT_PULLBACK = 0.42;\nconst TPS_CAMERA_IMPACT_SHOULDER = 0.62;''',
    '''const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2.55;\nconst TPS_CAMERA_CLOSE_BACK_DELTA = -0.58;\nconst TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.30;\nconst TPS_CAMERA_CLOSE_TARGET_LIFT = 0.14;\nconst TPS_CAMERA_IMPACT_BACK_DELTA = -0.16;\nconst TPS_CAMERA_IMPACT_SHOULDER = 0.20;''',
)
replace_once(
    'src/game/tps-game-base.ts',
    '''      + impactReadabilityFactor * TPS_CAMERA_IMPACT_PULLBACK;''',
    '''      + impactReadabilityFactor * TPS_CAMERA_IMPACT_BACK_DELTA;''',
)
replace_once(
    'src/game/tps-game-base.ts',
    '''      .addScaledVector(right, TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT * closeFactor - flankLaneShift + impactReadabilityFactor * 0.08)''',
    '''      .addScaledVector(right, TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT * closeFactor - flankLaneShift + impactReadabilityFactor * 0.035)''',
)
replace_once(
    'tests/tps-mode.test.ts',
    '''  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 3\\.15/);\n  assert.match(source, /TPS_CAMERA_CLOSE_BACK_DELTA = 0\\.18/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\\.42/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\\.12/);\n  assert.match(source, /TPS_CAMERA_IMPACT_PULLBACK = 0\\.42/);\n  assert.match(source, /TPS_CAMERA_IMPACT_SHOULDER = 0\\.62/);''',
    '''  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2\\.55/);\n  assert.match(source, /TPS_CAMERA_CLOSE_BACK_DELTA = -0\\.58/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\\.30/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\\.14/);\n  assert.match(source, /TPS_CAMERA_IMPACT_BACK_DELTA = -0\\.16/);\n  assert.match(source, /TPS_CAMERA_IMPACT_SHOULDER = 0\\.20/);''',
)
print('restored proven close framing and limited impact-only camera accent')
