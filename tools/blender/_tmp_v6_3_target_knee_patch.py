from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()

text = text.replace(
    'KNEE_POLE_POLICY = "ANIMATED_MEASURED_KNEE_PLANE_V6_2"',
    'KNEE_POLE_POLICY = "ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3"',
    1,
)

old = '''def set_anatomical_knee_pole_keys(\n    control: bpy.types.Object,\n    armature: bpy.types.Object,\n    positions,\n    frames: Sequence[int],\n    thigh_name: str,\n    calf_name: str,\n    foot_name: str,\n    scale: float,\n    bias: Vector,\n) -> None:\n    """Animate an IK pole from the measured knee plane for every authored phase.\n\n    A single world-space pole is incorrect for a roundhouse/rising kick because\n    the pelvis and support leg rotate through the strike.  Following the measured\n    hip-knee-ankle plane keeps the knee on the human side of the chain.  A\n    hemisphere continuity guard prevents an almost-straight leg from flipping the\n    pole 180 degrees between adjacent phases.\n    """\n    keys = []\n    previous_direction = None\n    for frame in frames:\n        hip = positions[frame][thigh_name]\n        knee = positions[frame][calf_name]\n        ankle = positions[frame][foot_name]\n        pole = rig.v1.chain_pole(hip, knee, ankle, scale=scale)\n        direction = pole - knee\n        if direction.length < 1e-6:\n            direction = previous_direction.copy() if previous_direction is not None else Vector((0.0, 1.0, 0.0))\n        if previous_direction is not None and direction.dot(previous_direction) < 0.0:\n            pole = knee - direction\n            direction.negate()\n        if direction.length > 1e-6:\n            previous_direction = direction.normalized()\n\n        # Legacy fixed pole bias could overpower the measured knee plane on\n        # roundhouse/rising kicks. Keep only a small component perpendicular\n        # to the hip-ankle chain and never let it push against the measured\n        # bend hemisphere.\n        safe_bias = bias.copy()\n        chain_axis = ankle - hip\n        if chain_axis.length > 1e-6:\n            axis = chain_axis.normalized()\n            safe_bias -= axis * safe_bias.dot(axis)\n        if direction.length > 1e-6 and safe_bias.dot(direction) < 0.0:\n            d = direction.normalized()\n            safe_bias -= d * safe_bias.dot(d)\n        max_bias = min(0.045, max(0.015, direction.length * 0.12))\n        if safe_bias.length > max_bias:\n            safe_bias.normalize()\n            safe_bias *= max_bias\n        pole += safe_bias\n        keys.append((frame, pole))\n    rig.v1.set_control_keys(control, armature, keys)\n    rig.smooth_control_curves(control)\n'''
new = '''def _knee_bend_offset(hip: Vector, knee: Vector, ankle: Vector) -> Tuple[Vector, float]:\n    """Return the knee's perpendicular offset from the hip-ankle axis and its axial ratio."""\n    axis = ankle - hip\n    if axis.length_squared < 1e-8:\n        return Vector((0.0, 0.0, 0.0)), 0.5\n    ratio = max(0.0, min(1.0, (knee - hip).dot(axis) / axis.length_squared))\n    on_axis = hip + axis * ratio\n    return knee - on_axis, ratio\n\n\ndef _project_bend_to_target_chain(\n    hip: Vector,\n    knee: Vector,\n    source_ankle: Vector,\n    target_ankle: Vector,\n    previous_direction: Vector | None,\n) -> Tuple[Vector, float]:\n    """Transplant the measured knee side onto the actual IK hip->target-ankle chain."""\n    source_bend, ratio = _knee_bend_offset(hip, knee, source_ankle)\n    target_axis = target_ankle - hip\n    if target_axis.length_squared < 1e-8:\n        fallback = previous_direction.copy() if previous_direction is not None else source_bend.copy()\n        return fallback, ratio\n    axis = target_axis.normalized()\n    bend = source_bend - axis * source_bend.dot(axis)\n    if bend.length < 1e-5:\n        source_axis = source_ankle - hip\n        source_normal = source_axis.cross(knee - hip)\n        if source_normal.length > 1e-5:\n            bend = source_normal.normalized().cross(axis)\n            if source_bend.length > 1e-5 and bend.dot(source_bend) < 0.0:\n                bend.negate()\n    if bend.length < 1e-5 and previous_direction is not None:\n        bend = previous_direction - axis * previous_direction.dot(axis)\n    if bend.length < 1e-5:\n        bend = Vector((0.0, 1.0, 0.0)) - axis * axis.y\n    return bend, ratio\n\n\ndef set_anatomical_knee_pole_keys(\n    control: bpy.types.Object,\n    armature: bpy.types.Object,\n    positions,\n    frames: Sequence[int],\n    thigh_name: str,\n    calf_name: str,\n    foot_name: str,\n    scale: float,\n    bias: Vector,\n    target_ankles=None,\n) -> None:\n    """Animate a target-aware pole that preserves the measured knee bend hemisphere."""\n    keys = []\n    previous_direction = None\n    for frame in frames:\n        hip = positions[frame][thigh_name]\n        knee = positions[frame][calf_name]\n        source_ankle = positions[frame][foot_name]\n        target_ankle = (target_ankles or {}).get(frame, source_ankle)\n        bend, ratio = _project_bend_to_target_chain(\n            hip, knee, source_ankle, target_ankle, previous_direction\n        )\n        if bend.length < 1e-6:\n            bend = previous_direction.copy() if previous_direction is not None else Vector((0.0, 1.0, 0.0))\n        direction = bend.normalized()\n        previous_direction = direction.copy()\n        target_axis = target_ankle - hip\n        on_axis = hip + target_axis * ratio\n        source_upper = (knee - hip).length\n        source_lower = (source_ankle - knee).length\n        pole_distance = max(0.18, (source_upper + source_lower) * scale)\n        pole = on_axis + direction * pole_distance\n\n        # Keep legacy styling bias only when it supports the same anatomical side.\n        safe_bias = bias.copy()\n        if target_axis.length > 1e-6:\n            axis = target_axis.normalized()\n            safe_bias -= axis * safe_bias.dot(axis)\n        if safe_bias.dot(direction) < 0.0:\n            safe_bias -= direction * safe_bias.dot(direction)\n        if safe_bias.length > 0.035:\n            safe_bias.normalize()\n            safe_bias *= 0.035\n        pole += safe_bias\n        keys.append((frame, pole))\n    rig.v1.set_control_keys(control, armature, keys)\n    rig.smooth_control_curves(control)\n'''
if old not in text:
    raise SystemExit('V6.2 pole function anchor not found')
