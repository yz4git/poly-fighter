#!/usr/bin/env python3
"""Build the Blender-authored airborne Dash Kick for POLY FIGHTER.

Grounded kicks use a planted support-foot lock. Dash Kick deliberately does not:
it gets its own airborne contract with a COG jump arc, an extended strike leg,
a tucked trailing leg, high guard, and a controlled landing return.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import importlib.util
import json
import math
import os
from pathlib import Path
from typing import List, Tuple

import bpy
from mathutils import Matrix, Quaternion, Vector

import motion_foundry_v2_rig as rig


PhaseValues = rig.PhaseValues
PhaseOffsets = Tuple[
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
    Tuple[float, float, float],
]


def _load_kick_helpers():
    path = Path(__file__).with_name("build-fight-motion-foundry-v2-kicks.py")
    spec = importlib.util.spec_from_file_location("poly_fighter_grounded_kick_helpers", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load grounded kick helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kick = _load_kick_helpers()


@dataclass(frozen=True)
class AirborneSpec:
    action_name: str
    version: str
    end_frame: int
    load_frame: int
    precontact_frame: int
    impact_frame: int
    overtravel_frame: int
    recovery_frame: int
    strike_side: str
    trail_side: str
    strike_offsets: PhaseOffsets
    strike_reach_ratios: PhaseValues
    strike_reach_directions: PhaseOffsets
    strike_ik_influences: PhaseValues
    strike_foot_pitch: PhaseValues
    strike_foot_yaw: PhaseValues
    trail_offsets: PhaseOffsets
    trail_ik_influences: PhaseValues
    trail_foot_pitch: PhaseValues
    pelvis_forward: PhaseValues
    pelvis_drop: PhaseValues
    pelvis_yaw: PhaseValues
    lower_yaw: PhaseValues
    upper_yaw: PhaseValues
    pelvis_pitch: PhaseValues
    lower_pitch: PhaseValues
    upper_pitch: PhaseValues
    source_action_hint: str = "Idle_Loop_Armature"
    source_knots: Tuple[Tuple[float, float], ...] = ((0.0, 0.0), (1.0, 1.0))
    hand_scales: rig.HandScales = (None, None, None, None, None, None, None)
    hand_offsets: rig.HandOffsets = ((0.0, 0.0, 0.0),) * 7
    guard_influences: PhaseValues = (0.0, 0.70, 0.96, 1.0, 1.0, 0.72, 0.0)
    guard_forward: float = 0.11
    guard_width: float = 0.11
    guard_height: float = 0.165
    strike_knee_pole_scale: float = 2.3
    trail_knee_pole_scale: float = 1.8

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
    def trail_suffix(self) -> str:
        return self.trail_side.lower()

    # Shared v2 helper compatibility. This is not a planted support leg.
    @property
    def support_side(self) -> str:
        return self.trail_side

    @property
    def support_suffix(self) -> str:
        return self.trail_suffix


DASH_KICK = AirborneSpec(
    action_name="BF_DashKick_R",
    version="BLENDER_MOTION_FOUNDRY_V2_AIRBORNE_DASH",
    end_frame=45,
    load_frame=7,
    precontact_frame=16,
    impact_frame=23,
    overtravel_frame=27,
    recovery_frame=36,
    strike_side="r",
    trail_side="l",
    strike_offsets=(
        (0.00, 0.00, 0.00),
        (-0.08, 0.00, 0.08),
        (0.18, 0.00, 0.10),
        (0.42, 0.00, 0.13),
        (0.46, 0.00, 0.12),
        (0.04, 0.00, 0.04),
        (0.00, 0.00, 0.00),
    ),
    strike_reach_ratios=(0.0, 0.0, 0.91, 0.982, 0.988, 0.0, 0.0),
    strike_reach_directions=(
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        (0.95, 0.0, 0.31),
        (0.965, 0.0, 0.26),
        (0.975, 0.0, 0.22),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
    ),
    strike_ik_influences=(0.0, 0.68, 0.96, 1.0, 1.0, 0.70, 0.0),
    strike_foot_pitch=(0.0, 10.0, -2.0, -14.0, -18.0, 6.0, 0.0),
    strike_foot_yaw=(0.0, 0.0, 1.0, 2.0, 3.0, 1.0, 0.0),
    trail_offsets=(
        (0.00, 0.00, 0.00),
        (-0.04, 0.02, 0.09),
        (-0.11, 0.04, 0.24),
        (-0.17, 0.05, 0.34),
        (-0.15, 0.05, 0.31),
        (-0.04, 0.02, 0.11),
        (0.00, 0.00, 0.00),
    ),
    trail_ik_influences=(0.0, 0.58, 0.94, 1.0, 1.0, 0.68, 0.0),
    trail_foot_pitch=(0.0, 8.0, 18.0, 28.0, 24.0, 8.0, 0.0),
    pelvis_forward=(0.000, -0.018, 0.075, 0.180, 0.215, 0.072, 0.000),
    # Shared rig calls this pelvis_drop, but positive values produce the jump arc.
    pelvis_drop=(0.000, 0.028, 0.155, 0.245, 0.220, 0.072, 0.000),
    pelvis_yaw=(0.0, -3.0, 3.0, 7.0, 9.0, 3.0, 0.0),
    lower_yaw=(0.0, -4.0, 4.0, 9.0, 11.0, 4.0, 0.0),
    upper_yaw=(0.0, -3.0, 3.0, 7.0, 8.0, 3.0, 0.0),
    pelvis_pitch=(0.0, -5.0, -1.0, 7.0, 9.0, 3.0, 0.0),
    lower_pitch=(0.0, -5.0, 0.0, 9.0, 11.0, 4.0, 0.0),
    upper_pitch=(0.0, -2.0, 3.0, 11.0, 12.0, 4.0, 0.0),
)


def ensure_airborne_bones(armature: bpy.types.Object, spec: AirborneSpec) -> None:
    required = (
        "pelvis", "spine_02", "spine_03",
        "upperarm_l", "lowerarm_l", "hand_l",
        "upperarm_r", "lowerarm_r", "hand_r",
        f"thigh_{spec.strike_suffix}", f"calf_{spec.strike_suffix}", f"foot_{spec.strike_suffix}",
        f"thigh_{spec.trail_suffix}", f"calf_{spec.trail_suffix}", f"foot_{spec.trail_suffix}",
    )
    missing = [name for name in required if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"{spec.action_name}: required airborne bones missing: {missing}")
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"


def _key_orientation(control: bpy.types.Object, base: Matrix, frame: int, pitch_deg: float, yaw_deg: float) -> None:
    loc, rot, scale = base.decompose()
    yaw = Quaternion(Vector((0.0, 0.0, 1.0)), math.radians(yaw_deg))
    pitch = Quaternion(Vector((1.0, 0.0, 0.0)), math.radians(pitch_deg))
    rig.key_matrix(control, frame, Matrix.LocRotScale(loc, yaw @ pitch @ rot, scale))


def _leg_lengths(positions, frame: int, thigh: str, calf: str, foot: str) -> float:
    hip = positions[frame][thigh]
    knee = positions[frame][calf]
    ankle = positions[frame][foot]
    length = (hip - knee).length + (knee - ankle).length
    if length < 1e-4:
        raise RuntimeError("Airborne leg did not provide a usable authored length")
    return length


def add_airborne_leg_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    spec: AirborneSpec,
    forward: Vector,
    left: Vector,
    up: Vector,
):
    strike = spec.strike_suffix
    trail = spec.trail_suffix
    s_thigh, s_calf, s_foot = f"thigh_{strike}", f"calf_{strike}", f"foot_{strike}"
    t_thigh, t_calf, t_foot = f"thigh_{trail}", f"calf_{trail}", f"foot_{trail}"
    names = (s_thigh, s_calf, s_foot, t_thigh, t_calf, t_foot)
    armature.animation_data.action = base_action
    positions = rig.v1.evaluated_positions(scene, armature, spec.phases, names)
    controls = []

    side_sign = 1.0 if strike == "l" else -1.0
    strike_length = _leg_lengths(positions, spec.start_frame, s_thigh, s_calf, s_foot)
    strike_target = rig.v1.make_control(
        f"{spec.action_name}_CTRL_strike_foot",
        armature,
        positions[spec.start_frame][s_foot],
    )
    strike_keys = []
    for frame, offset_values, reach_ratio, direction_values in zip(
        spec.phases,
        spec.strike_offsets,
        spec.strike_reach_ratios,
        spec.strike_reach_directions,
    ):
        if reach_ratio > 0.0:
            df, dl, du = direction_values
            direction = forward * df + left * (dl * side_sign) + up * du
            if direction.length < 1e-4:
                raise RuntimeError(f"{spec.action_name}: strike reach direction is degenerate at frame {frame}")
            direction.normalize()
            target = positions[frame][s_thigh] + direction * (strike_length * reach_ratio)
        else:
            fwd, lateral, vertical = offset_values
            target = positions[frame][s_foot] + forward * fwd + left * (lateral * side_sign) + up * vertical
        strike_keys.append((frame, target))
    rig.v1.set_control_keys(strike_target, armature, strike_keys)
    controls.append(strike_target)

    strike_pole = rig.v1.make_control(
        f"{spec.action_name}_CTRL_strike_knee",
        armature,
        rig.v1.chain_pole(
            positions[spec.start_frame][s_thigh],
            positions[spec.start_frame][s_calf],
            positions[spec.start_frame][s_foot],
            scale=spec.strike_knee_pole_scale,
        ),
    )
    strike_pole_keys = []
    for frame in spec.phases:
        strike_pole_keys.append((
            frame,
            rig.v1.chain_pole(
                positions[frame][s_thigh], positions[frame][s_calf], positions[frame][s_foot],
                scale=spec.strike_knee_pole_scale,
            ),
        ))
    rig.v1.set_control_keys(strike_pole, armature, strike_pole_keys)
    controls.append(strike_pole)

    strike_ik = armature.pose.bones[s_calf].constraints.new(type="IK")
    strike_ik.name = f"{spec.action_name}_StrikeLegIK"
    strike_ik.target = strike_target
    strike_ik.pole_target = strike_pole
    strike_ik.chain_count = 2
    for frame, influence in zip(spec.phases, spec.strike_ik_influences):
        strike_ik.influence = influence
        strike_ik.keyframe_insert(data_path="influence", frame=frame)

    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    strike_foot_world = rig.pose_world_matrix(armature, s_foot)
    strike_orientation = rig.make_matrix_control(
        f"{spec.action_name}_CTRL_strike_foot_orientation", strike_foot_world, 0.065
    )
    strike_rot = armature.pose.bones[s_foot].constraints.new(type="COPY_ROTATION")
    strike_rot.name = f"{spec.action_name}_StrikeFootOrientation"
    strike_rot.target = strike_orientation
    strike_rot.owner_space = "WORLD"
    strike_rot.target_space = "WORLD"
    strike_rot.mix_mode = "REPLACE"
    for frame, pitch, yaw, influence in zip(
        spec.phases, spec.strike_foot_pitch, spec.strike_foot_yaw, spec.strike_ik_influences
    ):
        _key_orientation(strike_orientation, strike_foot_world, frame, pitch, yaw * side_sign)
        strike_rot.influence = influence
        strike_rot.keyframe_insert(data_path="influence", frame=frame)
    rig.smooth_control_curves(strike_orientation)
    controls.append(strike_orientation)

    trail_sign = 1.0 if trail == "l" else -1.0
    trail_target = rig.v1.make_control(
        f"{spec.action_name}_CTRL_trail_foot",
        armature,
        positions[spec.start_frame][t_foot],
    )
    trail_keys = []
    for frame, (fwd, lateral, vertical) in zip(spec.phases, spec.trail_offsets):
        target = positions[frame][t_foot] + forward * fwd + left * (lateral * trail_sign) + up * vertical
        trail_keys.append((frame, target))
    rig.v1.set_control_keys(trail_target, armature, trail_keys)
    controls.append(trail_target)

    trail_pole = rig.v1.make_control(
        f"{spec.action_name}_CTRL_trail_knee",
        armature,
        rig.v1.chain_pole(
            positions[spec.start_frame][t_thigh],
            positions[spec.start_frame][t_calf],
            positions[spec.start_frame][t_foot],
            scale=spec.trail_knee_pole_scale,
        ),
    )
    trail_pole_keys = []
    for frame in spec.phases:
        pole = rig.v1.chain_pole(
            positions[frame][t_thigh], positions[frame][t_calf], positions[frame][t_foot],
            scale=spec.trail_knee_pole_scale,
        )
        # Bias the trailing knee slightly downward/back to make the tuck readable in silhouette.
        pole += forward * -0.05 + up * -0.03
        trail_pole_keys.append((frame, pole))
    rig.v1.set_control_keys(trail_pole, armature, trail_pole_keys)
    controls.append(trail_pole)

    trail_ik = armature.pose.bones[t_calf].constraints.new(type="IK")
    trail_ik.name = f"{spec.action_name}_TrailLegTuckIK"
    trail_ik.target = trail_target
    trail_ik.pole_target = trail_pole
    trail_ik.chain_count = 2
    for frame, influence in zip(spec.phases, spec.trail_ik_influences):
        trail_ik.influence = influence
        trail_ik.keyframe_insert(data_path="influence", frame=frame)

    scene.frame_set(spec.start_frame); bpy.context.view_layer.update()
    trail_foot_world = rig.pose_world_matrix(armature, t_foot)
    trail_orientation = rig.make_matrix_control(
        f"{spec.action_name}_CTRL_trail_foot_orientation", trail_foot_world, 0.055
    )
    trail_rot = armature.pose.bones[t_foot].constraints.new(type="COPY_ROTATION")
    trail_rot.name = f"{spec.action_name}_TrailFootOrientation"
    trail_rot.target = trail_orientation
    trail_rot.owner_space = "WORLD"
    trail_rot.target_space = "WORLD"
    trail_rot.mix_mode = "REPLACE"
    for frame, pitch, influence in zip(spec.phases, spec.trail_foot_pitch, spec.trail_ik_influences):
        _key_orientation(trail_orientation, trail_foot_world, frame, pitch, 0.0)
        trail_rot.influence = influence
        trail_rot.keyframe_insert(data_path="influence", frame=frame)
    rig.smooth_control_curves(trail_orientation)
    controls.append(trail_orientation)

    return controls


def _pose_head(scene: bpy.types.Scene, armature: bpy.types.Object, bone: str, frame: int) -> Vector:
    scene.frame_set(frame); bpy.context.view_layer.update()
    return rig.v1.pose_head(armature, bone)


def axis_delta(scene, armature, bone: str, start_frame: int, frame: int, axis: Vector) -> float:
    start = _pose_head(scene, armature, bone, start_frame)
    current = _pose_head(scene, armature, bone, frame)
    return (current - start).dot(axis)


def pelvis_apex_rise(scene, armature, spec: AirborneSpec, up: Vector) -> float:
    start = _pose_head(scene, armature, "pelvis", spec.start_frame)
    maximum = 0.0
    for frame in range(spec.start_frame, spec.end_frame + 1):
        current = _pose_head(scene, armature, "pelvis", frame)
        maximum = max(maximum, (current - start).dot(up))
    return maximum


def landing_vertical_residual(scene, armature, spec: AirborneSpec, up: Vector) -> float:
    return abs(axis_delta(scene, armature, "pelvis", spec.start_frame, spec.end_frame, up))


def trail_knee_angle_degrees(scene, armature, spec: AirborneSpec) -> float:
    thigh = f"thigh_{spec.trail_suffix}"
    calf = f"calf_{spec.trail_suffix}"
    foot = f"foot_{spec.trail_suffix}"
    hip = _pose_head(scene, armature, thigh, spec.impact_frame)
    knee = _pose_head(scene, armature, calf, spec.impact_frame)
    ankle = _pose_head(scene, armature, foot, spec.impact_frame)
    upper = hip - knee
    lower = ankle - knee
    if upper.length < 1e-6 or lower.length < 1e-6:
        return 180.0
    return math.degrees(upper.angle(lower))


def collect_metrics(scene, armature, spec: AirborneSpec, axes) -> dict:
    forward, _left, up = axes
    strike_foot = f"foot_{spec.strike_suffix}"
    trail_foot = f"foot_{spec.trail_suffix}"
    return {
        "strikeFootTravel": kick.foot_travel(scene, armature, spec),
        "strikeFootForwardReach": kick.foot_axis_reach(scene, armature, spec, forward),
        "strikeFootVerticalRise": kick.foot_axis_reach(scene, armature, spec, up),
        "strikeKneeExtensionDegrees": kick.strike_knee_extension_degrees(scene, armature, spec),
        "strikeLegReachRatio": kick.strike_leg_reach_ratio(scene, armature, spec),
        "trailFootVerticalRise": axis_delta(scene, armature, trail_foot, spec.start_frame, spec.impact_frame, up),
        "trailKneeAngleDegrees": trail_knee_angle_degrees(scene, armature, spec),
        "pelvisImpactRise": axis_delta(scene, armature, "pelvis", spec.start_frame, spec.impact_frame, up),
        "pelvisApexRise": pelvis_apex_rise(scene, armature, spec, up),
        "landingVerticalResidual": landing_vertical_residual(scene, armature, spec, up),
        "guardHandMaxChestDistance": kick.guard_distance(scene, armature, spec),
        "guardHandMinChestHeight": kick.guard_min_height(scene, armature, spec, up),
        "pelvisTravel": rig.pelvis_travel(scene, armature, spec),
        "torsoTwistDegrees": rig.torso_twist_degrees(scene, armature, spec),
        "airborneFeetAtImpact": min(
            axis_delta(scene, armature, strike_foot, spec.start_frame, spec.impact_frame, up),
            axis_delta(scene, armature, trail_foot, spec.start_frame, spec.impact_frame, up),
        ),
    }


def build_airborne_action(scene, armature, spec: AirborneSpec, axes):
    rig.configure_v1_for_spec(spec)
    ensure_airborne_bones(armature, spec)
    source = rig.v1.find_source_action()
    source_name = source.name
    samples = rig.v1.sample_source_basis(scene, armature, source)
    base = rig.v1.key_pose_basis(scene, armature, f"{spec.action_name}_BASE", samples)
    armature.animation_data.action = base

    strike_world = armature.matrix_world.to_3x3() @ axes[0]
    masters = rig.add_master_controls(scene, armature, base, strike_world, spec)
    legs = add_airborne_leg_controls(scene, armature, base, spec, *axes)
    guards = kick.add_guard_controls(scene, armature, base, spec, *axes)

    before_bake = collect_metrics(scene, armature, spec, axes)
    constrained = {f"constrained{key[0].upper()}{key[1:]}": value for key, value in before_bake.items()}
    final_action = rig.v1.bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    rig.v1.remove_controls([*legs, *guards, *masters])
    after_bake = collect_metrics(scene, armature, spec, axes)

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
        "trailSide": spec.trail_side.upper(),
        **after_bake,
        **constrained,
        "boneCount": len(armature.pose.bones),
        "meshCount": len([o for o in bpy.context.scene.objects if o.type == "MESH"]),
        "sharedRig": "MOTION_FOUNDRY_V2_AIRBORNE_STRIKE_RIG",
        "pipeline": [
            "Idle_Loop whole-body base",
            "shoulder-orthogonal anatomical forward axis",
            "Cross max hand-to-pelvis reach chooses forward sign",
            "shared COG/pelvis jump arc and staged torso masters",
            "R strike-leg two-bone IK with authored leg-length reach",
            "L trailing-leg tuck IK",
            "independent strike/trail foot orientation",
            "dual high-guard hand IK",
            "no planted support-foot constraint while airborne",
            "landing return to neutral pelvis height",
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
    axes = kick.body_axes(scene, armature)
    action, metrics = build_airborne_action(scene, armature, DASH_KICK, axes)
    summary = {
        "version": "BLENDER_MOTION_FOUNDRY_V2_AIRBORNE",
        "sharedRig": "MOTION_FOUNDRY_V2_AIRBORNE_STRIKE_RIG",
        "fps": rig.FPS,
        "actions": [DASH_KICK.action_name],
        "moves": [metrics],
        "boneCount": len(armature.pose.bones),
    }
    rig.export_action_library(
        scene,
        armature,
        Path(args.output_dir).resolve(),
        [action],
        summary,
        glb_name="blender-airborne-core.glb",
        blend_name="blender-airborne-core-v2.blend",
        metrics_name="blender-airborne-core.metrics.json",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
