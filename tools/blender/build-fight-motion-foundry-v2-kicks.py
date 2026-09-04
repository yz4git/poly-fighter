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
    foot_offsets: PhaseOffsets
    foot_pitch: rig.PhaseValues
    foot_yaw: rig.PhaseValues
    support_yaw: rig.PhaseValues
    ik_influences: rig.PhaseValues
    pelvis_forward: rig.PhaseValues
    pelvis_drop: rig.PhaseValues
    pelvis_yaw: rig.PhaseValues
    lower_yaw: rig.PhaseValues
    upper_yaw: rig.PhaseValues
    pelvis_pitch: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    lower_pitch: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    upper_pitch: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    source_action_hint: str = "Idle_Loop_Armature"
    source_knots: Tuple[Tuple[float, float], ...] = ((0.0, 0.0), (1.0, 1.0))
    hand_scales: rig.HandScales = (None, None, None, None, None, None, None)
    hand_offsets: rig.HandOffsets = ((0.0, 0.0, 0.0),) * 7
    knee_pole_scale: float = 2.2
    guard_influences: rig.PhaseValues = (0.0, 0.68, 0.94, 1.0, 1.0, 0.70, 0.0)
    guard_forward: float = 0.105
    guard_width: float = 0.105
    guard_height: float = 0.155
    reach_ratios: rig.PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    reach_directions: PhaseOffsets = ((0.0, 0.0, 0.0),) * 7

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
    def reference_pose_frames(self) -> Tuple[int, int, int, int, int]:
        # Five readable checkpoints from the generated reference sheets.
        return (self.start_frame, self.load_frame, self.impact_frame, self.recovery_frame, self.end_frame)

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
        (-0.06, 0.00, 0.27),
        (0.31, 0.00, 0.36),
        (0.72, 0.00, 0.37),
        (0.76, 0.00, 0.35),
        (-0.02, 0.00, 0.25),
        (0.00, 0.00, 0.00),
    ),
    foot_pitch=(0.0, 10.0, -5.0, -20.0, -24.0, 5.0, 0.0),
    foot_yaw=(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
    support_yaw=(0.0, -2.0, -7.0, -12.0, -14.0, -4.0, 0.0),
    ik_influences=(0.0, 0.74, 0.96, 1.0, 1.0, 0.76, 0.0),
    pelvis_forward=(0.000, -0.015, 0.015, 0.065, 0.078, 0.008, 0.000),
    pelvis_drop=(0.000, -0.045, -0.040, -0.032, -0.025, -0.020, 0.000),
    pelvis_yaw=(0.0, -2.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    lower_yaw=(0.0, -3.0, 3.0, 6.0, 7.0, 1.5, 0.0),
    upper_yaw=(0.0, -3.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    pelvis_pitch=(0.0, -3.0, -6.0, -8.0, -8.0, -2.0, 0.0),
    lower_pitch=(0.0, -4.0, -8.0, -10.0, -10.0, -3.0, 0.0),
    upper_pitch=(0.0, -2.0, -5.0, -7.0, -7.0, -2.0, 0.0),
    reach_ratios=(0.0, 0.0, 0.88, 0.962, 0.966, 0.0, 0.0),
    reach_directions=(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        (0.92, 0.0, 0.39),
        (0.94, 0.0, 0.34),
        (0.95, 0.0, 0.31),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
    ),
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
        (-0.05, 0.08, 0.18),
        (0.18, 0.18, 0.20),
        (0.34, 0.27, 0.18),
        (0.36, 0.31, 0.17),
        (0.02, 0.08, 0.14),
        (0.00, 0.00, 0.00),
    ),
    foot_pitch=(0.0, 8.0, 2.0, -8.0, -11.0, 5.0, 0.0),
    foot_yaw=(0.0, 10.0, 34.0, 66.0, 78.0, 16.0, 0.0),
    support_yaw=(0.0, 3.0, 12.0, 26.0, 32.0, 8.0, 0.0),
    ik_influences=(0.0, 0.70, 0.94, 1.0, 1.0, 0.72, 0.0),
    pelvis_forward=(0.000, -0.020, 0.012, 0.050, 0.060, 0.006, 0.000),
    pelvis_drop=(0.000, -0.040, -0.038, -0.030, -0.026, -0.020, 0.000),
    pelvis_yaw=(0.0, -8.0, 14.0, 28.0, 34.0, 7.0, 0.0),
    lower_yaw=(0.0, -10.0, 20.0, 38.0, 46.0, 9.0, 0.0),
    upper_yaw=(0.0, -6.0, 6.0, 8.0, 10.0, 3.0, 0.0),
    pelvis_pitch=(0.0, -2.0, -4.0, -5.0, -5.0, -1.0, 0.0),
    lower_pitch=(0.0, -2.0, -4.0, -5.0, -4.0, -1.0, 0.0),
    upper_pitch=(0.0, -2.0, -4.0, -6.0, -6.0, -2.0, 0.0),
    guard_width=0.12,
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
        (-0.07, 0.00, 0.29),
        (0.29, 0.00, 0.52),
        (0.68, 0.00, 0.78),
        (0.72, 0.00, 0.84),
        (-0.02, 0.00, 0.30),
        (0.00, 0.00, 0.00),
    ),
    foot_pitch=(0.0, 12.0, -8.0, -24.0, -30.0, 5.0, 0.0),
    foot_yaw=(0.0, 0.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    support_yaw=(0.0, -3.0, -9.0, -18.0, -22.0, -6.0, 0.0),
    ik_influences=(0.0, 0.72, 0.96, 1.0, 1.0, 0.74, 0.0),
    pelvis_forward=(0.000, -0.016, 0.012, 0.055, 0.065, 0.006, 0.000),
    pelvis_drop=(0.000, -0.050, -0.050, -0.040, -0.030, -0.024, 0.000),
    pelvis_yaw=(0.0, -3.0, 3.0, 7.0, 8.0, 2.0, 0.0),
    lower_yaw=(0.0, -4.0, 4.0, 9.0, 10.0, 2.0, 0.0),
    upper_yaw=(0.0, -3.0, 2.0, 5.0, 6.0, 1.0, 0.0),
    pelvis_pitch=(0.0, -4.0, -7.0, -10.0, -11.0, -3.0, 0.0),
    lower_pitch=(0.0, -5.0, -9.0, -12.0, -13.0, -4.0, 0.0),
    upper_pitch=(0.0, -3.0, -6.0, -9.0, -10.0, -3.0, 0.0),
    guard_height=0.165,
    reach_ratios=(0.0, 0.0, 0.88, 0.955, 0.962, 0.0, 0.0),
    reach_directions=(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        (0.78, 0.0, 0.62),
        (0.82, 0.0, 0.57),
        (0.84, 0.0, 0.54),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
    ),
)

KICK_SPECS = (FRONT_KICK, LOW_KICK, RISING_KICK)


def _find_action_exact(name: str) -> bpy.types.Action:
    exact = next((action for action in bpy.data.actions if action.name == name), None)
    if exact is not None:
        return exact
    raise RuntimeError(f"Required action {name!r} missing; available: {[a.name for a in bpy.data.actions]}")


def body_axes(scene: bpy.types.Scene, armature: bpy.types.Object) -> Tuple[Vector, Vector, Vector]:
    """Derive left from shoulders and forward sign from max Cross hand-to-pelvis reach."""
    idle = _find_action_exact("Idle_Loop_Armature")
    armature.animation_data.action = idle
    rig.v1.set_scene_frame(scene, idle.frame_range[0])
    left_shoulder = rig.v1.pose_head(armature, "upperarm_l")
    right_shoulder = rig.v1.pose_head(armature, "upperarm_r")
    left = left_shoulder - right_shoulder
    left.z = 0.0
    if left.length < 1e-4:
        raise RuntimeError("Shoulder span did not provide a usable anatomical left axis")
    left.normalize()
    up = Vector((0.0, 0.0, 1.0))
    forward = left.cross(up)
    if forward.length < 1e-4:
        raise RuntimeError("Shoulder axis did not provide a usable forward axis")
    forward.normalize()

    cross = next((a for a in bpy.data.actions if a.name == "Punch_Cross_Armature"), None)
    if cross is None:
        cross = next((a for a in bpy.data.actions if "Punch_Cross" in a.name), None)
    if cross is None:
        raise RuntimeError("Punch_Cross is required to choose forward sign")
    armature.animation_data.action = cross
    start, end = cross.frame_range
    best_reach = Vector((0.0, 0.0, 0.0))
    best_length = -1.0
    for i in range(33):
        frame = start + (end - start) * i / 32
        rig.v1.set_scene_frame(scene, frame)
        hand = rig.v1.pose_head(armature, "hand_r")
        pelvis = rig.v1.pose_head(armature, "pelvis")
        reach = hand - pelvis
        reach.z = 0.0
        if reach.length > best_length:
            best_reach = reach.copy()
            best_length = reach.length
    if best_length < 1e-4:
        raise RuntimeError("Punch_Cross did not provide a usable hand-to-pelvis reach vector")
    if best_reach.dot(forward) < 0.0:
        forward.negate()
    return forward, left, up


def ensure_kick_bones(armature: bpy.types.Object, spec: KickSpec) -> None:
    required = (
        "pelvis", "spine_02", "spine_03",
        "upperarm_l", "lowerarm_l", "hand_l",
        "upperarm_r", "lowerarm_r", "hand_r",
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
    start_hip = positions[spec.start_frame][thigh_name]
    start_knee = positions[spec.start_frame][calf_name]
    start_foot = positions[spec.start_frame][foot_name]
    upper_leg_length = (start_hip - start_knee).length
    lower_leg_length = (start_knee - start_foot).length
    leg_length = upper_leg_length + lower_leg_length
    if leg_length < 1e-4:
        raise RuntimeError(f"{spec.action_name}: strike leg did not provide a usable authored length")
    for frame, (fwd, lateral, vertical), reach_ratio, reach_direction in zip(
        spec.phases, spec.foot_offsets, spec.reach_ratios, spec.reach_directions
    ):
        if reach_ratio > 0.0:
            dir_fwd, dir_lateral, dir_up = reach_direction
            direction = forward * dir_fwd + left * (dir_lateral * side_sign) + up * dir_up
            if direction.length < 1e-4:
                raise RuntimeError(f"{spec.action_name}: hip-relative reach direction is degenerate at frame {frame}")
            direction.normalize()
            target = positions[frame][thigh_name] + direction * (leg_length * reach_ratio)
        else:
            offset = forward * fwd + left * (lateral * side_sign) + up * vertical
            target = strike_ankle + offset
        keys.append((frame, target))
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
    for frame, yaw in zip(spec.phases, spec.support_yaw):
        key_orientation(support_orientation, support_world, frame, 0.0, yaw)
    support_rot.influence = 1.0
    rig.smooth_control_curves(support_orientation)

    return [strike_target, knee_pole, strike_orientation, support_target, support_pole, support_orientation]


def add_guard_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    spec: KickSpec,
    forward: Vector,
    left: Vector,
    up: Vector,
):
    names = (
        "spine_03",
        "upperarm_l", "lowerarm_l", "hand_l",
        "upperarm_r", "lowerarm_r", "hand_r",
    )
    armature.animation_data.action = base_action
    positions = rig.v1.evaluated_positions(scene, armature, spec.phases, names)
    controls = []
    for side in ("l", "r"):
        upper = f"upperarm_{side}"
        lower = f"lowerarm_{side}"
        hand = f"hand_{side}"
        side_sign = 1.0 if side == "l" else -1.0
        start_hand = positions[spec.start_frame][hand]
        target = rig.v1.make_control(f"{spec.action_name}_CTRL_guard_hand_{side}", armature, start_hand)
        keys = []
        for frame in spec.phases:
            chest = positions[frame]["spine_03"]
            guard = chest + forward * spec.guard_forward + left * (spec.guard_width * side_sign) + up * spec.guard_height
            keys.append((frame, guard))
        rig.v1.set_control_keys(target, armature, keys)

        shoulder = positions[spec.impact_frame][upper]
        elbow = positions[spec.impact_frame][lower]
        wrist = positions[spec.impact_frame][hand]
        pole = rig.v1.make_control(
            f"{spec.action_name}_CTRL_guard_elbow_{side}",
            armature,
            rig.v1.chain_pole(shoulder, elbow, wrist, scale=2.0),
        )
        ik = armature.pose.bones[lower].constraints.new(type="IK")
        ik.name = f"{spec.action_name}_{'Left' if side == 'l' else 'Right'}GuardHandIK"
        ik.target = target
        ik.pole_target = pole
        ik.chain_count = 2
        for frame, influence in zip(spec.phases, spec.guard_influences):
            ik.influence = influence
            ik.keyframe_insert(data_path="influence", frame=frame)
        controls.extend((target, pole))
    return controls


def foot_travel(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    foot = f"foot_{spec.strike_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start = rig.v1.pose_head(armature, foot)
    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()
    return (rig.v1.pose_head(armature, foot) - start).length


def foot_axis_reach(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axis: Vector) -> float:
    foot = f"foot_{spec.strike_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start = rig.v1.pose_head(armature, foot)
    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()
    delta = rig.v1.pose_head(armature, foot) - start
    return delta.dot(axis)


def strike_knee_extension_degrees(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    """Return the impact knee angle; 180 degrees is a fully extended strike leg."""
    thigh = f"thigh_{spec.strike_suffix}"
    calf = f"calf_{spec.strike_suffix}"
    foot = f"foot_{spec.strike_suffix}"
    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()
    hip = rig.v1.pose_head(armature, thigh)
    knee = rig.v1.pose_head(armature, calf)
    ankle = rig.v1.pose_head(armature, foot)
    upper = hip - knee
    lower = ankle - knee
    if upper.length < 1e-6 or lower.length < 1e-6:
        return 0.0
    return math.degrees(upper.angle(lower))


def strike_leg_reach_ratio(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    """Measure hip-to-ankle reach against the authored two-bone leg length at impact."""
    thigh = f"thigh_{spec.strike_suffix}"
    calf = f"calf_{spec.strike_suffix}"
    foot = f"foot_{spec.strike_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start_hip = rig.v1.pose_head(armature, thigh)
    start_knee = rig.v1.pose_head(armature, calf)
    start_ankle = rig.v1.pose_head(armature, foot)
    leg_length = (start_hip - start_knee).length + (start_knee - start_ankle).length
    if leg_length < 1e-6:
        return 0.0
    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()
    hip = rig.v1.pose_head(armature, thigh)
    ankle = rig.v1.pose_head(armature, foot)
    return (hip - ankle).length / leg_length


def guard_distance(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()
    chest = rig.v1.pose_head(armature, "spine_03")
    return max(
        (rig.v1.pose_head(armature, "hand_l") - chest).length,
        (rig.v1.pose_head(armature, "hand_r") - chest).length,
    )


def guard_min_height(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, up: Vector) -> float:
    scene.frame_set(spec.impact_frame); bpy.context.view_layer.update()
    chest = rig.v1.pose_head(armature, "spine_03")
    return min(
        (rig.v1.pose_head(armature, "hand_l") - chest).dot(up),
        (rig.v1.pose_head(armature, "hand_r") - chest).dot(up),
    )


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



REFERENCE_POSE_LABELS = ("START", "CHAMBER", "IMPACT", "RECOVERY", "GUARD")


def _knee_extension_at(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, frame: int) -> float:
    thigh = f"thigh_{spec.strike_suffix}"
    calf = f"calf_{spec.strike_suffix}"
    foot = f"foot_{spec.strike_suffix}"
    scene.frame_set(frame); bpy.context.view_layer.update()
    hip = rig.v1.pose_head(armature, thigh)
    knee = rig.v1.pose_head(armature, calf)
    ankle = rig.v1.pose_head(armature, foot)
    upper = hip - knee
    lower = ankle - knee
    if upper.length < 1e-6 or lower.length < 1e-6:
        return 0.0
    return math.degrees(upper.angle(lower))


def reference_pose_snapshots(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, forward: Vector, up: Vector):
    strike_foot = f"foot_{spec.strike_suffix}"
    support_foot = f"foot_{spec.support_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start_strike = rig.v1.pose_head(armature, strike_foot)
    start_pelvis = rig.v1.pose_head(armature, "pelvis")
    start_support_q = rig.pose_world_matrix(armature, support_foot).to_quaternion()
    poses = []
    for label, frame in zip(REFERENCE_POSE_LABELS, spec.reference_pose_frames):
        scene.frame_set(frame); bpy.context.view_layer.update()
        foot = rig.v1.pose_head(armature, strike_foot)
        pelvis = rig.v1.pose_head(armature, "pelvis")
        support_q = rig.pose_world_matrix(armature, support_foot).to_quaternion()
        poses.append({
            "label": label,
            "frame": frame,
            "normalizedTime": (frame - spec.start_frame) / max(1, spec.end_frame - spec.start_frame),
            "strikeFootForward": (foot - start_strike).dot(forward),
            "strikeFootRise": (foot - start_strike).dot(up),
            "strikeKneeExtensionDegrees": _knee_extension_at(scene, armature, spec, frame),
            "pelvisForward": (pelvis - start_pelvis).dot(forward),
            "pelvisRise": (pelvis - start_pelvis).dot(up),
            "supportFootPivotDegrees": math.degrees(start_support_q.rotation_difference(support_q).angle),
        })
    return poses

def build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes):
    rig.configure_v1_for_spec(spec)
    ensure_kick_bones(armature, spec)
    source = rig.v1.find_source_action()
    source_name = source.name
    samples = rig.v1.sample_source_basis(scene, armature, source)
    base = rig.v1.key_pose_basis(scene, armature, f"{spec.action_name}_BASE", samples)
    armature.animation_data.action = base

    strike_world = armature.matrix_world.to_3x3() @ axes[0]
    masters = rig.add_master_controls(scene, armature, base, strike_world, spec)
    controls = add_kick_controls(scene, armature, base, spec, *axes)
    guards = add_guard_controls(scene, armature, base, spec, *axes)

    constrained = {
        "constrainedStrikeFootTravel": foot_travel(scene, armature, spec),
        "constrainedStrikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),
        "constrainedStrikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),
        "constrainedStrikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),
        "constrainedStrikeLegReachRatio": strike_leg_reach_ratio(scene, armature, spec),
        "constrainedGuardHandMaxChestDistance": guard_distance(scene, armature, spec),
        "constrainedGuardHandMinChestHeight": guard_min_height(scene, armature, spec, axes[2]),
        "constrainedSupportFootLockMaxDrift": support_drift(scene, armature, spec),
        "constrainedSupportFootLockMaxAngularDriftDegrees": support_angle(scene, armature, spec),
        "constrainedSupportFootPivotMaxDegrees": support_angle(scene, armature, spec),
        "constrainedPelvisTravel": rig.pelvis_travel(scene, armature, spec),
        "constrainedTorsoTwistDegrees": rig.torso_twist_degrees(scene, armature, spec),
    }
    final_action = rig.v1.bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    armature.animation_data.action = final_action
    reference_poses = reference_pose_snapshots(scene, armature, spec, axes[0], axes[2])
    rig.v1.remove_controls([*controls, *guards, *masters])
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
        "strikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),
        "strikeFootVerticalRise": foot_axis_reach(scene, armature, spec, axes[2]),
        "strikeKneeExtensionDegrees": strike_knee_extension_degrees(scene, armature, spec),
        "strikeLegReachRatio": strike_leg_reach_ratio(scene, armature, spec),
        "guardHandMaxChestDistance": guard_distance(scene, armature, spec),
        "guardHandMinChestHeight": guard_min_height(scene, armature, spec, axes[2]),
        "supportFootLockMaxDrift": support_drift(scene, armature, spec),
        "supportFootLockMaxAngularDriftDegrees": support_angle(scene, armature, spec),
        "supportFootPivotMaxDegrees": support_angle(scene, armature, spec),
        "pelvisTravel": rig.pelvis_travel(scene, armature, spec),
        "torsoTwistDegrees": rig.torso_twist_degrees(scene, armature, spec),
        **constrained,
        "boneCount": len(armature.pose.bones),
        "meshCount": len([o for o in bpy.context.scene.objects if o.type == "MESH"]),
        "sharedRig": "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG",
        "naturalnessPass": "REFERENCE_POSE_V4",
        "referencePoseMethod": "FIVE_KEY_REFERENCE_V4",
        "referencePoses": reference_poses,
        "pipeline": [
            "Idle_Loop whole-body base",
            "shoulder-orthogonal anatomical forward axis",
            "Cross max hand-to-pelvis reach chooses forward sign",
            "five-pose visual reference: START / CHAMBER / IMPACT / RECOVERY / GUARD",
            "shared COG/pelvis and staged torso masters",
            f"{spec.strike_side.upper()} strike-leg two-bone IK",
            "hip-relative impact reach from authored leg length",
            "impact knee-extension quality gate",
            "move-specific strike-foot orientation",
            "dual high-guard hand IK",
            f"world-space {spec.support_side.upper()} support-foot position lock",
            f"controlled {spec.support_side.upper()} support-foot pivot",
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
        "naturalnessPass": "REFERENCE_POSE_V4",
        "referencePoseMethod": "FIVE_KEY_REFERENCE_V4",
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