text = text.replace(old, new, 1)

old = '''    rig.v1.set_control_keys(strike_target, armature, keys)\n\n    pole_forward, pole_lateral, pole_up = spec.knee_pole_bias\n'''
new = '''    rig.v1.set_control_keys(strike_target, armature, keys)\n    strike_target_positions = {frame: target.copy() for frame, target in keys}\n\n    pole_forward, pole_lateral, pole_up = spec.knee_pole_bias\n'''
if old not in text:
    raise SystemExit('strike target positions anchor not found')
text = text.replace(old, new, 1)

old = '''        spec.knee_pole_scale,\n        strike_pole_bias,\n    )\n'''
new = '''        spec.knee_pole_scale,\n        strike_pole_bias,\n        strike_target_positions,\n    )\n'''
if old not in text:
    raise SystemExit('strike pole call anchor not found')
text = text.replace(old, new, 1)

old = '''    support_target = rig.v1.make_control(f"{spec.action_name}_CTRL_support_foot", armature, support_ankle)\n    support_knee = positions[spec.start_frame][s_calf]\n'''
new = '''    support_target = rig.v1.make_control(f"{spec.action_name}_CTRL_support_foot", armature, support_ankle)\n    support_target_positions = {frame: support_ankle.copy() for frame in spec.phases}\n    support_knee = positions[spec.start_frame][s_calf]\n'''
if old not in text:
    raise SystemExit('support target positions anchor not found')
text = text.replace(old, new, 1)

