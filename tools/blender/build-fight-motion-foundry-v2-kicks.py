#!/usr/bin/env python3
"""Build Blender-authored grounded kicks on the shared Motion Foundry v2 rig."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
import json
import math
import os
from pathlib import Path
from typing import List, Tuple, Sequence

import bpy
from mathutils import Matrix, Quaternion, Vector

import motion_foundry_v2_rig as rig
import motion_foundry_v6_mocap as mocap_v6


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
    reference_candidates: Tuple[str, ...] = ()
    source_knots: Tuple[Tuple[float, float], ...] = ((0.0, 0.0), (1.0, 1.0))
    hand_scales: rig.HandScales = (None, None, None, None, None, None, None)
    hand_offsets: rig.HandOffsets = ((0.0, 0.0, 0.0),) * 7
    knee_pole_scale: float = 2.2
    knee_pole_bias: Tuple[float, float, float] = (0.0, 0.0, 0.0)
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
    version="BLENDER_MOTION_FOUNDRY_V6_FRONT_KICK",
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
    ik_influences=(0.0, 0.16, 0.52, 1.0, 0.72, 0.12, 0.0),
    pelvis_forward=(0.000, -0.018, 0.028, 0.090, 0.108, 0.012, 0.000),
    pelvis_drop=(0.000, -0.050, -0.048, -0.045, -0.038, -0.024, 0.000),
    pelvis_yaw=(0.0, -2.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    lower_yaw=(0.0, -3.0, 3.0, 6.0, 7.0, 1.5, 0.0),
    upper_yaw=(0.0, -3.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    pelvis_pitch=(0.0, -3.0, -6.0, -8.0, -8.0, -2.0, 0.0),
    lower_pitch=(0.0, -4.0, -8.0, -10.0, -10.0, -3.0, 0.0),
    upper_pitch=(0.0, -2.0, -5.0, -7.0, -7.0, -2.0, 0.0),
    reference_candidates=("Melee_Hook_Armature", "OverhandThrow_Armature", "Sword_Regular_A_Armature"),
    guard_influences=(0.0, 0.18, 0.30, 0.58, 0.42, 0.22, 0.0),
    knee_pole_bias=(0.12, 0.06, 0.03),
    reach_ratios=(0.0, 0.0, 0.90, 0.976, 0.980, 0.0, 0.0),
    reach_directions=(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        (0.94, 0.0, 0.34),
        (0.97, 0.0, 0.25),
        (0.98, 0.0, 0.22),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
    ),
)

LOW_KICK = KickSpec(
    action_name="BF_LowKick_L",
    version="BLENDER_MOTION_FOUNDRY_V6_LOW_KICK",
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
    ik_influences=(0.0, 0.12, 0.48, 1.0, 0.68, 0.10, 0.0),
    pelvis_forward=(0.000, -0.020, 0.012, 0.050, 0.060, 0.006, 0.000),
    pelvis_drop=(0.000, -0.040, -0.038, -0.030, -0.026, -0.020, 0.000),
    pelvis_yaw=(0.0, -10.0, 18.0, 36.0, 44.0, 8.0, 0.0),
    lower_yaw=(0.0, -12.0, 26.0, 48.0, 56.0, 11.0, 0.0),
    upper_yaw=(0.0, -8.0, 4.0, 1.0, 0.0, 2.0, 0.0),
    pelvis_pitch=(0.0, -2.0, -4.0, -5.0, -5.0, -1.0, 0.0),
    lower_pitch=(0.0, -2.0, -4.0, -5.0, -4.0, -1.0, 0.0),
    upper_pitch=(0.0, -2.0, -4.0, -6.0, -6.0, -2.0, 0.0),
    reference_candidates=("Melee_Hook_Armature", "Sword_Regular_A_Armature", "OverhandThrow_Armature"),
    guard_influences=(0.0, 0.10, 0.24, 0.45, 0.32, 0.16, 0.0),
    guard_width=0.12,
    knee_pole_bias=(0.14, 0.18, -0.02),
    reach_ratios=(0.0, 0.0, 0.90, 0.955, 0.962, 0.0, 0.0),
    reach_directions=(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        (0.70, 0.45, -0.55),
        (0.72, 0.52, -0.45),
        (0.70, 0.58, -0.42),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
    ),
)

RISING_KICK = KickSpec(
    action_name="BF_RisingKick_R",
    version="BLENDER_MOTION_FOUNDRY_V6_RISING_KICK",
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
        (-0.07, 0.00, 0.34),
        (0.29, 0.00, 0.52),
        (0.68, 0.00, 0.78),
        (0.72, 0.00, 0.84),
        (-0.02, 0.00, 0.30),
        (0.00, 0.00, 0.00),
    ),
    foot_pitch=(0.0, 12.0, -8.0, -24.0, -30.0, 5.0, 0.0),
    foot_yaw=(0.0, 0.0, 2.0, 4.0, 5.0, 1.0, 0.0),
    support_yaw=(0.0, -3.0, -9.0, -18.0, -22.0, -6.0, 0.0),
    ik_influences=(0.0, 0.18, 0.56, 1.0, 0.78, 0.14, 0.0),
    pelvis_forward=(0.000, -0.016, 0.012, 0.055, 0.065, 0.006, 0.000),
    pelvis_drop=(0.000, -0.055, -0.058, -0.052, -0.043, -0.028, 0.000),
    pelvis_yaw=(0.0, -3.0, 3.0, 7.0, 8.0, 2.0, 0.0),
    lower_yaw=(0.0, -4.0, 4.0, 9.0, 10.0, 2.0, 0.0),
    upper_yaw=(0.0, -3.0, 2.0, 5.0, 6.0, 1.0, 0.0),
    pelvis_pitch=(0.0, -4.0, -7.0, -10.0, -11.0, -3.0, 0.0),
    lower_pitch=(0.0, -5.0, -9.0, -12.0, -13.0, -4.0, 0.0),
    upper_pitch=(0.0, -3.0, -6.0, -9.0, -10.0, -3.0, 0.0),
    reference_candidates=("NinjaJump_Start_Armature", "Melee_Hook_Armature", "OverhandThrow_Armature"),
    guard_influences=(0.0, 0.12, 0.26, 0.50, 0.36, 0.18, 0.0),
    guard_height=0.165,
    knee_pole_bias=(0.30, 0.18, 0.10),
    reach_ratios=(0.0, 0.0, 0.90, 0.960, 0.966, 0.0, 0.0),
    reach_directions=(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        (0.82, 0.22, 0.62),
        (0.86, 0.32, 0.58),
        (0.88, 0.36, 0.55),
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


def _normalized_action_name(name: str) -> str:
    stem = name.split(".", 1)[0].lower().replace("armature", "")
    return "".join(ch for ch in stem if ch.isalnum())


def _find_action_fuzzy(name: str):
    exact = next((action for action in bpy.data.actions if action.name == name), None)
    if exact is not None:
        return exact
    wanted = _normalized_action_name(name)
    return next((action for action in bpy.data.actions if _normalized_action_name(action.name) == wanted), None)


def import_reference_actions(path: str) -> List[str]:
    before_objects = {obj.name for obj in bpy.context.scene.objects}
    before_actions = {action.name for action in bpy.data.actions}
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    imported = [action.name for action in bpy.data.actions if action.name not in before_actions]
    for obj in list(bpy.context.scene.objects):
        if obj.name not in before_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not imported:
        raise RuntimeError(f"Reference source {path!r} did not provide any new Actions")
    return imported


def choose_reference_action(spec: KickSpec) -> bpy.types.Action:
    for candidate in spec.reference_candidates:
        action = _find_action_fuzzy(candidate)
        if action is not None:
            return action
    fallback = _find_action_fuzzy(spec.source_action_hint)
    if fallback is not None:
        return fallback
    raise RuntimeError(
        f"{spec.action_name}: no reference action found from {spec.reference_candidates}; "
        f"available: {[a.name for a in bpy.data.actions]}"
    )


def _normalize_series(values: Sequence[float]) -> List[float]:
    if not values:
        return []
    low, high = min(values), max(values)
    span = high - low
    if span < 1e-8:
        return [0.0 for _ in values]
    return [(value - low) / span for value in values]


def derive_reference_knots(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    action: bpy.types.Action,
    spec: KickSpec,
    up: Vector,
):
    """Align the authored reference's kinetic peak to gameplay impact.

    V5 stretched an Idle pose and asked IK to invent almost the entire kick.
    V6 preserves an authored full-body combat sequence and only constrains the
    strike limb near contact. The reference peak is found from hand reach, torso
    rotation, pelvis travel and (for rising kicks) vertical pelvis velocity.
    """
    armature.animation_data.action = action
    start, end = action.frame_range
    if end - start < 2.0:
        raise RuntimeError(f"{spec.action_name}: reference {action.name} is too short")
    sample_count = 49
    reaches, twists, pelvis_travel, vertical_speed = [], [], [], []
    pelvis0 = None
    torso0 = None
    previous_pelvis = None
    for index in range(sample_count):
        frame = start + (end - start) * index / (sample_count - 1)
        rig.v1.set_scene_frame(scene, frame)
        pelvis = rig.v1.pose_head(armature, "pelvis")
        left_hand = rig.v1.pose_head(armature, "hand_l")
        right_hand = rig.v1.pose_head(armature, "hand_r")
        torso_q = rig.pose_world_matrix(armature, "spine_03").to_quaternion()
        if pelvis0 is None:
            pelvis0 = pelvis.copy()
            torso0 = torso_q.copy()
        reach_l = left_hand - pelvis
        reach_r = right_hand - pelvis
        reaches.append(max(reach_l.length, reach_r.length))
        twists.append(math.degrees(torso0.rotation_difference(torso_q).angle))
        pelvis_travel.append((pelvis - pelvis0).length)
        vertical_speed.append(0.0 if previous_pelvis is None else abs((pelvis - previous_pelvis).dot(up)))
        previous_pelvis = pelvis.copy()

    nr = _normalize_series(reaches)
    nt = _normalize_series(twists)
    np = _normalize_series(pelvis_travel)
    nv = _normalize_series(vertical_speed)
    rising = spec.action_name == "BF_RisingKick_R"
    scores = [
        0.92 * nr[i] + 1.00 * nt[i] + 0.45 * np[i] + (0.85 if rising else 0.20) * nv[i]
        for i in range(sample_count)
    ]
    lo, hi = int(sample_count * 0.10), int(sample_count * 0.90)
    peak_index = max(range(lo, hi), key=lambda i: scores[i])
    reference_impact_u = peak_index / (sample_count - 1)
    reference_impact_u = max(0.18, min(0.82, reference_impact_u))
    prior_score = scores[peak_index] / (3.22 if rising else 2.57)

    def du(frame: int) -> float:
        return (frame - spec.start_frame) / max(1, spec.end_frame - spec.start_frame)

    src_load = max(0.0, reference_impact_u - 0.30)
    src_pre = max(src_load + 0.02, reference_impact_u - 0.085)
    src_over = min(1.0, reference_impact_u + 0.075)
    src_recovery = min(1.0, reference_impact_u + 0.31)
    knots = (
        (0.0, 0.0),
        (du(spec.load_frame), src_load),
        (du(spec.precontact_frame), src_pre),
        (du(spec.impact_frame), reference_impact_u),
        (du(spec.overtravel_frame), src_over),
        (du(spec.recovery_frame), src_recovery),
        (1.0, 1.0),
    )
    return knots, reference_impact_u, max(0.0, min(1.0, prior_score))


def reference_knots_for_impact(spec: KickSpec, reference_impact_u: float):
    """Build a nonlinear source-time map around a measured impact event."""
    reference_impact_u = max(0.18, min(0.82, reference_impact_u))
    def du(frame: int) -> float:
        return (frame - spec.start_frame) / max(1, spec.end_frame - spec.start_frame)
    src_load = max(0.0, reference_impact_u - 0.30)
    src_pre = max(src_load + 0.02, reference_impact_u - 0.085)
    src_over = min(1.0, reference_impact_u + 0.075)
    src_recovery = min(1.0, reference_impact_u + 0.31)
    return (
        (0.0, 0.0),
        (du(spec.load_frame), src_load),
        (du(spec.precontact_frame), src_pre),
        (du(spec.impact_frame), reference_impact_u),
        (du(spec.overtravel_frame), src_over),
        (du(spec.recovery_frame), src_recovery),
        (1.0, 1.0),
    )


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


def key_orientation(
    control: bpy.types.Object,
    base: Matrix,
    frame: int,
    pitch_deg: float,
    yaw_deg: float,
    pitch_axis: Vector | None = None,
    yaw_axis: Vector | None = None,
) -> None:
    """Key foot orientation around the fighter's anatomical axes, not world X."""
    loc, rot, scale = base.decompose()
    p_axis = (pitch_axis or Vector((1.0, 0.0, 0.0))).normalized()
    y_axis = (yaw_axis or Vector((0.0, 0.0, 1.0))).normalized()
    yaw = Quaternion(y_axis, math.radians(yaw_deg))
    pitch = Quaternion(p_axis, math.radians(pitch_deg))
    rig.key_matrix(control, frame, Matrix.LocRotScale(loc, yaw @ pitch @ rot, scale))


