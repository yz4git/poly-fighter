from pathlib import Path

root = Path('.')
gen_path = root / 'tools/blender/build-fight-motion-foundry-v2-kicks.py'
test_path = root / 'tests/blender-motion-foundry-v2-kicks.test.mjs'
gen = gen_path.read_text()

# Replace both single-stage recovery maps with measured TUCK -> SETTLE -> GUARD mapping.
old_block = '''    src_over = min(1.0, reference_impact_u + 0.075)\n    src_recovery = min(0.96, reference_impact_u + 0.44)\n'''
new_block = '''    src_over = min(1.0, reference_impact_u + 0.075)\n    # V6.8: preserve the measured post-impact knee tuck, then advance to a\n    # later measured settle before GUARD. A single late recovery sample skipped\n    # the tuck and produced a straight-leg landing; the old single early sample\n    # left the foot extended until the final eight frames.\n    src_recovery = min(0.90, reference_impact_u + 0.31)\n    src_settle = min(0.96, reference_impact_u + 0.44)\n    recovery_u = du(spec.recovery_frame)\n    settle_u = recovery_u + (1.0 - recovery_u) * 0.55\n'''
if gen.count(old_block) != 2:
    raise SystemExit(f'expected two single-stage recovery blocks, found {gen.count(old_block)}')
gen = gen.replace(old_block, new_block)

old_tuple = '''        (du(spec.overtravel_frame), src_over),\n        (du(spec.recovery_frame), src_recovery),\n        (1.0, 1.0),\n'''
new_tuple = '''        (du(spec.overtravel_frame), src_over),\n        (du(spec.recovery_frame), src_recovery),\n        (settle_u, src_settle),\n        (1.0, 1.0),\n'''
if gen.count(old_tuple) != 2:
    raise SystemExit(f'expected two warp tuple tails, found {gen.count(old_tuple)}')
gen = gen.replace(old_tuple, new_tuple)

# Demote authored reach IK back to contact assistance so measured CMU body mechanics survive.
replacements = {
'''    ik_influences=(0.0, 0.16, 0.52, 1.0, 0.72, 0.12, 0.0),''':
'''    ik_influences=(0.0, 0.12, 0.40, 0.82, 0.52, 0.08, 0.0),''',
'''    reach_ratios=(0.0, 0.0, 0.90, 0.976, 0.980, 0.0, 0.0),''':
'''    reach_ratios=(0.0, 0.0, 0.84, 0.950, 0.955, 0.0, 0.0),''',
'''    ik_influences=(0.0, 0.12, 0.48, 1.0, 0.68, 0.10, 0.0),''':
'''    ik_influences=(0.0, 0.08, 0.30, 0.58, 0.38, 0.06, 0.0),''',
'''    reach_ratios=(0.0, 0.0, 0.90, 0.955, 0.962, 0.0, 0.0),''':
'''    reach_ratios=(0.0, 0.0, 0.72, 0.860, 0.880, 0.0, 0.0),''',
'''    ik_influences=(0.0, 0.18, 0.56, 1.0, 0.78, 0.14, 0.0),''':
'''    ik_influences=(0.0, 0.10, 0.36, 0.68, 0.44, 0.08, 0.0),''',
'''    reach_ratios=(0.0, 0.0, 0.90, 0.960, 0.966, 0.0, 0.0),''':
'''    reach_ratios=(0.0, 0.0, 0.78, 0.900, 0.910, 0.0, 0.0),''',
}
for old, new in replacements.items():
    if old not in gen:
        raise SystemExit(f'missing expected control line: {old}')
    gen = gen.replace(old, new, 1)

gen_path.write_text(gen)

test = test_path.read_text()
# Recovery is the measured knee-tuck checkpoint; the later settle knot owns positional retreat.
old_gate = '''    const recoveryRetreatRatio = Math.abs(recovery.strikeFootForward) / Math.max(0.001, Math.abs(impact.strikeFootForward));\n    assert.ok(recoveryRetreatRatio < 0.58, `${move.action} recovery retreat ratio ${recoveryRetreatRatio}`);\n'''
if old_gate not in test:
    raise SystemExit('V6.8 phase-1 recovery gate missing')
test = test.replace(old_gate, '''    assert.equal(move.referenceTimeWarpKnots.length, 8, `${move.action} two-stage recovery knots`);\n    const settleKnot = move.referenceTimeWarpKnots.at(-2);\n    assert.ok(settleKnot[0] > recovery.normalizedTime && settleKnot[0] < 1.0, `${move.action} settle gameplay phase`);\n    assert.ok(settleKnot[1] > move.referenceTimeWarpKnots.at(-3)[1], `${move.action} settle source phase`);\n''', 1)
# Static source contract: contact correction must remain assistance, not full IK override.
anchor = '  assert.match(generator, /IMPACT_WINDOW_ONLY/);\n'
if 'V6_8_CONTACT_ASSIST' not in test:
    test = test.replace(anchor, anchor + '  assert.match(generator, /V6_8_CONTACT_ASSIST/);\n', 1)

gen = gen_path.read_text()
marker = 'KNEE_POLE_POLICY = "ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3"'
if marker in gen and 'V6_8_CONTACT_ASSIST' not in gen:
    gen = gen.replace(marker, marker + '\nCONTACT_ASSIST_POLICY = "V6_8_CONTACT_ASSIST"', 1)
    gen_path.write_text(gen)

test_path.write_text(test)
print('V6.8 two-stage recovery + mocap-dominant contact assist patch applied')
# trigger: 2026-09-05 V6.8 phase 2
