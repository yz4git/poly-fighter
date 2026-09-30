#!/usr/bin/env python3
"""UniMate-inspired constrained in-between cleanup for baked Blender actions.

This module does NOT run the UniMate neural model. It transfers the core
replacement-style in-betweening invariant from UniMate into POLY FIGHTER's
existing deterministic Blender Motion Foundry:

- authored phase anchors are immutable,
- only frames between those anchors are regularised,
- support-foot chains stay untouched,
- contact-adjacent segments receive much weaker smoothing,
- quaternion motion is pulled toward a shortest-arc temporal path rather than
  independently filtering quaternion components.

The result is a lightweight offline pass suitable for shipping ordinary glTF
animation clips to iPhone/WebGL.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Iterable, Mapping, Sequence, Tuple

import bpy
from mathutils import Quaternion, Vector


UNIMATE_INBETWEEN_VERSION = "UNIMATE_INSPIRED_REPLACEMENT_INBETWEEN_V1"


@dataclass(frozen=True)
class PoseSample:
    location: Vector
    rotation: Quaternion


@dataclass(frozen=True)
class InbetweenMetrics:
    version: str
    anchor_frames: Tuple[int, ...]
    smoothed_bones: int
    preserved_bones: Tuple[str, ...]
    rotation_accel_rms_before: float
    rotation_accel_rms_after: float
    max_rotation_step_before: float
    max_rotation_step_after: float
    maximum_anchor_rotation_error: float
    maximum_anchor_location_error: float
    accepted: bool

    def as_dict(self) -> dict:
        return {
            "unimateInbetweenVersion": self.version,
            "unimateInbetweenAnchors": list(self.anchor_frames),
            "unimateInbetweenSmoothedBones": self.smoothed_bones,
            "unimateInbetweenPreservedBones": list(self.preserved_bones),
            "unimateRotationAccelerationRmsBefore": self.rotation_accel_rms_before,
            "unimateRotationAccelerationRmsAfter": self.rotation_accel_rms_after,
            "unimateMaxRotationStepBefore": self.max_rotation_step_before,
            "unimateMaxRotationStepAfter": self.max_rotation_step_after,
            "unimateMaximumAnchorRotationError": self.maximum_anchor_rotation_error,
            "unimateMaximumAnchorLocationError": self.maximum_anchor_location_error,
            "unimateInbetweenAccepted": self.accepted,
        }


def _smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def _quaternion_angle(a: Quaternion, b: Quaternion) -> float:
    """Shortest pose-space angle; q and -q are the same rotation."""
    qa = a.copy().normalized()
    qb = b.copy().normalized()
    dot = abs(qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z)
    dot = max(-1.0, min(1.0, dot))
    # Blender pose keys are stored/evaluated at float32 precision. A sign-only
    # rewrite of the same normalized quaternion can leave ~1e-7 dot error,
    # which acos magnifies into a misleading ~0.05 degree "pose change".
    if 1.0 - dot <= 2.0e-7:
        return 0.0
    return 2.0 * math.acos(dot)


def _rotation_metrics(
    samples: Mapping[str, Mapping[int, PoseSample]],
    frames: Sequence[int],
) -> Tuple[float, float]:
    accelerations = []
    max_step = 0.0
    for per_frame in samples.values():
        steps = []
        for prior, current in zip(frames, frames[1:]):
            if prior not in per_frame or current not in per_frame:
                continue
            step = _quaternion_angle(per_frame[prior].rotation, per_frame[current].rotation)
            steps.append(step)
            max_step = max(max_step, step)
        accelerations.extend(
            current - prior for prior, current in zip(steps, steps[1:])
        )
    accel_rms = (
        math.sqrt(sum(value * value for value in accelerations) / len(accelerations))
        if accelerations
        else 0.0
    )
    return accel_rms, max_step


def _relevant_bone(name: str) -> bool:
    """Limit smoothing to the body chains that materially affect combat."""
    lowered = name.lower()
    return (
        lowered == "pelvis"
        or lowered.startswith("spine")
        or lowered.startswith("neck")
        or lowered.startswith("head")
        or lowered.startswith("clavicle")
        or lowered.startswith("upperarm")
        or lowered.startswith("lowerarm")
        or lowered.startswith("hand")
        or lowered.startswith("thigh")
        or lowered.startswith("calf")
        or lowered.startswith("foot")
    )


def _bone_strength(name: str, strike_suffix: str) -> float:
    lowered = name.lower()
    if lowered == "pelvis" or lowered.startswith("spine"):
        return 0.78
    if lowered.startswith("neck") or lowered.startswith("head"):
        return 0.46
    if lowered.endswith(f"_{strike_suffix}"):
        if lowered.startswith(("hand", "foot")):
            return 0.34
        if lowered.startswith(("upperarm", "lowerarm", "thigh", "calf")):
            return 0.52
    if lowered.startswith(("clavicle", "upperarm", "lowerarm", "thigh", "calf")):
        return 0.62
    if lowered.startswith(("hand", "foot")):
        return 0.42
    return 0.50


def _segment_strength(
    left: int,
    right: int,
    impact_frame: int,
    precontact_frame: int,
    overtravel_frame: int,
) -> float:
    # UniMate-style temporal replacement: the attack-defining contact segment is
    # mostly known signal. Anticipation/recovery gaps can be regularised harder.
    if left >= precontact_frame and right <= overtravel_frame:
        return 0.10
    if left == precontact_frame or right == overtravel_frame:
        return 0.15
    if left <= impact_frame <= right:
        return 0.08
    return 0.28


def _find_segment(anchors: Sequence[int], frame: int) -> Tuple[int, int]:
    for left, right in zip(anchors, anchors[1:]):
        if left <= frame <= right:
            return left, right
    return anchors[-2], anchors[-1]


def _capture(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    action: bpy.types.Action,
    bone_names: Iterable[str],
    frames: Sequence[int],
) -> Dict[str, Dict[int, PoseSample]]:
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action
    result: Dict[str, Dict[int, PoseSample]] = {name: {} for name in bone_names}
    for frame in frames:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        for name in bone_names:
            bone = armature.pose.bones.get(name)
            if bone is None:
                continue
            if bone.rotation_mode != "QUATERNION":
                bone.rotation_mode = "QUATERNION"
            result[name][frame] = PoseSample(
                location=bone.location.copy(),
                rotation=bone.rotation_quaternion.copy().normalized(),
            )
    return result


def _same_hemisphere(reference: Quaternion, value: Quaternion) -> Quaternion:
    """Return an equivalent quaternion whose component sign follows reference."""
    out = value.copy().normalized()
    dot = (
        reference.w * out.w
        + reference.x * out.x
        + reference.y * out.y
        + reference.z * out.z
    )
    if dot < 0.0:
        return Quaternion((-out.w, -out.x, -out.y, -out.z))
    return out


def _local_smooth_pose(
    source: PoseSample,
    previous: PoseSample,
    following: PoseSample,
    u: float,
    strength: float,
    allow_location: bool,
) -> PoseSample:
    """One geodesic Laplacian step on an unknown frame.

    UniMate regenerates unknown frames while repeatedly replacing known signal.
    Our deterministic analogue keeps the known anchors and reduces local second
    derivative only inside the unknown region. This avoids the velocity kink
    produced by pulling an entire segment toward one start-to-end SLERP arc.
    """
    envelope = math.sin(math.pi * u) ** 2
    weight = max(0.0, min(1.0, strength * envelope))

    previous_q = previous.rotation.copy().normalized()
    following_q = _same_hemisphere(previous_q, following.rotation)
    source_q = _same_hemisphere(previous_q, source.rotation)
    rotation_target = previous_q.slerp(following_q, 0.5).normalized()
    rotation = source_q.slerp(rotation_target, weight).normalized()

    location = source.location.copy()
    if allow_location:
        location_target = previous.location.copy().lerp(following.location, 0.5)
        location.lerp(location_target, weight * 0.55)

    return PoseSample(location=location, rotation=rotation)


def _canonicalize_quaternion_signs(
    samples: Dict[str, Dict[int, PoseSample]],
    frames: Sequence[int],
) -> None:
    """Keep dense quaternion keys in one hemisphere across time.

    q and -q encode the same pose, but linear glTF/FCurve interpolation between
    opposite signs can pass through the zero quaternion and appear as a near-2π
    one-frame spin. Sign canonicalization changes no authored pose.
    """
    for per_frame in samples.values():
        if not frames:
            continue
        previous = per_frame[frames[0]].rotation.copy().normalized()
        per_frame[frames[0]] = PoseSample(
            location=per_frame[frames[0]].location.copy(),
            rotation=previous,
        )
        for frame in frames[1:]:
            current = per_frame[frame]
            rotation = _same_hemisphere(previous, current.rotation)
            per_frame[frame] = PoseSample(
                location=current.location.copy(),
                rotation=rotation,
            )
            previous = rotation


def _write_samples(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    action: bpy.types.Action,
    samples: Mapping[str, Mapping[int, PoseSample]],
    frames: Sequence[int],
    *,
    write_pelvis_location: bool,
) -> None:
    armature.animation_data.action = action
    for frame in frames:
        scene.frame_set(frame)
        for name, per_frame in samples.items():
            bone = armature.pose.bones.get(name)
            sample = per_frame.get(frame)
            if bone is None or sample is None:
                continue
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = sample.rotation
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=name)
            if write_pelvis_location and name == "pelvis":
                bone.location = sample.location
                bone.keyframe_insert(data_path="location", frame=frame, group=name)

def apply_replacement_inbetween(
    scene: bpy.types.Scene,
    armature: bpy.types.Object,
    action: bpy.types.Action,
    *,
    anchor_frames: Sequence[int],
    impact_frame: int,
    precontact_frame: int,
    overtravel_frame: int,
    strike_suffix: str,
    support_suffix: str,
) -> InbetweenMetrics:
    """Regularise only unknown temporal gaps while keeping combat anchors exact."""
    anchors = tuple(sorted({int(frame) for frame in anchor_frames}))
    if len(anchors) < 2:
        raise ValueError("UniMate in-between pass requires at least two anchor frames")
    frames = tuple(range(anchors[0], anchors[-1] + 1))

    # The support leg is only world-locked if its parent pelvis also remains
    # untouched. Smoothing pelvis local rotation/translation moves the entire
    # planted chain even when thigh/calf/foot local keys are exact.
    support_preserved = (
        "pelvis",
        f"thigh_{support_suffix}",
        f"calf_{support_suffix}",
        f"foot_{support_suffix}",
    )
    support_set = set(support_preserved)
    bone_names = [
        bone.name
        for bone in armature.pose.bones
        if _relevant_bone(bone.name) and bone.name not in support_set
    ]

    original = _capture(scene, armature, action, bone_names, frames)
    before_accel, before_max_step = _rotation_metrics(original, frames)

    rewritten: Dict[str, Dict[int, PoseSample]] = {
        name: dict(per_frame) for name, per_frame in original.items()
    }
    anchor_set = set(anchors)

    # Two conservative local passes reduce angular second derivative while
    # preserving every combat phase anchor exactly.
    for _iteration in range(2):
        prior_pass: Dict[str, Dict[int, PoseSample]] = {
            name: dict(per_frame) for name, per_frame in rewritten.items()
        }
        for name, per_frame in prior_pass.items():
            bone_factor = _bone_strength(name, strike_suffix)
            for frame in frames[1:-1]:
                if frame in anchor_set:
                    continue
                left_frame, right_frame = _find_segment(anchors, frame)
                if right_frame <= left_frame:
                    continue
                u = (frame - left_frame) / (right_frame - left_frame)
                segment = _segment_strength(
                    left_frame,
                    right_frame,
                    impact_frame,
                    precontact_frame,
                    overtravel_frame,
                )
                rewritten[name][frame] = _local_smooth_pose(
                    per_frame[frame],
                    per_frame[frame - 1],
                    per_frame[frame + 1],
                    u,
                    segment * bone_factor,
                    allow_location=(name == "pelvis"),
                )

        # Exact replacement: reset all known phase anchors after every smoothing
        # iteration so they can never drift numerically.
        for name in bone_names:
            for frame in anchors:
                rewritten[name][frame] = original[name][frame]

    # Quaternion sign is representation-only, not pose. Canonicalize every dense
    # key (including anchors) so LINEAR glTF interpolation cannot take the long
    # component-space path through q -> -q.
    _canonicalize_quaternion_signs(rewritten, frames)
    _write_samples(
        scene,
        armature,
        action,
        rewritten,
        frames,
        write_pelvis_location=True,
    )

    # Dense bake curves should stay linear after the surgical replacement.
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"

    bpy.context.view_layer.update()
    after = _capture(scene, armature, action, bone_names, frames)
    after_accel, after_max_step = _rotation_metrics(after, frames)

    # Never ship a cleanup pass that makes the measured temporal motion worse.
    # Revert to the original dense poses (with harmless quaternion hemisphere
    # canonicalization) when either jitter or the largest one-frame turn grows.
    accepted = (
        after_accel <= before_accel + 1e-7
        and after_max_step <= before_max_step + 1e-7
    )
    if not accepted:
        rewritten = {
            name: dict(per_frame) for name, per_frame in original.items()
        }
        _canonicalize_quaternion_signs(rewritten, frames)
        _write_samples(
            scene,
            armature,
            action,
            rewritten,
            frames,
            write_pelvis_location=True,
        )
        for curve in action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "LINEAR"
        bpy.context.view_layer.update()
        after = _capture(scene, armature, action, bone_names, frames)
        after_accel, after_max_step = _rotation_metrics(after, frames)

    max_anchor_rotation_error = 0.0
    max_anchor_location_error = 0.0
    for name in bone_names:
        for frame in anchors:
            before = original[name].get(frame)
            final = after[name].get(frame)
            if before is None or final is None:
                continue
            max_anchor_rotation_error = max(
                max_anchor_rotation_error,
                _quaternion_angle(before.rotation, final.rotation),
            )
            max_anchor_location_error = max(
                max_anchor_location_error,
                (before.location - final.location).length,
            )

    armature.animation_data.action = action
    scene.frame_set(anchors[0])
    bpy.context.view_layer.update()
    return InbetweenMetrics(
        version=UNIMATE_INBETWEEN_VERSION,
        anchor_frames=anchors,
        smoothed_bones=len(bone_names),
        preserved_bones=support_preserved,
        rotation_accel_rms_before=before_accel,
        rotation_accel_rms_after=after_accel,
        max_rotation_step_before=before_max_step,
        max_rotation_step_after=after_max_step,
        maximum_anchor_rotation_error=max_anchor_rotation_error,
        maximum_anchor_location_error=max_anchor_location_error,
        accepted=accepted,
    )
