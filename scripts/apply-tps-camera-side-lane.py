from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing anchor: {label}')
    return text.replace(old, new, 1)

path = Path('src/game/tps-game-base.ts')
text = path.read_text()
text = replace_once(
    text,
    'const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 1.95;\nconst TPS_CAMERA_CLOSE_BACK_BONUS = 0.24;\nconst TPS_CAMERA_CLOSE_TARGET_LIFT = 0.14;\n',
    'const TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2.55;\nconst TPS_CAMERA_CLOSE_BACK_DELTA = -0.58;\nconst TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0.30;\nconst TPS_CAMERA_CLOSE_TARGET_LIFT = 0.14;\n',
    'camera constants',
)
text = replace_once(
    text,
    '''    const backDistance = 4.88 + closeFactor * TPS_CAMERA_CLOSE_BACK_BONUS + compactLandscapeFactor * 0.24;\n    const shoulderOffset = 2.50 + closeFactor * TPS_CAMERA_CLOSE_SHOULDER_BONUS\n      + compactLandscapeFactor * (0.62 + closeFactor * 0.62);\n    const cameraHeight = 2.36 + closeFactor * 0.24 + compactLandscapeFactor * 0.06;\n    const targetHeight = 1.22 + closeFactor * TPS_CAMERA_CLOSE_TARGET_LIFT;\n    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, -0.34 * closeFactor - flankLaneShift)\n''',
    '''    // At melee range rotate the composition toward a 3/4 side lane rather\n    // than simply pulling the shoulder camera farther away. This keeps camera-to-\n    // player distance nearly unchanged while increasing screen-space separation.\n    const backDistance = 4.70 + closeFactor * TPS_CAMERA_CLOSE_BACK_DELTA + compactLandscapeFactor * 0.18;\n    const shoulderOffset = 2.50 + closeFactor * TPS_CAMERA_CLOSE_SHOULDER_BONUS\n      + compactLandscapeFactor * (0.52 + closeFactor * 0.48);\n    const cameraHeight = 2.36 + closeFactor * 0.24 + compactLandscapeFactor * 0.06;\n    const targetHeight = 1.22 + closeFactor * TPS_CAMERA_CLOSE_TARGET_LIFT;\n    this.cameraTarget.copy(this.p2.position)\n      .addScaledVector(right, TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT * closeFactor - flankLaneShift)\n''',
    'camera side lane',
)
path.write_text(text)

path = Path('tests/tps-mode.test.ts')
text = path.read_text()
text = replace_once(
    text,
    '''  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 1\\.95/);\n  assert.match(source, /TPS_CAMERA_CLOSE_BACK_BONUS = 0\\.24/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\\.14/);\n''',
    '''  assert.match(source, /TPS_CAMERA_CLOSE_SHOULDER_BONUS = 2\\.55/);\n  assert.match(source, /TPS_CAMERA_CLOSE_BACK_DELTA = -0\\.58/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_SIDE_SHIFT = 0\\.30/);\n  assert.match(source, /TPS_CAMERA_CLOSE_TARGET_LIFT = 0\\.14/);\n''',
    'camera test constants',
)
path.write_text(text)
print('close TPS camera now transitions to a 3/4 side lane')
