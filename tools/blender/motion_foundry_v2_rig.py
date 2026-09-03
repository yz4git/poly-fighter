#!/usr/bin/env python3
"""Shared Blender Motion Foundry v2 strike rig.

This module centralises the authored control-rig logic first proven by
BF_Cross_R so additional punches can share one deterministic pipeline:

- whole-body nonlinear source retiming
- COG/pelvis world-space master control
- staged lower/upper torso master controls
- strike-hand two-bone IK + elbow pole
- opposite support-foot position IK lock
- support-foot world-space orientation lock
- native Blender visual/NLA bake
- reusable metrics and glTF export helpers

Move-specific scripts only provide timing, hand-path and master-control curves.
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import json
import math
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 60
PHASE_COUNT = 7
PhaseValues = Tuple[float, float, float, float, float, float, float]
HandScales = Tuple[
    Optional[float],
    Optional[float],
    Optional[float],
    Optional[float],
    Optional[float],
    Optional[float],
    Optional[float],
]
Offset3 = Tuple[float, float, float]
HandOffsets = Tuple[Offset3, Offset3, Offset3, Offset3, Offset3, Offset3, Offset3]


def _load_v1_module():
    path = Path(__file__).with_name("build-fight-motion-foundry-v1.py")
    spec = importlib.util.spec_from_file_location("poly_fighter_motion_foundry_v1", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load Motion Foundry v1 helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v1 = _load_v1_module()


@dataclass(frozen=True)
class StrikeSpec:
    action_name: str
    version: str
    source_action_hint: str
    end_frame: int
    load_frame: int
    precontact_frame: int
    impact_frame: int
    overtravel_frame: int
    recovery_frame: int
    strike_side: str
    support_side: str
    source_knots: Tuple[Tuple[float, float], ...]
    hand_scales: HandScales
    hand_offsets: HandOffsets
    ik_influences: PhaseValues
    pelvis_forward: PhaseValues
    pelvis_drop: PhaseValues
    pelvis_yaw: PhaseValues
    lower_yaw: PhaseValues
    upper_yaw: PhaseValues
    pelvis_pitch: PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    lower_pitch: PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    upper_pitch: PhaseValues = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    hand_pole_scale: float = 2.2
    knee_pole_scale: float = 1.8

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


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def remap_u(knots: Sequence[Tuple[float, float]], u: float) -> float:
    for (du0, su0), (du1, su1) in zip(knots, knots[1:]):
        if u <= du1:
            local = 0.0 if du1 == du0 else (u - du0) / (du1 - du0)
            return su0 + (su1 - su0) * smoothstep(local)
    return 1.0


def phase_curve(spec: StrikeSpec, values: PhaseValues) -> Tuple[Tuple[int, float], ...]:
    if len(values) != PHASE_COUNT:
        raise ValueError(f"{spec.action_name}: phase curve must contain {PHASE_COUNT} values")
    return tuple(zip(spec.phases, values))


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
    spec: StrikeSpec,
    bone_names: Iterable[str],
) -> Dict[int, Dict[str, Matrix]]:
    armature.animation_data.action = action
    result: Dict[int, Dict[str, Matrix]] = {}
    for frame in range(spec.start_frame, spec.end_frame + 1):
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


def matrix_with_world_delta(
    base: Matrix,
    translation: Vector,
    yaw_radians: float,
    pitch_radians: float = 0.0,
) -> Matrix:
    location, rotation, scale = base.decompose()
    yaw = Quaternion(Vector((0.0, 0.0, 1.0)), yaw_radians)
    pitch = Quaternion(Vector((1.0, 0.0, 0.0)), pitch_radians)
    return Matrix.LocRotScale(location + translation, yaw @ pitch @ rotation, scale)


def ensure_required_bones(armature: bpy.types.Object, spec: StrikeSpec) -> None:
    required = (
        "pelvis",
        "spine_02",
        "spine_03",
        f"upperarm_{spec.strike_suffix}",
        f"lowerarm_{spec.strike_suffix}",
        f"hand_{spec.strike_suffix}",
        f"thigh_{spec.support_suffix}",
        f"calf_{spec.support_suffix}",
        f"foot_{spec.support_suffix}",
    )
    missing = [name for name in required if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"{spec.action_name}: Motion Foundry required bones missing: {missing}")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"


def configure_v1_for_spec(spec: StrikeSpec) -> None:
    v1.START_FRAME = spec.start_frame
    v1.END_FRAME = spec.end_frame
    v1.LOAD_FRAME = spec.load_frame
    v1.PRECONTACT_FRAME = spec.precontact_frame
    v1.IMPACT_FRAME = spec.impact_frame
    v1.OVERTRAVEL_FRAME = spec.overtravel_frame
    v1.RECOVERY_FRAME = spec.recovery_frame
    v1.ACTION_NAME = spec.action_name
    v1.SOURCE_ACTION_HINT = spec.source_action_hint
    v1.source_u_for_destination_u = lambda u: remap_u(spec.source_knots, u)


def source_twist_sign(
    world_samples: Dict[int, Dict[str, Matrix]],
    spec: StrikeSpec,
) -> float:
    start_q = world_samples[spec.start_frame]["spine_03"].to_quaternion()
    impact_q = world_samples[spec.impact_frame]["spine_03"].to_quaternion()
    delta = start_q.rotation_difference(impact_q).to_euler("XYZ").z
    return -1.0 if delta < 0.0 else 1.0


def add_master_controls(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    base_action: bpy.types.Action,
    strike_world: Vector,
    spec: StrikeSpec,
) -> List[bpy.types.Object]:
    samples = sample_world_matrices(
        scene,
        armature,
        base_action,
        spec,
        ("pelvis", "spine_02", "spine_03"),
    )
    ground = Vector((strike_world.x, strike_world.y, 0.0))
    if ground.length < 1e-5:
        ground = Vector((0.0, -1.0, 0.0))
    ground.normalize()
    twist_sign = source_twist_sign(samples, spec)
    prefix = spec.action_name.replace("BF_", "BF2_")

    pelvis = make_matrix_control(f"{prefix}_CTRL_COG", samples[spec.start_frame]["pelvis"], 0.095)
    lower_torso = make_matrix_control(
        f"{prefix}_CTRL_torso_lower",
        samples[spec.start_frame]["spine_02"],
    )
    upper_torso = make_matrix_control(
        f"{prefix}_CTRL_torso_upper",
        samples[spec.start_frame]["spine_03"],
    )

    pelvis_forward = phase_curve(spec, spec.pelvis_forward)
    pelvis_drop = phase_curve(spec, spec.pelvis_drop)
    pelvis_yaw = phase_curve(spec, spec.pelvis_yaw)
    lower_yaw = phase_curve(spec, spec.lower_yaw)
    upper_yaw = phase_curve(spec, spec.upper_yaw)
    pelvis_pitch = phase_curve(spec, spec.pelvis_pitch)
    lower_pitch = phase_curve(spec, spec.lower_pitch)
    upper_pitch = phase_curve(spec, spec.upper_pitch)

    for frame in range(spec.start_frame, spec.end_frame + 1):
        forward = phase_value(frame, pelvis_forward)
        drop = phase_value(frame, pelvis_drop)
        shared_translation = ground * forward + Vector((0.0, 0.0, drop))
        pelvis_matrix = matrix_with_world_delta(
            samples[frame]["pelvis"],
            shared_translation,
            math.radians(phase_value(frame, pelvis_yaw) * twist_sign),
            math.radians(phase_value(frame, pelvis_pitch)),
        )
        lower_matrix = matrix_with_world_delta(
            samples[frame]["spine_02"],
            shared_translation + ground * 0.004,
            math.radians(phase_value(frame, lower_yaw) * twist_sign),
            math.radians(phase_value(frame, lower_pitch)),
        )
        upper_matrix = matrix_with_world_delta(
            samples[frame]["spine_03"],
            shared_translation + ground * 0.008,
            math.radians(phase_value(frame, upper_yaw) * twist_sign),
            math.radians(phase_value(frame, upper_pitch)),
        )
        key_matrix(pelvis, frame, pelvis_matrix)
        key_matrix(lower_torso, frame, lower_matrix)
        key_matrix(upper_torso, frame, upper_matrix)

    for control in (pelvis, lower_torso, upper_torso):
        smooth_control_curves(control)

    for bone_name, control, label in (
        ("pelvis", pelvis, f"{prefix}_COG_Master"),
        ("spine_02", lower_torso, f"{prefix}_LowerTorso_Master"),
        ("spine_03", upper_torso, f"{prefix}_UpperTorso_Master"),
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
    spec: StrikeSpec,
) -> Tuple[List[bpy.types.Object], Vector]:
    strike_suffix = spec.strike_suffix
    support_suffix = spec.support_suffix
    upperarm_name = f"upperarm_{strike_suffix}"
    lowerarm_name = f"lowerarm_{strike_suffix}"
    hand_name = f"hand_{strike_suffix}"
    thigh_name = f"thigh_{support_suffix}"
    calf_name = f"calf_{support_suffix}"
    foot_name = f"foot_{support_suffix}"
    frames = spec.phases

    armature.animation_data.action = base_action
    positions = v1.evaluated_positions(
        scene,
        armature,
        frames,
        (upperarm_name, lowerarm_name, hand_name, thigh_name, calf_name, foot_name),
    )
    start_hand = positions[spec.start_frame][hand_name]
    impact_hand = positions[spec.impact_frame][hand_name]
    strike = impact_hand - start_hand
    if strike.length < 1e-4:
        raise RuntimeError(
            f"{spec.action_name}: {spec.source_action_hint} does not provide a usable {hand_name} strike path"
        )

    prefix = spec.action_name.replace("BF_", "BF2_")
    hand_target = v1.make_control(f"{prefix}_CTRL_{hand_name}", armature, start_hand)
    hand_keys = []
    for frame, scale, offset in zip(spec.phases, spec.hand_scales, spec.hand_offsets):
        base = positions[frame][hand_name] if scale is None else start_hand + strike * scale
        hand_keys.append((frame, base + Vector(offset)))
    v1.set_control_keys(hand_target, armature, hand_keys)

    shoulder = positions[spec.impact_frame][upperarm_name]
    elbow = positions[spec.impact_frame][lowerarm_name]
    wrist = positions[spec.impact_frame][hand_name]
    elbow_pole = v1.make_control(
        f"{prefix}_CTRL_elbow_{strike_suffix}",
        armature,
        v1.chain_pole(shoulder, elbow, wrist, scale=spec.hand_pole_scale),
    )
    lowerarm = armature.pose.bones[lowerarm_name]
    hand_ik = lowerarm.constraints.new(type="IK")
    hand_ik.name = f"{prefix}_{'Left' if strike_suffix == 'l' else 'Right'}HandContactIK"
    hand_ik.target = hand_target
    hand_ik.pole_target = elbow_pole
    hand_ik.chain_count = 2
    for frame, influence in zip(spec.phases, spec.ik_influences):
        hand_ik.influence = influence
        hand_ik.keyframe_insert(data_path="influence", frame=frame)

    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    ankle = v1.pose_tail(armature, calf_name)
    knee = positions[spec.start_frame][calf_name]
    hip = positions[spec.start_frame][thigh_name]
    foot_target = v1.make_control(f"{prefix}_CTRL_foot_{support_suffix}", armature, ankle)
    knee_pole = v1.make_control(
        f"{prefix}_CTRL_knee_{support_suffix}",
        armature,
        v1.chain_pole(hip, knee, ankle, scale=spec.knee_pole_scale),
    )
    calf = armature.pose.bones[calf_name]
    foot_ik = calf.constraints.new(type="IK")
    foot_ik.name = f"{prefix}_{'Left' if support_suffix == 'l' else 'Right'}FootPositionLockIK"
    foot_ik.target = foot_target
    foot_ik.pole_target = knee_pole
    foot_ik.chain_count = 2
    foot_ik.influence = 1.0

    foot_world = pose_world_matrix(armature, foot_name)
    foot_rotation = make_matrix_control(
        f"{prefix}_CTRL_foot_{support_suffix}_orientation",
        foot_world,
        0.065,
    )
    foot_constraint = armature.pose.bones[foot_name].constraints.new(type="COPY_ROTATION")
    foot_constraint.name = f"{prefix}_{'Left' if support_suffix == 'l' else 'Right'}FootOrientationLock"
    foot_constraint.target = foot_rotation
    foot_constraint.owner_space = "WORLD"
    foot_constraint.target_space = "WORLD"
    foot_constraint.mix_mode = "REPLACE"
    foot_constraint.influence = 1.0

    strike_world = armature.matrix_world.to_3x3() @ strike
    return [hand_target, elbow_pole, foot_target, knee_pole, foot_rotation], strike_world


def support_foot_drift(scene: bpy.types.Scene, armature: bpy.types.Object, spec: StrikeSpec) -> float:
    calf_name = f"calf_{spec.support_suffix}"
    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    start = v1.pose_tail(armature, calf_name)
    maximum = 0.0
    for frame in range(spec.start_frame, spec.end_frame + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        maximum = max(maximum, (v1.pose_tail(armature, calf_name) - start).length)
    return maximum


def support_foot_rotation_drift_degrees(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    spec: StrikeSpec,
) -> float:
    foot_name = f"foot_{spec.support_suffix}"
    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    start = pose_world_matrix(armature, foot_name).to_quaternion()
    maximum = 0.0
    for frame in range(spec.start_frame, spec.end_frame + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        current = pose_world_matrix(armature, foot_name).to_quaternion()
        maximum = max(maximum, math.degrees(start.rotation_difference(current).angle))
    return maximum


def strike_hand_travel(scene: bpy.types.Scene, armature: bpy.types.Object, spec: StrikeSpec) -> float:
    hand_name = f"hand_{spec.strike_suffix}"
    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    start = v1.pose_head(armature, hand_name)
    scene.frame_set(spec.impact_frame)
    bpy.context.view_layer.update()
    return (v1.pose_head(armature, hand_name) - start).length


def pelvis_travel(scene: bpy.types.Scene, armature: bpy.types.Object, spec: StrikeSpec) -> float:
    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    start = v1.pose_head(armature, "pelvis")
    scene.frame_set(spec.impact_frame)
    bpy.context.view_layer.update()
    return (v1.pose_head(armature, "pelvis") - start).length


def torso_twist_degrees(scene: bpy.types.Scene, armature: bpy.types.Object, spec: StrikeSpec) -> float:
    scene.frame_set(spec.start_frame)
    bpy.context.view_layer.update()
    start = pose_world_matrix(armature, "spine_03").to_quaternion()
    scene.frame_set(spec.impact_frame)
    bpy.context.view_layer.update()
    impact = pose_world_matrix(armature, "spine_03").to_quaternion()
    return math.degrees(start.rotation_difference(impact).angle)


def build_strike_action(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    spec: StrikeSpec,
) -> Tuple[bpy.types.Action, dict]:
    configure_v1_for_spec(spec)
    ensure_required_bones(armature, spec)
    source_action = v1.find_source_action()
    source_name = source_action.name
    scene.render.fps = FPS

    source_samples = v1.sample_source_basis(scene, armature, source_action)
    base_action = v1.key_pose_basis(
        scene,
        armature,
        f"{spec.action_name}_BASE",
        source_samples,
    )
    armature.animation_data.action = base_action

    limb_controls, strike_world = add_contact_and_foot_controls(scene, armature, base_action, spec)
    master_controls = add_master_controls(scene, armature, base_action, strike_world, spec)

    constrained = {
        "constrainedSupportFootLockMaxDrift": support_foot_drift(scene, armature, spec),
        "constrainedSupportFootLockMaxAngularDriftDegrees": support_foot_rotation_drift_degrees(
            scene, armature, spec
        ),
        "constrainedStrikeHandTravel": strike_hand_travel(scene, armature, spec),
        "constrainedPelvisTravel": pelvis_travel(scene, armature, spec),
        "constrainedTorsoTwistDegrees": torso_twist_degrees(scene, armature, spec),
    }

    final_action = v1.bake_visual_action(scene, armature, constrained)
    final_action.use_fake_user = True
    v1.remove_controls([*limb_controls, *master_controls])

    baked_hand = strike_hand_travel(scene, armature, spec)
    baked_foot = support_foot_drift(scene, armature, spec)
    baked_foot_angle = support_foot_rotation_drift_degrees(scene, armature, spec)
    metrics = {
        "version": spec.version,
        "action": spec.action_name,
        "sourceAction": source_name,
        "fps": FPS,
        "startFrame": spec.start_frame,
        "endFrame": spec.end_frame,
        "durationSeconds": (spec.end_frame - spec.start_frame) / FPS,
        "impactFrame": spec.impact_frame,
        "strikeSide": spec.strike_side.upper(),
        "supportSide": spec.support_side.upper(),
        "strikeHandTravel": baked_hand,
        "supportFootLockMaxDrift": baked_foot,
        "supportFootLockMaxAngularDriftDegrees": baked_foot_angle,
        "pelvisTravel": pelvis_travel(scene, armature, spec),
        "torsoTwistDegrees": torso_twist_degrees(scene, armature, spec),
        **constrained,
        "boneCount": len(armature.pose.bones),
        "meshCount": len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"]),
        "sharedRig": "MOTION_FOUNDRY_V2_SHARED_STRIKE_RIG",
        "pipeline": [
            f"{spec.source_action_hint} source body motion",
            "move-specific nonlinear whole-body retiming",
            "shared COG/pelvis world-space master control",
            "shared staged lower/upper torso master controls",
            f"{spec.strike_side.upper()} strike-hand two-bone IK contact control",
            f"world-space {spec.support_side.upper()} support-foot position IK lock",
            f"world-space {spec.support_side.upper()} support-foot orientation lock",
            "Blender native NLA visual-keying bake",
            "glTF Action export",
        ],
    }

    if spec.strike_suffix == "r":
        metrics["rightHandTravel"] = baked_hand
        metrics["constrainedRightHandTravel"] = constrained["constrainedStrikeHandTravel"]
    else:
        metrics["leftHandTravel"] = baked_hand
        metrics["constrainedLeftHandTravel"] = constrained["constrainedStrikeHandTravel"]
    if spec.support_suffix == "l":
        metrics["leftFootLockMaxDrift"] = baked_foot
        metrics["leftFootLockMaxAngularDriftDegrees"] = baked_foot_angle
        metrics["constrainedFootLockMaxDrift"] = constrained["constrainedSupportFootLockMaxDrift"]
        metrics["constrainedFootLockMaxAngularDriftDegrees"] = constrained[
            "constrainedSupportFootLockMaxAngularDriftDegrees"
        ]
    else:
        metrics["rightFootLockMaxDrift"] = baked_foot
        metrics["rightFootLockMaxAngularDriftDegrees"] = baked_foot_angle

    return final_action, metrics


def prepare_action_library(armature: bpy.types.Object, actions: Sequence[bpy.types.Action]) -> None:
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = None

    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)

    keep = {action.name for action in actions}
    for action in list(bpy.data.actions):
        if action.name not in keep:
            bpy.data.actions.remove(action)

    for action in actions:
        track = armature.animation_data.nla_tracks.new()
        track.name = action.name
        start = int(round(action.frame_range[0]))
        strip = track.strips.new(action.name, start, action)
        strip.action_frame_start = action.frame_range[0]
        strip.action_frame_end = action.frame_range[1]
        track.mute = True


def export_action_library(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    output_dir: Path,
    actions: Sequence[bpy.types.Action],
    metrics: dict,
    *,
    glb_name: str,
    blend_name: str,
    metrics_name: str,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    scene.render.fps = FPS
    scene.frame_start = min(int(action.frame_range[0]) for action in actions)
    scene.frame_end = max(int(action.frame_range[1]) for action in actions)
    prepare_action_library(armature, actions)

    blend_path = output_dir / blend_name
    glb_path = output_dir / glb_name
    metrics_path = output_dir / metrics_name
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=False,
        export_force_sampling=True,
    )
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (output_dir / "blender-shared-rig-version.txt").write_text(
        bpy.app.version_string + "\n",
        encoding="utf-8",
    )


def export_single_action(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    output_dir: Path,
    action: bpy.types.Action,
    metrics: dict,
    *,
    glb_name: str,
    blend_name: str,
    metrics_name: str,
) -> None:
    export_action_library(
        scene,
        armature,
        output_dir,
        [action],
        metrics,
        glb_name=glb_name,
        blend_name=blend_name,
        metrics_name=metrics_name,
    )
