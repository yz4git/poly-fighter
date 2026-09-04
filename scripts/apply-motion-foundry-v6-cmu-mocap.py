#!/usr/bin/env python3
"""Integrate the CMU martial-arts mocap prior into the V6 kick generator."""
from pathlib import Path

path = Path("tools/blender/build-fight-motion-foundry-v2-kicks.py")
text = path.read_text()


def once(old: str, new: str) -> None:
    global text
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing patch anchor: {old[:120]!r}")
    text = text.replace(old, new, 1)


once(
    "import motion_foundry_v2_rig as rig\n",
    "import motion_foundry_v2_rig as rig\nimport motion_foundry_v6_mocap as mocap_v6\n",
)

anchor = "    return knots, reference_impact_u, max(0.0, min(1.0, prior_score))\n\n\n"
helper = anchor + '''def reference_knots_for_impact(spec: KickSpec, reference_impact_u: float):\n    """Build a nonlinear source-time map around a measured impact event."""\n    reference_impact_u = max(0.18, min(0.82, reference_impact_u))\n    def du(frame: int) -> float:\n        return (frame - spec.start_frame) / max(1, spec.end_frame - spec.start_frame)\n    src_load = max(0.0, reference_impact_u - 0.30)\n    src_pre = max(src_load + 0.02, reference_impact_u - 0.085)\n    src_over = min(1.0, reference_impact_u + 0.075)\n    src_recovery = min(1.0, reference_impact_u + 0.31)\n    return (\n        (0.0, 0.0),\n        (du(spec.load_frame), src_load),\n        (du(spec.precontact_frame), src_pre),\n        (du(spec.impact_frame), reference_impact_u),\n        (du(spec.overtravel_frame), src_over),\n        (du(spec.recovery_frame), src_recovery),\n        (1.0, 1.0),\n    )\n\n\n'''
once(anchor, helper)

old_build = '''def build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes):\n    # Reference-driven V6: the full-body authored motion is primary.\n    # IK is only a contact-window constraint layered over that motion prior.\n    reference = choose_reference_action(spec)\n    spec = replace(spec, source_action_hint=reference.name)\n    rig.configure_v1_for_spec(spec)\n    ensure_kick_bones(armature, spec)\n    reference_knots, reference_impact_u, reference_prior_score = derive_reference_knots(\n        scene, armature, reference, spec, axes[2]\n    )\n    spec = replace(spec, source_knots=reference_knots)\n'''
new_build = '''def build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes, mocap_paths):\n    # Reference-driven V6: measured full-body human motion is primary.  The\n    # existing procedural rig is demoted to gameplay contact/support constraints.\n    mocap_path = mocap_paths.get(spec.action_name)\n    mocap_meta = None\n    if mocap_path:\n        reference, mocap_meta = mocap_v6.build_mocap_prior(scene, armature, spec, mocap_path, axes)\n        # The mocap already contains weight transfer and counter-rotation.  Keep\n        # only a small fraction of legacy master offsets to avoid double-driving.\n        spec = replace(\n            spec,\n            source_action_hint=reference.name,\n            pelvis_forward=tuple(value * 0.22 for value in spec.pelvis_forward),\n            pelvis_drop=tuple(value * 0.22 for value in spec.pelvis_drop),\n            pelvis_yaw=tuple(value * 0.12 for value in spec.pelvis_yaw),\n            lower_yaw=tuple(value * 0.10 for value in spec.lower_yaw),\n            upper_yaw=tuple(value * 0.10 for value in spec.upper_yaw),\n            pelvis_pitch=tuple(value * 0.12 for value in spec.pelvis_pitch),\n            lower_pitch=tuple(value * 0.10 for value in spec.lower_pitch),\n            upper_pitch=tuple(value * 0.10 for value in spec.upper_pitch),\n        )\n    else:\n        reference = choose_reference_action(spec)\n        spec = replace(spec, source_action_hint=reference.name)\n    rig.configure_v1_for_spec(spec)\n    ensure_kick_bones(armature, spec)\n    if mocap_meta is not None:\n        reference_impact_u = mocap_meta.impact_normalized_time\n        reference_prior_score = mocap_meta.activity_score\n        reference_knots = reference_knots_for_impact(spec, reference_impact_u)\n    else:\n        reference_knots, reference_impact_u, reference_prior_score = derive_reference_knots(\n            scene, armature, reference, spec, axes[2]\n        )\n    spec = replace(spec, source_knots=reference_knots)\n'''
once(old_build, new_build)