KNEE_POLE_POLICY = "ANIMATED_TARGET_AWARE_KNEE_PLANE_V6_3"
FOOT_ORIENTATION_POLICY = "ANATOMICAL_BODY_AXES_V6_2"
POLE_ANGLE_POLICY = "AUTO_CONTINUOUS_BEND_HEMISPHERE_V6_6"


def _knee_bend_offset(hip: Vector, knee: Vector, ankle: Vector) -> Tuple[Vector, float]:
    """Return the knee's perpendicular offset from the hip-ankle axis and its axial ratio."""
    axis = ankle - hip
    if axis.length_squared < 1e-8:
        return Vector((0.0, 0.0, 0.0)), 0.5
    ratio = max(0.0, min(1.0, (knee - hip).dot(axis) / axis.length_squared))
    on_axis = hip + axis * ratio
    return knee - on_axis, ratio


def _project_bend_to_target_chain(
    hip: Vector,
    knee: Vector,
    source_ankle: Vector,
    target_ankle: Vector,
    previous_direction: Vector | None,
) -> Tuple[Vector, float]:
    """Transplant the measured knee side onto the actual IK hip->target-ankle chain."""
    source_bend, ratio = _knee_bend_offset(hip, knee, source_ankle)
    target_axis = target_ankle - hip
    if target_axis.length_squared < 1e-8:
        fallback = previous_direction.copy() if previous_direction is not None else source_bend.copy()
        return fallback, ratio
    axis = target_axis.normalized()
    bend = source_bend - axis * source_bend.dot(axis)
    if bend.length < 1e-5:
        source_axis = source_ankle - hip
        source_normal = source_axis.cross(knee - hip)
        if source_normal.length > 1e-5:
            bend = source_normal.normalized().cross(axis)
            if source_bend.length > 1e-5 and bend.dot(source_bend) < 0.0:
                bend.negate()
    if bend.length < 1e-5 and previous_direction is not None:
        bend = previous_direction - axis * previous_direction.dot(axis)
    if bend.length < 1e-5:
        bend = Vector((0.0, 1.0, 0.0)) - axis * axis.y
    return bend, ratio


