#!/usr/bin/env python3
"""POLY FIGHTER Blender Motion Foundry v1.

Creates BF_Power_R as a Blender-authored animation vertical slice.

The source Punch_Cross supplies a proven human kinetic chain. Blender then owns
retiming and contact constraints: a right-hand IK target with elbow pole drives
contact, while a left-leg IK target keeps the support ankle planted. The final
motion is baked with Blender's native visual-keying/NLA bake, so constraint
results are converted to portable deform-skeleton keys before glTF export.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import bpy
from mathutils import Matrix, Vector

FPS = 60
START_FRAME = 1
END_FRAME = 52
LOAD_FRAME = 9
PRECONTACT_FRAME = 24
IMPACT_FRAME = 30
OVERTRAVEL_FRAME = 34
RECOVERY_FRAME = 43
ACTION_NAME = "BF_Power_R"
SOURCE_ACTION_HINT = "Punch_Cross"
REQUIRED_BONES = (
    "pelvis",
    "spine_02",
    "spine_03",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
    "thigh_l",
    "calf_l",
    "foot_l",
)


def _argv_after_double_dash() -> List[str]:
    import sys

    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(_argv_after_double_dash())


def reset_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_source(path: str) -> bpy.types.Object:
    bpy.ops.import_scene.gltf(filepath=path)
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"No armature found in {path}")
    armature = max(armatures, key=lambda obj: len(obj.data.bones))
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    return armature


def find_source_action() -> bpy.types.Action:
    actions = list(bpy.data.actions)
    exact = next((action for action in actions if action.name == SOURCE_ACTION_HINT), None)
    if exact:
        return exact
    partial = next((action for action in actions if SOURCE_ACTION_HINT.lower() in action.name.lower()), None)
    if partial:
        return partial
    raise RuntimeError(
        f"Source action {SOURCE_ACTION_HINT!r} missing. Available: {[action.name for action in actions]}"
    )


def ensure_required_bones(armature: bpy.types.Object) -> None:
    missing = [name for name in REQUIRED_BONES if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"Motion Foundry required bones missing: {missing}")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def source_u_for_destination_u(u: float) -> float:
    """Hand-authored timing map applied to the entire source body.

    The early frames store weight, the middle accelerates aggressively into
    contact, a short overtravel beat keeps impact readable, and recovery is given
    enough time to avoid a robotic snap back to guard.
    """

    knots: Tuple[Tuple[float, float], ...] = (
        (0.00, 0.00),
        (0.16, 0.07),
        (0.31, 0.18),
        (0.46, 0.39),
        (0.57, 0.66),
        (0.64, 0.76),
        (0.78, 0.90),
        (1.00, 1.00),
    )
    for (du0, su0), (du1, su1) in zip(knots, knots[1:]):
        if u <= du1:
            local = 0.0 if du1 == du0 else (u - du0) / (du1 - du0)
            eased = smoothstep(local)
            return su0 + (su1 - su0) * eased
    return 1.0


def set_scene_frame(scene: bpy.types.Scene, frame: float) -> None:
    integer = math.floor(frame)
    scene.frame_set(integer, subframe=frame - integer)
    bpy.context.view_layer.update()


def sample_source_basis(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    source_action: bpy.types.Action,
) -> Dict[int, Dict[str, Matrix]]:
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = source_action
    source_start, source_end = source_action.frame_range
    source_span = max(1e-5, source_end - source_start)
    samples: Dict[int, Dict[str, Matrix]] = {}
    for frame in range(START_FRAME, END_FRAME + 1):
        u = (frame - START_FRAME) / (END_FRAME - START_FRAME)
        source_u = source_u_for_destination_u(u)
        source_frame = source_start + source_span * source_u
        set_scene_frame(scene, source_frame)
        samples[frame] = {
            pose_bone.name: pose_bone.matrix_basis.copy()
            for pose_bone in armature.pose.bones
        }
    return samples


def key_pose_basis(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    name: str,
    samples: Dict[int, Dict[str, Matrix]],
) -> bpy.types.Action:
    action = bpy.data.actions.new(name=name)
    armature.animation_data.action = action
    for frame in range(START_FRAME, END_FRAME + 1):
        scene.frame_set(frame)
        for pose_bone in armature.pose.bones:
            pose_bone.matrix_basis = samples[frame][pose_bone.name]
            pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=pose_bone.name)
            pose_bone.keyframe_insert(data_path="scale", frame=frame, group=pose_bone.name)
    for fcurve in action.fcurves:
        for key in fcurve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"
    return action


def pose_head(armature: bpy.types.Object, bone_name: str) -> Vector:
    return armature.pose.bones[bone_name].head.copy()


def pose_tail(armature: bpy.types.Object, bone_name: str) -> Vector:
    return armature.pose.bones[bone_name].tail.copy()


def evaluated_positions(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    frames: Iterable[int],
    names: Iterable[str],
) -> Dict[int, Dict[str, Vector]]:
    result: Dict[int, Dict[str, Vector]] = {}
    for frame in frames:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        result[frame] = {name: pose_head(armature, name) for name in names}
    return result


def local_to_world(armature: bpy.types.Object, location: Vector) -> Vector:
    return armature.matrix_world @ location


def make_control(name: str, armature: bpy.types.Object, local_location: Vector) -> bpy.types.Object:
    """Create an unparented world-space IK target.

    Constraint targets are deliberately not parented to the driven armature.
    That removes any parent-space feedback from pelvis/root motion and makes a
    planted foot genuinely stationary in world space while the body moves.
    """

    control = bpy.data.objects.new(name, None)
    control.empty_display_type = "SPHERE"
    control.empty_display_size = 0.055
    control.location = local_to_world(armature, local_location)
    bpy.context.scene.collection.objects.link(control)
    return control


def set_control_keys(
    control: bpy.types.Object,
    armature: bpy.types.Object,
    keys: Iterable[Tuple[int, Vector]],
) -> None:
    for frame, local_location in keys:
        control.location = local_to_world(armature, local_location)
        control.keyframe_insert(data_path="location", frame=frame)
    if control.animation_data and control.animation_data.action:
        for fcurve in control.animation_data.action.fcurves:
            for key in fcurve.keyframe_points:
                key.interpolation = "BEZIER"
                key.handle_left_type = "AUTO_CLAMPED"
                key.handle_right_type = "AUTO_CLAMPED"


def chain_pole(root: Vector, joint: Vector, end: Vector, scale: float = 2.4) -> Vector:
    line = end - root
    if line.length < 1e-6:
        return joint + Vector((0.0, 0.25, 0.0))
    line.normalize()
    projected = root + line * (joint - root).dot(line)
    offset = joint - projected
    if offset.length < 1e-5:
        offset = Vector((0.0, 0.25, 0.0))
    return joint + offset.normalized() * max(0.25, (end - root).length * scale)


def add_ik_controls(scene: bpy.types.Scene, armature: bpy.types.Object) -> List[bpy.types.Object]:
    frames = (
        START_FRAME,
        LOAD_FRAME,
        PRECONTACT_FRAME,
        IMPACT_FRAME,
        OVERTRAVEL_FRAME,
        RECOVERY_FRAME,
        END_FRAME,
    )
    positions = evaluated_positions(
        scene,
        armature,
        frames,
        ("upperarm_r", "lowerarm_r", "hand_r", "thigh_l", "calf_l", "foot_l"),
    )

    start_hand = positions[START_FRAME]["hand_r"]
    impact_hand = positions[IMPACT_FRAME]["hand_r"]
    strike = impact_hand - start_hand
    if strike.length < 1e-4:
        raise RuntimeError("Punch_Cross source does not provide a usable right-hand strike path")

    hand_target = make_control("BF_CTRL_hand_r", armature, start_hand)
    hand_keys = (
        (START_FRAME, start_hand),
        (LOAD_FRAME, start_hand - strike * 0.10),
        (PRECONTACT_FRAME, start_hand + strike * 0.72),
        (IMPACT_FRAME, start_hand + strike * 1.10),
        (OVERTRAVEL_FRAME, start_hand + strike * 1.14),
        (RECOVERY_FRAME, positions[RECOVERY_FRAME]["hand_r"]),
        (END_FRAME, positions[END_FRAME]["hand_r"]),
    )
    set_control_keys(hand_target, armature, hand_keys)

    shoulder = positions[IMPACT_FRAME]["upperarm_r"]
    elbow = positions[IMPACT_FRAME]["lowerarm_r"]
    wrist = positions[IMPACT_FRAME]["hand_r"]
    elbow_pole = make_control(
        "BF_CTRL_elbow_r",
        armature,
        chain_pole(shoulder, elbow, wrist),
    )

    lowerarm = armature.pose.bones["lowerarm_r"]
    hand_ik = lowerarm.constraints.new(type="IK")
    hand_ik.name = "BF_RightHandContactIK"
    hand_ik.target = hand_target
    hand_ik.pole_target = elbow_pole
    hand_ik.chain_count = 2
    for frame, influence in (
        (START_FRAME, 0.00),
        (LOAD_FRAME, 0.18),
        (PRECONTACT_FRAME, 0.72),
        (IMPACT_FRAME, 1.00),
        (OVERTRAVEL_FRAME, 0.86),
        (RECOVERY_FRAME, 0.18),
        (END_FRAME, 0.00),
    ):
        hand_ik.influence = influence
        hand_ik.keyframe_insert(data_path="influence", frame=frame)

    # A calf two-bone IK target controls the ankle (calf tail / foot head).
    # The target is fixed in world space so the support foot cannot inherit root
    # translation from the moving pelvis.
    scene.frame_set(START_FRAME)
    bpy.context.view_layer.update()
    ankle = pose_tail(armature, "calf_l")
    knee = positions[START_FRAME]["calf_l"]
    hip = positions[START_FRAME]["thigh_l"]
    foot_target = make_control("BF_CTRL_foot_l", armature, ankle)
    knee_pole = make_control(
        "BF_CTRL_knee_l",
        armature,
        chain_pole(hip, knee, ankle, scale=1.8),
    )
    calf = armature.pose.bones["calf_l"]
    foot_ik = calf.constraints.new(type="IK")
    foot_ik.name = "BF_LeftFootLockIK"
    foot_ik.target = foot_target
    foot_ik.pole_target = knee_pole
    foot_ik.chain_count = 2
    foot_ik.influence = 1.0

    return [hand_target, elbow_pole, foot_target, knee_pole]


def foot_lock_drift(scene: bpy.types.Scene, armature: bpy.types.Object) -> float:
    scene.frame_set(START_FRAME)
    bpy.context.view_layer.update()
    start = pose_tail(armature, "calf_l")
    maximum = 0.0
    for frame in range(START_FRAME, END_FRAME + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        maximum = max(maximum, (pose_tail(armature, "calf_l") - start).length)
    return maximum


def hand_travel(scene: bpy.types.Scene, armature: bpy.types.Object) -> float:
    scene.frame_set(START_FRAME)
    bpy.context.view_layer.update()
    start = pose_head(armature, "hand_r")
    scene.frame_set(IMPACT_FRAME)
    bpy.context.view_layer.update()
    return (pose_head(armature, "hand_r") - start).length


def capture_visual_pose(scene: bpy.types.Scene, armature: bpy.types.Object) -> Dict[str, float]:
    """Capture pre-bake constraint diagnostics.

    Kept as a named stage so the CI contract can distinguish an IK problem from
    a visual-bake problem instead of treating every foot-lock failure alike.
    """

    return {
        "constrainedFootLockMaxDrift": foot_lock_drift(scene, armature),
        "constrainedRightHandTravel": hand_travel(scene, armature),
    }


def bake_visual_action(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    diagnostics: Dict[str, float],
) -> bpy.types.Action:
    del diagnostics  # Diagnostics are measured before this destructive bake.
    if armature.animation_data is None or armature.animation_data.action is None:
        raise RuntimeError("Motion Foundry has no active action to bake")

    # Blender's native NLA bake performs the parent/rest-space conversion needed
    # for constrained pose bones. This is more reliable than assigning evaluated
    # pose matrices back into matrix_basis by hand.
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(
        frame_start=START_FRAME,
        frame_end=END_FRAME,
        step=1,
        only_selected=False,
        visual_keying=True,
        clear_constraints=True,
        clear_parents=False,
        use_current_action=True,
        clean_curves=False,
        bake_types={"POSE"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")

    action = armature.animation_data.action
    if action is None:
        raise RuntimeError("Blender NLA bake did not produce an active Action")
    action.name = ACTION_NAME
    action.use_fake_user = True
    return action


def remove_controls(controls: Iterable[bpy.types.Object]) -> None:
    for control in controls:
        if control.name in bpy.data.objects:
            bpy.data.objects.remove(control, do_unlink=True)


def motion_metrics(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    source_action_name: str,
    constrained: Dict[str, float],
) -> dict:
    armature.animation_data.action = bpy.data.actions[ACTION_NAME]
    baked_foot_drift = foot_lock_drift(scene, armature)
    baked_hand_travel = hand_travel(scene, armature)
    return {
        "version": "BLENDER_MOTION_FOUNDRY_V1",
        "action": ACTION_NAME,
        "sourceAction": source_action_name,
        "fps": FPS,
        "startFrame": START_FRAME,
        "endFrame": END_FRAME,
        "durationSeconds": (END_FRAME - START_FRAME) / FPS,
        "impactFrame": IMPACT_FRAME,
        "rightHandTravel": baked_hand_travel,
        "leftFootLockMaxDrift": baked_foot_drift,
        "constrainedRightHandTravel": constrained["constrainedRightHandTravel"],
        "constrainedFootLockMaxDrift": constrained["constrainedFootLockMaxDrift"],
        "boneCount": len(armature.pose.bones),
        "meshCount": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
        "pipeline": [
            "Punch_Cross source body motion",
            "nonlinear whole-body retiming",
            "right-hand two-bone IK contact control",
            "world-space left support-foot IK lock",
            "Blender native NLA visual-keying bake",
            "glTF Action export",
        ],
    }


def export_outputs(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    output_dir: Path,
    metrics: dict,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    scene.render.fps = FPS
    scene.frame_start = START_FRAME
    scene.frame_end = END_FRAME
    armature.animation_data.action = bpy.data.actions[ACTION_NAME]

    # Keep only the final baked Action. Mesh/skin remain in this first vertical
    # slice because Blender's exporter then preserves an unambiguous armature;
    # a later optimization pass can strip presentation geometry from the GLB.
    for action in list(bpy.data.actions):
        if action.name != ACTION_NAME:
            bpy.data.actions.remove(action)

    blend_path = output_dir / "blender-fight-core-v1.blend"
    glb_path = output_dir / "blender-fight-core.glb"
    metrics_path = output_dir / "blender-fight-core.metrics.json"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=True,
        export_frame_range=True,
        export_force_sampling=True,
    )
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (output_dir / "blender-version.txt").write_text(
        bpy.app.version_string + "\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    source = os.path.abspath(args.source)
    output_dir = Path(args.output_dir).resolve()
    reset_scene()
    armature = import_source(source)
    ensure_required_bones(armature)
    source_action = find_source_action()
    source_action_name = source_action.name
    scene = bpy.context.scene
    scene.render.fps = FPS

    source_samples = sample_source_basis(scene, armature, source_action)
    base_action = key_pose_basis(scene, armature, "BF_BASE_Power_R", source_samples)
    armature.animation_data.action = base_action
    controls = add_ik_controls(scene, armature)
    constrained = capture_visual_pose(scene, armature)
    final_action = bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    remove_controls(controls)
    metrics = motion_metrics(scene, armature, source_action_name, constrained)
    export_outputs(scene, armature, output_dir, metrics)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
