from pathlib import Path

builder_path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
test_path = Path('tests/blender-motion-foundry-v2-kicks.test.mjs')

builder = builder_path.read_text()

old = '''def add_kick_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    spec: KickSpec,
    forward: Vector,
    left: Vector,
    up: Vector,
):'''
new = '''def add_kick_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    spec: KickSpec,
    forward: Vector,
    left: Vector,
    up: Vector,
    use_mocap_support_anchor: bool = False,
):'''
assert old in builder
builder = builder.replace(old, new, 1)

old = '''    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    support_ankle = rig.v1.pose_tail(armature, s_calf)
    support_target = rig.v1.make_control(f"{spec.action_name}_CTRL_support_foot", armature, support_ankle)
    support_target_positions = {frame: support_ankle.copy() for frame in spec.phases}
    support_knee = positions[spec.start_frame][s_calf]
    support_hip = positions[spec.start_frame][s_thigh]
    support_pole = rig.v1.make_control(
        f"{spec.action_name}_CTRL_support_knee",
        armature,
        rig.v1.chain_pole(support_hip, support_knee, support_ankle, scale=1.9),
    )
    set_anatomical_knee_pole_keys(
        support_pole,
        armature,
        positions,
        spec.phases,
        s_thigh,
        s_calf,
        s_foot,
        1.9,
        Vector((0.0, 0.0, 0.0)),
        support_target_positions,
    )
    support_calf = armature.pose.bones[s_calf]
    support_ik = support_calf.constraints.new(type="IK")
    support_ik.name = f"{spec.action_name}_SupportFootPositionLockIK"
    support_ik.target = support_target
    support_ik.pole_target = support_pole
    support_ik.chain_count = 2
    support_ik.influence = 1.0
    support_pole_angle, support_pole_calibration_min = calibrate_ik_pole_angle(
        scene, armature, support_ik, positions, spec.phases,
        s_thigh, s_calf, s_foot, None,
    )
    support_pole_angle_keys = [(spec.start_frame, support_pole_angle)]
    support_pole_angle_max_step = 0.0
    # Static pole-angle compensation is preferable when it works.  Only fall
    # back to dense dynamic calibration for chains such as Rising support where
    # Blender's correct bend solution crosses the bone-roll seam during motion.
    if support_pole_calibration_min <= 0.05:
        support_pole_angle_keys, support_pole_calibration_min, support_pole_angle_max_step = calibrate_dynamic_ik_pole_angle(
            scene, armature, support_ik, dense_positions, spec.start_frame, spec.end_frame,
            s_thigh, s_calf, s_foot, support_pole_angle,
        )
        support_pole_angle = support_pole_angle_keys[0][1]
'''
new = '''    # V6.7: the measured prior already anchors the support ankle at dense 60 Hz
    # by moving only the pelvis root. Applying a second two-bone position IK on
    # Rising forced Blender onto the opposite knee solution. Preserve the measured
    # support-leg rotations for that move and keep the old IK lock for Front/Low.
    support_controls = []
    support_constraint_policy = "MOCAP_PELVIS_ANCHOR_V6_7" if use_mocap_support_anchor else "IK_POSITION_LOCK_V6_6"
    support_pole_angle = None
    support_pole_angle_keys = []
    support_pole_calibration_min = None
    support_pole_angle_max_step = 0.0
    if not use_mocap_support_anchor:
        scene.frame_set(spec.start_frame)
        bpy.context.view_layer.update()
        support_ankle = rig.v1.pose_tail(armature, s_calf)
        support_target = rig.v1.make_control(f"{spec.action_name}_CTRL_support_foot", armature, support_ankle)
        support_target_positions = {frame: support_ankle.copy() for frame in spec.phases}
        support_knee = positions[spec.start_frame][s_calf]
        support_hip = positions[spec.start_frame][s_thigh]
        support_pole = rig.v1.make_control(
            f"{spec.action_name}_CTRL_support_knee",
            armature,
            rig.v1.chain_pole(support_hip, support_knee, support_ankle, scale=1.9),
        )
        set_anatomical_knee_pole_keys(
            support_pole,
            armature,
            positions,
            spec.phases,
            s_thigh,
            s_calf,
            s_foot,
            1.9,
            Vector((0.0, 0.0, 0.0)),
            support_target_positions,
        )
        support_calf = armature.pose.bones[s_calf]
        support_ik = support_calf.constraints.new(type="IK")
        support_ik.name = f"{spec.action_name}_SupportFootPositionLockIK"
        support_ik.target = support_target
        support_ik.pole_target = support_pole
        support_ik.chain_count = 2
        support_ik.influence = 1.0
        support_pole_angle, support_pole_calibration_min = calibrate_ik_pole_angle(
            scene, armature, support_ik, positions, spec.phases,
            s_thigh, s_calf, s_foot, None,
        )
        support_pole_angle_keys = [(spec.start_frame, support_pole_angle)]
        # Static pole-angle compensation is preferable when it works. Only fall
        # back to dense calibration on legacy support-IK moves.
        if support_pole_calibration_min <= 0.05:
            support_pole_angle_keys, support_pole_calibration_min, support_pole_angle_max_step = calibrate_dynamic_ik_pole_angle(
                scene, armature, support_ik, dense_positions, spec.start_frame, spec.end_frame,
                s_thigh, s_calf, s_foot, support_pole_angle,
            )
            support_pole_angle = support_pole_angle_keys[0][1]
        support_controls.extend([support_target, support_pole])
'''
assert old in builder
builder = builder.replace(old, new, 1)