once(
    '        "contactIKPolicy": "IMPACT_WINDOW_ONLY",\n        "fps": rig.FPS,',
    '        "contactIKPolicy": "IMPACT_WINDOW_ONLY",\n        "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6" if mocap_meta is not None else "UAL2_AUTHORED_REFERENCE_V6",\n        **(mocap_meta.as_dict() if mocap_meta is not None else {}),\n        "fps": rig.FPS,',
)

once(
    '            f"full-body authored reference base: {source_name}",',
    '            (f"measured CMU mocap full-body prior: {mocap_meta.source_file}" if mocap_meta is not None else f"full-body authored reference base: {source_name}"),',
)

once(
    '    parser.add_argument("--reference-source", required=True)\n    parser.add_argument("--output-dir", required=True)',
    '    parser.add_argument("--reference-source")\n    parser.add_argument("--mocap-front")\n    parser.add_argument("--mocap-low")\n    parser.add_argument("--mocap-rising")\n    parser.add_argument("--output-dir", required=True)',
)

once(
    '    imported_reference_actions = import_reference_actions(args.reference_source)\n    print("MOTION_FOUNDRY_V6_REFERENCE_ACTIONS", imported_reference_actions)\n    axes = body_axes(scene, armature)\n    actions, moves = [], []\n    for spec in KICK_SPECS:\n        action, metrics = build_kick_action(scene, armature, spec, axes)',
    '    imported_reference_actions = []\n    if args.reference_source:\n        imported_reference_actions = import_reference_actions(args.reference_source)\n        print("MOTION_FOUNDRY_V6_REFERENCE_ACTIONS", imported_reference_actions)\n    axes = body_axes(scene, armature)\n    mocap_paths = {\n        "BF_FrontKick_R": args.mocap_front,\n        "BF_LowKick_L": args.mocap_low,\n        "BF_RisingKick_R": args.mocap_rising,\n    }\n    actions, moves = [], []\n    for spec in KICK_SPECS:\n        action, metrics = build_kick_action(scene, armature, spec, axes, mocap_paths)',
)

once(
    '        "referencePoseMethod": "FULL_BODY_REFERENCE_V6",\n        "fps": rig.FPS,',
    '        "referencePoseMethod": "FULL_BODY_REFERENCE_V6",\n        "motionPriorProvider": ("CMU_MOCAP_WORLD_DELTA_V6" if all(mocap_paths.values()) else "HYBRID_REFERENCE_V6"),\n        "fps": rig.FPS,',
)

path.write_text(text)

# Strengthen the contract test: the shipping V6 must be measured-mocap-driven.
test = Path("tests/blender-motion-foundry-v2-kicks.test.mjs")
t = test.read_text()
t = t.replace(
    'assert.match(generator, /derive_reference_knots/);',
    'assert.match(generator, /derive_reference_knots/);\n  assert.match(generator, /motion_foundry_v6_mocap/);\n  assert.match(generator, /CMU_MOCAP_WORLD_DELTA_V6/);',
)
t = t.replace(
    'assert.equal(metrics.naturalnessPass, "REFERENCE_DRIVEN_V6");',
    'assert.equal(metrics.naturalnessPass, "REFERENCE_DRIVEN_V6");\n  assert.equal(metrics.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");',
    1,
)
t = t.replace(
    'assert.equal(move.contactIKPolicy, "IMPACT_WINDOW_ONLY");',
    'assert.equal(move.contactIKPolicy, "IMPACT_WINDOW_ONLY");\n    assert.equal(move.motionPriorProvider, "CMU_MOCAP_WORLD_DELTA_V6");\n    assert.match(move.mocapSourceFile, /^135_(04|07|11)\\.bvh$/);\n    assert.ok(move.mocapSampleCount >= 20);',
    1,
)
test.write_text(t)

# Keep a small provenance/usage-rights note next to the architecture document.
doc = Path("docs/MOTION_FOUNDRY_V6_REFERENCE_DRIVEN.md")
d = doc.read_text()
if "CMU Motion Capture" not in d:
    d += '''\n## Measured martial-arts prior\n\nThe shipping V6 bootstrap uses measured motions from the Carnegie Mellon Graphics Lab Motion Capture Database, subject 135: trial 04 `Front Kick`, trial 07 `Mawashigeri`, and trial 11 `Yokogeri`. The CMU site permits copying, modification, redistribution and commercial use; the Bruce Hahne BVH conversion adds no further restrictions. The build pins the public `una-dinosauria/cmu-mocap` mirror by commit.\n\nThe source BVH is build-time input only. Motion Foundry crops the strongest kick event, transfers full-body world-space rotation deltas into the universal game rig, mirrors anatomically when the measured strike side differs from the gameplay side, then bakes ordinary 60 Hz glTF clips.\n'''
    doc.write_text(d)
