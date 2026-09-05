from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()

anchor = 'FOOT_ORIENTATION_POLICY = "ANATOMICAL_BODY_AXES_V6_2"\n'
if anchor not in text:
    raise SystemExit('policy anchor not found')
text = text.replace(anchor, anchor + 'POLE_ANGLE_POLICY = "AUTO_ROBUST_BEND_HEMISPHERE_V6_4"\n', 1)

anchor = '''def add_kick_controls(\n    scene: bpy.types.Scene,\n'''
helper = '''def _evaluated_knee_bend_dot(\n    scene: bpy.types.Scene,\n    armature: bpy.types.Object,\n    frame: int,\n    source_positions,\n    thigh_name: str,\n    calf_name: str,\n    foot_name: str,\n) -> float | None:\n    """Score the evaluated constrained knee against the measured bend hemisphere."""\n    rig.v1.set_scene_frame(scene, frame)\n    hip = rig.v1.pose_head(armature, thigh_name)\n    knee = rig.v1.pose_head(armature, calf_name)\n    ankle = rig.v1.pose_head(armature, foot_name)\n    source_hip = source_positions[frame][thigh_name]\n    source_knee = source_positions[frame][calf_name]\n    source_ankle = source_positions[frame][foot_name]\n    desired, _ = _project_bend_to_target_chain(\n        source_hip, source_knee, source_ankle, ankle, None\n    )\n    actual, _ = _knee_bend_offset(hip, knee, ankle)\n    # Near full extension has no stable bend side and should not dominate calibration.\n    if desired.length < 1e-4 or actual.length < 0.012:\n        return None\n    return desired.normalized().dot(actual.normalized())\n\n\ndef calibrate_ik_pole_angle(\n    scene: bpy.types.Scene,\n    armature: bpy.types.Object,\n    ik: bpy.types.Constraint,\n    source_positions,\n    frames: Sequence[int],\n    thigh_name: str,\n    calf_name: str,\n    foot_name: str,\n    influences: Sequence[float] | None = None,\n) -> Tuple[float, float]:\n    """Choose a static pole angle that maximizes the worst anatomical bend score.\n\n    Blender's pole target still needs pole_angle compensation for arbitrary bone\n    roll.  Searching the small scalar angle is deterministic, build-time only, and\n    lets the final evaluated chain decide instead of assuming left/right roll.\n    """\n    active = []\n    for index, frame in enumerate(frames):\n        influence = 1.0 if influences is None else influences[index]\n        if influence >= 0.55:\n            active.append(frame)\n    if not active:\n        active = list(frames[1:-1])\n\n    candidates = [math.radians(deg) for deg in range(-180, 180, 10)]\n    best_angle = 0.0\n    best_objective = -999.0\n    best_min = -1.0\n    for angle in candidates:\n        ik.pole_angle = angle\n        scores = []\n        for frame in active:\n            score = _evaluated_knee_bend_dot(\n                scene, armature, frame, source_positions, thigh_name, calf_name, foot_name\n            )\n            if score is not None:\n                scores.append(score)\n        if not scores:\n            continue\n        robust_min = min(scores)\n        mean = sum(scores) / len(scores)\n        # Worst-frame correctness dominates; mean only breaks ties.\n        objective = robust_min * 10.0 + mean\n        if objective > best_objective:\n            best_objective = objective\n            best_angle = angle\n            best_min = robust_min\n\n    # Refine ±10 degrees around the coarse optimum at one-degree resolution.\n    coarse = best_angle\n    for degree_offset in range(-10, 11):\n        angle = coarse + math.radians(degree_offset)\n        ik.pole_angle = angle\n        scores = []\n        for frame in active:\n            score = _evaluated_knee_bend_dot(\n                scene, armature, frame, source_positions, thigh_name, calf_name, foot_name\n            )\n            if score is not None:\n                scores.append(score)\n        if not scores:\n            continue\n        robust_min = min(scores)\n        mean = sum(scores) / len(scores)\n        objective = robust_min * 10.0 + mean\n        if objective > best_objective:\n            best_objective = objective\n            best_angle = angle\n            best_min = robust_min\n\n    ik.pole_angle = best_angle\n    bpy.context.view_layer.update()\n    return best_angle, best_min\n\n\n'''
if anchor not in text:
    raise SystemExit('add_kick_controls anchor not found')
text = text.replace(anchor, helper + anchor, 1)

old = '''    for frame, influence in zip(spec.phases, spec.ik_influences):\n        strike_ik.influence = influence\n        strike_ik.keyframe_insert(data_path="influence", frame=frame)\n\n    strike_foot_world = rig.pose_world_matrix(armature, foot_name)\n'''
new = '''    for frame, influence in zip(spec.phases, spec.ik_influences):\n        strike_ik.influence = influence\n        strike_ik.keyframe_insert(data_path="influence", frame=frame)\n    strike_pole_angle, strike_pole_calibration_min = calibrate_ik_pole_angle(\n        scene, armature, strike_ik, positions, spec.phases,\n        thigh_name, calf_name, foot_name, spec.ik_influences,\n    )\n\n    strike_foot_world = rig.pose_world_matrix(armature, foot_name)\n'''
if old not in text:
    raise SystemExit('strike calibration anchor not found')
