#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


generator_path = Path("tools/blender/build-fight-motion-foundry-v2-kicks.py")
test_path = Path("tests/blender-motion-foundry-v2-kicks.test.mjs")

generator = generator_path.read_text()

generator = replace_once(
    generator,
    """    guard_height: float = 0.155\n""",
    """    guard_height: float = 0.155\n    reach_ratios: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)\n    reach_directions: PhaseOffsets = ((0.0, 0.0, 0.0),) * 7\n""",
    "KickSpec hip-relative reach fields",
)

generator = replace_once(
    generator,
    """    upper_pitch=(0.0, 1.0, 2.0, 3.0, 3.0, 1.0, 0.0),\n)\n\nLOW_KICK""",
    """    upper_pitch=(0.0, 1.0, 2.0, 3.0, 3.0, 1.0, 0.0),\n    reach_ratios=(0.0, 0.0, 0.90, 0.975, 0.982, 0.0, 0.0),\n    reach_directions=(\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n        (0.88, 0.0, 0.48),\n        (0.89, 0.0, 0.46),\n        (0.91, 0.0, 0.42),\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n    ),\n)\n\nLOW_KICK""",
    "Front hip-relative reach spec",
)

generator = replace_once(
    generator,
    """    upper_pitch=(0.0, 2.0, 5.0, 8.0, 9.0, 2.0, 0.0),\n    guard_height=0.165,\n)""",
    """    upper_pitch=(0.0, 2.0, 5.0, 8.0, 9.0, 2.0, 0.0),\n    guard_height=0.165,\n    reach_ratios=(0.0, 0.0, 0.88, 0.970, 0.978, 0.0, 0.0),\n    reach_directions=(\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n        (0.70, 0.0, 0.72),\n        (0.73, 0.0, 0.68),\n        (0.76, 0.0, 0.65),\n        (0.0, 0.0, 0.0),\n        (0.0, 0.0, 0.0),\n    ),\n)""",
    "Rising hip-relative reach spec",
)

old_keys = """    keys = []\n    side_sign = 1.0 if strike == \"l\" else -1.0\n    for frame, (fwd, lateral, vertical) in zip(spec.phases, spec.foot_offsets):\n        offset = forward * fwd + left * (lateral * side_sign) + up * vertical\n        keys.append((frame, strike_ankle + offset))\n    rig.v1.set_control_keys(strike_target, armature, keys)\n"""
new_keys = """    keys = []\n    side_sign = 1.0 if strike == \"l\" else -1.0\n    start_hip = positions[spec.start_frame][thigh_name]\n    start_knee = positions[spec.start_frame][calf_name]\n    start_foot = positions[spec.start_frame][foot_name]\n    upper_leg_length = (start_hip - start_knee).length\n    lower_leg_length = (start_knee - start_foot).length\n    leg_length = upper_leg_length + lower_leg_length\n    if leg_length < 1e-4:\n        raise RuntimeError(f\"{spec.action_name}: strike leg did not provide a usable authored length\")\n    for frame, (fwd, lateral, vertical), reach_ratio, reach_direction in zip(\n        spec.phases, spec.foot_offsets, spec.reach_ratios, spec.reach_directions\n    ):\n        if reach_ratio > 0.0:\n            dir_fwd, dir_lateral, dir_up = reach_direction\n            direction = forward * dir_fwd + left * (dir_lateral * side_sign) + up * dir_up\n            if direction.length < 1e-4:\n                raise RuntimeError(f\"{spec.action_name}: hip-relative reach direction is degenerate at frame {frame}\")\n            direction.normalize()\n            target = positions[frame][thigh_name] + direction * (leg_length * reach_ratio)\n        else:\n            offset = forward * fwd + left * (lateral * side_sign) + up * vertical\n            target = strike_ankle + offset\n        keys.append((frame, target))\n    rig.v1.set_control_keys(strike_target, armature, keys)\n"""
generator = replace_once(generator, old_keys, new_keys, "hip-relative strike target construction")