def set_anatomical_knee_pole_keys(
    control: bpy.types.Object,
    armature: bpy.types.Object,
    positions,
    frames: Sequence[int],
    thigh_name: str,
    calf_name: str,
    foot_name: str,
    scale: float,
    bias: Vector,
    target_ankles=None,
) -> None:
    """Animate a target-aware pole that preserves the measured knee bend hemisphere."""
    keys = []
    previous_direction = None
    for frame in frames:
        hip = positions[frame][thigh_name]
        knee = positions[frame][calf_name]
        source_ankle = positions[frame][foot_name]
        target_ankle = (target_ankles or {}).get(frame, source_ankle)
        bend, ratio = _project_bend_to_target_chain(
            hip, knee, source_ankle, target_ankle, previous_direction
        )
        if bend.length < 1e-6:
            bend = previous_direction.copy() if previous_direction is not None else Vector((0.0, 1.0, 0.0))
        direction = bend.normalized()
        previous_direction = direction.copy()
        target_axis = target_ankle - hip
        on_axis = hip + target_axis * ratio
        source_upper = (knee - hip).length
        source_lower = (source_ankle - knee).length
        pole_distance = max(0.18, (source_upper + source_lower) * scale)
        pole = on_axis + direction * pole_distance

        # Keep legacy styling bias only when it supports the same anatomical side.
        safe_bias = bias.copy()
        if target_axis.length > 1e-6:
            axis = target_axis.normalized()
            safe_bias -= axis * safe_bias.dot(axis)
        if safe_bias.dot(direction) < 0.0:
            safe_bias -= direction * safe_bias.dot(direction)
        if safe_bias.length > 0.035:
            safe_bias.normalize()
            safe_bias *= 0.035
        pole += safe_bias
        keys.append((frame, pole))
    rig.v1.set_control_keys(control, armature, keys)
    rig.smooth_control_curves(control)