text = text.replace(old, new, 1)

old = '''    support_ik.pole_target = support_pole\n    support_ik.chain_count = 2\n    support_ik.influence = 1.0\n\n    support_world = rig.pose_world_matrix(armature, s_foot)\n'''
new = '''    support_ik.pole_target = support_pole\n    support_ik.chain_count = 2\n    support_ik.influence = 1.0\n    support_pole_angle, support_pole_calibration_min = calibrate_ik_pole_angle(\n        scene, armature, support_ik, positions, spec.phases,\n        s_thigh, s_calf, s_foot, None,\n    )\n\n    support_world = rig.pose_world_matrix(armature, s_foot)\n'''
if old not in text:
    raise SystemExit('support calibration anchor not found')
text = text.replace(old, new, 1)

old = '''    return [strike_target, knee_pole, strike_orientation, support_target, support_pole, support_orientation]\n'''
new = '''    return (\n        [strike_target, knee_pole, strike_orientation, support_target, support_pole, support_orientation],\n        {\n            "strikePoleAngleDegrees": math.degrees(strike_pole_angle),\n            "strikePoleCalibrationMinDot": strike_pole_calibration_min,\n            "supportPoleAngleDegrees": math.degrees(support_pole_angle),\n            "supportPoleCalibrationMinDot": support_pole_calibration_min,\n        },\n    )\n'''
if old not in text:
    raise SystemExit('controls return anchor not found')
text = text.replace(old, new, 1)

old = '''    controls = add_kick_controls(scene, armature, base, spec, *axes)\n    guards = add_guard_controls(scene, armature, base, spec, *axes)\n'''
new = '''    controls, pole_calibration = add_kick_controls(scene, armature, base, spec, *axes)\n    guards = add_guard_controls(scene, armature, base, spec, *axes)\n'''
if old not in text:
    raise SystemExit('build controls anchor not found')
text = text.replace(old, new, 1)

old = '''        "footOrientationPolicy": FOOT_ORIENTATION_POLICY,\n        "strikeKneePlaneMinDot": strike_knee_plane_min_dot,\n'''
new = '''        "footOrientationPolicy": FOOT_ORIENTATION_POLICY,\n        "poleAnglePolicy": POLE_ANGLE_POLICY,\n        **pole_calibration,\n        "strikeKneePlaneMinDot": strike_knee_plane_min_dot,\n'''
if old not in text:
    raise SystemExit('metrics insertion anchor not found')
text = text.replace(old, new, 1)

old = '''            "measured knee bend-plane hemisphere preservation",\n'''
new = '''            "measured knee bend-plane hemisphere preservation",\n            "automatic Blender IK pole-angle calibration against evaluated bend hemisphere",\n'''
if old not in text:
    raise SystemExit('pipeline insertion anchor not found')
text = text.replace(old, new, 1)

# Harden contract and static regression around the pole-angle calibration policy.
contract = Path('tests/blender-motion-foundry-v2-kicks.test.mjs')
t = contract.read_text()
needle = '''    assert.equal(move.footOrientationPolicy, "ANATOMICAL_BODY_AXES_V6_2");\n    assert.ok(move.strikeKneePlaneMinDot > 0.05, `${move.action} strike knee plane ${move.strikeKneePlaneMinDot}`);\n'''
replacement = '''    assert.equal(move.footOrientationPolicy, "ANATOMICAL_BODY_AXES_V6_2");\n    assert.equal(move.poleAnglePolicy, "AUTO_ROBUST_BEND_HEMISPHERE_V6_4");\n    assert.ok(Number.isFinite(move.strikePoleAngleDegrees));\n    assert.ok(Number.isFinite(move.supportPoleAngleDegrees));\n    assert.ok(move.strikePoleCalibrationMinDot > 0.05, `${move.action} strike pole calibration ${move.strikePoleCalibrationMinDot}`);\n    assert.ok(move.supportPoleCalibrationMinDot > 0.05, `${move.action} support pole calibration ${move.supportPoleCalibrationMinDot}`);\n    assert.ok(move.strikeKneePlaneMinDot > 0.05, `${move.action} strike knee plane ${move.strikeKneePlaneMinDot}`);\n'''
if needle not in t:
    raise SystemExit('contract V6.4 anchor not found')
contract.write_text(t.replace(needle, replacement, 1))

static = Path('tests/motion-foundry-v6-leg-anatomy-v62.test.mjs')
t = static.read_text()
insert = '''\ntest('V6.4 calibrates Blender IK pole angle from evaluated anatomical bend scores', () => {\n  assert.match(kicks, /AUTO_ROBUST_BEND_HEMISPHERE_V6_4/);\n  assert.match(kicks, /calibrate_ik_pole_angle/);\n  assert.match(kicks, /robust_min \* 10\\.0 \+ mean/);\n  assert.match(kicks, /strikePoleCalibrationMinDot/);\n  assert.match(kicks, /supportPoleCalibrationMinDot/);\n});\n'''
if 'V6.4 calibrates Blender IK pole angle' not in t:
    t += insert
static.write_text(t)

path.write_text(text)
print('patched V6.4 pole angle calibration')