old = '''        [strike_target, knee_pole, strike_orientation, support_target, support_pole, support_orientation],
        {
            "strikePoleAngleDegrees": math.degrees(strike_pole_angle),
            "strikePoleCalibrationMinDot": strike_pole_calibration_min,
            "supportPoleAngleDegrees": math.degrees(support_pole_angle),
            "supportPoleAngleKeysDegrees": [
                [frame, math.degrees(angle)] for frame, angle in support_pole_angle_keys
            ],
            "supportPoleCalibrationMinDot": support_pole_calibration_min,
            "supportPoleAngleMaxStepDegrees": support_pole_angle_max_step,
        },'''
new = '''        [strike_target, knee_pole, strike_orientation, *support_controls, support_orientation],
        {
            "strikePoleAngleDegrees": math.degrees(strike_pole_angle),
            "strikePoleCalibrationMinDot": strike_pole_calibration_min,
            "supportConstraintPolicy": support_constraint_policy,
            "supportPoleAngleDegrees": None if support_pole_angle is None else math.degrees(support_pole_angle),
            "supportPoleAngleKeysDegrees": [
                [frame, math.degrees(angle)] for frame, angle in support_pole_angle_keys
            ],
            "supportPoleCalibrationMinDot": support_pole_calibration_min,
            "supportPoleAngleMaxStepDegrees": support_pole_angle_max_step,
        },'''
assert old in builder
builder = builder.replace(old, new, 1)

old = '''    mocap_path = mocap_paths.get(spec.action_name)
    mocap_meta = None
    if mocap_path:
        reference, mocap_meta = mocap_v6.build_mocap_prior(scene, armature, spec, mocap_path, axes)'''
new = '''    mocap_path = mocap_paths.get(spec.action_name)
    mocap_meta = None
    mocap_support_anchor_before = None
    mocap_support_anchor_after = None
    if mocap_path:
        reference, mocap_meta = mocap_v6.build_mocap_prior(scene, armature, spec, mocap_path, axes)
        mocap_support_anchor_before = float(reference.get("cmu_support_anchor_before", 0.0))
        mocap_support_anchor_after = float(reference.get("cmu_support_anchor_after", 0.0))'''
assert old in builder
builder = builder.replace(old, new, 1)

builder = builder.replace(
    'pelvis_forward=tuple(value * 0.22 for value in spec.pelvis_forward),',
    'pelvis_forward=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.22) for value in spec.pelvis_forward),',
    1,
)
builder = builder.replace(
    'pelvis_drop=tuple(value * 0.22 for value in spec.pelvis_drop),',
    'pelvis_drop=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.22) for value in spec.pelvis_drop),',
    1,
)
builder = builder.replace(
    'pelvis_yaw=tuple(value * 0.12 for value in spec.pelvis_yaw),',
    'pelvis_yaw=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.12) for value in spec.pelvis_yaw),',
    1,
)
builder = builder.replace(
    'pelvis_pitch=tuple(value * 0.12 for value in spec.pelvis_pitch),',
    'pelvis_pitch=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.12) for value in spec.pelvis_pitch),',
    1,
)