def _evaluated_knee_bend_dot(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    frame: int,
    source_positions,
    thigh_name: str,
    calf_name: str,
    foot_name: str,
) -> float | None:
    """Score the evaluated constrained knee against the measured bend hemisphere."""
    rig.v1.set_scene_frame(scene, frame)
    hip = rig.v1.pose_head(armature, thigh_name)
    knee = rig.v1.pose_head(armature, calf_name)
    ankle = rig.v1.pose_head(armature, foot_name)
    source_hip = source_positions[frame][thigh_name]
    source_knee = source_positions[frame][calf_name]
    source_ankle = source_positions[frame][foot_name]
    desired, _ = _project_bend_to_target_chain(
        source_hip, source_knee, source_ankle, ankle, None
    )
    actual, _ = _knee_bend_offset(hip, knee, ankle)
    # Near full extension has no stable bend side and should not dominate calibration.
    if desired.length < 1e-4 or actual.length < 0.012:
        return None
    return desired.normalized().dot(actual.normalized())


def calibrate_ik_pole_angle(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    ik: bpy.types.Constraint,
    source_positions,
    frames: Sequence[int],
    thigh_name: str,
    calf_name: str,
    foot_name: str,
    influences: Sequence[float] | None = None,
) -> Tuple[float, float]:
    """Choose a static pole angle that maximizes the worst anatomical bend score.

    Blender's pole target still needs pole_angle compensation for arbitrary bone
    roll.  Searching the small scalar angle is deterministic, build-time only, and
    lets the final evaluated chain decide instead of assuming left/right roll.
    """
    active = []
    for index, frame in enumerate(frames):
        influence = 1.0 if influences is None else influences[index]
        if influence >= 0.55:
            active.append(frame)
    if not active:
        active = list(frames[1:-1])

    candidates = [math.radians(deg) for deg in range(-180, 180, 10)]
    best_angle = 0.0
    best_objective = -999.0
    best_min = -1.0
    for angle in candidates:
        ik.pole_angle = angle
        scores = []
        for frame in active:
            score = _evaluated_knee_bend_dot(
                scene, armature, frame, source_positions, thigh_name, calf_name, foot_name
            )
            if score is not None:
                scores.append(score)
        if not scores:
            continue
        robust_min = min(scores)
        mean = sum(scores) / len(scores)
        # Worst-frame correctness dominates; mean only breaks ties.
        objective = robust_min * 10.0 + mean
        if objective > best_objective:
            best_objective = objective
            best_angle = angle
            best_min = robust_min

    # Refine ±10 degrees around the coarse optimum at one-degree resolution.
    coarse = best_angle
    for degree_offset in range(-10, 11):
        angle = coarse + math.radians(degree_offset)
        ik.pole_angle = angle
        scores = []
        for frame in active:
            score = _evaluated_knee_bend_dot(
                scene, armature, frame, source_positions, thigh_name, calf_name, foot_name
            )
            if score is not None:
                scores.append(score)
        if not scores:
            continue
        robust_min = min(scores)
        mean = sum(scores) / len(scores)
        objective = robust_min * 10.0 + mean
        if objective > best_objective:
            best_objective = objective
            best_angle = angle
            best_min = robust_min

    ik.pole_angle = best_angle
    bpy.context.view_layer.update()
    return best_angle, best_min


def _unwrap_angle_near(angle: float, reference: float) -> float:
    while angle - reference > math.pi:
        angle -= math.tau
    while angle - reference < -math.pi:
        angle += math.tau
    return angle


DYNAMIC_TARGET_MIN_DOT = 0.10
DYNAMIC_MAX_STEP_DEGREES = 45.0


def _wrapped_angle_delta(angle: float, reference: float) -> float:
    """Return the shortest signed angular delta to reference."""
    return _unwrap_angle_near(angle, reference) - reference


def _dynamic_score_cost(score: float | None) -> float:
    """Make anatomical correctness a hard priority before smoothness/reward."""
    if score is None:
        return 0.0
    return max(0.0, DYNAMIC_TARGET_MIN_DOT - score) * 220.0 - score * 0.24


