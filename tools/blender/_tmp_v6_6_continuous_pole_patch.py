from pathlib import Path

path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
text = path.read_text()
text = text.replace('POLE_ANGLE_POLICY = "AUTO_DYNAMIC_BEND_HEMISPHERE_V6_5"', 'POLE_ANGLE_POLICY = "AUTO_CONTINUOUS_BEND_HEMISPHERE_V6_6"')

start = text.index('def _best_pole_angle_for_frame(')
end = text.index('\ndef add_kick_controls(', start)
replacement = r'''DYNAMIC_TARGET_MIN_DOT = 0.10
DYNAMIC_MAX_STEP_DEGREES = 45.0


def _wrapped_angle_delta(angle: float, reference: float) -> float:
    """Return the shortest signed angular delta to reference."""
    return _unwrap_angle_near(angle, reference) - reference


def _dynamic_score_cost(score: float | None) -> float:
    """Make anatomical correctness a hard priority before smoothness/reward."""
    if score is None:
        return 0.0
    return max(0.0, DYNAMIC_TARGET_MIN_DOT - score) * 220.0 - score * 0.24


def calibrate_dynamic_ik_pole_angle(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    ik: bpy.types.Constraint,
    source_positions,
    start_frame: int,
    end_frame: int,
    thigh_name: str,
    calf_name: str,
    foot_name: str,
    seed_angle: float,
) -> Tuple[List[Tuple[int, float]], float, float]:
    """Find a globally continuous, bend-correct pole-angle path.

    V6.5 maximized every frame independently.  Around Blender's bone-roll seam
    that produced equally valid but visually discontinuous 140-170 degree jumps.
    V6.6 evaluates the whole angle circle per frame, then uses dynamic programming
    to prefer bend-correct neighboring states.  This is build-time only; the
    result is baked to ordinary pose keys and adds zero runtime work on iPhone.
    """
    frames = list(range(start_frame, end_frame + 1))
    offsets = list(range(-180, 180, 5))
    candidates = [seed_angle + math.radians(degree) for degree in offsets]
    score_rows: List[List[float | None]] = []

    # No pole-angle fcurve exists yet, so trial values are evaluated directly.
    for frame in frames:
        row: List[float | None] = []
        for angle in candidates:
            ik.pole_angle = angle
            row.append(_evaluated_knee_bend_dot(
                scene, armature, frame, source_positions,
                thigh_name, calf_name, foot_name,
            ))
        score_rows.append(row)

    # DP cost: bend correctness dominates.  Once above the target hemisphere
    # margin, shortest wrapped transitions decide between equivalent IK branches.
    continuity_weight = 0.070
    previous_costs: List[float] = []
    backrefs: List[List[int]] = []
    for index, angle in enumerate(candidates):
        delta_deg = abs(math.degrees(_wrapped_angle_delta(angle, seed_angle)))
        previous_costs.append(
            _dynamic_score_cost(score_rows[0][index])
            + continuity_weight * (delta_deg / 30.0) ** 2
        )
    backrefs.append([-1] * len(candidates))

    for row_index in range(1, len(frames)):
        current_costs = [float('inf')] * len(candidates)
        current_back = [-1] * len(candidates)
        for current_index, current_angle in enumerate(candidates):
            anatomical = _dynamic_score_cost(score_rows[row_index][current_index])
            best_cost = float('inf')
            best_prev = 0
            for previous_index, previous_angle in enumerate(candidates):
                delta_deg = abs(math.degrees(_wrapped_angle_delta(current_angle, previous_angle)))
                transition = continuity_weight * (delta_deg / 30.0) ** 2
                cost = previous_costs[previous_index] + anatomical + transition
                if cost < best_cost:
                    best_cost = cost
                    best_prev = previous_index
            current_costs[current_index] = best_cost
            current_back[current_index] = best_prev
        previous_costs = current_costs
        backrefs.append(current_back)

    state = min(range(len(candidates)), key=lambda index: previous_costs[index])
    states = [state]
    for row_index in range(len(frames) - 1, 0, -1):
        state = backrefs[row_index][state]
        states.append(state)
    states.reverse()

    keys: List[Tuple[int, float]] = []
    previous = seed_angle
    for frame, state in zip(frames, states):
        angle = _unwrap_angle_near(candidates[state], previous)
        keys.append((frame, angle))
        previous = angle

    # Insert only after global path selection so trial values never fight fcurves.
    for frame, angle in keys:
        scene.frame_set(frame)
        ik.pole_angle = angle
        ik.keyframe_insert(data_path="pole_angle", frame=frame)
    action = armature.animation_data.action if armature.animation_data else None
    if action:
        data_path = ik.path_from_id("pole_angle")
        for fcurve in action.fcurves:
            if fcurve.data_path == data_path:
                for point in fcurve.keyframe_points:
                    point.interpolation = "LINEAR"
    bpy.context.view_layer.update()

    # The strict diagnostic is measured from the FINAL keyed curve, not trial
    # candidates.  This makes the gate describe exactly what will be baked.
    dense_scores = []
    for frame in frames:
        score = _evaluated_knee_bend_dot(
            scene, armature, frame, source_positions,
            thigh_name, calf_name, foot_name,
        )
        if score is not None:
            dense_scores.append(score)
    final_min = min(dense_scores) if dense_scores else 1.0
    max_step = max(
        (abs(math.degrees(angle - prior_angle))
         for (_, prior_angle), (_, angle) in zip(keys, keys[1:])),
        default=0.0,
    )
    return keys, final_min, max_step
'''
text = text[:start] + replacement + text[end:]