old = '    controls, pole_calibration = add_kick_controls(scene, armature, base, spec, *axes)'
new = '''    use_mocap_support_anchor = mocap_meta is not None and spec.action_name == "BF_RisingKick_R"
    controls, pole_calibration = add_kick_controls(
        scene, armature, base, spec, *axes,
        use_mocap_support_anchor=use_mocap_support_anchor,
    )'''
assert old in builder
builder = builder.replace(old, new, 1)

old = '''        "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6" if mocap_meta is not None else "UAL2_AUTHORED_REFERENCE_V6",
        **(mocap_meta.as_dict() if mocap_meta is not None else {}),'''
new = '''        "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6" if mocap_meta is not None else "UAL2_AUTHORED_REFERENCE_V6",
        "mocapSupportAnchorBefore": mocap_support_anchor_before,
        "mocapSupportAnchorAfter": mocap_support_anchor_after,
        **(mocap_meta.as_dict() if mocap_meta is not None else {}),'''
assert old in builder
builder = builder.replace(old, new, 1)

builder_path.write_text(builder)

test_src = test_path.read_text()
test_src = test_src.replace(
    '  assert.match(generator, /SupportFootPositionLockIK/);',
    '  assert.match(generator, /SupportFootPositionLockIK/);\n  assert.match(generator, /MOCAP_PELVIS_ANCHOR_V6_7/);',
    1,
)
old = '''    assert.ok(Number.isFinite(move.strikePoleAngleDegrees));
    assert.ok(Number.isFinite(move.supportPoleAngleDegrees));
    assert.ok(Array.isArray(move.supportPoleAngleKeysDegrees) && move.supportPoleAngleKeysDegrees.length >= 1);
    assert.ok(move.supportPoleAngleMaxStepDegrees <= 45, `${move.action} support pole step ${move.supportPoleAngleMaxStepDegrees}`);
    assert.ok(move.strikePoleCalibrationMinDot > 0.05, `${move.action} strike pole calibration ${move.strikePoleCalibrationMinDot}`);
    assert.ok(move.supportPoleCalibrationMinDot > 0.05, `${move.action} support pole calibration ${move.supportPoleCalibrationMinDot}`);'''
new = '''    assert.ok(Number.isFinite(move.strikePoleAngleDegrees));
    assert.ok(move.strikePoleCalibrationMinDot > 0.05, `${move.action} strike pole calibration ${move.strikePoleCalibrationMinDot}`);
    if (move.supportConstraintPolicy === "MOCAP_PELVIS_ANCHOR_V6_7") {
      assert.equal(move.action, "BF_RisingKick_R");
      assert.equal(move.supportPoleAngleDegrees, null);
      assert.deepEqual(move.supportPoleAngleKeysDegrees, []);
      assert.equal(move.supportPoleCalibrationMinDot, null);
      assert.ok(move.mocapSupportAnchorAfter < 0.001, `${move.action} prior anchor ${move.mocapSupportAnchorAfter}`);
    } else {
      assert.equal(move.supportConstraintPolicy, "IK_POSITION_LOCK_V6_6");
      assert.ok(Number.isFinite(move.supportPoleAngleDegrees));
      assert.ok(Array.isArray(move.supportPoleAngleKeysDegrees) && move.supportPoleAngleKeysDegrees.length >= 1);
      assert.ok(move.supportPoleAngleMaxStepDegrees <= 45, `${move.action} support pole step ${move.supportPoleAngleMaxStepDegrees}`);
      assert.ok(move.supportPoleCalibrationMinDot > 0.05, `${move.action} support pole calibration ${move.supportPoleCalibrationMinDot}`);
    }'''
assert old in test_src
test_src = test_src.replace(old, new, 1)

test_path.write_text(test_src)
print('V6_7_ANCHOR_SUPPORT_PATCH_OK')
