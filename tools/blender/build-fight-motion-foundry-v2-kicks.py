#!/usr/bin/env python3
"""Build Blender-authored grounded kicks on the shared Motion Foundry v2 rig."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
from typing import List, Tuple

import bpy
from mathutils import Matrix, Quaternion, Vector

import motion_foundry_v2_rig as rig


PhaseOffsets = Tuple[
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
]


@dataclass(frozen=True)
class KickSpec:
    action_name: str
    version: str
    end_frame: int
    load_frame: int
    precontact_frame: int
    impact_frame: int
    overtravel_frame: int
    recovery_frame: int
    strike_side: str
    support_side: str
    foot_offsets: PhaseOffsets  # (forward, lateral, vertical), in body-relative metres
    foot_pitch: rig.PhaseValues
    foot_yaw: rig.PhaseValues
    ik_influences: rig.PhaseValues
    pelvis_forward: rig.PhaseValues
    pelvis_drop: rig.PhaseValues
    pelvis_yaw: rig.PhaseValues
    lower_yaw: rig.PhaseValues
    upper_yaw: rig.PhaseValues
    pelvis_pitch: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    lower_pitch: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    upper_pitch: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    source_action_hint: str = "Idle_Loop"
    source_knots: Tuple[Tuple[float, float], ...] = ((0.0, 0.0), (1.0, 1.0))
    hand_scales: rig.HandScales = (None, None, None, None, None, None, None)
    hand_offsets: rig.HandOffsets = ((0.0, 0.0, 0.0),) * 7
    knee_pole_scale: float = 2.2

    @property
    def start_frame(self) -> int:
        return 1

    @property
    def phases(self) -> Tuple[int, int, int, int, int, int, int]:
        return (
            self.start_frame,
            self.load_frame,
            self.precontact_frame,
            self.impact_frame,
            self.overtravel_frame,
            self.recovery_frame,
            self.end_frame,
        )

    @property
    def strike_suffix(self) -> str:
        return self.strike_side.lower()

    @property
    def support_suffix(self) -> str:
        return self.support_side.lower()


FRONT_KICK = KickSpec(
    action_name="BF_FrontKick_R",
    version="BLENDER_MOTION_FOUNDRY_V2_FRONT_KICK",
    end_frame=43,
    load_frame=7,
    precontact_frame=18,
    impact_frame=24,
    overtravel_frame=27,
    recovery_frame=35,
    strike_side="r",
    support_side="l",
    foot_offsets=(
        (0.00, 0.00, 0.00),
        (-0.05, 0.00, 0.16),
        (0.20, 0.00, 0.24),
        (0.43, 0.00, 0.21),
        (0.47, 0.00, 0.18),
        (0.02, 0.00, 0.16),
        (0.00, 0.00, 0.00),
    ),
    foot_pitch=(0.0, 10.0, -4.0, -18.0, -22.0, 5.0, 0.0),
    foot_yaw=(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
    ik_influences=(0.0, 0.72, 0.94, 1.0, 1.0, 0.74, 0.0),
    pelvis_forward=(0.000, -0.010, 0.005, 0.022, 0.025, 0.002, 0.000),
    pelvis_drop=(0.000, -0.025, -0.008, 0.008, 0.010, -0.010, 0.000),
    pelvis_yaw=(0.0, -2.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    lower_yaw=(0.0, -3.0, 3.0, 6.0, 7.0, 1.5, 0.0),
    upper_yaw=(0.0, -3.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    pelvis_pitch=(0.0, -2.0, -3.0, -5.0, -5.0, -1.0, 0.0),
    lower_pitch=(0.0, -2.0, -4.0, -6.0, -6.0, -1.0, 0.0),
    upper_pitch=(0.0, 1.0, 2.0, 3.0, 3.0, 1.0, 0.0),
)

LOW_KICK = KickSpec(
    action_name="BF_LowKick_L",
    version="BLENDER_MOTION_FOUNDRY_V2_LOW_KICK",
    end_frame=46,
    load_frame=8,
    precontact_frame=19,
    impact_frame=25,
    overtravel_frame=29,
    recovery_frame=38,
    strike_side="l",
    support_side="r",
    foot_offsets=(
        (0.00, 0.00, 0.00),
        (-0.04, 0.05, 0.12),
        (0.17, 0.11, 0.13),
        (0.33, 0.18, 0.10),
        (0.35, 0.23, 0.09),
        (0.00, 0.06, 0.11),
        (0.00, 0.00, 0.00),
    ),
    foot_pitch=(0.0, 8.0, 2.0, -7.0, -10.0, 5.0, 0.0),
    foot_yaw=(0.0, 8.0, 28.0, 54.0, 68.0, 12.0, 0.0),
    ik_influences=(0.0, 0.68, 0.92, 1.0, 1.0, 0.70, 0.0),
    pelvis_forward=(0.000, -0.014, 0.004, 0.020, 0.023, 0.001, 0.000),
    pelvis_drop=(0.000, -0.028, -0.014, -0.004, -0.002, -0.012, 0.000),
    pelvis_yaw=(0.0, -5.0, 8.0, 18.0, 23.0, 4.0, 0.0),
    lower_yaw=(0.0, -7.0, 12.0, 25.0, 31.0, 6.0, 0.0),
    upper_yaw=(0.0, -5.0, 8.0, 16.0, 20.0, 4.0, 0.0),
    pelvis_pitch=(0.0, -1.0, -2.0, -2.0, -1.0, 0.0, 0.0),
)

RISING_KICK = KickSpec(
    action_name="BF_RisingKick_R",
    version="BLENDER_MOTION_FOUNDRY_V2_RISING_KICK",
    end_frame=49,
    load_frame=9,
    precontact_frame=21,
    impact_frame=28,
    overtravel_frame=32,
    recovery_frame=41,
    strike_side="r",
    support_side="l",
    foot_offsets=(
        (0.00, 0.00, 0.00),
        (-0.06, 0.00, 0.17),
        (0.12, 0.00, 0.36),
        (0.25, 0.00, 0.59),
        (0.24, 0.00, 0.64),
        (0.00, 0.00, 0.18),
        (0.00, 0.00, 0.00),
    ),
    foot_pitch=(0.0, 12.0, -10.0, -34.0, -42.0, 5.0, 0.0),
    foot_yaw=(0.0, 0.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    ik_influences=(0.0, 0.70, 0.94, 1.0, 1.0, 0.72, 0.0),
    pelvis_forward=(0.000, -0.012, 0.000, 0.014, 0.015, 0.000, 0.000),
    pelvis_drop=(0.000, -0.040, -0.024, -0.005, 0.000, -0.018, 0.000),
    pelvis_yaw=(0.0, -3.0, 3.0, 7.0, 8.0, 2.0, 0.0),
    lower_yaw=(0.0, -4.0, 4.0, 9.0, 10.0, 2.0, 0.0),
    upper_yaw=(0.0, -3.0, 2.0, 5.0, 6.0, 1.0, 0.0),
    pelvis_pitch=(0.0, -3.0, -6.0, -10.0, -11.0, -2.0, 0.0),
    lower_pitch=(0.0, -3.0, -7.0, -12.0, -13.0, -3.0, 0.0),
    upper_pitch=(0.0, 2.0, 5.0, 8.0, 9.0, 2.0, 0.0),
)

KICK_SPECS = (FRONT_KICK, LOW_KICK, RISING_KICK)


def body_axes(scene: bpy.types.Scene, armature: bpy.types.Object) -> Tuple[Vector, Vector, Vector]:
    """Infer forward from Punch_Cross so move specs remain axis-agnostic."""
    action = next((a for a in bpy.data.actions if "Punch_Cross" in a.name), None)
    if action is None:
        raise RuntimeError("Punch_Cross is required to infer the fighter forward axis")
    armature.animation_data.action = action
    start, end = action.frame_range
    rig.v1.set_scene_frame(scene, start)
    start_hand = rig.v1.pose_head(armature, "hand_r")
    best = Vector((0.0, 1.0, 0.0))
    best_len = 0.0
    for i in range(17):
        frame = start + (end - start) * i / 16
        rig.v1.set_scene_frame(scene, frame)
        delta = rig.v1.pose_head(armature, "hand_r") - start_hand
        delta.z = 0.0
        if delta.length > best_len:
            best = delta.copy()
            best_len = delta.length
    if best_len < 1e-4:
        raise RuntimeError("Punch_Cross did not provide a usable planar forward axis")
    forward = best.normalized()
    up = Vector((0.0, 0.0, 1.0))
    left = up.cross(forward).normalized()
    return forward, left, up


def ensure_kick_bones(armature: bpy.types.Object, spec: KickSpec) -> None:
    required = (
        "pelvis", "spine_02", "spine_03",
        f"thigh_{spec.strike_suffix}", f"calf_{spec.strike_suffix}", f"foot_{spec.strike_suffix}",
        f"thigh_{spec.support_suffix}", f"calf_{spec.support_suffix}", f"foot_{spec.support_suffix}",
    )
    missing = [name for name in required if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"{spec.action_name}: required kick bones missing: {missing}")
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"


def key_orientation(control: bpy.types.Object, base: Matrix, frame: int, pitch_deg: float, yaw_deg: float) -> None:
    loc, rot, scale = base.decompose()
    yaw = Quaternion(Vector((0.0, 0.0, 1.0)), math.radians(yaw_deg))
    pitch = Quaternion(Vector((1.0, 0.0, 0.0)), math.radians(pitch_deg))
    rig.key_matrix(control, frame, Matrix.LocRotScale(loc, yaw @ pitch @ rot, scale))


def add_kick_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    spec: KickSpec,
    forward: Vector,
    left: Vector,
    up: Vector,
):
    strike = spec.strike_suffix
    support = spec.support_suffix
    thigh_name, calf_name, foot_name = f"thigh_{strike}", f"calf_{strike}", f"foot_{strike}"
    s_thigh, s_calf, s_foot = f"thigh_{support}", f"calf_{support}", f"foot_{support}"
    names = (thigh_name, calf_name, foot_name, s_thigh, s_calf, s_foot)
    armature.animation_data.action = base_action
    positions = rig.v1.evaluated_positions(scene, armature, spec.phases, names)

    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    strike_ankle = rig.v1.pose_tail(armature, calf_name)
    strike_target = rig.v1.make_control(f"{spec.action_name}_CTRL_strike_foot", armature, strike_ankle)
    keys = []
    side_sign = 1.0 if strike == "l" else -1.0
    for frame, (fwd, lateral, vertical) in zip(spec.phases, spec.foot_offsets):
        offset = forward * fwd + left * (lateral * side_sign) + up * vertical
        keys.append((frame, strike_ankle + offset))
    rig.v1.set_control_keys(strike_target, armature, keys)

    hip = positions[spec.impact_frame][thigh_name]
    knee = positions[spec.impact_frame][calf_name]
    ankle = positions[spec.impact_frame][foot_name]
    knee_pole = rig.v1.make_control(
        f"{spec.action_name}_CTRL_strike_knee",
        armature,
        rig.v1.chain_pole(hip, knee, ankle, scale=spec.knee_pole_scale),
    )
    calf = armature.pose.bones[calf_name]
    strike_ik = calf.constraints.new(type="IK")
    strike_ik.name = f"{spec.action_name}_StrikeLegIK"
    strike_ik.target = strike_target
    strike_ik.pole_target = knee_pole
    strike_ik.chain_count = 2
    for frame, influence in zip(spec.phases, spec.ik_influences):
        strike_ik.influence = influence
        strike_ik.keyframe_insert(data_path="influence", frame=frame)

    strike_foot_world = rig.pose_world_matrix(armature, foot_name)
    strike_orientation = rig.make_matrix_control(f"{spec.action_name}_CTRL_strike_foot_orientation", strike_foot_world, 0.065)
    strike_rot = armature.pose.bones[foot_name].constraints.new(type="COPY_ROTATION")
    strike_rot.name = f"{spec.action_name}_StrikeFootOrientation"
    strike_rot.target = strike_orientation
    strike_rot.owner_space = "WORLD"
    strike_rot.target_space = "WORLD"
    strike_rot.mix_mode = "REPLACE"
    for frame, pitch, yaw in zip(spec.phases, spec.foot_pitch, spec.foot_yaw):
        key_orientation(strike_orientation, strike_foot_world, frame, pitch, yaw * side_sign)
        strike_rot.influence = rig.phase_value(frame, tuple(zip(spec.phases, spec.ik_influences)))
        strike_rot.keyframe_insert(data_path="influence", frame=frame)
    rig.smooth_control_curves(strike_orientation)

    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    support_ankle = rig.v1.pose_tail(armature, s_calf)
    support_target = rig.v1.make_control(f"{spec.action_name}_CTRL_support_foot", armature, support_ankle)
    support_knee = positions[spec.start_frame][s_calf]
    support_hip = positions[spec.start_frame][s_thigh]
    support_pole = rig.v1.make_control(
        f"{spec.action_name}_CTRL_support_knee",
        armature,
        rig.v1.chain_pole(support_hip, support_knee, support_ankle, scale=1.9),
    )
    support_calf = armature.pose.bones[s_calf]
    support_ik = support_calf.constraints.new(type="IK")
    support_ik.name = f"{spec.action_name}_SupportFootPositionLockIK"
    support_ik.target = support_target
    support_ik.pole_target = support_pole
    support_ik.chain_count = 2
    support_ik.influence = 1.0

    support_world = rig.pose_world_matrix(armature, s_foot)
    support_orientation = rig.make_matrix_control(f"{spec.action_name}_CTRL_support_foot_orientation", support_world, 0.065)
    support_rot = armature.pose.bones[s_foot].constraints.new(type="COPY_ROTATION")
    support_rot.name = f"{spec.action_name}_SupportFootOrientationLock"
    support_rot.target = support_orientation
    support_rot.owner_space = "WORLD"
    support_rot.target_space = "WORLD"
    support_rot.mix_mode = "REPLACE"
    support_rot.influence = 1.0

    return [strike_target, knee_pole, strike_orientation, support_target, support_pole, support_orientation]


def foot_travel(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    foot = f"foot_{spec.strike_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start = rig.v1.pose_head(armature, foot)
    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()
    return (rig.v1.pose_head(armature, foot) - start).length


def support_drift(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    calf = f"calf_{spec.support_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start = rig.v1.pose_tail(armature, calf)
    maximum = 0.0
    for frame in range(spec.start_frame, spec.end_frame + 1):
        scene.frame_set(frame); bpy.context.view_layer.update()
        maximum = max(maximum, (rig.v1.pose_tail(armature, calf) - start).length)
    return maximum


def support_angle(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    foot = f"foot_{spec.support_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start = rig.pose_world_matrix(armature, foot).to_quaternion()
    maximum = 0.0
    for frame in range(spec.start_frame, spec.end_frame + 1):
        scene.frame_set(frame); bpy.context.view_layer.update()
        current = rig.pose_world_matrix(armature, foot).to_quaternion()
        maximum = max(maximum, math.degrees(start.rotation_difference(current).angle))
    return maximum


def build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes):
    rig.configure_v1_for_spec(spec)
    ensure_kick_bones(armature, spec)
    source = rig.v1.find_source_action()
    source_name = source.name
    samples = rig.v1.sample_source_basis(scene, armature, source)
    base = rig.v1.key_pose_basis(scene, armature, f"{spec.action_name}_BASE", samples)
    armature.animation_data.action = base
    controls = add_kick_controls(scene, armature, base, spec, *axes)
    strike_world = armature.matrix_world.to_3x3() @ axes[0]
    masters = rig.add_master_controls(scene, armature, base, strike_world, spec)

    constrained = {
        "constrainedStrikeFootTravel": foot_travel(scene, armature, spec),
        "constrainedSupportFootLockMaxDrift": support_drift(scene, armature, spec),
        "constrainedSupportFootLockMaxAngularDriftDegrees": support_angle(scene, armature, spec),
        "constrainedPelvisTravel": rig.pelvis_travel(scene, armature, spec),
        "constrainedTorsoTwistDegrees": rig.torso_twist_degrees(scene, armature, spec),
    }
    final_action = rig.v1.bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    rig.v1.remove_controls([*controls, *masters])
    metrics = {
        "version": spec.version,
        "action": spec.action_name,
        "sourceAction": source_name,
        "fps": rig.FPS,
        "startFrame": spec.start_frame,
        "endFrame": spec.end_frame,
        "durationSeconds": (spec.end_frame - spec.start_frame) / rig.FPS,
        "impactFrame": spec.impact_frame,
        "strikeSide": spec.strike_side.upper(),
        "supportSide": spec.support_side.upper(),
        "strikeFootTravel": foot_travel(scene, armature, spec),
        "supportFootLockMaxDrift": support_drift(scene, armature, spec),
        "supportFootLockMaxAngularDriftDegrees": support_angle(scene, armature, spec),
        "pelvisTravel": rig.pelvis_travel(scene, armature, spec),
        "torsoTwistDegrees": rig.torso_twist_degrees(scene, armature, spec),
        **constrained,
        "boneCount": len(armature.pose.bones),
        "meshCount": len([o for o in bpy.context.scene.objects if o.type == "MESH"]),
        "sharedRig": "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG",
        "pipeline": [
            "Idle_Loop whole-body base",
            "shared COG/pelvis and staged torso masters",
            f"{spec.strike_side.upper()} strike-leg two-bone IK",
            "move-specific strike-foot orientation",
            f"world-space {spec.support_side.upper()} support-foot position lock",
            f"world-space {spec.support_side.upper()} support-foot orientation lock",
            "Blender native NLA visual-keying bake",
            "glTF Action export",
        ],
    }
    return final_action, metrics


def _argv_after_double_dash() -> List[str]:
    import sys
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(_argv_after_double_dash())
    rig.v1.reset_scene()
    armature = rig.v1.import_source(os.path.abspath(args.source))
    scene = bpy.context.scene
    axes = body_axes(scene, armature)
    actions, moves = [], []
    for spec in KICK_SPECS:
        action, metrics = build_kick_action(scene, armature, spec, axes)
        actions.append(action); moves.append(metrics)
    summary = {
        "version": "BLENDER_MOTION_FOUNDRY_V2_KICKS",
        "sharedRig": "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG",
        "fps": rig.FPS,
        "actions": [s.action_name for s in KICK_SPECS],
        "moves": moves,
        "boneCount": len(armature.pose.bones),
    }
    rig.export_action_library(
        scene, armature, Path(args.output_dir).resolve(), actions, summary,
        glb_name="blender-kicks-core.glb",
        blend_name="blender-kicks-core-v2.blend",
        metrics_name="blender-kicks-core.metrics.json",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
