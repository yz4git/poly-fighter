from pathlib import Path

root = Path('.')
generator_path = root / 'tools/blender/build-fight-motion-foundry-v2-kicks.py'
test_path = root / 'tests/blender-motion-foundry-v2-kicks.test.mjs'

generator = generator_path.read_text()
old = 'src_recovery = min(1.0, reference_impact_u + 0.31)'
new = 'src_recovery = min(0.96, reference_impact_u + 0.44)'
count = generator.count(old)
if count != 2:
    raise SystemExit(f'expected two recovery warp formulas, found {count}')
generator = generator.replace(old, new)
generator_path.write_text(generator)

test = test_path.read_text()
needle = '    assert.ok(recovery.strikeKneeExtensionDegrees < impact.strikeKneeExtensionDegrees - 8, `${move.action} impact->recovery knee`);\n'
insert = needle + '''    const recoveryRetreatRatio = Math.abs(recovery.strikeFootForward) / Math.max(0.001, Math.abs(impact.strikeFootForward));\n    assert.ok(recoveryRetreatRatio < 0.58, `${move.action} recovery retreat ratio ${recoveryRetreatRatio}`);\n'''
if needle not in test:
    raise SystemExit('reference-pose recovery assertion anchor not found')
if 'recovery retreat ratio' in test:
    raise SystemExit('recovery retreat gate already present')
test = test.replace(needle, insert, 1)
test_path.write_text(test)

print('V6.8 recovery continuity patch applied')
