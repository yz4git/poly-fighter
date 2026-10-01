#!/usr/bin/env python3
"""Compare shipping and candidate POLY FIGHTER GLB animation quality in Blender.

This is an offline promotion gate, not a runtime component. Both clips are sampled
through Blender's evaluated pose stack on the same normalized timeline. The gate
measures shortest-arc quaternion velocity/acceleration across the canonical UAL
combat skeleton so a neural in-between candidate cannot be promoted merely because
it rendered successfully.

Usage:
  blender -b --python tools/unimate/compare-motion-quality.py -- \
    --baseline public/models/quaternius/blender-cross-core.glb \
    --candidate artifacts/unimate-neural-foundry/cross/blender-cross-core.glb \
    --action BF_Cross_R --output artifacts/quality/BF_Cross_R.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Quaternion


CANONICAL_BONES = (
    "pelvis",
    "spine_01",
    "spine_02",
    "spine_03",
    "neck_01",
    "Head",
    "clavicle_l",
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "clavicle_r",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
    "thigh_l",
    "calf_l",
    "foot_l",
    "thigh_r",
    "calf_r",
    "foot_r",
)

CONTACT_BONES = {
    "BF_Jab_L": ("hand_l", "foot_r"),
    "BF_BodyBlow_L": ("hand_l", "foot_r"),
    "BF_Backfist_R": ("hand_r", "foot_l"),
    "BF_Counter_R": ("hand_r", "foot_l"),
    "BF_Cross_R": ("hand_r", "foot_l"),
    "BF_Power_R": ("hand_r", "foot_l"),
    "BF_FrontKick_R": ("foot_r", "foot_l"),
    "BF_LowKick_L": ("foot_l", "foot_r"),
    "BF_RisingKick_R": ("foot_r", "foot_l"),
}


def _argv() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def _reset() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def _normal(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


def _import_action(path: Path, wanted: str):
    _reset()
    bpy.ops.import_scene.gltf(filepath=str(path))
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"{path}: no armature")
    armature = max(armatures, key=lambda obj: len(obj.pose.bones))
    wanted_n = _normal(wanted)

    actions = list(bpy.data.actions)
    exact = next((a for a in actions if a.name == wanted), None)
    action = exact or next((a for a in actions if _normal(a.name) == wanted_n), None)
    if action is None:
        raise RuntimeError(
            f"{path}: action {wanted!r} unavailable; "
            f"actions={[a.name for a in actions]}"
        )
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action

    missing = [name for name in CANONICAL_BONES if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"{path}: canonical UAL bones missing: {missing}")
    return armature, action


def _set_frame(scene: bpy.types.Scene, frame: float) -> None:
    integer = math.floor(frame)
    scene.frame_set(integer, subframe=frame - integer)
    bpy.context.view_layer.update()


def _shortest_angle(a: Quaternion, b: Quaternion) -> float:
    dot = abs(max(-1.0, min(1.0, a.dot(b))))
    return 2.0 * math.acos(dot)


def _rms(values: Iterable[float]) -> float:
    seq = list(values)
    return math.sqrt(sum(v * v for v in seq) / len(seq)) if seq else 0.0


def _sample(path: Path, action_name: str, sample_count: int) -> dict:
    armature, action = _import_action(path, action_name)
    scene = bpy.context.scene
    start, end = action.frame_range
    span = max(1e-6, end - start)

    rotations: dict[str, list[Quaternion]] = {name: [] for name in CANONICAL_BONES}
    positions: dict[str, list[tuple[float, float, float]]] = {
        name: [] for name in CONTACT_BONES.get(action_name, ())
    }

    for i in range(sample_count):
        u = i / max(1, sample_count - 1)
        _set_frame(scene, start + span * u)
        for name in CANONICAL_BONES:
            q = armature.pose.bones[name].matrix.to_quaternion().normalized()
            rotations[name].append(q)
        for name in positions:
            p = armature.pose.bones[name].head.copy()
            positions[name].append((p.x, p.y, p.z))

    per_bone_steps: dict[str, list[float]] = {}
    per_bone_accel: dict[str, list[float]] = {}
    all_steps: list[float] = []
    all_accel: list[float] = []
    for name, qs in rotations.items():
        steps = [_shortest_angle(a, b) for a, b in zip(qs, qs[1:])]
        accel = [b - a for a, b in zip(steps, steps[1:])]
        per_bone_steps[name] = steps
        per_bone_accel[name] = accel
        all_steps.extend(steps)
        all_accel.extend(accel)

    contact_motion = {}
    for name, ps in positions.items():
        distances = [
            math.dist(a, b)
            for a, b in zip(ps, ps[1:])
        ]
        contact_motion[name] = {
            "pathLength": sum(distances),
            "maxStep": max(distances, default=0.0),
            "stepRms": _rms(distances),
        }

    return {
        "file": str(path),
        "action": action_name,
        "frameRange": [float(start), float(end)],
        "samples": sample_count,
        "rotationStepRms": _rms(all_steps),
        "rotationAccelerationRms": _rms(all_accel),
        "maxRotationStepRad": max(all_steps, default=0.0),
        "perBone": {
            name: {
                "rotationStepRms": _rms(per_bone_steps[name]),
                "rotationAccelerationRms": _rms(per_bone_accel[name]),
                "maxRotationStepRad": max(per_bone_steps[name], default=0.0),
            }
            for name in CANONICAL_BONES
        },
        "contactMotion": contact_motion,
    }


def _ratio(candidate: float, baseline: float) -> float:
    if baseline <= 1e-9:
        return 1.0 if candidate <= 1e-9 else float("inf")
    return candidate / baseline


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--action", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--samples", type=int, default=60)
    parser.add_argument("--worsen-tolerance", type=float, default=1.05)
    parser.add_argument("--improve-ratio", type=float, default=0.98)
    args = parser.parse_args(_argv())

    baseline_path = Path(args.baseline).resolve()
    candidate_path = Path(args.candidate).resolve()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if not baseline_path.is_file() or not candidate_path.is_file():
        raise FileNotFoundError((baseline_path, candidate_path))

    samples = max(16, args.samples)
    baseline = _sample(baseline_path, args.action, samples)
    candidate = _sample(candidate_path, args.action, samples)

    accel_ratio = _ratio(
        candidate["rotationAccelerationRms"],
        baseline["rotationAccelerationRms"],
    )
    max_step_ratio = _ratio(
        candidate["maxRotationStepRad"],
        baseline["maxRotationStepRad"],
    )
    velocity_ratio = _ratio(
        candidate["rotationStepRms"],
        baseline["rotationStepRms"],
    )

    no_regression = (
        accel_ratio <= args.worsen_tolerance
        and max_step_ratio <= args.worsen_tolerance
        and velocity_ratio <= args.worsen_tolerance
    )
    meaningful_improvement = (
        accel_ratio <= args.improve_ratio
        or max_step_ratio <= args.improve_ratio
    )
    accepted = bool(no_regression and meaningful_improvement)

    report = {
        "version": "POLY_FIGHTER_UNIMATE_GLTF_QUALITY_GATE_V1",
        "action": args.action,
        "accepted": accepted,
        "policy": {
            "worsenToleranceRatio": args.worsen_tolerance,
            "requiredImprovementRatio": args.improve_ratio,
            "rule": "no measured rotation metric may regress > tolerance; acceleration RMS or max rotation step must improve by required ratio",
        },
        "ratios": {
            "rotationStepRms": velocity_ratio,
            "rotationAccelerationRms": accel_ratio,
            "maxRotationStepRad": max_step_ratio,
        },
        "baseline": baseline,
        "candidate": candidate,
    }
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