def calibrate_dynamic_ik_pole_angle(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    ik: bpy.types.Constraint,
    source_positions,
    start_frame: int,
    end_frame: int,
    thigh_name: str,
    calf_name: str,
    foot_name: str,
    seed_angle: float,
) -> Tuple[List[Tuple[int, float]], float, float]:
    """Find a globally continuous, bend-correct pole-angle path.

    V6.5 maximized every frame independently.  Around Blender's bone-roll seam
    that produced equally valid but visually discontinuous 140-170 degree jumps.
    V6.6 evaluates the whole angle circle per frame, then uses dynamic programming
    to prefer bend-correct neighboring states.  This is build-time only; the
    result is baked to ordinary pose keys and adds zero runtime work on iPhone.
    """
    frames = list(range(start_frame, end_frame + 1))
    offsets = list(range(-180, 180, 5))
    candidates = [seed_angle + math.radians(degree) for degree in offsets]
    score_rows: List[List[float | None]] = []

    # No pole-angle fcurve exists yet, so trial values are evaluated directly.
    for frame in frames:
        row: List[float | None] = []
        for angle in candidates:
            ik.pole_angle = angle
            row.append(_evaluated_knee_bend_dot(
                scene, armature, frame, source_positions,
                thigh_name, calf_name, foot_name,
            ))
        score_rows.append(row)

    # DP cost: bend correctness dominates.  Once above the target hemisphere
    # margin, shortest wrapped transitions decide between equivalent IK branches.
    continuity_weight = 0.070
    previous_costs: List[float] = []
    backrefs: List[List[int]] = []
    for index, angle in enumerate(candidates):
        delta_deg = abs(math.degrees(_wrapped_angle_delta(angle, seed_angle)))
        previous_costs.append(
            _dynamic_score_cost(score_rows[0][index])
            + continuity_weight * (delta_deg / 30.0) ** 2
        )
    backrefs.append([-1] * len(candidates))

    for row_index in range(1, len(frames)):
        current_costs = [float('inf')] * len(candidates)
        current_back = [-1] * len(candidates)
        for current_index, current_angle in enumerate(candidates):
            anatomical = _dynamic_score_cost(score_rows[row_index][current_index])
            best_cost = float('inf')
            best_prev = 0
            for previous_index, previous_angle in enumerate(candidates):
                delta_deg = abs(math.degrees(_wrapped_angle_delta(current_angle, previous_angle)))
                transition = continuity_weight * (delta_deg / 30.0) ** 2
                cost = previous_costs[previous_index] + anatomical + transition
                if cost < best_cost:
                    best_cost = cost
                    best_prev = previous_index
            current_costs[current_index] = best_cost
            current_back[current_index] = best_prev
        previous_costs = current_costs
        backrefs.append(current_back)

    state = min(range(len(candidates)), key=lambda index: previous_costs[index])
    states = [state]
    for row_index in range(len(frames) - 1, 0, -1):
        state = backrefs[row_index][state]
        states.append(state)
    states.reverse()

    keys: List[Tuple[int, float]] = []
    previous = seed_angle
    for frame, state in zip(frames, states):
        angle = _unwrap_angle_near(candidates[state], previous)
        keys.append((frame, angle))
        previous = angle

    # Insert only after global path selection so trial values never fight fcurves.
    for frame, angle in keys:
        scene.frame_set(frame)
        ik.pole_angle = angle
        ik.keyframe_insert(data_path="pole_angle", frame=frame)
    action = armature.animation_data.action if armature.animation_data else None
    if action:
        data_path = ik.path_from_id("pole_angle")
        for fcurve in action.fcurves:
            if fcurve.data_path == data_path:
                for point in fcurve.keyframe_points:
                    point.interpolation = "LINEAR"
    bpy.context.view_layer.update()

    # The strict diagnostic is measured from the FINAL keyed curve, not trial
    # candidates.  This makes the gate describe exactly what will be baked.
    dense_scores = []
    for frame in frames:
        score = _evaluated_knee_bend_dot(
            scene, armature, frame, source_positions,
            thigh_name, calf_name, foot_name,
        )
        if score is not None:
            dense_scores.append(score)
    final_min = min(dense_scores) if dense_scores else 1.0
    max_step = max(
        (abs(math.degrees(angle - prior_angle))
         for (_, prior_angle), (_, angle) in zip(keys, keys[1:])),
        default=0.0,
    )
    return keys, final_min, max_step

