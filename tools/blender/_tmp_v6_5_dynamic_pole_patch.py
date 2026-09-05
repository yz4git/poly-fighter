from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()

text = text.replace(
    'POLE_ANGLE_POLICY = "AUTO_ROBUST_BEND_HEMISPHERE_V6_4"',
    'POLE_ANGLE_POLICY = "AUTO_DYNAMIC_BEND_HEMISPHERE_V6_5"',
    1,
)

anchor = '''def add_kick_controls(\n    scene: bpy.types.Scene,\n'''
helper = '''def _unwrap_angle_near(angle: float, reference: float) -> float:\n    while angle - reference > math.pi:\n        angle -= math.tau\n    while angle - reference < -math.pi:\n        angle += math.tau\n    return angle\n\n\ndef _best_pole_angle_for_frame(\n    scene: bpy.types.Scene,\n    armature: bpy.types.Object,\n    ik: bpy.types.Constraint,\n    source_positions,\n    frame: int,\n    thigh_name: str,\n    calf_name: str,\n    foot_name: str,\n    seed_angle: float,\n) -> Tuple[float, float]:\n    """Find the bend-correct pole angle for one frame, preferring continuity."""\n    best_angle = seed_angle\n    best_score = -2.0\n\n    # Full-circle coarse search is deterministic and avoids assuming rig bone roll.\n    for degree_offset in range(-180, 180, 10):\n        angle = seed_angle + math.radians(degree_offset)\n        ik.pole_angle = angle\n        score = _evaluated_knee_bend_dot(\n            scene, armature, frame, source_positions, thigh_name, calf_name, foot_name\n        )\n        if score is not None and score > best_score:\n            best_score = score\n            best_angle = angle\n\n    # One-degree local refinement around the best coarse solution.\n    coarse = best_angle\n    for degree_offset in range(-10, 11):\n        angle = coarse + math.radians(degree_offset)\n        ik.pole_angle = angle\n        score = _evaluated_knee_bend_dot(\n            scene, armature, frame, source_positions, thigh_name, calf_name, foot_name\n        )\n        if score is not None and score > best_score:\n            best_score = score\n            best_angle = angle\n\n    return _unwrap_angle_near(best_angle, seed_angle), best_score\n\n\ndef calibrate_dynamic_ik_pole_angle(\n    scene: bpy.types.Scene,\n    armature: bpy.types.Object,\n    ik: bpy.types.Constraint,\n    source_positions,\n    start_frame: int,\n    end_frame: int,\n    thigh_name: str,\n    calf_name: str,\n    foot_name: str,\n    seed_angle: float,\n) -> Tuple[List[Tuple[int, float]], float]:\n    """Key pole_angle every frame when a static solution cannot preserve knee side.\n\n    The final animation is still baked to ordinary pose keys.  This solver only\n    runs offline in Blender and therefore adds no runtime work on iPhone.\n    """\n    keys: List[Tuple[int, float]] = []\n    previous = seed_angle\n    minimum = 1.0\n    for frame in range(start_frame, end_frame + 1):\n        angle, score = _best_pole_angle_for_frame(\n            scene, armature, ik, source_positions, frame,\n            thigh_name, calf_name, foot_name, previous,\n        )\n        if score <= -1.5:\n            # Near-straight/degenerate frame: retain the previous continuous angle.\n            angle = previous\n        else:\n            minimum = min(minimum, score)\n        keys.append((frame, angle))\n        previous = angle\n\n    # Insert only after all searches so animation evaluation cannot override trial values.\n    for frame, angle in keys:\n        scene.frame_set(frame)\n        ik.pole_angle = angle\n        ik.keyframe_insert(data_path="pole_angle", frame=frame)\n    action = armature.animation_data.action if armature.animation_data else None\n    if action:\n        data_path = ik.path_from_id("pole_angle")\n        for fcurve in action.fcurves:\n            if fcurve.data_path == data_path:\n                for point in fcurve.keyframe_points:\n                    point.interpolation = "LINEAR"\n    bpy.context.view_layer.update()\n\n    # Re-evaluate the keyed curve densely; this is the value used by the strict gate.\n    dense_scores = []\n    for frame in range(start_frame, end_frame + 1):\n        score = _evaluated_knee_bend_dot(\n            scene, armature, frame, source_positions, thigh_name, calf_name, foot_name\n        )\n        if score is not None:\n            dense_scores.append(score)\n    return keys, (min(dense_scores) if dense_scores else minimum)\n\n\n'''
if anchor not in text:
    raise SystemExit('add_kick_controls anchor not found')
text = text.replace(anchor, helper + anchor, 1)

