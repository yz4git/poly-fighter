#!/usr/bin/env python3
"""POLY FIGHTER Blender Motion Foundry v2 - authored straight/cross.

Builds BF_Cross_R as a second Blender-authored vertical slice without replacing
v1 BF_Power_R.  The proven Punch_Cross source remains the motion reference, but
Blender owns the authored contact pose through explicit world-space controls:

- COG/pelvis master target with weight transfer and hip lead
- lower/upper torso master targets with staged kinetic-chain twist
- right-hand two-bone IK + elbow pole for deterministic contact
- left support ankle world-space IK lock
- left support foot world-space orientation lock
- Blender native visual-keying/NLA bake back to the deform skeleton

The result is exported as a standalone GLB so runtime can A/B it against
PF_Cross_R and fall back independently from BF_Power_R.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 60
START_FRAME = 1
END_FRAME = 42
LOAD_FRAME = 6
PRECONTACT_FRAME = 16
IMPACT_FRAME = 21
OVERTRAVEL_FRAME = 24
RECOVERY_FRAME = 33
ACTION_NAME = "BF_Cross_R"
VERSION = "BLENDER_MOTION_FOUNDRY_V2_CROSS"


def _load_v1_module():
    path = Path(__file__).with_name("build-fight-motion-foundry-v1.py")
    spec = importlib.util.spec_from_file_location("poly_fighter_motion_foundry_v1", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load Motion Foundry v1 helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v1 = _load_v1_module()


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


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def cross_source_u(u: float) -> float:
    """Faster authored timing than the v1 heavy Power punch.

    The rear-side load is compact, launch accelerates hard into frame 21, and
    recovery gets enough room to read as a fighting action rather than a snap.
    """

    knots: Tuple[Tuple[float, float], ...] = (
        (0.00, 0.00),
        (0.13, 0.06),
        (0.27, 0.17),
        (0.40, 0.36),
        (0.50, 0.66),
        (0.57, 0.78),
        (0.76, 0.91),
        (1.00, 1.00),
    )
    for (du0, su0), (du1, su1) in zip(knots, knots[1:]):
        if u <= du1:
            local = 0.0 if du1 == du0 else (u - du0) / (du1 - du0)
            return su0 + (su1 - su0) * smoothstep(local)
    return 1.0


def phase_value(frame: int, knots: Sequence[Tuple[int, float]]) -> float:
    if frame <= knots[0][0]:
        return knots[0][1]
    for (f0, v0), (f1, v1) in zip(knots, knots[1:]):
        if frame <= f1:
            local = 0.0 if f1 == f0 else (frame - f0) / (f1 - f0)
            return v0 + (v1 - v0) * smoothstep(local)
    return knots[-1][1]


def pose_world_matrix(armature: bpy.types.Object, bone_name: str) -> Matrix:
    return armature.matrix_world @ armature.pose.bones[bone_name].matrix


def sample_world_matrices(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    action: bpy.types.Action,
    bone_names: Iterable[str],
) -> Dict[int, Dict[str, Matrix]]:
    armature.animation_data.action = action
    result: Dict[int, Dict[str, Matrix]] = {}
    for frame in range(START_FRAME, END_FRAME + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        result[frame] = {name: pose_world_matrix(armature, name).copy() for name in bone_names}
    return result


def make_matrix_control(name: str, matrix_world: Matrix, size: float = 0.075) -> bpy.types.Object:
    control = bpy.data.objects.new(name, None)
    control.empty_display_type = "CUBE"
    control.empty_display_size = size
    control.rotation_mode = "QUATERNION"
    bpy.context.scene.collection.objects.link(control)
    control.matrix_world = matrix_world
    return control


def key_matrix(control: bpy.types.Object, frame: int, matrix_world: Matrix) -> None:
    location, rotation, scale = matrix_world.decompose()
    control.location = location
    control.rotation_quaternion = rotation
    control.scale = scale
    control.keyframe_insert(data_path="location", frame=frame)
    control.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    control.keyframe_insert(data_path="scale", frame=frame)


def smooth_control_curves(control: bpy.types.Object) -> None:
    if not control.animation_data or not control.animation_data.action:
        return
    for curve in control.animation_data.action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"


def matrix_with_world_delta(base: Matrix, translation: Vector, yaw_radians: float) -> Matrix:
    location, rotation, scale = base.decompose()
    yaw = Quaternion(Vector((0.0, 0.0, 1.0)), yaw_radians)
    return Matrix.LocRotScale(location + translation, yaw @ rotation, scale)


def source_twist_sign(world_samples: Dict[int, Dict[str, Matrix]]) -> float:
    start_q = world_samples[START_FRAME]["spine_03"].to_quaternion()
    impact_q = world_samples[IMPACT_FRAME]["spine_03"].to_quaternion()
    delta = start_q.rotation_difference(impact_q).to_euler("XYZ").z
    return -1.0 if delta < 0.0 else 1.0


def add_master_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    strike_world: Vector,
) -> List[bpy.types.Object]:
    samples = sample_world_matrices(scene, armature, base_action, ("pelvis", "spine_02", "spine_03"))
    ground = Vector((strike_world.x, strike_world.y, 0.0))
    if ground.length < 1e-5:
        ground = Vector((0.0, -1.0, 0.0))
    ground.normalize()
    twist_sign = source_twist_sign(samples)

    pelvis = make_matrix_control("BF2_CTRL_COG", samples[START_FRAME]["pelvis"], 0.095)
    lower_torso = make_matrix_control("BF2_CTRL_torso_lower", samples[START_FRAME]["spine_02"])
    upper_torso = make_matrix_control("BF2_CTRL_torso_upper", samples[START_FRAME]["spine_03"])

    pelvis_forward = (
        (START_FRAME, 0.000),
        (LOAD_FRAME, -0.018),
        (PRECONTACT_FRAME, 0.012),
        (IMPACT_FRAME, 0.032),
        (OVERTRAVEL_FRAME, 0.038),
        (RECOVERY_FRAME, 0.008),
        (END_FRAME, 0.000),
    )
    pelvis_drop = (
        (START_FRAME, 0.000),
        (LOAD_FRAME, -0.012),
        (PRECONTACT_FRAME, -0.006),
        (IMPACT_FRAME, 0.002),
        (OVERTRAVEL_FRAME, 0.000),
        (RECOVERY_FRAME, -0.003),
        (END_FRAME, 0.000),
    )
    pelvis_yaw = (
        (START_FRAME, 0.0),
        (LOAD_FRAME, -4.0),
        (PRECONTACT_FRAME, 3.0),
        (IMPACT_FRAME, 8.0),
        (OVERTRAVEL_FRAME, 10.0),
        (RECOVERY_FRAME, 2.0),
        (END_FRAME, 0.0),
    )
    lower_yaw = (
        (START_FRAME, 0.0),
        (LOAD_FRAME, -5.0),
        (PRECONTACT_FRAME, 5.0),
        (IMPACT_FRAME, 12.0),
        (OVERTRAVEL_FRAME, 14.0),
        (RECOVERY_FRAME, 3.0),
        (END_FRAME, 0.0),
    )
    upper_yaw = (
        (START_FRAME, 0.0),
        (LOAD_FRAME, -7.0),
        (PRECONTACT_FRAME, 7.0),
        (IMPACT_FRAME, 16.0),
        (OVERTRAVEL_FRAME, 18.0),
        (RECOVERY_FRAME, 4.0),
        (END_FRAME, 0.0),
    )

    for frame in range(START_FRAME, END_FRAME + 1):
        forward = phase_value(frame, pelvis_forward)
        drop = phase_value(frame, pelvis_drop)
        shared_translation = ground * forward + Vector((0.0, 0.0, drop))
        pelvis_matrix = matrix_with_world_delta(
            samples[frame]["pelvis"],
            shared_translation,
            math.radians(phase_value(frame, pelvis_yaw) * twist_sign),
        )
        lower_matrix = matrix_with_world_delta(
            samples[frame]["spine_02"],
            shared_translation + ground * 0.004,
            math.radians(phase_value(frame, lower_yaw) * twist_sign),
        )
        upper_matrix = matrix_with_world_delta(
            samples[frame]["spine_03"],
            shared_translation + ground * 0.008,
            math.radians(phase_value(frame, upper_yaw) * twist_sign),
        )
        key_matrix(pelvis, frame, pelvis_matrix)
        key_matrix(lower_torso, frame, lower_matrix)
        key_matrix(upper_torso, frame, upper_matrix)

    for control in (pelvis, lower_torso, upper_torso):
        smooth_control_curves(control)

    for bone_name, control, label in (
        ("pelvis", pelvis, "BF2_COG_Master"),
        ("spine_02", lower_torso, "BF2_LowerTorso_Master"),
        ("spine_03", upper_torso, "BF2_UpperTorso_Master"),
    ):
        constraint = armature.pose.bones[bone_name].constraints.new(type="COPY_TRANSFORMS")
        constraint.name = label
        constraint.target = control
        constraint.owner_space = "WORLD"
        constraint.target_space = "WORLD"
        constraint.influence = 1.0

    return [pelvis, lower_torso, upper_torso]


def add_contact_and_foot_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
) -> Tuple[List[bpy.types.Object], Vector]:
    frames = (START_FRAME, LOAD_FRAME, PRECONTACT_FRAME, IMPACT_FRAME, OVERTRAVEL_FRAME, RECOVERY_FRAME, END_FRAME)
    armature.animation_data.action = base_action
    positions = v1.evaluated_positions(
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

    hand_target = v1.make_control("BF2_CTRL_hand_r", armature, start_hand)
    v1.set_control_keys(
        hand_target,
        armature,
        (
            (START_FRAME, start_hand),
            (LOAD_FRAME, start_hand - strike * 0.05),
            (PRECONTACT_FRAME, start_hand + strike * 0.78),
            (IMPACT_FRAME, start_hand + strike * 1.04),
            (OVERTRAVEL_FRAME, start_hand + strike * 1.08),
            (RECOVERY_FRAME, positions[RECOVERY_FRAME]["hand_r"]),
            (END_FRAME, positions[END_FRAME]["hand_r"]),
        ),
    )

    shoulder = positions[IMPACT_FRAME]["upperarm_r"]
    elbow = positions[IMPACT_FRAME]["lowerarm_r"]
    wrist = positions[IMPACT_FRAME]["hand_r"]
    elbow_pole = v1.make_control("BF2_CTRL_elbow_r", armature, v1.chain_pole(shoulder, elbow, wrist, scale=2.2))
    lowerarm = armature.pose.bones["lowerarm_r"]
    hand_ik = lowerarm.constraints.new(type="IK")
    hand_ik.name = "BF2_RightHandContactIK"
    hand_ik.target = hand_target
    hand_ik.pole_target = elbow_pole
    hand_ik.chain_count = 2
    for frame, influence in (
        (START_FRAME, 0.00),
        (LOAD_FRAME, 0.10),
        (PRECONTACT_FRAME, 0.76),
        (IMPACT_FRAME, 1.00),
        (OVERTRAVEL_FRAME, 0.78),
        (RECOVERY_FRAME, 0.12),
        (END_FRAME, 0.00),
    ):
        hand_ik.influence = influence
        hand_ik.keyframe_insert(data_path="influence", frame=frame)

    scene.frame_set(START_FRAME)
    bpy.context.view_layer.update()
    ankle = v1.pose_tail(armature, "calf_l")
    knee = positions[START_FRAME]["calf_l"]
    hip = positions[START_FRAME]["thigh_l"]
    foot_target = v1.make_control("BF2_CTRL_foot_l", armature, ankle)
    knee_pole = v1.make_control("BF2_CTRL_knee_l", armature, v1.chain_pole(hip, knee, ankle, scale=1.8))
    calf = armature.pose.bones["calf_l"]
    foot_ik = calf.constraints.new(type="IK")
    foot_ik.name = "BF2_LeftFootPositionLockIK"
    foot_ik.target = foot_target
    foot_ik.pole_target = knee_pole
    foot_ik.chain_count = 2
    foot_ik.influence = 1.0

    foot_world = pose_world_matrix(armature, "foot_l")
    foot_rotation = make_matrix_control("BF2_CTRL_foot_l_orientation", foot_world, 0.065)
    foot_constraint = armature.pose.bones["foot_l"].constraints.new(type="COPY_ROTATION")
    foot_constraint.name = "BF2_LeftFootOrientationLock"
    foot_constraint.target = foot_rotation
    foot_constraint.owner_space = "WORLD"
    foot_constraint.target_space = "WORLD"
    foot_constraint.mix_mode = "REPLACE"
    foot_constraint.influence = 1.0

    strike_world = armature.matrix_world.to_3x3() @ strike
    return [hand_target, elbow_pole, foot_target, knee_pole, foot_rotation], strike_world


def foot_rotation_drift_degrees(scene: bpy.types.Scene, armature: bpy.types.Object) -> float:
    scene.frame_set(START_FRAME)
    bpy.context.view_layer.update()
    start = pose_world_matrix(armature, "foot_l").to_quaternion()
    maximum = 0.0
    for frame in range(START_FRAME, END_FRAME + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        current = pose_world_matrix(armature, "foot_l").to_quaternion()
        maximum = max(maximum, math.degrees(start.rotation_difference(current).angle))
    return maximum


def pelvis_travel(scene: bpy.types.Scene, armature: bpy.types.Object) -> float:
    scene.frame_set(START_FRAME)
    bpy.context.view_layer.update()
    start = v1.pose_head(armature, "pelvis")
    scene.frame_set(IMPACT_FRAME)
    bpy.context.view_layer.update()
    return (v1.pose_head(armature, "pelvis") - start).length


def torso_twist_degrees(scene: bpy.types.Scene, armature: bpy.types.Object) -> float:
    scene.frame_set(START_FRAME)
    bpy.context.view_layer.update()
    start = pose_world_matrix(armature, "spine_03").to_quaternion()
    scene.frame_set(IMPACT_FRAME)
    bpy.context.view_layer.update()
    impact = pose_world_matrix(armature, "spine_03").to_quaternion()
    return math.degrees(start.rotation_difference(impact).angle)


def export_outputs(scene: bpy.types.Scene, armature: bpy.types.Object, output_dir: Path, metrics: dict) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    scene.render.fps = FPS
    scene.frame_start = START_FRAME
    scene.frame_end = END_FRAME
    armature.animation_data.action = bpy.data.actions[ACTION_NAME]
    for action in list(bpy.data.actions):
        if action.name != ACTION_NAME:
            bpy.data.actions.remove(action)

    blend_path = output_dir / "blender-cross-core-v2.blend"
    glb_path = output_dir / "blender-cross-core.glb"
    metrics_path = output_dir / "blender-cross-core.metrics.json"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=True,
        export_frame_range=True,
        export_force_sampling=True,
    )
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (output_dir / "blender-cross-version.txt").write_text(bpy.app.version_string + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    source = os.path.abspath(args.source)
    output_dir = Path(args.output_dir).resolve()

    v1.START_FRAME = START_FRAME
    v1.END_FRAME = END_FRAME
    v1.LOAD_FRAME = LOAD_FRAME
    v1.PRECONTACT_FRAME = PRECONTACT_FRAME
    v1.IMPACT_FRAME = IMPACT_FRAME
    v1.OVERTRAVEL_FRAME = OVERTRAVEL_FRAME
    v1.RECOVERY_FRAME = RECOVERY_FRAME
    v1.ACTION_NAME = ACTION_NAME
    v1.source_u_for_destination_u = cross_source_u

    v1.reset_scene()
    armature = v1.import_source(source)
    v1.ensure_required_bones(armature)
    source_action = v1.find_source_action()
    source_name = source_action.name
    scene = bpy.context.scene
    scene.render.fps = FPS

    source_samples = v1.sample_source_basis(scene, armature, source_action)
    base_action = v1.key_pose_basis(scene, armature, "BF2_BASE_Cross_R", source_samples)
    armature.animation_data.action = base_action

    limb_controls, strike_world = add_contact_and_foot_controls(scene, armature, base_action)
    master_controls = add_master_controls(scene, armature, base_action, strike_world)
    constrained = {
        "constrainedFootLockMaxDrift": v1.foot_lock_drift(scene, armature),
        "constrainedFootLockMaxAngularDriftDegrees": foot_rotation_drift_degrees(scene, armature),
        "constrainedRightHandTravel": v1.hand_travel(scene, armature),
        "constrainedPelvisTravel": pelvis_travel(scene, armature),
        "constrainedTorsoTwistDegrees": torso_twist_degrees(scene, armature),
    }

    final_action = v1.bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    v1.remove_controls([*limb_controls, *master_controls])

    metrics = {
        "version": VERSION,
        "action": ACTION_NAME,
        "sourceAction": source_name,
        "fps": FPS,
        "startFrame": START_FRAME,
        "endFrame": END_FRAME,
        "durationSeconds": (END_FRAME - START_FRAME) / FPS,
        "impactFrame": IMPACT_FRAME,
        "rightHandTravel": v1.hand_travel(scene, armature),
        "leftFootLockMaxDrift": v1.foot_lock_drift(scene, armature),
        "leftFootLockMaxAngularDriftDegrees": foot_rotation_drift_degrees(scene, armature),
        "pelvisTravel": pelvis_travel(scene, armature),
        "torsoTwistDegrees": torso_twist_degrees(scene, armature),
        **constrained,
        "boneCount": len(armature.pose.bones),
        "meshCount": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
        "pipeline": [
            "Punch_Cross source body motion",
            "fast nonlinear whole-body retiming",
            "COG/pelvis world-space master control",
            "staged lower/upper torso master controls",
            "right-hand two-bone IK contact control",
            "world-space left support-foot position IK lock",
            "world-space left support-foot orientation lock",
            "Blender native NLA visual-keying bake",
            "glTF Action export",
        ],
    }
    export_outputs(scene, armature, output_dir, metrics)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