def add_kick_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    spec: KickSpec,
    forward: Vector,
    left: Vector,
    up: Vector,
    use_mocap_support_anchor: bool = False,
):
    strike = spec.strike_suffix
    support = spec.support_suffix
    thigh_name, calf_name, foot_name = f"thigh_{strike}", f"calf_{strike}", f"foot_{strike}"
    s_thigh, s_calf, s_foot = f"thigh_{support}", f"calf_{support}", f"foot_{support}"
    names = (thigh_name, calf_name, foot_name, s_thigh, s_calf, s_foot)
    armature.animation_data.action = base_action
    positions = rig.v1.evaluated_positions(scene, armature, spec.phases, names)
    dense_frames = tuple(range(spec.start_frame, spec.end_frame + 1))
    dense_positions = rig.v1.evaluated_positions(scene, armature, dense_frames, names)

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
    strike_target_positions = {frame: target.copy() for frame, target in keys}

    pole_forward, pole_lateral, pole_up = spec.knee_pole_bias
    strike_pole_bias = (
        forward * pole_forward
        + left * (pole_lateral * side_sign)
        + up * pole_up
    )
    hip = positions[spec.start_frame][thigh_name]
    knee = positions[spec.start_frame][calf_name]
    ankle = positions[spec.start_frame][foot_name]
    knee_pole = rig.v1.make_control(
        f"{spec.action_name}_CTRL_strike_knee",
        armature,
        rig.v1.chain_pole(hip, knee, ankle, scale=spec.knee_pole_scale) + strike_pole_bias,
    )
    set_anatomical_knee_pole_keys(
        knee_pole,
        armature,
        positions,
        spec.phases,
        thigh_name,
        calf_name,
        foot_name,
        spec.knee_pole_scale,
        strike_pole_bias,
        strike_target_positions,
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
    strike_pole_angle, strike_pole_calibration_min = calibrate_ik_pole_angle(
        scene, armature, strike_ik, positions, spec.phases,
        thigh_name, calf_name, foot_name, spec.ik_influences,
    )

    strike_foot_world = rig.pose_world_matrix(armature, foot_name)
    strike_orientation = rig.make_matrix_control(f"{spec.action_name}_CTRL_strike_foot_orientation", strike_foot_world, 0.065)
    strike_rot = armature.pose.bones[foot_name].constraints.new(type="COPY_ROTATION")
    strike_rot.name = f"{spec.action_name}_StrikeFootOrientation"
    strike_rot.target = strike_orientation
    strike_rot.owner_space = "WORLD"
    strike_rot.target_space = "WORLD"
    strike_rot.mix_mode = "REPLACE"
    for frame, pitch, yaw in zip(spec.phases, spec.foot_pitch, spec.foot_yaw):
        key_orientation(
            strike_orientation, strike_foot_world, frame, pitch, yaw * side_sign,
            pitch_axis=left, yaw_axis=up,
        )
        strike_rot.influence = rig.phase_value(frame, tuple(zip(spec.phases, spec.ik_influences)))
        strike_rot.keyframe_insert(data_path="influence", frame=frame)
    rig.smooth_control_curves(strike_orientation)

    # V6.7: the measured prior already anchors the support ankle at dense 60 Hz
    # by moving only the pelvis root. Applying a second two-bone position IK on
    # Rising forced Blender onto the opposite knee solution. Preserve the measured
    # support-leg rotations for that move and keep the old IK lock for Front/Low.
    support_controls = []
    support_constraint_policy = "MOCAP_PELVIS_ANCHOR_V6_7" if use_mocap_support_anchor else "IK_POSITION_LOCK_V6_6"
    support_pole_angle = None
    support_pole_angle_keys = []
    support_pole_calibration_min = None
    support_pole_angle_max_step = 0.0
    if not use_mocap_support_anchor:
        scene.frame_set(spec.start_frame)
        bpy.context.view_layer.update()
        support_ankle = rig.v1.pose_tail(armature, s_calf)
        support_target = rig.v1.make_control(f"{spec.action_name}_CTRL_support_foot", armature, support_ankle)
        support_target_positions = {frame: support_ankle.copy() for frame in spec.phases}
        support_knee = positions[spec.start_frame][s_calf]
        support_hip = positions[spec.start_frame][s_thigh]
        support_pole = rig.v1.make_control(
            f"{spec.action_name}_CTRL_support_knee",
            armature,
            rig.v1.chain_pole(support_hip, support_knee, support_ankle, scale=1.9),
        )
        set_anatomical_knee_pole_keys(
            support_pole,
            armature,
            positions,
            spec.phases,
            s_thigh,
            s_calf,
            s_foot,
            1.9,
            Vector((0.0, 0.0, 0.0)),
            support_target_positions,
        )
        support_calf = armature.pose.bones[s_calf]
        support_ik = support_calf.constraints.new(type="IK")
        support_ik.name = f"{spec.action_name}_SupportFootPositionLockIK"
        support_ik.target = support_target
        support_ik.pole_target = support_pole
        support_ik.chain_count = 2
        support_ik.influence = 1.0
        support_pole_angle, support_pole_calibration_min = calibrate_ik_pole_angle(
            scene, armature, support_ik, positions, spec.phases,
            s_thigh, s_calf, s_foot, None,
        )
        support_pole_angle_keys = [(spec.start_frame, support_pole_angle)]
        # Static pole-angle compensation is preferable when it works. Only fall
        # back to dense calibration on legacy support-IK moves.
        if support_pole_calibration_min <= 0.05:
            support_pole_angle_keys, support_pole_calibration_min, support_pole_angle_max_step = calibrate_dynamic_ik_pole_angle(
                scene, armature, support_ik, dense_positions, spec.start_frame, spec.end_frame,
                s_thigh, s_calf, s_foot, support_pole_angle,
            )
            support_pole_angle = support_pole_angle_keys[0][1]
        support_controls.extend([support_target, support_pole])

    support_world = rig.pose_world_matrix(armature, s_foot)
    support_orientation = rig.make_matrix_control(f"{spec.action_name}_CTRL_support_foot_orientation", support_world, 0.065)
    support_rot = armature.pose.bones[s_foot].constraints.new(type="COPY_ROTATION")
    support_rot.name = f"{spec.action_name}_SupportFootOrientationLock"
    support_rot.target = support_orientation
    support_rot.owner_space = "WORLD"
    support_rot.target_space = "WORLD"
    support_rot.mix_mode = "REPLACE"
    for frame, yaw in zip(spec.phases, spec.support_yaw):
        key_orientation(
            support_orientation, support_world, frame, 0.0, yaw,
            pitch_axis=left, yaw_axis=up,
        )
    support_rot.influence = 1.0
    rig.smooth_control_curves(support_orientation)

    return (
        [strike_target, knee_pole, strike_orientation, *support_controls, support_orientation],
        {
            "strikePoleAngleDegrees": math.degrees(strike_pole_angle),
            "strikePoleCalibrationMinDot": strike_pole_calibration_min,
            "supportConstraintPolicy": support_constraint_policy,
            "supportPoleAngleDegrees": None if support_pole_angle is None else math.degrees(support_pole_angle),
            "supportPoleAngleKeysDegrees": [
                [frame, math.degrees(angle)] for frame, angle in support_pole_angle_keys
            ],
            "supportPoleCalibrationMinDot": support_pole_calibration_min,
            "supportPoleAngleMaxStepDegrees": support_pole_angle_max_step,
        },
    )


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


def _shortest_quaternion_angle_degrees(start: Quaternion, current: Quaternion) -> float:
    angle = start.rotation_difference(current).angle
    angle = angle % math.tau
    if angle > math.pi:
        angle = math.tau - angle
    return math.degrees(abs(angle))


def support_angle(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec) -> float:
    foot = f"foot_{spec.support_suffix}"
    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    start = rig.pose_world_matrix(armature, foot).to_quaternion()
    maximum = 0.0
    for frame in range(spec.start_frame, spec.end_frame + 1):
        scene.frame_set(frame); bpy.context.view_layer.update()
        current = rig.pose_world_matrix(armature, foot).to_quaternion()
        maximum = max(maximum, _shortest_quaternion_angle_degrees(start, current))
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
            "supportFootPivotDegrees": _shortest_quaternion_angle_degrees(start_support_q, support_q),
        })
    return poses

