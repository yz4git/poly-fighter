#!/usr/bin/env python3
from pathlib import Path

mocap_path = Path('tools/blender/motion_foundry_v6_mocap.py')
mocap = mocap_path.read_text()

anchor = '''def _anchor_support_foot(\n    scene: bpy.types.Scene,\n'''
settle = '''def _smoothstep(value: float) -> float:\n    value = max(0.0, min(1.0, value))\n    return value * value * (3.0 - 2.0 * value)\n\n\ndef _settle_to_guard(\n    scene: bpy.types.Scene,\n    target: bpy.types.Object,\n    action: bpy.types.Action,\n    base_basis: Mapping[str, Matrix],\n    sample_count: int,\n    settle_start_u: float = 0.72,\n) -> None:\n    \"\"\"Blend the measured clip back into the authored fighting guard.\n\n    Raw mocap often finishes with a step after the kick. That is correct for the\n    capture but wrong for a reusable fighting-game attack clip. Preserve the\n    measured anticipation/contact/follow-through, then smoothly return every\n    target bone to the authored idle/guard basis in the final quarter. A support\n    anchor pass runs afterwards, so this cleanup cannot reintroduce foot slide.\n    \"\"\"\n    target.animation_data.action = action\n    start_frame = max(2, int(math.floor((sample_count - 1) * settle_start_u)) + 1)\n    span = max(1, sample_count - start_frame)\n    for frame in range(start_frame, sample_count + 1):\n        _set_frame(scene, float(frame))\n        blend = _smoothstep((frame - start_frame) / span)\n        for pb in target.pose.bones:\n            base = base_basis.get(pb.name)\n            if base is None:\n                continue\n            current_loc, current_rot, current_scale = pb.matrix_basis.decompose()\n            base_loc, base_rot, base_scale = base.decompose()\n            loc = current_loc.lerp(base_loc, blend)\n            rot = current_rot.slerp(base_rot, blend)\n            scale = current_scale.lerp(base_scale, blend)\n            pb.matrix_basis = Matrix.LocRotScale(loc, rot, scale)\n            pb.keyframe_insert(data_path=\"location\", frame=frame, group=pb.name)\n            pb.keyframe_insert(data_path=\"rotation_quaternion\", frame=frame, group=pb.name)\n            pb.keyframe_insert(data_path=\"scale\", frame=frame, group=pb.name)\n        bpy.context.view_layer.update()\n\n\n'''
if 'def _settle_to_guard(' not in mocap:
    if anchor not in mocap:
        raise SystemExit('anchor insertion point missing')
    mocap = mocap.replace(anchor, settle + anchor, 1)

old_call = '''    support_side = "L" if target_side == "R" else "R"\n    anchor_before, anchor_after = _anchor_support_foot(\n        scene, target, action, support_side, sample_count\n    )\n'''
new_call = '''    # A fighting-game attack must reconnect to locomotion/idle without a visible\n    # pop. Keep measured motion through follow-through, then settle to guard and\n    # finally re-anchor the planted foot in world space.\n    _settle_to_guard(scene, target, action, base_basis, sample_count)\n    support_side = "L" if target_side == "R" else "R"\n    anchor_before, anchor_after = _anchor_support_foot(\n        scene, target, action, support_side, sample_count\n    )\n'''
if '_settle_to_guard(scene, target, action, base_basis, sample_count)' not in mocap:
    if old_call not in mocap:
        raise SystemExit('anchor call point missing')
    mocap = mocap.replace(old_call, new_call, 1)

mocap_path.write_text(mocap)

gen_path = Path('tools/blender/build-fight-motion-foundry-v2-kicks.py')
gen = gen_path.read_text()
old = '''            upper_pitch=tuple(value * 0.10 for value in spec.upper_pitch),\n        )\n'''
new = '''            upper_pitch=tuple(value * 0.10 for value in spec.upper_pitch),\n            # Mocap remains the primary motion. These narrow controls only make\n            # the combat-readable chamber and high guard survive retargeting.\n            ik_influences=(\n                spec.ik_influences[0],\n                max(spec.ik_influences[1], 0.52),\n                max(spec.ik_influences[2], 0.62),\n                spec.ik_influences[3],\n                spec.ik_influences[4],\n                spec.ik_influences[5],\n                spec.ik_influences[6],\n            ),\n            guard_influences=(\n                spec.guard_influences[0],\n                max(spec.guard_influences[1], 0.52),\n                max(spec.guard_influences[2], 0.78),\n                max(spec.guard_influences[3], 0.90),\n                max(spec.guard_influences[4], 0.82),\n                max(spec.guard_influences[5], 0.46),\n                spec.guard_influences[6],\n            ),\n            guard_height=max(spec.guard_height, 0.245),\n            guard_forward=min(spec.guard_forward, 0.095),\n        )\n'''
if 'guard_height=max(spec.guard_height, 0.245)' not in gen:
    if old not in gen:
        raise SystemExit('V6 replace block missing')
    gen = gen.replace(old, new, 1)
gen_path.write_text(gen)
