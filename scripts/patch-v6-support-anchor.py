#!/usr/bin/env python3
from pathlib import Path

path = Path('tools/blender/motion_foundry_v6_mocap.py')
text = path.read_text()

anchor = '''def _source_leg_length(source: bpy.types.Object, side: str) -> float:\n    prefix = "Left" if side == "L" else "Right"\n    return max(1e-4, source.data.bones[f"{prefix}UpLeg"].length + source.data.bones[f"{prefix}Leg"].length)\n\n\n'''
insert = anchor + '''def _anchor_support_foot(\n    scene: bpy.types.Scene,\n    target: bpy.types.Object,\n    action: bpy.types.Action,\n    support_side: str,\n    sample_count: int,\n) -> Tuple[float, float]:\n    """Remove retarget root drift while preserving measured joint rotations.\n\n    CMU root translation and a different target leg proportion can make an\n    otherwise measured kick require the planted leg to stretch beyond its\n    reachable sphere.  For every dense 60 Hz prior sample, move only the pelvis\n    root by the inverse support-ankle drift.  Descendant rotations stay exactly\n    as retargeted, so weight transfer/counter-rotation remain measured motion.\n    """\n    suffix = support_side.lower()\n    calf_name = f"calf_{suffix}"\n    if calf_name not in target.pose.bones:\n        raise RuntimeError(f"Support calf missing for V6 anchor: {calf_name}")\n    target.animation_data.action = action\n    _set_frame(scene, 1.0)\n    anchor_ankle = target.pose.bones[calf_name].tail.copy()\n    pelvis = target.pose.bones["pelvis"]\n    before = 0.0\n    for frame in range(1, sample_count + 1):\n        _set_frame(scene, float(frame))\n        ankle = target.pose.bones[calf_name].tail.copy()\n        drift = ankle - anchor_ankle\n        before = max(before, drift.length)\n        pelvis_matrix = pelvis.matrix.copy()\n        pelvis_matrix.translation -= drift\n        pelvis.matrix = pelvis_matrix\n        bpy.context.view_layer.update()\n        pelvis.keyframe_insert(data_path="location", frame=frame, group="pelvis")\n        pelvis.keyframe_insert(data_path="rotation_quaternion", frame=frame, group="pelvis")\n        pelvis.keyframe_insert(data_path="scale", frame=frame, group="pelvis")\n\n    # Source time-warp samples subframes. Dense linear root interpolation avoids\n    # Bezier overshoot reintroducing foot drift between the 60 Hz anchor samples.\n    pelvis_path = 'pose.bones["pelvis"].location'\n    for curve in action.fcurves:\n        if curve.data_path == pelvis_path:\n            for key in curve.keyframe_points:\n                key.interpolation = "LINEAR"\n\n    after = 0.0\n    for frame in range(1, sample_count + 1):\n        _set_frame(scene, float(frame))\n        after = max(after, (target.pose.bones[calf_name].tail - anchor_ankle).length)\n    return before, after\n\n\n'''
if '_anchor_support_foot(' not in text:
    if anchor not in text:
        raise SystemExit('support anchor insertion point missing')
    text = text.replace(anchor, insert, 1)

old = '''    for curve in action.fcurves:\n        for key in curve.keyframe_points:\n            key.interpolation = "BEZIER"\n            key.handle_left_type = "AUTO_CLAMPED"\n            key.handle_right_type = "AUTO_CLAMPED"\n\n    action.use_fake_user = True\n'''
new = '''    for curve in action.fcurves:\n        for key in curve.keyframe_points:\n            key.interpolation = "BEZIER"\n            key.handle_left_type = "AUTO_CLAMPED"\n            key.handle_right_type = "AUTO_CLAMPED"\n\n    support_side = "L" if target_side == "R" else "R"\n    anchor_before, anchor_after = _anchor_support_foot(\n        scene, target, action, support_side, sample_count\n    )\n\n    action.use_fake_user = True\n'''
if 'anchor_before, anchor_after = _anchor_support_foot' not in text:
    if old not in text:
        raise SystemExit('support anchor call point missing')
    text = text.replace(old, new, 1)

old_props = '''    action["cmu_impact_u"] = impact_u\n    action["cmu_activity_score"] = activity\n'''
new_props = '''    action["cmu_impact_u"] = impact_u\n    action["cmu_activity_score"] = activity\n    action["cmu_support_anchor_before"] = anchor_before\n    action["cmu_support_anchor_after"] = anchor_after\n'''
if 'cmu_support_anchor_before' not in text:
    if old_props not in text:
        raise SystemExit('support anchor metadata point missing')
    text = text.replace(old_props, new_props, 1)

# Include root-anchor quality in exported metadata without expanding the immutable dataclass.
old_meta = '''    meta = MocapPriorMeta(\n        source_file=Path(bvh_path).name,\n'''
new_meta = '''    meta = MocapPriorMeta(\n        source_file=Path(bvh_path).name,\n'''
# Dataclass stays stable; generator can read action custom props if needed.

path.write_text(text)