def knee_plane_min_dot(reference_positions, final_positions, frames, thigh_name: str, calf_name: str, foot_name: str) -> float:
    """Return minimum target-chain bend-side dot; negative means an anatomical knee flip."""
    dots = []
    previous_desired = None
    for frame in frames:
        r_hip = reference_positions[frame][thigh_name]
        r_knee = reference_positions[frame][calf_name]
        r_ankle = reference_positions[frame][foot_name]
        f_hip = final_positions[frame][thigh_name]
        f_knee = final_positions[frame][calf_name]
        f_ankle = final_positions[frame][foot_name]
        desired, _ = _project_bend_to_target_chain(
            r_hip, r_knee, r_ankle, f_ankle, previous_desired
        )
        final_bend, _ = _knee_bend_offset(f_hip, f_knee, f_ankle)
        if desired.length < 1e-4 or final_bend.length < 1e-4:
            continue
        desired.normalize()
        final_bend.normalize()
        previous_desired = desired.copy()
        dots.append(desired.dot(final_bend))
    return min(dots) if dots else 1.0


def build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes, mocap_paths):
    # Reference-driven V6: measured full-body human motion is primary.  The
    # existing procedural rig is demoted to gameplay contact/support constraints.
    mocap_path = mocap_paths.get(spec.action_name)
    mocap_meta = None
    mocap_support_anchor_before = None
    mocap_support_anchor_after = None
    if mocap_path:
        reference, mocap_meta = mocap_v6.build_mocap_prior(scene, armature, spec, mocap_path, axes)
        mocap_support_anchor_before = float(reference.get("cmu_support_anchor_before", 0.0))
        mocap_support_anchor_after = float(reference.get("cmu_support_anchor_after", 0.0))
        # The mocap already contains weight transfer and counter-rotation.  Keep
        # only a small fraction of legacy master offsets to avoid double-driving.
        spec = replace(
            spec,
            source_action_hint=reference.name,
            pelvis_forward=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.22) for value in spec.pelvis_forward),
            pelvis_drop=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.22) for value in spec.pelvis_drop),
            pelvis_yaw=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.12) for value in spec.pelvis_yaw),
            lower_yaw=tuple(value * 0.10 for value in spec.lower_yaw),
            upper_yaw=tuple(value * 0.10 for value in spec.upper_yaw),
            pelvis_pitch=tuple(value * (0.0 if spec.action_name == "BF_RisingKick_R" else 0.12) for value in spec.pelvis_pitch),
            lower_pitch=tuple(value * 0.10 for value in spec.lower_pitch),
            upper_pitch=tuple(value * 0.10 for value in spec.upper_pitch),
            # Mocap remains the primary motion. These narrow controls only make
            # the combat-readable chamber and high guard survive retargeting.
            ik_influences=(
                spec.ik_influences[0],
                max(spec.ik_influences[1], 0.66 if spec.action_name == "BF_RisingKick_R" else 0.52),
                max(spec.ik_influences[2], 0.62),
                spec.ik_influences[3],
                spec.ik_influences[4],
                spec.ik_influences[5],
                spec.ik_influences[6],
            ),
            guard_influences=(
                spec.guard_influences[0],
                max(spec.guard_influences[1], 0.52),
                max(spec.guard_influences[2], 0.78),
                max(spec.guard_influences[3], 0.90),
                max(spec.guard_influences[4], 0.82),
                max(spec.guard_influences[5], 0.46),
                spec.guard_influences[6],
            ),
            guard_height=max(spec.guard_height, 0.245),
            guard_forward=min(spec.guard_forward, 0.095),
        )
    else:
        reference = choose_reference_action(spec)
        spec = replace(spec, source_action_hint=reference.name)
    rig.configure_v1_for_spec(spec)
    ensure_kick_bones(armature, spec)
    if mocap_meta is not None:
        reference_impact_u = mocap_meta.impact_normalized_time
        reference_prior_score = mocap_meta.activity_score
        reference_knots = reference_knots_for_impact(spec, reference_impact_u)
    else:
        reference_knots, reference_impact_u, reference_prior_score = derive_reference_knots(
            scene, armature, reference, spec, axes[2]
        )
    spec = replace(spec, source_knots=reference_knots)
    rig.configure_v1_for_spec(spec)
    source = reference
    source_name = source.name
    samples = rig.v1.sample_source_basis(scene, armature, source)
    base = rig.v1.key_pose_basis(scene, armature, f"{spec.action_name}_BASE", samples)
    armature.animation_data.action = base
    leg_names = (
        f"thigh_{spec.strike_suffix}", f"calf_{spec.strike_suffix}", f"foot_{spec.strike_suffix}",
        f"thigh_{spec.support_suffix}", f"calf_{spec.support_suffix}", f"foot_{spec.support_suffix}",
    )
    reference_leg_positions = rig.v1.evaluated_positions(scene, armature, spec.phases, leg_names)

    strike_world = armature.matrix_world.to_3x3() @ axes[0]
    masters = rig.add_master_controls(scene, armature, base, strike_world, spec)
    use_mocap_support_anchor = mocap_meta is not None and spec.action_name == "BF_RisingKick_R"
    controls, pole_calibration = add_kick_controls(
        scene, armature, base, spec, *axes,
        use_mocap_support_anchor=use_mocap_support_anchor,
    )
    guards = add_guard_controls(scene, armature, base, spec, *axes)

    constrained = {
        "constrainedStrikeFootTravel": foot_travel(scene, armature, spec),
        "constrainedStrikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),
        "constrainedStrikeFootOutwardReach": foot_axis_reach(scene, armature, spec, axes[1]) * (-1.0 if spec.strike_suffix == "l" else 1.0),
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
    final_leg_positions = rig.v1.evaluated_positions(scene, armature, spec.phases, leg_names)
    strike_knee_plane_min_dot = knee_plane_min_dot(
        reference_leg_positions, final_leg_positions, spec.phases[1:-1],
        f"thigh_{spec.strike_suffix}", f"calf_{spec.strike_suffix}", f"foot_{spec.strike_suffix}",
    )
    support_knee_plane_min_dot = knee_plane_min_dot(
        reference_leg_positions, final_leg_positions, spec.phases[1:-1],
        f"thigh_{spec.support_suffix}", f"calf_{spec.support_suffix}", f"foot_{spec.support_suffix}",
    )
    reference_poses = reference_pose_snapshots(scene, armature, spec, axes[0], axes[2])
    rig.v1.remove_controls([*controls, *guards, *masters])
    metrics = {
        "version": spec.version,
        "action": spec.action_name,
        "sourceAction": source_name,
        "referenceSourceAction": source_name,
        "referenceImpactNormalizedTime": reference_impact_u,
        "referencePriorActivityScore": reference_prior_score,
        "referenceTimeWarpKnots": [list(knot) for knot in spec.source_knots],
        "contactIKPolicy": "IMPACT_WINDOW_ONLY",
        "kneePolePolicy": KNEE_POLE_POLICY,
        "footOrientationPolicy": FOOT_ORIENTATION_POLICY,
        "poleAnglePolicy": POLE_ANGLE_POLICY,
        **pole_calibration,
        "strikeKneePlaneMinDot": strike_knee_plane_min_dot,
        "supportKneePlaneMinDot": support_knee_plane_min_dot,
        "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6" if mocap_meta is not None else "UAL2_AUTHORED_REFERENCE_V6",
        "mocapSupportAnchorBefore": mocap_support_anchor_before,
        "mocapSupportAnchorAfter": mocap_support_anchor_after,
        **(mocap_meta.as_dict() if mocap_meta is not None else {}),
        "fps": rig.FPS,
        "startFrame": spec.start_frame,
        "endFrame": spec.end_frame,
        "durationSeconds": (spec.end_frame - spec.start_frame) / rig.FPS,
        "impactFrame": spec.impact_frame,
        "strikeSide": spec.strike_side.upper(),
        "supportSide": spec.support_side.upper(),
        "strikeFootTravel": foot_travel(scene, armature, spec),
        "strikeFootForwardReach": foot_axis_reach(scene, armature, spec, axes[0]),
        "strikeFootOutwardReach": foot_axis_reach(scene, armature, spec, axes[1]) * (-1.0 if spec.strike_suffix == "l" else 1.0),
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
        "naturalnessPass": "REFERENCE_DRIVEN_V6",
        "referencePoseMethod": "FULL_BODY_REFERENCE_V6",
        "referencePoses": reference_poses,
        "pipeline": [
            (f"measured CMU mocap full-body prior: {mocap_meta.source_file}" if mocap_meta is not None else f"full-body authored reference base: {source_name}"),
            "automatic kinetic-peak alignment to gameplay impact",
            "reference motion retained outside the contact window",
            "shoulder-orthogonal anatomical forward axis",
            "Cross max hand-to-pelvis reach chooses forward sign",
            "five-pose visual reference: START / CHAMBER / IMPACT / RECOVERY / GUARD",
            "shared COG/pelvis and staged torso masters",
            f"{spec.strike_side.upper()} contact-window strike-leg IK",
            "hip-relative impact reach from authored leg length",
            "impact knee-extension quality gate",
            "move-specific strike-foot orientation around anatomical body axes",
            "measured knee bend-plane hemisphere preservation",
            "automatic Blender IK pole-angle calibration with dense dynamic fallback",
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
    parser.add_argument("--reference-source")
    parser.add_argument("--mocap-front")
    parser.add_argument("--mocap-low")
    parser.add_argument("--mocap-rising")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(_argv_after_double_dash())
    rig.v1.reset_scene()
    armature = rig.v1.import_source(os.path.abspath(args.source))
    scene = bpy.context.scene
    imported_reference_actions = []
    if args.reference_source:
        imported_reference_actions = import_reference_actions(args.reference_source)
        print("MOTION_FOUNDRY_V6_REFERENCE_ACTIONS", imported_reference_actions)
    axes = body_axes(scene, armature)
    mocap_paths = {
        "BF_FrontKick_R": args.mocap_front,
        "BF_LowKick_L": args.mocap_low,
        "BF_RisingKick_R": args.mocap_rising,
    }
    actions, moves = [], []
    for spec in KICK_SPECS:
        action, metrics = build_kick_action(scene, armature, spec, axes, mocap_paths)
        actions.append(action); moves.append(metrics)
    summary = {
        "version": "BLENDER_MOTION_FOUNDRY_V6_KICKS",
        "sharedRig": "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG",
        "naturalnessPass": "REFERENCE_DRIVEN_V6",
        "referencePoseMethod": "FULL_BODY_REFERENCE_V6",
        "motionPriorProvider": ("CMU_MOCAP_WORLD_DELTA_V6" if all(mocap_paths.values()) else "HYBRID_REFERENCE_V6"),
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
