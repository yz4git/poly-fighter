from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()

old = '''def key_orientation(control: bpy.types.Object, base: Matrix, frame: int, pitch_deg: float, yaw_deg: float) -> None:\n    loc, rot, scale = base.decompose()\n    yaw = Quaternion(Vector((0.0, 0.0, 1.0)), math.radians(yaw_deg))\n    pitch = Quaternion(Vector((1.0, 0.0, 0.0)), math.radians(pitch_deg))\n    rig.key_matrix(control, frame, Matrix.LocRotScale(loc, yaw @ pitch @ rot, scale))\n\n\nKNEE_POLE_POLICY = "ANIMATED_MEASURED_KNEE_PLANE_V6_1"\n'''
new = '''def key_orientation(\n    control: bpy.types.Object,\n    base: Matrix,\n    frame: int,\n    pitch_deg: float,\n    yaw_deg: float,\n    pitch_axis: Vector | None = None,\n    yaw_axis: Vector | None = None,\n) -> None:\n    """Key foot orientation around the fighter's anatomical axes, not world X."""\n    loc, rot, scale = base.decompose()\n    p_axis = (pitch_axis or Vector((1.0, 0.0, 0.0))).normalized()\n    y_axis = (yaw_axis or Vector((0.0, 0.0, 1.0))).normalized()\n    yaw = Quaternion(y_axis, math.radians(yaw_deg))\n    pitch = Quaternion(p_axis, math.radians(pitch_deg))\n    rig.key_matrix(control, frame, Matrix.LocRotScale(loc, yaw @ pitch @ rot, scale))\n\n\nKNEE_POLE_POLICY = "ANIMATED_MEASURED_KNEE_PLANE_V6_2"\nFOOT_ORIENTATION_POLICY = "ANATOMICAL_BODY_AXES_V6_2"\n'''
if old not in text:
    raise SystemExit('key_orientation anchor not found')
text = text.replace(old, new, 1)

old = '''        if direction.length > 1e-6:\n            previous_direction = direction.normalized()\n        pole += bias\n        keys.append((frame, pole))\n'''
new = '''        if direction.length > 1e-6:\n            previous_direction = direction.normalized()\n\n        # Legacy fixed pole bias could overpower the measured knee plane on\n        # roundhouse/rising kicks. Keep only a small component perpendicular\n        # to the hip-ankle chain and never let it push against the measured\n        # bend hemisphere.\n        safe_bias = bias.copy()\n        chain_axis = ankle - hip\n        if chain_axis.length > 1e-6:\n            axis = chain_axis.normalized()\n            safe_bias -= axis * safe_bias.dot(axis)\n        if direction.length > 1e-6 and safe_bias.dot(direction) < 0.0:\n            d = direction.normalized()\n            safe_bias -= d * safe_bias.dot(d)\n        max_bias = min(0.045, max(0.015, direction.length * 0.12))\n        if safe_bias.length > max_bias:\n            safe_bias.normalize()\n            safe_bias *= max_bias\n        pole += safe_bias\n        keys.append((frame, pole))\n'''
if old not in text:
    raise SystemExit('pole bias anchor not found')
text = text.replace(old, new, 1)

old = '''        key_orientation(strike_orientation, strike_foot_world, frame, pitch, yaw * side_sign)\n'''
new = '''        key_orientation(\n            strike_orientation, strike_foot_world, frame, pitch, yaw * side_sign,\n            pitch_axis=left, yaw_axis=up,\n        )\n'''
if old not in text:
    raise SystemExit('strike orientation call anchor not found')
text = text.replace(old, new, 1)

old = '''        key_orientation(support_orientation, support_world, frame, 0.0, yaw)\n'''
new = '''        key_orientation(\n            support_orientation, support_world, frame, 0.0, yaw,\n            pitch_axis=left, yaw_axis=up,\n        )\n'''
if old not in text:
    raise SystemExit('support orientation call anchor not found')
text = text.replace(old, new, 1)

