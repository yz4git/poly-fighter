#!/usr/bin/env python3
from pathlib import Path

GEN = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
TEST = Path('tests/blender-motion-foundry-v2-kicks.test.mjs')

gen = GEN.read_text()
old_dirs = '''    reach_directions=(\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n        (0.80, 0.08, 0.60),\n        (0.85, 0.10, 0.52),\n        (0.87, 0.10, 0.49),\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n    ),\n)\n\nKICK_SPECS = (FRONT_KICK, LOW_KICK, RISING_KICK)\n'''
new_dirs = '''    reach_directions=(\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n        (0.82, 0.22, 0.62),\n        (0.86, 0.32, 0.58),\n        (0.88, 0.36, 0.55),\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n    ),\n)\n\nKICK_SPECS = (FRONT_KICK, LOW_KICK, RISING_KICK)\n'''
if old_dirs not in gen:
    raise SystemExit('Rising reach direction block not found')
gen = gen.replace(old_dirs, new_dirs, 1)

old_constrained = '        "constrainedStrikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),\n        "constrainedStrikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n'
new_constrained = '        "constrainedStrikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),\n        "constrainedStrikeFootOutwardReach": foot_axis_reach(scene, armature, spec, axes[1]) * (1.0 if spec.strike_suffix == "l" else -1.0),\n        "constrainedStrikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n'
if gen.count(old_constrained) != 1:
    raise SystemExit(f'Expected constrained metric block once, found {gen.count(old_constrained)}')
gen = gen.replace(old_constrained, new_constrained, 1)

old_final = '        "strikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),\n        "strikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n'
new_final = '        "strikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),\n        "strikeFootOutwardReach": foot_axis_reach(scene, armature, spec, axes[1]) * (1.0 if spec.strike_suffix == "l" else -1.0),\n        "strikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n'
if gen.count(old_final) != 1:
    raise SystemExit(f'Expected final metric block once, found {gen.count(old_final)}')
gen = gen.replace(old_final, new_final, 1)
GEN.write_text(gen)

test = TEST.read_text()
needle = '  assert.match(generator, /strikeFootForwardReach/);\n'
replacement = needle + '  assert.match(generator, /strikeFootOutwardReach/);\n'
if needle not in test:
    raise SystemExit('Generator metric assertion anchor missing')
test = test.replace(needle, replacement, 1)
needle2 = '  assert.ok(rising.strikeFootForwardReach > 0.34, rising.strikeFootForwardReach);\n'
replacement2 = needle2 + '  assert.ok(rising.strikeFootOutwardReach > 0.16, rising.strikeFootOutwardReach);\n'
if needle2 not in test:
    raise SystemExit('Rising metric assertion anchor missing')
test = test.replace(needle2, replacement2, 1)
TEST.write_text(test)
