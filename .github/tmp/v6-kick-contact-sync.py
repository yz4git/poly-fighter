from pathlib import Path

mocap_path = Path("tools/blender/motion_foundry_v6_mocap.py")
mocap = mocap_path.read_text()

if "RISING_KICK_TORSO_DELTA_RETENTION" not in mocap:
    raise SystemExit("rising torso retention anchor missing")
mocap = mocap.replace('"spine_01": 0.20,\n                "spine_02": 0.18,\n                "spine_03": 0.25,\n                "neck_01": 0.45,',
                      '"spine_01": 0.17,\n                "spine_02": 0.15,\n                "spine_03": 0.25,\n                "neck_01": 0.45,', 1)
if '"spine_01": 0.17' not in mocap or '"spine_02": 0.15' not in mocap:
    raise SystemExit("final rising torso retention values not materialized")
mocap_path.write_text(mocap)

test_path = Path("tests/blender-motion-foundry-v2-kicks.test.mjs")
test = test_path.read_text()
test = test.replace('/spine_01\\": 0\\.20/', '/spine_01\\": 0\\.17/')
test = test.replace('/spine_02\\": 0\\.18/', '/spine_02\\": 0\\.15/')
if 'spine_01\\": 0\\.17' not in test or 'spine_02\\": 0\\.15' not in test:
    raise SystemExit("rising torso contract values not materialized")
test_path.write_text(test)