text = text.replace(
    '    support_pole_angle_keys = [(spec.start_frame, support_pole_angle)]\n',
    '    support_pole_angle_keys = [(spec.start_frame, support_pole_angle)]\n    support_pole_angle_max_step = 0.0\n',
    1,
)
text = text.replace(
    '''        support_pole_angle_keys, support_pole_calibration_min = calibrate_dynamic_ik_pole_angle(\n            scene, armature, support_ik, dense_positions, spec.start_frame, spec.end_frame,\n            s_thigh, s_calf, s_foot, support_pole_angle,\n        )\n''',
    '''        support_pole_angle_keys, support_pole_calibration_min, support_pole_angle_max_step = calibrate_dynamic_ik_pole_angle(\n            scene, armature, support_ik, dense_positions, spec.start_frame, spec.end_frame,\n            s_thigh, s_calf, s_foot, support_pole_angle,\n        )\n''',
    1,
)
text = text.replace(
    '            "supportPoleCalibrationMinDot": support_pole_calibration_min,\n',
    '            "supportPoleCalibrationMinDot": support_pole_calibration_min,\n            "supportPoleAngleMaxStepDegrees": support_pole_angle_max_step,\n',
    1,
)
path.write_text(text)

static = Path('tests/motion-foundry-v6-leg-anatomy-v62.test.mjs')
t = static.read_text()
t = t.replace('AUTO_DYNAMIC_BEND_HEMISPHERE_V6_5', 'AUTO_CONTINUOUS_BEND_HEMISPHERE_V6_6')
t = t.replace("test('V6.5 dynamically calibrates pole angle only when static knee-side preservation fails'", "test('V6.6 dynamically calibrates a continuous pole-angle path only when static preservation fails'")
t = t.replace(
    "  assert.match(kicks, /supportPoleAngleKeysDegrees/);\n",
    "  assert.match(kicks, /supportPoleAngleKeysDegrees/);\n  assert.match(kicks, /DYNAMIC_TARGET_MIN_DOT = 0\\.10/);\n  assert.match(kicks, /_wrapped_angle_delta/);\n  assert.match(kicks, /dynamic programming/);\n  assert.match(kicks, /supportPoleAngleMaxStepDegrees/);\n",
    1,
)
static.write_text(t)

contract = Path('tests/blender-motion-foundry-v2-kicks.test.mjs')
t = contract.read_text()
t = t.replace('AUTO_DYNAMIC_BEND_HEMISPHERE_V6_5', 'AUTO_CONTINUOUS_BEND_HEMISPHERE_V6_6')
t = t.replace(
    '    assert.ok(Array.isArray(move.supportPoleAngleKeysDegrees) && move.supportPoleAngleKeysDegrees.length >= 1);\n',
    '    assert.ok(Array.isArray(move.supportPoleAngleKeysDegrees) && move.supportPoleAngleKeysDegrees.length >= 1);\n    assert.ok(move.supportPoleAngleMaxStepDegrees <= 45, `${move.action} support pole step ${move.supportPoleAngleMaxStepDegrees}`);\n',
    1,
)
contract.write_text(t)
print('patched V6.6 continuous pole-angle solver and gates')
