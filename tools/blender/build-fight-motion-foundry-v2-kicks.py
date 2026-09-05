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


KNEE_POLE_POLICY = "ANIMATED_MEASURED_KNEE_PLANE_V6_2"
FOOT_ORIENTATION_POLICY = "ANATOMICAL_BODY_AXES_V6_2"


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
) -> None:
    """Animate an IK pole from the measured knee plane for every authored phase.

    A single world-space pole is incorrect for a roundhouse/rising kick because
    the pelvis and support leg rotate through the strike.  Following the measured
    hip-knee-ankle plane keeps the knee on the human side of the chain.  A
    hemisphere continuity guard prevents an almost-straight leg from flipping the
    pole 180 degrees between adjacent phases.
    """
    keys = []
    previous_direction = None
    for frame in frames:
        hip = positions[frame][thigh_name]
        knee = positions[frame][calf_name]
        ankle = positions[frame][foot_name]
        pole = rig.v1.chain_pole(hip, knee, ankle, scale=scale)
        direction = pole - knee
        if direction.length < 1e-6:
            direction = previous_direction.copy() if previous_direction is not None else Vector((0.0, 1.0, 0.0))
        if previous_direction is not None and direction.dot(previous_direction) < 0.0:
            pole = knee - direction
            direction.negate()
        if direction.length > 1e-6:
            previous_direction = direction.normalized()

        # Legacy fixed pole bias could overpower the measured knee plane on
        # roundhouse/rising kicks. Keep only a small component perpendicular
        # to the hip-ankle chain and never let it push against the measured
        # bend hemisphere.
        safe_bias = bias.copy()
        chain_axis = ankle - hip
        if chain_axis.length > 1e-6:
            axis = chain_axis.normalized()
            safe_bias -= axis * safe_bias.dot(axis)
        if direction.length > 1e-6 and safe_bias.dot(direction) < 0.0:
            d = direction.normalized()
            safe_bias -= d * safe_bias.dot(d)
        max_bias = min(0.045, max(0.015, direction.length * 0.12))
        if safe_bias.length > max_bias:
            safe_bias.normalize()
            safe_bias *= max_bias
        pole += safe_bias
        keys.append((frame, pole))
    rig.v1.set_control_keys(control, armature, keys)
    rig.smooth_control_curves(control)


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
        key_orientation(
            strike_orientation, strike_foot_world, frame, pitch, yaw * side_sign,
            pitch_axis=left, yaw_axis=up,
        )
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
        key_orientation(
            support_orientation, support_world, frame, 0.0, yaw,
            pitch_axis=left, yaw_axis=up,
        )
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

def knee_plane_min_dot(reference_positions, final_positions, frames, thigh_name: str, calf_name: str, foot_name: str) -> float:
    """Return minimum source-vs-final bend-plane dot; negative means a knee flip."""
    dots = []
    for frame in frames:
        r_hip = reference_positions[frame][thigh_name]
        r_knee = reference_positions[frame][calf_name]
        r_ankle = reference_positions[frame][foot_name]
        f_hip = final_positions[frame][thigh_name]
        f_knee = final_positions[frame][calf_name]
        f_ankle = final_positions[frame][foot_name]
        r_normal = (r_knee - r_hip).cross(r_ankle - r_knee)
        f_normal = (f_knee - f_hip).cross(f_ankle - f_knee)
        # Near full extension has an unstable plane; skip those samples.
        if r_normal.length < 1e-4 or f_normal.length < 1e-4:
            continue
        dots.append(r_normal.normalized().dot(f_normal.normalized()))
    return min(dots) if dots else 1.0


def build_kick_action(scene: bpy.types.Scene, armature: bpy.types.Object, spec: KickSpec, axes, mocap_paths):
    # Reference-driven V6: measured full-body human motion is primary.  The
    # existing procedural rig is demoted to gameplay contact/support constraints.
    mocap_path = mocap_paths.get(spec.action_name)
    mocap_meta = None
    if mocap_path:
        reference, mocap_meta = mocap_v6.build_mocap_prior(scene, armature, spec, mocap_path, axes)
        # The mocap already contains weight transfer and counter-rotation.  Keep
        # only a small fraction of legacy master offsets to avoid double-driving.
        spec = replace(
            spec,
            source_action_hint=reference.name,
            pelvis_forward=tuple(value * 0.22 for value in spec.pelvis_forward),
            pelvis_drop=tuple(value * 0.22 for value in spec.pelvis_drop),
            pelvis_yaw=tuple(value * 0.12 for value in spec.pelvis_yaw),
            lower_yaw=tuple(value * 0.10 for value in spec.lower_yaw),
            upper_yaw=tuple(value * 0.10 for value in spec.upper_yaw),
            pelvis_pitch=tuple(value * 0.12 for value in spec.pelvis_pitch),
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
    controls = add_kick_controls(scene, armature, base, spec, *axes)
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
        "strikeKneePlaneMinDot": strike_knee_plane_min_dot,
        "supportKneePlaneMinDot": support_knee_plane_min_dot,
        "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6" if mocap_meta is not None else "UAL2_AUTHORED_REFERENCE_V6",
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