old = '''        1.9,\n        Vector((0.0, 0.0, 0.0)),\n    )\n'''
new = '''        1.9,\n        Vector((0.0, 0.0, 0.0)),\n        support_target_positions,\n    )\n'''
if old not in text:
    raise SystemExit('support pole call anchor not found')
text = text.replace(old, new, 1)

old = '''def knee_plane_min_dot(reference_positions, final_positions, frames, thigh_name: str, calf_name: str, foot_name: str) -> float:\n    """Return minimum source-vs-final bend-plane dot; negative means a knee flip."""\n    dots = []\n    for frame in frames:\n        r_hip = reference_positions[frame][thigh_name]\n        r_knee = reference_positions[frame][calf_name]\n        r_ankle = reference_positions[frame][foot_name]\n        f_hip = final_positions[frame][thigh_name]\n        f_knee = final_positions[frame][calf_name]\n        f_ankle = final_positions[frame][foot_name]\n        r_normal = (r_knee - r_hip).cross(r_ankle - r_knee)\n        f_normal = (f_knee - f_hip).cross(f_ankle - f_knee)\n        # Near full extension has an unstable plane; skip those samples.\n        if r_normal.length < 1e-4 or f_normal.length < 1e-4:\n            continue\n        dots.append(r_normal.normalized().dot(f_normal.normalized()))\n    return min(dots) if dots else 1.0\n'''
new = '''def knee_plane_min_dot(reference_positions, final_positions, frames, thigh_name: str, calf_name: str, foot_name: str) -> float:\n    """Return minimum target-chain bend-side dot; negative means an anatomical knee flip."""\n    dots = []\n    previous_desired = None\n    for frame in frames:\n        r_hip = reference_positions[frame][thigh_name]\n        r_knee = reference_positions[frame][calf_name]\n        r_ankle = reference_positions[frame][foot_name]\n        f_hip = final_positions[frame][thigh_name]\n        f_knee = final_positions[frame][calf_name]\n        f_ankle = final_positions[frame][foot_name]\n        desired, _ = _project_bend_to_target_chain(\n            r_hip, r_knee, r_ankle, f_ankle, previous_desired\n        )\n        final_bend, _ = _knee_bend_offset(f_hip, f_knee, f_ankle)\n        if desired.length < 1e-4 or final_bend.length < 1e-4:\n            continue\n        desired.normalize()\n        final_bend.normalize()\n        previous_desired = desired.copy()\n        dots.append(desired.dot(final_bend))\n    return min(dots) if dots else 1.0\n'''
if old not in text:
    raise SystemExit('knee metric anchor not found')
text = text.replace(old, new, 1)

path.write_text(text)

# Update static regression expectations to the target-aware policy.
for test_path in [
    Path('tests/motion-foundry-v6-leg-anatomy.test.mjs'),
    Path('tests/motion-foundry-v6-leg-anatomy-v62.test.mjs'),
]:
    t = test_path.read_text()
    t = t.replace('ANIMATED_MEASURED_KNEE_PLANE_V6_2', 'ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3')
    test_path.write_text(t)

# Add a generated-metrics gate. It deliberately fails against the current V6.2 GLB
# until V6.3 is regenerated, preventing negative knee hemispheres from shipping.
contract = Path('tests/blender-motion-foundry-v2-kicks.test.mjs')
t = contract.read_text()
needle = '''    assert.equal(move.contactIKPolicy, "IMPACT_WINDOW_ONLY");\n    assert.equal(move.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");\n'''
replacement = '''    assert.equal(move.contactIKPolicy, "IMPACT_WINDOW_ONLY");\n    assert.equal(move.kneePolePolicy, "ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3");\n    assert.equal(move.footOrientationPolicy, "ANATOMICAL_BODY_AXES_V6_2");\n    assert.ok(move.strikeKneePlaneMinDot > 0.05, `${move.action} strike knee plane ${move.strikeKneePlaneMinDot}`);\n    assert.ok(move.supportKneePlaneMinDot > 0.05, `${move.action} support knee plane ${move.supportKneePlaneMinDot}`);\n    assert.equal(move.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");\n'''
if needle not in t:
    raise SystemExit('contract insertion anchor not found')
t = t.replace(needle, replacement, 1)
contract.write_text(t)
print('patched V6.3 target-aware knees')