old = '''    support_pole_angle, support_pole_calibration_min = calibrate_ik_pole_angle(\n        scene, armature, support_ik, positions, spec.phases,\n        s_thigh, s_calf, s_foot, None,\n    )\n\n    support_world = rig.pose_world_matrix(armature, s_foot)\n'''
new = '''    support_pole_angle, support_pole_calibration_min = calibrate_ik_pole_angle(\n        scene, armature, support_ik, positions, spec.phases,\n        s_thigh, s_calf, s_foot, None,\n    )\n    support_pole_angle_keys = [(spec.start_frame, support_pole_angle)]\n    # Static pole-angle compensation is preferable when it works.  Only fall\n    # back to dense dynamic calibration for chains such as Rising support where\n    # Blender's correct bend solution crosses the bone-roll seam during motion.\n    if support_pole_calibration_min <= 0.05:\n        support_pole_angle_keys, support_pole_calibration_min = calibrate_dynamic_ik_pole_angle(\n            scene, armature, support_ik, positions, spec.start_frame, spec.end_frame,\n            s_thigh, s_calf, s_foot, support_pole_angle,\n        )\n        support_pole_angle = support_pole_angle_keys[0][1]\n\n    support_world = rig.pose_world_matrix(armature, s_foot)\n'''
if old not in text:
    raise SystemExit('support calibration anchor not found')
text = text.replace(old, new, 1)

old = '''            "supportPoleAngleDegrees": math.degrees(support_pole_angle),\n            "supportPoleCalibrationMinDot": support_pole_calibration_min,\n'''
new = '''            "supportPoleAngleDegrees": math.degrees(support_pole_angle),\n            "supportPoleAngleKeysDegrees": [\n                [frame, math.degrees(angle)] for frame, angle in support_pole_angle_keys\n            ],\n            "supportPoleCalibrationMinDot": support_pole_calibration_min,\n'''
if old not in text:
    raise SystemExit('support metrics anchor not found')
text = text.replace(old, new, 1)

# Fix quaternion sign/wrap in pivot metrics: 342° is physically the same as -18°.
anchor = '''def support_angle(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:\n'''
helper = '''def _shortest_quaternion_angle_degrees(start: Quaternion, current: Quaternion) -> float:\n    angle = start.rotation_difference(current).angle\n    angle = angle % math.tau\n    if angle > math.pi:\n        angle = math.tau - angle\n    return math.degrees(abs(angle))\n\n\n'''
if anchor not in text:
    raise SystemExit('support_angle anchor not found')
text = text.replace(anchor, helper + anchor, 1)
text = text.replace(
    'maximum = max(maximum, math.degrees(start.rotation_difference(current).angle))',
    'maximum = max(maximum, _shortest_quaternion_angle_degrees(start, current))',
    1,
)
text = text.replace(
    '"supportFootPivotDegrees": math.degrees(start_support_q.rotation_difference(support_q).angle),',
    '"supportFootPivotDegrees": _shortest_quaternion_angle_degrees(start_support_q, support_q),',
    1,
)

# Pipeline description.
text = text.replace(
    '"automatic Blender IK pole-angle calibration against evaluated bend hemisphere",',
    '"automatic Blender IK pole-angle calibration with dense dynamic fallback",',
    1,
)

# Update strict generated-asset contract.
contract = Path('tests/blender-motion-foundry-v2-kicks.test.mjs')
t = contract.read_text()
t = t.replace(
    'assert.equal(move.poleAnglePolicy, "AUTO_ROBUST_BEND_HEMISPHERE_V6_4");',
    'assert.equal(move.poleAnglePolicy, "AUTO_DYNAMIC_BEND_HEMISPHERE_V6_5");',
)
needle = '''    assert.ok(Number.isFinite(move.supportPoleAngleDegrees));\n    assert.ok(move.strikePoleCalibrationMinDot > 0.05, `${move.action} strike pole calibration ${move.strikePoleCalibrationMinDot}`);\n'''
replacement = '''    assert.ok(Number.isFinite(move.supportPoleAngleDegrees));\n    assert.ok(Array.isArray(move.supportPoleAngleKeysDegrees) && move.supportPoleAngleKeysDegrees.length >= 1);\n    assert.ok(move.strikePoleCalibrationMinDot > 0.05, `${move.action} strike pole calibration ${move.strikePoleCalibrationMinDot}`);\n'''
if needle not in t:
    raise SystemExit('contract key-array anchor not found')
t = t.replace(needle, replacement, 1)
contract.write_text(t)

# Update static regression and add explicit dynamic/shortest-angle checks.
static = Path('tests/motion-foundry-v6-leg-anatomy-v62.test.mjs')
t = static.read_text().replace('AUTO_ROBUST_BEND_HEMISPHERE_V6_4', 'AUTO_DYNAMIC_BEND_HEMISPHERE_V6_5')
extra = '''\ntest('V6.5 dynamically calibrates pole angle only when static knee-side preservation fails', () => {\n  assert.match(kicks, /calibrate_dynamic_ik_pole_angle/);\n  assert.match(kicks, /support_pole_calibration_min <= 0\\.05/);\n  assert.match(kicks, /keyframe_insert\\(data_path="pole_angle", frame=frame\\)/);\n  assert.match(kicks, /point\\.interpolation = "LINEAR"/);\n  assert.match(kicks, /supportPoleAngleKeysDegrees/);\n});\n\ntest('support-foot pivot uses shortest quaternion angle instead of 360-degree wrap', () => {\n  assert.match(kicks, /_shortest_quaternion_angle_degrees/);\n  assert.match(kicks, /if angle > math\\.pi:/);\n  assert.match(kicks, /angle = math\\.tau - angle/);\n});\n'''
if 'V6.5 dynamically calibrates pole angle' not in t:
    t += extra
static.write_text(t)

path.write_text(text)
print('patched V6.5 dynamic pole calibration and shortest pivot angle')
