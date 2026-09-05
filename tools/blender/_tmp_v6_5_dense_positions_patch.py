from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()

old = '''    positions = rig.v1.evaluated_positions(scene, armature, spec.phases, names)\n\n    scene.frame_set(spec.start_frame)\n'''
new = '''    positions = rig.v1.evaluated_positions(scene, armature, spec.phases, names)\n    dense_frames = tuple(range(spec.start_frame, spec.end_frame + 1))\n    dense_positions = rig.v1.evaluated_positions(scene, armature, dense_frames, names)\n\n    scene.frame_set(spec.start_frame)\n'''
if old not in text:
    raise SystemExit('dense positions anchor not found')
text = text.replace(old, new, 1)

old = '''        support_pole_angle_keys, support_pole_calibration_min = calibrate_dynamic_ik_pole_angle(\n            scene, armature, support_ik, positions, spec.start_frame, spec.end_frame,\n            s_thigh, s_calf, s_foot, support_pole_angle,\n        )\n'''
new = '''        support_pole_angle_keys, support_pole_calibration_min = calibrate_dynamic_ik_pole_angle(\n            scene, armature, support_ik, dense_positions, spec.start_frame, spec.end_frame,\n            s_thigh, s_calf, s_foot, support_pole_angle,\n        )\n'''
if old not in text:
    raise SystemExit('dynamic dense call anchor not found')
text = text.replace(old, new, 1)

path.write_text(text)

static = Path('tests/motion-foundry-v6-leg-anatomy-v62.test.mjs')
t = static.read_text()
extra = '''\ntest('V6.5 dynamic calibration evaluates dense reference leg positions', () => {\n  assert.match(kicks, /dense_frames = tuple\\(range\\(spec\\.start_frame, spec\\.end_frame \\+ 1\\)\\)/);\n  assert.match(kicks, /dense_positions = rig\\.v1\\.evaluated_positions/);\n  assert.match(kicks, /support_ik, dense_positions, spec\\.start_frame, spec\\.end_frame/);\n});\n'''
if 'dynamic calibration evaluates dense reference leg positions' not in t:
    t += extra
static.write_text(t)
print('patched V6.5 dense reference positions')