reach_metric = '''\n\ndef strike_leg_reach_ratio(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:\n    """Measure hip-to-ankle reach against the authored two-bone leg length at impact."""\n    thigh = f"thigh_{spec.strike_suffix}"\n    calf = f"calf_{spec.strike_suffix}"\n    foot = f"foot_{spec.strike_suffix}"\n    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()\n    start_hip = rig.v1.pose_head(armature, thigh)\n    start_knee = rig.v1.pose_head(armature, calf)\n    start_ankle = rig.v1.pose_head(armature, foot)\n    leg_length = (start_hip - start_knee).length + (start_knee - start_ankle).length\n    if leg_length < 1e-6:\n        return 0.0\n    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()\n    hip = rig.v1.pose_head(armature, thigh)\n    ankle = rig.v1.pose_head(armature, foot)\n    return (hip - ankle).length / leg_length\n'''
generator = replace_once(
    generator,
    "\n\ndef guard_distance(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:\n",
    reach_metric + "\n\ndef guard_distance(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:\n",
    "strike leg reach metric",
)

generator = replace_once(
    generator,
    '        "constrainedStrikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),\n',
    '        "constrainedStrikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),\n        "constrainedStrikeLegReachRatio": strike_leg_reach_ratio(scene, armature, spec),\n',
    "constrained reach ratio metric",
)
generator = replace_once(
    generator,
    '        "strikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),\n',
    '        "strikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),\n        "strikeLegReachRatio": strike_leg_reach_ratio(scene, armature, spec),\n',
    "baked reach ratio metric",
)
generator = replace_once(
    generator,
    '            "impact knee-extension quality gate",\n',
    '            "hip-relative impact reach from authored leg length",\n            "impact knee-extension quality gate",\n',
    "pipeline reach description",
)

generator_path.write_text(generator)

test_source = test_path.read_text()
test_source = replace_once(
    test_source,
    "  assert.match(generator, /strikeKneeExtensionDegrees/);\n",
    "  assert.match(generator, /strikeKneeExtensionDegrees/);\n  assert.match(generator, /strikeLegReachRatio/);\n  assert.match(generator, /hip-relative reach direction is degenerate/);\n",
    "generator reach contract",
)
test_source = replace_once(
    test_source,
    "    assert.ok(move.strikeKneeExtensionDegrees > 135, `${move.action}: ${move.strikeKneeExtensionDegrees}`);\n",
    "    assert.ok(move.strikeKneeExtensionDegrees > 135, `${move.action}: ${move.strikeKneeExtensionDegrees}`);\n    assert.ok(move.strikeLegReachRatio > 0.85, `${move.action}: ${move.strikeLegReachRatio}`);\n",
    "generic reach gate",
)
test_source = replace_once(
    test_source,
    "  assert.ok(front.strikeKneeExtensionDegrees > 150, front.strikeKneeExtensionDegrees);\n",
    "  assert.ok(front.strikeKneeExtensionDegrees > 150, front.strikeKneeExtensionDegrees);\n  assert.ok(front.strikeLegReachRatio > 0.96, front.strikeLegReachRatio);\n",
    "front reach gate",
)
test_source = replace_once(
    test_source,
    "  assert.ok(low.strikeKneeExtensionDegrees > 145, low.strikeKneeExtensionDegrees);\n",
    "  assert.ok(low.strikeKneeExtensionDegrees > 145, low.strikeKneeExtensionDegrees);\n  assert.ok(low.strikeLegReachRatio > 0.90, low.strikeLegReachRatio);\n",
    "low reach gate",
)
test_source = replace_once(
    test_source,
    "  assert.ok(rising.strikeKneeExtensionDegrees > 145, rising.strikeKneeExtensionDegrees);\n",
    "  assert.ok(rising.strikeKneeExtensionDegrees > 145, rising.strikeKneeExtensionDegrees);\n  assert.ok(rising.strikeLegReachRatio > 0.95, rising.strikeLegReachRatio);\n",
    "rising reach gate",
)
test_path.write_text(test_source)

print("KICK_HIP_REACH_V4_PATCH_OK")
