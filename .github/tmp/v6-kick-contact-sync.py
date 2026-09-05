from pathlib import Path

mocap_path = Path("tools/blender/motion_foundry_v6_mocap.py")
mocap = mocap_path.read_text()

low_block = '''            LOW_KICK_TORSO_DELTA_RETENTION = {
                "spine_02": 0.30,
                "spine_03": 0.30,
                "neck_01": 0.70,
            }
            if spec.action_name == "BF_LowKick_L" and target_name in LOW_KICK_TORSO_DELTA_RETENTION:
                retention = LOW_KICK_TORSO_DELTA_RETENTION[target_name]
                delta_q = Quaternion((1.0, 0.0, 0.0, 0.0)).slerp(delta_q, retention).normalized()
'''
expanded_block = '''            LOW_KICK_TORSO_DELTA_RETENTION = {
                "spine_02": 0.30,
                "spine_03": 0.30,
                "neck_01": 0.70,
            }
            # The measured rising/side kick contains an extreme upper-body fold when
            # transferred through the UAL rest delta. Preserve pelvis lift and the
            # complete leg motion, while keeping only the useful torso counter-balance.
            RISING_KICK_TORSO_DELTA_RETENTION = {
                "spine_01": 0.30,
                "spine_02": 0.25,
                "spine_03": 0.25,
                "neck_01": 0.45,
            }
            retention_map = None
            if spec.action_name == "BF_LowKick_L":
                retention_map = LOW_KICK_TORSO_DELTA_RETENTION
            elif spec.action_name == "BF_RisingKick_R":
                retention_map = RISING_KICK_TORSO_DELTA_RETENTION
            if retention_map is not None and target_name in retention_map:
                retention = retention_map[target_name]
                delta_q = Quaternion((1.0, 0.0, 0.0, 0.0)).slerp(delta_q, retention).normalized()
'''
if "RISING_KICK_TORSO_DELTA_RETENTION" not in mocap:
    if low_block not in mocap:
        raise SystemExit("low torso retention anchor missing")
    mocap = mocap.replace(low_block, expanded_block, 1)
mocap_path.write_text(mocap)

test_path = Path("tests/blender-motion-foundry-v2-kicks.test.mjs")
test = test_path.read_text()
anchor = '  assert.match(mocapPrior, /LOW_KICK_TORSO_DELTA_RETENTION/);\n'
insert = anchor + '  assert.match(mocapPrior, /RISING_KICK_TORSO_DELTA_RETENTION/);\n  assert.match(mocapPrior, /spine_01\\": 0\\.30/);\n  assert.match(mocapPrior, /neck_01\\": 0\\.45/);\n'
if "RISING_KICK_TORSO_DELTA_RETENTION" not in test:
    if anchor not in test:
        raise SystemExit("mocap contract assertion anchor missing")
    test = test.replace(anchor, insert, 1)
test_path.write_text(test)
