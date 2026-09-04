#!/usr/bin/env python3
"""CMU BVH -> Poly Fighter universal-rig motion prior retargeting.

Motion Foundry V6 uses measured human motion as the primary full-body signal.
This module imports a CMU BVH clip, finds the strongest kick event, crops a
combat-sized anticipation/contact/recovery window, and transfers world-space
rotation deltas onto the UAL humanoid rig.  Limb lengths and target rest pose
remain owned by the Poly Fighter rig; only motion deltas are transferred.

The CMU database explicitly permits copying, modification, redistribution and
commercial use.  Runtime redistribution still happens as the baked Poly Fighter
GLB, not as a neural model or expensive solver.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence, Tuple

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 60

# CMU/Bruce-Hahne BVH joint -> Quaternius Universal humanoid joint.
# Fingers are deliberately omitted: mocap fingers are synthetic/noisy and the
# game should preserve its authored fist/hand shape.
CMU_TO_UAL: Tuple[Tuple[str, str], ...] = (
    ("Hips", "pelvis"),
    ("LowerBack", "spine_01"),
    ("Spine", "spine_02"),
    ("Spine1", "spine_03"),
    ("Neck1", "neck_01"),
    ("Head", "Head"),
    ("LeftShoulder", "clavicle_l"),
    ("LeftArm", "upperarm_l"),
    ("LeftForeArm", "lowerarm_l"),
    ("LeftHand", "hand_l"),
    ("RightShoulder", "clavicle_r"),
    ("RightArm", "upperarm_r"),
    ("RightForeArm", "lowerarm_r"),
    ("RightHand", "hand_r"),
    ("LeftUpLeg", "thigh_l"),
    ("LeftLeg", "calf_l"),
    ("LeftFoot", "foot_l"),
    ("RightUpLeg", "thigh_r"),
    ("RightLeg", "calf_r"),
    ("RightFoot", "foot_r"),
)

SIDE_SWAP: Mapping[str, str] = {
    "LeftShoulder": "RightShoulder", "RightShoulder": "LeftShoulder",
    "LeftArm": "RightArm", "RightArm": "LeftArm",
    "LeftForeArm": "RightForeArm", "RightForeArm": "LeftForeArm",
    "LeftHand": "RightHand", "RightHand": "LeftHand",
    "LeftUpLeg": "RightUpLeg", "RightUpLeg": "LeftUpLeg",
    "LeftLeg": "RightLeg", "RightLeg": "LeftLeg",
    "LeftFoot": "RightFoot", "RightFoot": "LeftFoot",
}


@dataclass(frozen=True)
class MocapPriorMeta:
    source_file: str
    source_action: str
    source_fps: float
    detected_strike_side: str
    target_strike_side: str
    mirrored: bool
    peak_frame: float
    crop_start: float
    crop_end: float
    impact_normalized_time: float
    activity_score: float
    sample_count: int

    def as_dict(self) -> dict:
        return {
            "mocapSourceFile": self.source_file,
            "mocapSourceAction": self.source_action,
            "mocapSourceFps": self.source_fps,
            "mocapDetectedStrikeSide": self.detected_strike_side,
            "mocapTargetStrikeSide": self.target_strike_side,
            "mocapMirrored": self.mirrored,
            "mocapPeakFrame": self.peak_frame,
            "mocapCropStart": self.crop_start,
            "mocapCropEnd": self.crop_end,
            "mocapImpactNormalizedTime": self.impact_normalized_time,
            "mocapActivityScore": self.activity_score,
            "mocapSampleCount": self.sample_count,
            "motionPriorProvider": "CMU_MOCAP_WORLD_DELTA_V6",
        }


def _set_frame(scene: bpy.types.Scene, frame: float) -> None:
    integer = math.floor(frame)
    scene.frame_set(integer, subframe=frame - integer)
    bpy.context.view_layer.update()


def _pose_head(armature: bpy.types.Object, name: str) -> Vector:
    return armature.pose.bones[name].head.copy()


def _normalize(values: Sequence[float]) -> List[float]:
    if not values:
        return []
    low, high = min(values), max(values)
    span = high - low
    if span < 1e-9:
        return [0.0] * len(values)
    return [(value - low) / span for value in values]


def _frame_time_from_bvh(path: str) -> float:
    with open(path, "r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if line.lower().startswith("frame time:"):
                value = float(line.split(":", 1)[1].strip())
                if value > 1e-8:
                    return value
    return 1.0 / 120.0


def _new_bvh_armature(scene: bpy.types.Scene, path: str) -> Tuple[bpy.types.Object, bpy.types.Action]:
    before_objects = {obj.name for obj in scene.objects}
    before_actions = {action.name for action in bpy.data.actions}
    bpy.ops.import_anim.bvh(
        filepath=str(Path(path).resolve()),
        target="ARMATURE",
        global_scale=1.0,
        frame_start=1,
        use_fps_scale=False,
        update_scene_fps=False,
        update_scene_duration=False,
        rotate_mode="QUATERNION",
        axis_forward="-Z",
        axis_up="Y",
    )
    armatures = [obj for obj in scene.objects if obj.name not in before_objects and obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"BVH import did not create an armature: {path}")
    source = max(armatures, key=lambda obj: len(obj.pose.bones))
    new_actions = [action for action in bpy.data.actions if action.name not in before_actions]
    action = source.animation_data.action if source.animation_data else None
    if action is None and new_actions:
        action = max(new_actions, key=lambda item: item.frame_range[1] - item.frame_range[0])
    if action is None:
        raise RuntimeError(f"BVH import did not create an action: {path}")
    source.animation_data.action = action
    required = {"Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot", "LeftArm", "RightArm"}
    missing = sorted(required - set(source.pose.bones.keys()))
    if missing:
        raise RuntimeError(f"CMU BVH required joints missing: {missing}")
    return source, action


def _kick_event(scene: bpy.types.Scene, source: bpy.types.Object, action: bpy.types.Action, source_fps: float):
    source.animation_data.action = action
    start, end = action.frame_range
    # Bruce Hahne's CMU conversion adds a synthetic T-pose as frame one.
    scan_start = max(start + 2.0, start + (end - start) * 0.035)
    scan_end = min(end - 2.0, end - (end - start) * 0.035)
    stride = max(1.0, source_fps / 60.0)
    frames: List[float] = []
    raw = {"L": {"speed": [], "reach": [], "rise": []}, "R": {"speed": [], "reach": [], "rise": []}}
    previous = {"L": None, "R": None}
    frame = scan_start
    while frame <= scan_end + 1e-6:
        _set_frame(scene, frame)
        pelvis = _pose_head(source, "Hips")
        positions = {"L": _pose_head(source, "LeftFoot"), "R": _pose_head(source, "RightFoot")}
        support = {"L": positions["R"], "R": positions["L"]}
        frames.append(frame)
        for side in ("L", "R"):
            foot = positions[side]
            speed = 0.0 if previous[side] is None else (foot - previous[side]).length
            raw[side]["speed"].append(speed)
            raw[side]["reach"].append((foot - pelvis).length)
            raw[side]["rise"].append(foot.z - support[side].z)
            previous[side] = foot.copy()
        frame += stride

    best = None
    for side in ("L", "R"):
        ns = _normalize(raw[side]["speed"])
        nr = _normalize(raw[side]["reach"])
        nh = _normalize(raw[side]["rise"])
        scores = [1.35 * ns[i] + 0.90 * nr[i] + 0.30 * nh[i] for i in range(len(frames))]
        margin = max(2, int(len(scores) * 0.05))
        usable = range(margin, max(margin + 1, len(scores) - margin))
        index = max(usable, key=lambda idx: scores[idx])
        candidate = (scores[index], side, index)
        if best is None or candidate[0] > best[0]:
            best = candidate
    if best is None:
        raise RuntimeError(f"Unable to detect kick event in {action.name}")
    score, side, index = best
    peak = frames[index]
    return side, peak, min(1.0, score / 2.55)


def _horizontal_basis(armature: bpy.types.Object) -> Tuple[Vector, Vector, Vector]:
    left_name = "LeftArm" if "LeftArm" in armature.pose.bones else "upperarm_l"
    right_name = "RightArm" if "RightArm" in armature.pose.bones else "upperarm_r"
    left = _pose_head(armature, left_name) - _pose_head(armature, right_name)
    left.z = 0.0
    if left.length < 1e-5:
        left = Vector((1.0, 0.0, 0.0))
    left.normalize()
    up = Vector((0.0, 0.0, 1.0))
    forward = left.cross(up)
    if forward.length < 1e-5:
        forward = Vector((0.0, -1.0, 0.0))
    forward.normalize()
    return forward, left, up


def _basis_matrix(forward: Vector, left: Vector, up: Vector) -> Matrix:
    # Columns are canonical forward / left / up axes in object space.
    return Matrix((forward, left, up)).transposed()


def _rotation_delta_in_target_space(
    start: Quaternion,
    current: Quaternion,
    source_basis: Matrix,
    target_basis: Matrix,
    mirrored: bool,
) -> Quaternion:
    delta = current.to_matrix() @ start.to_matrix().inverted()
    canonical = source_basis.inverted() @ delta @ source_basis
    if mirrored:
        mirror = Matrix(((1.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, 1.0)))
        canonical = mirror @ canonical @ mirror
    target_delta = target_basis @ canonical @ target_basis.inverted()
    return target_delta.to_quaternion().normalized()


def _mapped_source_name(source_name: str, mirrored: bool) -> str:
    return SIDE_SWAP.get(source_name, source_name) if mirrored else source_name


def _target_leg_length(armature: bpy.types.Object, side: str) -> float:
    suffix = side.lower()
    thigh = armature.data.bones[f"thigh_{suffix}"].length
    calf = armature.data.bones[f"calf_{suffix}"].length
    return max(1e-4, thigh + calf)


def _source_leg_length(source: bpy.types.Object, side: str) -> float:
    prefix = "Left" if side == "L" else "Right"
    return max(1e-4, source.data.bones[f"{prefix}UpLeg"].length + source.data.bones[f"{prefix}Leg"].length)


def _smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def _settle_to_guard(
    scene: bpy.types.Scene,
    target: bpy.types.Object,
    action: bpy.types.Action,
    base_basis: Mapping[str, Matrix],
    sample_count: int,
    settle_start_u: float = 0.72,
) -> None:
    """Blend the measured clip back into the authored fighting guard.

    Raw mocap often finishes with a step after the kick. That is correct for the
    capture but wrong for a reusable fighting-game attack clip. Preserve the
    measured anticipation/contact/follow-through, then smoothly return every
    target bone to the authored idle/guard basis in the final quarter. A support
    anchor pass runs afterwards, so this cleanup cannot reintroduce foot slide.
    """
    target.animation_data.action = action
    start_frame = max(2, int(math.floor((sample_count - 1) * settle_start_u)) + 1)
    span = max(1, sample_count - start_frame)
    for frame in range(start_frame, sample_count + 1):
        _set_frame(scene, float(frame))
        blend = _smoothstep((frame - start_frame) / span)
        for pb in target.pose.bones:
            base = base_basis.get(pb.name)
            if base is None:
                continue
            current_loc, current_rot, current_scale = pb.matrix_basis.decompose()
            base_loc, base_rot, base_scale = base.decompose()
            loc = current_loc.lerp(base_loc, blend)
            rot = current_rot.slerp(base_rot, blend)
            scale = current_scale.lerp(base_scale, blend)
            pb.matrix_basis = Matrix.LocRotScale(loc, rot, scale)
            pb.keyframe_insert(data_path="location", frame=frame, group=pb.name)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=pb.name)
            pb.keyframe_insert(data_path="scale", frame=frame, group=pb.name)
        bpy.context.view_layer.update()


def _anchor_support_foot(
    scene: bpy.types.Scene,
    target: bpy.types.Object,
    action: bpy.types.Action,
    support_side: str,
    sample_count: int,
) -> Tuple[float, float]:
    """Remove retarget root drift while preserving measured joint rotations.

    CMU root translation and a different target leg proportion can make an
    otherwise measured kick require the planted leg to stretch beyond its
    reachable sphere.  For every dense 60 Hz prior sample, move only the pelvis
    root by the inverse support-ankle drift.  Descendant rotations stay exactly
    as retargeted, so weight transfer/counter-rotation remain measured motion.
    """
    suffix = support_side.lower()
    calf_name = f"calf_{suffix}"
    if calf_name not in target.pose.bones:
        raise RuntimeError(f"Support calf missing for V6 anchor: {calf_name}")
    target.animation_data.action = action
    _set_frame(scene, 1.0)
    anchor_ankle = target.pose.bones[calf_name].tail.copy()
    pelvis = target.pose.bones["pelvis"]
    before = 0.0
    for frame in range(1, sample_count + 1):
        _set_frame(scene, float(frame))
        ankle = target.pose.bones[calf_name].tail.copy()
        drift = ankle - anchor_ankle
        before = max(before, drift.length)
        pelvis_matrix = pelvis.matrix.copy()
        pelvis_matrix.translation -= drift
        pelvis.matrix = pelvis_matrix
        bpy.context.view_layer.update()
        pelvis.keyframe_insert(data_path="location", frame=frame, group="pelvis")
        pelvis.keyframe_insert(data_path="rotation_quaternion", frame=frame, group="pelvis")
        pelvis.keyframe_insert(data_path="scale", frame=frame, group="pelvis")

    # Source time-warp samples subframes. Dense linear root interpolation avoids
    # Bezier overshoot reintroducing foot drift between the 60 Hz anchor samples.
    pelvis_path = 'pose.bones["pelvis"].location'
    for curve in action.fcurves:
        if curve.data_path == pelvis_path:
            for key in curve.keyframe_points:
                key.interpolation = "LINEAR"

    after = 0.0
    for frame in range(1, sample_count + 1):
        _set_frame(scene, float(frame))
        after = max(after, (target.pose.bones[calf_name].tail - anchor_ankle).length)
    return before, after


def build_mocap_prior(
    scene: bpy.types.Scene,
    target: bpy.types.Object,
    spec,
    bvh_path: str,
    target_axes: Tuple[Vector, Vector, Vector],
) -> Tuple[bpy.types.Action, MocapPriorMeta]:
    """Create a UAL-skeleton action from a measured CMU martial-arts clip."""
    original_fps = scene.render.fps
    source, source_action = _new_bvh_armature(scene, bvh_path)
    source_fps = 1.0 / _frame_time_from_bvh(bvh_path)
    detected_side, peak, activity = _kick_event(scene, source, source_action, source_fps)
    target_side = spec.strike_side.upper()
    mirrored = detected_side != target_side

    # Keep enough real anticipation and follow-through for weight transfer to read.
    crop_start = max(source_action.frame_range[0] + 2.0, peak - source_fps * 0.46)
    crop_end = min(source_action.frame_range[1], peak + source_fps * 0.56)
    if crop_end - crop_start < source_fps * 0.30:
        raise RuntimeError(f"CMU crop too short for {spec.action_name}: {crop_start}..{crop_end}")
    seconds = (crop_end - crop_start) / source_fps
    sample_count = max(20, int(round(seconds * FPS)) + 1)
    impact_u = (peak - crop_start) / max(1e-6, crop_end - crop_start)

    # Source samples are collected first because source and target share the scene
    # clock but have independent actions.
    source.animation_data.action = source_action
    source_frames = [crop_start + (crop_end - crop_start) * i / (sample_count - 1) for i in range(sample_count)]
    sample_names = {source_name for source_name, _ in CMU_TO_UAL}
    samples: List[Dict[str, Matrix]] = []
    source_root_positions: List[Vector] = []
    for frame in source_frames:
        _set_frame(scene, frame)
        samples.append({name: source.pose.bones[name].matrix.copy() for name in sample_names if name in source.pose.bones})
        source_root_positions.append(_pose_head(source, "Hips"))

    _set_frame(scene, source_frames[0])
    source_axes = _horizontal_basis(source)
    source_basis = _basis_matrix(*source_axes)
    target_basis = _basis_matrix(*target_axes)

    # Establish target base from its authored idle pose. This preserves character
    # proportions, guard convention, hand shape and non-mocap helper bones.
    idle = next((action for action in bpy.data.actions if action.name == "Idle_Loop_Armature"), None)
    if idle is None:
        idle = next((action for action in bpy.data.actions if "Idle_Loop" in action.name), None)
    if idle is None:
        raise RuntimeError("Idle_Loop is required as the V6 target retarget base")
    target.animation_data.action = idle
    _set_frame(scene, idle.frame_range[0])
    base_basis = {pb.name: pb.matrix_basis.copy() for pb in target.pose.bones}
    base_object_q = {pb.name: pb.matrix.to_quaternion().normalized() for pb in target.pose.bones}
    base_object_loc = {pb.name: pb.matrix.to_translation().copy() for pb in target.pose.bones}

    # Root displacement is scaled by leg length and expressed in anatomy axes,
    # avoiding dependence on BVH/glTF coordinate conventions.
    source_scale = _target_leg_length(target, target_side) / _source_leg_length(source, detected_side)
    source_root0 = source_root_positions[0]

    action = bpy.data.actions.new(name=f"CMU135_{spec.action_name}_PRIOR")
    target.animation_data.action = action
    for pb in target.pose.bones:
        pb.rotation_mode = "QUATERNION"

    # Parents first, then limbs, so assigning object-space rotations resolves into
    # stable local matrix_basis values on the target hierarchy.
    ordered_pairs = list(CMU_TO_UAL)
    for index, sample in enumerate(samples):
        dest_frame = index + 1
        scene.frame_set(dest_frame)
        for pb in target.pose.bones:
            pb.matrix_basis = base_basis[pb.name]
        bpy.context.view_layer.update()

        for source_name, target_name in ordered_pairs:
            if target_name not in target.pose.bones:
                continue
            actual_source = _mapped_source_name(source_name, mirrored)
            if actual_source not in sample or actual_source not in samples[0]:
                continue
            start_q = samples[0][actual_source].to_quaternion().normalized()
            current_q = sample[actual_source].to_quaternion().normalized()
            delta_q = _rotation_delta_in_target_space(start_q, current_q, source_basis, target_basis, mirrored)
            # Mawashigeri carries useful hip/shoulder counter-rotation, but the raw
            # CMU upper-torso lean is too large after UAL -> UBC rest-delta retargeting.
            # Keep pelvis/legs untouched and retain a measured, progressively softer
            # upper-body delta so the low kick stays athletic without folding the chest.
            LOW_KICK_TORSO_DELTA_RETENTION = {
                "spine_02": 0.55,
                "spine_03": 0.55,
                "neck_01": 0.70,
            }
            if spec.action_name == "BF_LowKick_L" and target_name in LOW_KICK_TORSO_DELTA_RETENTION:
                retention = LOW_KICK_TORSO_DELTA_RETENTION[target_name]
                delta_q = Quaternion((1.0, 0.0, 0.0, 0.0)).slerp(delta_q, retention).normalized()
            desired_q = (delta_q @ base_object_q[target_name]).normalized()
            pb = target.pose.bones[target_name]
            loc = pb.matrix.to_translation()
            if target_name == "pelvis":
                source_disp = source_root_positions[index] - source_root0
                canonical = Vector((source_disp.dot(source_axes[0]), source_disp.dot(source_axes[1]), source_disp.dot(source_axes[2])))
                if mirrored:
                    canonical.y *= -1.0
                # Gameplay owns gross planar movement; preserve only a modest
                # in-place weight shift plus the full vertical compression/lift.
                canonical.x *= 0.34
                canonical.y *= 0.28
                target_disp = (
                    target_axes[0] * canonical.x
                    + target_axes[1] * canonical.y
                    + target_axes[2] * canonical.z
                ) * source_scale
                loc = base_object_loc[target_name] + target_disp
            pb.matrix = Matrix.LocRotScale(loc, desired_q, pb.matrix.to_scale())
            bpy.context.view_layer.update()

        for pb in target.pose.bones:
            pb.keyframe_insert(data_path="location", frame=dest_frame, group=pb.name)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=dest_frame, group=pb.name)
            pb.keyframe_insert(data_path="scale", frame=dest_frame, group=pb.name)

    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "BEZIER"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"

    # A fighting-game attack must reconnect to locomotion/idle without a visible
    # pop. Keep measured motion through follow-through, then settle to guard and
    # finally re-anchor the planted foot in world space.
    _settle_to_guard(scene, target, action, base_basis, sample_count)
    support_side = "L" if target_side == "R" else "R"
    anchor_before, anchor_after = _anchor_support_foot(
        scene, target, action, support_side, sample_count
    )

    action.use_fake_user = True
    action["motion_prior_provider"] = "CMU_MOCAP_WORLD_DELTA_V6"
    action["cmu_source_file"] = Path(bvh_path).name
    action["cmu_detected_strike_side"] = detected_side
    action["cmu_target_strike_side"] = target_side
    action["cmu_mirrored"] = mirrored
    action["cmu_impact_u"] = impact_u
    action["cmu_activity_score"] = activity
    action["cmu_support_anchor_before"] = anchor_before
    action["cmu_support_anchor_after"] = anchor_after

    # Remove the temporary BVH skeleton; the measured motion now lives as a UAL
    # action and can be constrained/baked by the existing Foundry stack.
    source_action.use_fake_user = False
    bpy.data.objects.remove(source, do_unlink=True)
    scene.render.fps = original_fps
    target.animation_data.action = action

    meta = MocapPriorMeta(
        source_file=Path(bvh_path).name,
        source_action=source_action.name,
        source_fps=source_fps,
        detected_strike_side=detected_side,
        target_strike_side=target_side,
        mirrored=mirrored,
        peak_frame=peak,
        crop_start=crop_start,
        crop_end=crop_end,
        impact_normalized_time=impact_u,
        activity_score=activity,
        sample_count=sample_count,
    )
    return action, meta
