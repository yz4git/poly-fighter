#!/usr/bin/env python3
"""POLY FIGHTER Blender Motion Foundry v2 reaction pack.

Authors grounded defensive reactions as baked UAL-compatible Actions:
- BF_HitHeavy: planted full-body chest hit with delayed head/torso recoil.
- BF_GuardBreak: high guard blown open while both feet remain planted.

Runtime gameplay owns world movement, hit stun and knockback. This offline pack
only improves the readable full-body reaction pose and recovery.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
from typing import List, Tuple

import bpy
from mathutils import Euler, Vector

import motion_foundry_v2_rig as rig

FPS = 60
v1 = rig.v1
Curve = Tuple[Tuple[float, float], ...]
HEAD_BONE = ""


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


def curve_value(curve: Curve, u: float) -> float:
    if u <= curve[0][0]:
        return curve[0][1]
    for (u0, v0), (u1, v1_) in zip(curve, curve[1:]):
        if u <= u1:
            t = 0.0 if u1 == u0 else smoothstep((u - u0) / (u1 - u0))
            return v0 + (v1_ - v0) * t
    return curve[-1][1]


@dataclass(frozen=True)
class ReactionSpec:
    action_name: str
    version: str
    source_action_hint: str
    end_frame: int
    impact_frame: int
    settle_frame: int
    source_knots: Tuple[Tuple[float, float], ...]
    pelvis_drop: Curve
    pelvis_roll: Curve
    lower_pitch: Curve
    lower_roll: Curve
    upper_pitch: Curve
    upper_roll: Curve
    head_pitch: Curve
    head_roll: Curve
    arm_open: Curve
    guard_break: bool = False

    @property
    def start_frame(self) -> int:
        return 1


REACTIONS: Tuple[ReactionSpec, ...] = (
    ReactionSpec(
        action_name="BF_HitHeavy",
        version="BLENDER_MOTION_FOUNDRY_V2_HIT_HEAVY",
        source_action_hint="Hit_Chest",
        end_frame=30,
        impact_frame=8,
        settle_frame=23,
        source_knots=((0.00, 0.00), (0.14, 0.03), (0.28, 0.22), (0.50, 0.58), (0.70, 0.76), (0.82, 0.46), (0.92, 0.18), (1.00, 0.00)),
        pelvis_drop=((0.00, 0.00), (0.27, -0.030), (0.52, -0.014), (0.78, -0.004), (1.00, 0.00)),
        pelvis_roll=((0.00, 0.0), (0.27, -7.0), (0.48, -10.0), (0.75, -3.0), (1.00, 0.0)),
        lower_pitch=((0.00, 0.0), (0.27, 9.0), (0.48, 14.0), (0.75, 4.0), (1.00, 0.0)),
        lower_roll=((0.00, 0.0), (0.27, -12.0), (0.48, -17.0), (0.75, -5.0), (1.00, 0.0)),
        upper_pitch=((0.00, 0.0), (0.27, 15.0), (0.48, 23.0), (0.75, 6.0), (1.00, 0.0)),
        upper_roll=((0.00, 0.0), (0.27, -22.0), (0.48, -30.0), (0.75, -8.0), (1.00, 0.0)),
        head_pitch=((0.00, 0.0), (0.27, -8.0), (0.48, -15.0), (0.75, -4.0), (1.00, 0.0)),
        head_roll=((0.00, 0.0), (0.27, 16.0), (0.48, 25.0), (0.75, 6.0), (1.00, 0.0)),
        arm_open=((0.00, 0.0), (0.27, 12.0), (0.48, 18.0), (0.75, 5.0), (1.00, 0.0)),
    ),
    ReactionSpec(
        action_name="BF_GuardBreak",
        version="BLENDER_MOTION_FOUNDRY_V2_GUARD_BREAK",
        source_action_hint="Hit_Chest",
        end_frame=34,
        impact_frame=9,
        settle_frame=27,
        source_knots=((0.00, 0.00), (0.12, 0.02), (0.27, 0.18), (0.48, 0.50), (0.70, 0.74), (0.83, 0.46), (0.93, 0.18), (1.00, 0.00)),
        pelvis_drop=((0.00, -0.012), (0.27, -0.040), (0.50, -0.025), (0.78, -0.010), (1.00, 0.00)),
        pelvis_roll=((0.00, 0.0), (0.27, 4.0), (0.50, 7.0), (0.78, 2.0), (1.00, 0.0)),
        lower_pitch=((0.00, 2.0), (0.27, 10.0), (0.50, 15.0), (0.78, 5.0), (1.00, 0.0)),
        lower_roll=((0.00, 0.0), (0.27, 5.0), (0.50, 8.0), (0.78, 2.0), (1.00, 0.0)),
        upper_pitch=((0.00, 2.0), (0.27, 14.0), (0.50, 20.0), (0.78, 6.0), (1.00, 0.0)),
        upper_roll=((0.00, 0.0), (0.27, 8.0), (0.50, 12.0), (0.78, 3.0), (1.00, 0.0)),
        head_pitch=((0.00, 0.0), (0.27, -5.0), (0.50, -10.0), (0.78, -2.0), (1.00, 0.0)),
        head_roll=((0.00, 0.0), (0.27, -6.0), (0.50, -9.0), (0.78, -2.0), (1.00, 0.0)),
        arm_open=((0.00, 0.0), (0.27, 28.0), (0.50, 40.0), (0.78, 12.0), (1.00, 0.0)),
        guard_break=True,
    ),
)


def configure_source(spec: ReactionSpec) -> None:
    v1.START_FRAME = spec.start_frame
    v1.END_FRAME = spec.end_frame
    v1.LOAD_FRAME = max(spec.start_frame + 1, spec.impact_frame - 4)
    v1.PRECONTACT_FRAME = max(spec.start_frame + 1, spec.impact_frame - 1)
    v1.IMPACT_FRAME = spec.impact_frame
    v1.OVERTRAVEL_FRAME = min(spec.end_frame - 2, spec.impact_frame + 4)
    v1.RECOVERY_FRAME = spec.settle_frame
    v1.ACTION_NAME = spec.action_name
    v1.SOURCE_ACTION_HINT = spec.source_action_hint
    v1.source_u_for_destination_u = lambda u: rig.remap_u(spec.source_knots, u)


def resolve_head_bone(armature: bpy.types.Object) -> str:
    names = list(armature.pose.bones.keys())
    for candidate in ("head", "head_01", "Head", "neck", "neck_01", "Neck"):
        if candidate in armature.pose.bones:
            return candidate
    for needle in ("head", "neck"):
        match = next((name for name in names if needle in name.lower()), None)
        if match:
            return match
    spine = armature.pose.bones.get("spine_03")
    if spine:
        descendants = []
        stack = list(spine.children)
        while stack:
            bone = stack.pop()
            stack.extend(bone.children)
            lower = bone.name.lower()
            if not any(part in lower for part in ("arm", "clavicle", "shoulder", "hand", "finger")):
                descendants.append(bone)
        if descendants:
            return max(descendants, key=lambda bone: bone.head.z).name
    raise RuntimeError(f"Reaction Foundry could not resolve a head/neck bone. Available: {names}")


def ensure_bones(armature: bpy.types.Object) -> None:
    global HEAD_BONE
    required = (
        "pelvis", "spine_02", "spine_03",
        "upperarm_l", "lowerarm_l", "hand_l",
        "upperarm_r", "lowerarm_r", "hand_r",
        "thigh_l", "calf_l", "foot_l",
        "thigh_r", "calf_r", "foot_r",
    )
    missing = [name for name in required if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"Reaction Foundry required bones missing: {missing}")
    HEAD_BONE = resolve_head_bone(armature)
    print("REACTION_HEAD_BONE", HEAD_BONE)
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"


def add_rotation_delta(bone: bpy.types.PoseBone, degrees_xyz: Tuple[float, float, float], frame: int) -> None:
    delta = Euler(tuple(math.radians(v) for v in degrees_xyz), "XYZ").to_quaternion()
    bone.rotation_quaternion = bone.rotation_quaternion @ delta
    bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)


def apply_body_direction(scene: bpy.types.Scene, armature: bpy.types.Object, spec: ReactionSpec) -> None:
    action = armature.animation_data.action
    if action is None:
        raise RuntimeError(f"{spec.action_name}: missing base action")
    for frame in range(spec.start_frame, spec.end_frame + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        u = (frame - spec.start_frame) / max(1, spec.end_frame - spec.start_frame)
        pelvis = armature.pose.bones["pelvis"]
        pelvis.location.z += curve_value(spec.pelvis_drop, u)
        pelvis.keyframe_insert(data_path="location", frame=frame, group="pelvis")
        add_rotation_delta(pelvis, (0.0, 0.0, curve_value(spec.pelvis_roll, u)), frame)
        add_rotation_delta(armature.pose.bones["spine_02"], (curve_value(spec.lower_pitch, u), 0.0, curve_value(spec.lower_roll, u)), frame)
        add_rotation_delta(armature.pose.bones["spine_03"], (curve_value(spec.upper_pitch, u), 0.0, curve_value(spec.upper_roll, u)), frame)
        add_rotation_delta(armature.pose.bones[HEAD_BONE], (curve_value(spec.head_pitch, u), 0.0, curve_value(spec.head_roll, u)), frame)
        if not spec.guard_break:
            arm = curve_value(spec.arm_open, u)
            add_rotation_delta(armature.pose.bones["upperarm_l"], (-arm * 0.22, 0.0, -arm), frame)
            add_rotation_delta(armature.pose.bones["upperarm_r"], (-arm * 0.22, 0.0, arm), frame)
    for fcurve in action.fcurves:
        for key in fcurve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"


def dual_foot_locks(scene: bpy.types.Scene, armature: bpy.types.Object, spec: ReactionSpec) -> List[bpy.types.Object]:
    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    controls: List[bpy.types.Object] = []
    prefix = spec.action_name.replace("BF_", "BF2_")
    for suffix in ("l", "r"):
        thigh = f"thigh_{suffix}"
        calf = f"calf_{suffix}"
        foot = f"foot_{suffix}"
        hip = v1.pose_head(armature, thigh)
        knee = v1.pose_head(armature, calf)
        ankle = v1.pose_tail(armature, calf)
        target = v1.make_control(f"{prefix}_CTRL_foot_{suffix}", armature, ankle)
        pole = v1.make_control(f"{prefix}_CTRL_knee_{suffix}", armature, v1.chain_pole(hip, knee, ankle, scale=1.7))
        ik = armature.pose.bones[calf].constraints.new(type="IK")
        ik.name = f"{prefix}_{suffix.upper()}FootPositionLockIK"
        ik.target = target
        ik.pole_target = pole
        ik.chain_count = 2
        ik.influence = 1.0
        foot_world = rig.pose_world_matrix(armature, foot)
        orientation = rig.make_matrix_control(f"{prefix}_CTRL_foot_{suffix}_orientation", foot_world, 0.06)
        copy_rot = armature.pose.bones[foot].constraints.new(type="COPY_ROTATION")
        copy_rot.name = f"{prefix}_{suffix.upper()}FootOrientationLock"
        copy_rot.target = orientation
        copy_rot.owner_space = "WORLD"
        copy_rot.target_space = "WORLD"
        copy_rot.mix_mode = "REPLACE"
        copy_rot.influence = 1.0
        controls.extend((target, pole, orientation))
    return controls


def guard_break_hands(scene: bpy.types.Scene, armature: bpy.types.Object, spec: ReactionSpec) -> List[bpy.types.Object]:
    if not spec.guard_break:
        return []
    frames = (spec.start_frame, spec.impact_frame, min(spec.end_frame, spec.impact_frame + 6), spec.settle_frame, spec.end_frame)
    names = ("upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r")
    positions = v1.evaluated_positions(scene, armature, frames, names)
    start_l = positions[spec.start_frame]["hand_l"]
    start_r = positions[spec.start_frame]["hand_r"]
    lateral = start_l - start_r
    lateral.z = 0.0
    if lateral.length < 1e-5:
        lateral = Vector((1.0, 0.0, 0.0))
    lateral.normalize()
    up = Vector((0.0, 0.0, 1.0))
    guard_l = start_l + up * 0.13 - lateral * 0.015
    guard_r = start_r + up * 0.13 + lateral * 0.015
    open_l = guard_l + lateral * 0.24 - up * 0.06
    open_r = guard_r - lateral * 0.24 - up * 0.06
    controls: List[bpy.types.Object] = []
    prefix = spec.action_name.replace("BF_", "BF2_")
    for suffix, guard, opened in (("l", guard_l, open_l), ("r", guard_r, open_r)):
        hand = f"hand_{suffix}"
        upper = f"upperarm_{suffix}"
        lower = f"lowerarm_{suffix}"
        target = v1.make_control(f"{prefix}_CTRL_hand_{suffix}", armature, guard)
        keys = (
            (spec.start_frame, guard),
            (spec.impact_frame, opened),
            (min(spec.end_frame, spec.impact_frame + 6), opened * 0.94 + guard * 0.06),
            (spec.settle_frame, guard * 0.88 + positions[spec.settle_frame][hand] * 0.12),
            (spec.end_frame, positions[spec.end_frame][hand]),
        )
        v1.set_control_keys(target, armature, keys)
        shoulder = positions[spec.impact_frame][upper]
        elbow = positions[spec.impact_frame][lower]
        wrist = positions[spec.impact_frame][hand]
        pole = v1.make_control(f"{prefix}_CTRL_elbow_{suffix}", armature, v1.chain_pole(shoulder, elbow, wrist, scale=2.0))
        ik = armature.pose.bones[lower].constraints.new(type="IK")
        ik.name = f"{prefix}_{suffix.upper()}GuardBreakHandIK"
        ik.target = target
        ik.pole_target = pole
        ik.chain_count = 2
        ik.influence = 1.0
        controls.extend((target, pole))
    return controls


def world_position(armature: bpy.types.Object, bone_name: str) -> Vector:
    return rig.pose_world_matrix(armature, bone_name).translation.copy()


def action_metrics(scene: bpy.types.Scene, armature: bpy.types.Object, spec: ReactionSpec) -> dict:
    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    start_torso = rig.pose_world_matrix(armature, "spine_03").to_quaternion()
    start_head = rig.pose_world_matrix(armature, HEAD_BONE).to_quaternion()
    start_pelvis = world_position(armature, "pelvis")
    start_left_foot = world_position(armature, "foot_l")
    start_right_foot = world_position(armature, "foot_r")
    start_left_foot_q = rig.pose_world_matrix(armature, "foot_l").to_quaternion()
    start_right_foot_q = rig.pose_world_matrix(armature, "foot_r").to_quaternion()
    start_sep = (world_position(armature, "hand_l") - world_position(armature, "hand_r")).length
    torso_excursion = 0.0
    head_excursion = 0.0
    pelvis_vertical = 0.0
    left_foot_drift = 0.0
    right_foot_drift = 0.0
    left_foot_angle = 0.0
    right_foot_angle = 0.0
    max_hand_sep = start_sep
    for frame in range(spec.start_frame, spec.end_frame + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        torso_excursion = max(torso_excursion, math.degrees(start_torso.rotation_difference(rig.pose_world_matrix(armature, "spine_03").to_quaternion()).angle))
        head_excursion = max(head_excursion, math.degrees(start_head.rotation_difference(rig.pose_world_matrix(armature, HEAD_BONE).to_quaternion()).angle))
        pelvis_vertical = max(pelvis_vertical, abs(world_position(armature, "pelvis").z - start_pelvis.z))
        left_foot_drift = max(left_foot_drift, (world_position(armature, "foot_l") - start_left_foot).length)
        right_foot_drift = max(right_foot_drift, (world_position(armature, "foot_r") - start_right_foot).length)
        left_foot_angle = max(left_foot_angle, math.degrees(start_left_foot_q.rotation_difference(rig.pose_world_matrix(armature, "foot_l").to_quaternion()).angle))
        right_foot_angle = max(right_foot_angle, math.degrees(start_right_foot_q.rotation_difference(rig.pose_world_matrix(armature, "foot_r").to_quaternion()).angle))
        max_hand_sep = max(max_hand_sep, (world_position(armature, "hand_l") - world_position(armature, "hand_r")).length)
    scene.frame_set(spec.end_frame)
    bpy.context.view_layer.update()
    settle_residual = math.degrees(start_torso.rotation_difference(rig.pose_world_matrix(armature, "spine_03").to_quaternion()).angle)
    return {
        "version": spec.version,
        "action": spec.action_name,
        "sourceAction": spec.source_action_hint,
        "headBone": HEAD_BONE,
        "fps": FPS,
        "startFrame": spec.start_frame,
        "endFrame": spec.end_frame,
        "durationSeconds": (spec.end_frame - spec.start_frame) / FPS,
        "impactFrame": spec.impact_frame,
        "torsoExcursionDegrees": torso_excursion,
        "headExcursionDegrees": head_excursion,
        "pelvisVerticalExcursion": pelvis_vertical,
        "leftFootDriftMax": left_foot_drift,
        "rightFootDriftMax": right_foot_drift,
        "leftFootAngularDriftDegrees": left_foot_angle,
        "rightFootAngularDriftDegrees": right_foot_angle,
        "handSeparationIncrease": max_hand_sep - start_sep,
        "settleTorsoResidualDegrees": settle_residual,
        "boneCount": len(armature.pose.bones),
        "meshCount": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
    }


def build_reaction(scene: bpy.types.Scene, armature: bpy.types.Object, spec: ReactionSpec):
    configure_source(spec)
    source = v1.find_source_action()
    source_name = source.name
    samples = v1.sample_source_basis(scene, armature, source)
    base = v1.key_pose_basis(scene, armature, f"{spec.action_name}_BASE", samples)
    armature.animation_data.action = base
    apply_body_direction(scene, armature, spec)
    foot_controls = dual_foot_locks(scene, armature, spec)
    hand_controls = guard_break_hands(scene, armature, spec)
    constrained = action_metrics(scene, armature, spec)
    baked = v1.bake_visual_action(scene, armature, constrained)
    baked.use_fake_user = True
    v1.remove_controls([*foot_controls, *hand_controls])
    armature.animation_data.action = baked
    metrics = action_metrics(scene, armature, spec)
    metrics["sourceAction"] = source_name
    metrics["constrained"] = constrained
    metrics["sharedRig"] = "MOTION_FOUNDRY_V2_REACTION_RIG"
    metrics["pipeline"] = [
        f"{spec.source_action_hint} whole-body source",
        "reaction-specific nonlinear retiming",
        "authored pelvis/spine/head recoil chain",
        "dual planted-foot position and orientation locks",
        "dual high-guard blow-open IK" if spec.guard_break else "source-driven arm recoil with authored shoulder spread",
        "Blender native NLA visual-keying bake",
        "glTF Action export",
    ]
    return baked, metrics


def main() -> None:
    args = parse_args()
    source_path = os.path.abspath(args.source)
    output_dir = Path(args.output_dir).resolve()
    v1.reset_scene()
    armature = v1.import_source(source_path)
    ensure_bones(armature)
    scene = bpy.context.scene
    scene.render.fps = FPS
    actions = []
    moves = []
    for spec in REACTIONS:
        action, metrics = build_reaction(scene, armature, spec)
        actions.append(action)
        moves.append(metrics)
    summary = {
        "version": "BLENDER_MOTION_FOUNDRY_V2_REACTIONS",
        "sharedRig": "MOTION_FOUNDRY_V2_REACTION_RIG",
        "fps": FPS,
        "actions": [action.name for action in actions],
        "moves": moves,
        "boneCount": len(armature.pose.bones),
    }
    rig.export_action_library(
        scene,
        armature,
        output_dir,
        actions,
        summary,
        glb_name="blender-reactions-core.glb",
        blend_name="blender-reactions-core-v2.blend",
        metrics_name="blender-reactions-core.metrics.json",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