anchor = '''def build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes, mocap_paths):\n'''
helper = '''def knee_plane_min_dot(reference_positions, final_positions, frames, thigh_name: str, calf_name: str, foot_name: str) -> float:\n    """Return minimum source-vs-final bend-plane dot; negative means a knee flip."""\n    dots = []\n    for frame in frames:\n        r_hip = reference_positions[frame][thigh_name]\n        r_knee = reference_positions[frame][calf_name]\n        r_ankle = reference_positions[frame][foot_name]\n        f_hip = final_positions[frame][thigh_name]\n        f_knee = final_positions[frame][calf_name]\n        f_ankle = final_positions[frame][foot_name]\n        r_normal = (r_knee - r_hip).cross(r_ankle - r_knee)\n        f_normal = (f_knee - f_hip).cross(f_ankle - f_knee)\n        # Near full extension has an unstable plane; skip those samples.\n        if r_normal.length < 1e-4 or f_normal.length < 1e-4:\n            continue\n        dots.append(r_normal.normalized().dot(f_normal.normalized()))\n    return min(dots) if dots else 1.0\n\n\n'''
if anchor not in text:
    raise SystemExit('build_kick_action anchor not found')
text = text.replace(anchor, helper + anchor, 1)

old = '''    base = rig.v1.key_pose_basis(scene, armature, f"{spec.action_name}_BASE", samples)\n    armature.animation_data.action = base\n\n    strike_world = armature.matrix_world.to_3x3() @ axes[0]\n'''
new = '''    base = rig.v1.key_pose_basis(scene, armature, f"{spec.action_name}_BASE", samples)\n    armature.animation_data.action = base\n    leg_names = (\n        f"thigh_{spec.strike_suffix}", f"calf_{spec.strike_suffix}", f"foot_{spec.strike_suffix}",\n        f"thigh_{spec.support_suffix}", f"calf_{spec.support_suffix}", f"foot_{spec.support_suffix}",\n    )\n    reference_leg_positions = rig.v1.evaluated_positions(scene, armature, spec.phases, leg_names)\n\n    strike_world = armature.matrix_world.to_3x3() @ axes[0]\n'''
if old not in text:
    raise SystemExit('baseline positions anchor not found')
text = text.replace(old, new, 1)

old = '''    final_action.use_fake_user = True\n    armature.animation_data.action = final_action\n    reference_poses = reference_pose_snapshots(scene, armature, spec, axes[0], axes[2])\n    rig.v1.remove_controls([*controls, *guards, *masters])\n    metrics = {\n'''
new = '''    final_action.use_fake_user = True\n    armature.animation_data.action = final_action\n    final_leg_positions = rig.v1.evaluated_positions(scene, armature, spec.phases, leg_names)\n    strike_knee_plane_min_dot = knee_plane_min_dot(\n        reference_leg_positions, final_leg_positions, spec.phases[1:-1],\n        f"thigh_{spec.strike_suffix}", f"calf_{spec.strike_suffix}", f"foot_{spec.strike_suffix}",\n    )\n    support_knee_plane_min_dot = knee_plane_min_dot(\n        reference_leg_positions, final_leg_positions, spec.phases[1:-1],\n        f"thigh_{spec.support_suffix}", f"calf_{spec.support_suffix}", f"foot_{spec.support_suffix}",\n    )\n    reference_poses = reference_pose_snapshots(scene, armature, spec, axes[0], axes[2])\n    rig.v1.remove_controls([*controls, *guards, *masters])\n    metrics = {\n'''
if old not in text:
    raise SystemExit('final positions anchor not found')
text = text.replace(old, new, 1)

old = '''        "contactIKPolicy": "IMPACT_WINDOW_ONLY",\n        "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6" if mocap_meta is not None else "UAL2_AUTHORED_REFERENCE_V6",\n'''
new = '''        "contactIKPolicy": "IMPACT_WINDOW_ONLY",\n        "kneePolePolicy": KNEE_POLE_POLICY,\n        "footOrientationPolicy": FOOT_ORIENTATION_POLICY,\n        "strikeKneePlaneMinDot": strike_knee_plane_min_dot,\n        "supportKneePlaneMinDot": support_knee_plane_min_dot,\n        "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6" if mocap_meta is not None else "UAL2_AUTHORED_REFERENCE_V6",\n'''
if old not in text:
    raise SystemExit('metrics policy anchor not found')
text = text.replace(old, new, 1)

old = '''            "move-specific strike-foot orientation",\n'''
new = '''            "move-specific strike-foot orientation around anatomical body axes",\n            "measured knee bend-plane hemisphere preservation",\n'''
if old not in text:
    raise SystemExit('pipeline anchor not found')
text = text.replace(old, new, 1)

path.write_text(text)
print('patched', path)
