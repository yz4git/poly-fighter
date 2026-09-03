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
    """        (0.27, 0.00, 0.31),\n        (0.56, 0.00, 0.33),\n        (0.60, 0.00, 0.31),""",
    """        (0.34, 0.00, 0.34),\n        (0.72, 0.00, 0.37),\n        (0.76, 0.00, 0.35),""",
    "front kick extension offsets",
)
generator = replace_once(
    generator,
    """        (0.24, 0.00, 0.42),\n        (0.50, 0.00, 0.66),\n        (0.53, 0.00, 0.72),""",
    """        (0.32, 0.00, 0.48),\n        (0.68, 0.00, 0.78),\n        (0.72, 0.00, 0.84),""",
    "rising kick extension offsets",
)
generator = replace_once(
    generator,
    """    pelvis_forward=(0.000, -0.012, 0.004, 0.020, 0.022, 0.000, 0.000),""",
    """    pelvis_forward=(0.000, -0.012, 0.006, 0.028, 0.032, 0.000, 0.000),""",
    "rising kick COG drive",
)

knee_metric = '''\n\ndef strike_knee_extension_degrees(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:\n    """Return the impact knee angle; 180 degrees is a fully extended strike leg."""\n    thigh = f"thigh_{spec.strike_suffix}"\n    calf = f"calf_{spec.strike_suffix}"\n    foot = f"foot_{spec.strike_suffix}"\n    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()\n    hip = rig.v1.pose_head(armature, thigh)\n    knee = rig.v1.pose_head(armature, calf)\n    ankle = rig.v1.pose_head(armature, foot)\n    upper = hip - knee\n    lower = ankle - knee\n    if upper.length < 1e-6 or lower.length < 1e-6:\n        return 0.0\n    return math.degrees(upper.angle(lower))\n'''
generator = replace_once(
    generator,
    "\n\ndef guard_distance(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:\n",
    knee_metric + "\n\ndef guard_distance(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:\n",
    "knee extension metric insertion",
)
generator = replace_once(
    generator,
    '        "constrainedStrikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n',
    '        "constrainedStrikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n        "constrainedStrikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),\n',
    "constrained knee metric",
)
generator = replace_once(
    generator,
    '        "strikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n',
    '        "strikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),\n        "strikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),\n',
    "baked knee metric",
)
generator = replace_once(
    generator,
    '            f"{spec.strike_side.upper()} strike-leg two-bone IK",\n',
    '            f"{spec.strike_side.upper()} strike-leg two-bone IK",\n            "impact knee-extension quality gate",\n',
    "pipeline knee gate",
)

generator_path.write_text(generator)

test_source = test_path.read_text()
test_source = replace_once(
    test_source,
    "  assert.match(generator, /strikeFootVerticalRise/);\n",
    "  assert.match(generator, /strikeFootVerticalRise/);\n  assert.match(generator, /strikeKneeExtensionDegrees/);\n",
    "test generator knee metric",
)
test_source = replace_once(
    test_source,
    "    assert.ok(move.guardHandMaxChestDistance < 0.34, `${move.action}: ${move.guardHandMaxChestDistance}`);\n",
    "    assert.ok(move.guardHandMaxChestDistance < 0.34, `${move.action}: ${move.guardHandMaxChestDistance}`);\n    assert.ok(move.strikeKneeExtensionDegrees > 135, `${move.action}: ${move.strikeKneeExtensionDegrees}`);\n",
    "generic knee gate",
)
test_source = replace_once(
    test_source,
    "  assert.ok(front.strikeFootVerticalRise > 0.27, front.strikeFootVerticalRise);\n",
    "  assert.ok(front.strikeFootVerticalRise > 0.27, front.strikeFootVerticalRise);\n  assert.ok(front.strikeKneeExtensionDegrees > 150, front.strikeKneeExtensionDegrees);\n",
    "front knee gate",
)
test_source = replace_once(
    test_source,
    "  assert.ok(low.strikeFootVerticalRise > 0.18, low.strikeFootVerticalRise);\n",
    "  assert.ok(low.strikeFootVerticalRise > 0.18, low.strikeFootVerticalRise);\n  assert.ok(low.strikeKneeExtensionDegrees > 145, low.strikeKneeExtensionDegrees);\n",
    "low knee gate",
)
test_source = replace_once(
    test_source,
    "  assert.ok(rising.strikeFootVerticalRise > 0.52, rising.strikeFootVerticalRise);\n",
    "  assert.ok(rising.strikeFootVerticalRise > 0.52, rising.strikeFootVerticalRise);\n  assert.ok(rising.strikeKneeExtensionDegrees > 145, rising.strikeKneeExtensionDegrees);\n",
    "rising knee gate",
)
test_path.write_text(test_source)

print("KICK_EXTENSION_V3_PATCH_OK")
