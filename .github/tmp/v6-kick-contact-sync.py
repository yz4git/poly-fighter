from pathlib import Path

mocap_path = Path("tools/blender/motion_foundry_v6_mocap.py")
mocap = mocap_path.read_text()
old = """            delta_q = _rotation_delta_in_target_space(start_q, current_q, source_basis, target_basis, mirrored)
            desired_q = (delta_q @ base_object_q[target_name]).normalized()
"""
new = """            delta_q = _rotation_delta_in_target_space(start_q, current_q, source_basis, target_basis, mirrored)
            # Mawashigeri carries useful hip/shoulder counter-rotation, but the raw
            # CMU upper-torso lean is too large after UAL -> UBC rest-delta retargeting.
            # Keep pelvis/legs untouched and retain a measured, progressively softer
            # upper-body delta so the low kick stays athletic without folding the chest.
            LOW_KICK_TORSO_DELTA_RETENTION = {
                \"spine_02\": 0.55,
                \"spine_03\": 0.55,
                \"neck_01\": 0.70,
            }
            if spec.action_name == \"BF_LowKick_L\" and target_name in LOW_KICK_TORSO_DELTA_RETENTION:
                retention = LOW_KICK_TORSO_DELTA_RETENTION[target_name]
                delta_q = Quaternion((1.0, 0.0, 0.0, 0.0)).slerp(delta_q, retention).normalized()
            desired_q = (delta_q @ base_object_q[target_name]).normalized()
"""
if "LOW_KICK_TORSO_DELTA_RETENTION" not in mocap:
    if old not in mocap:
        raise SystemExit("mocap delta anchor missing")
    mocap = mocap.replace(old, new, 1)
    mocap_path.write_text(mocap)

test_path = Path("tests/blender-motion-foundry-v2-kicks.test.mjs")
test = test_path.read_text()
read_anchor = 'const generator = await readFile(new URL("../tools/blender/build-fight-motion-foundry-v2-kicks.py", import.meta.url), "utf8");\n'
read_insert = read_anchor + 'const mocapPrior = await readFile(new URL("../tools/blender/motion_foundry_v6_mocap.py", import.meta.url), "utf8");\n'
if "const mocapPrior" not in test:
    if read_anchor not in test:
        raise SystemExit("test read anchor missing")
    test = test.replace(read_anchor, read_insert, 1)

assert_anchor = '  assert.match(generator, /CMU_MOCAP_WORLD_DELTA_V6/);\n'
assert_insert = assert_anchor + '  assert.match(mocapPrior, /LOW_KICK_TORSO_DELTA_RETENTION/);\n'
if "assert.match(mocapPrior" not in test:
    if assert_anchor not in test:
        raise SystemExit("test assertion anchor missing")
    test = test.replace(assert_anchor, assert_insert, 1)

runtime_anchor = '  assert.match(runtime, /BLENDER_MOTION_FOUNDRY_V6_REFERENCE_KICKS/);\n'
runtime_insert = runtime_anchor + '  assert.match(runtime, /V6_ACTIVE_CONTACT_SYNC/);\n  assert.match(runtime, /BF_LowKick_L: 0\\.5333333333333333/);\n'
if "V6_ACTIVE_CONTACT_SYNC" not in test:
    if runtime_anchor not in test:
        raise SystemExit("runtime assertion anchor missing")
    test = test.replace(runtime_anchor, runtime_insert, 1)

test_path.write_text(test)
