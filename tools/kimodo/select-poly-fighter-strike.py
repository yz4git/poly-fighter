#!/usr/bin/env python3
"""Rank Kimodo SOMA hand-strike candidates before Blender Motion Foundry."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from kimodo.skeleton.registry import build_skeleton


def _motion_array(data, key: str) -> np.ndarray:
    value = np.asarray(data[key])
    if value.ndim >= 1 and value.shape[0] == 1 and key in {"posed_joints", "foot_contacts"}:
        value = value[0]
    return value


def _joint_names(joint_count: int) -> list[str]:
    return list(build_skeleton(joint_count).bone_order_names)


def _rotation_smoothness(local_rot_mats: np.ndarray, names: list[str], preferred: tuple[str, ...]) -> dict:
    """UniMate-inspired geodesic rotation / velocity smoothness metrics."""
    if local_rot_mats.ndim == 5 and local_rot_mats.shape[0] == 1:
        local_rot_mats = local_rot_mats[0]
    if local_rot_mats.ndim != 4 or local_rot_mats.shape[-2:] != (3, 3):
        return {
            "rotationVelocityRms": 0.0,
            "rotationAccelerationRms": 0.0,
            "maxRotationStepRad": 0.0,
        }

    name_to_index = {name: i for i, name in enumerate(names)}
    indices = [name_to_index[name] for name in preferred if name in name_to_index]
    if not indices:
        indices = list(range(min(local_rot_mats.shape[1], len(names))))

    rotations = local_rot_mats[:, indices]
    if len(rotations) < 2:
        return {
            "rotationVelocityRms": 0.0,
            "rotationAccelerationRms": 0.0,
            "maxRotationStepRad": 0.0,
        }

    rel = np.swapaxes(rotations[:-1], -1, -2) @ rotations[1:]
    trace = np.trace(rel, axis1=-2, axis2=-1)
    cos_angle = np.clip((trace - 1.0) * 0.5, -1.0, 1.0)
    angular_step = np.arccos(cos_angle)
    velocity_rms = float(np.sqrt(np.mean(np.square(angular_step))))
    acceleration = np.diff(angular_step, axis=0)
    acceleration_rms = float(np.sqrt(np.mean(np.square(acceleration)))) if acceleration.size else 0.0
    return {
        "rotationVelocityRms": velocity_rms,
        "rotationAccelerationRms": acceleration_rms,
        "maxRotationStepRad": float(np.max(angular_step)),
    }


def _foot_contact_slice(side: str, channels: int) -> slice:
    if channels >= 6:
        return slice(0, 3) if side == "L" else slice(3, 6)
    return slice(0, 2) if side == "L" else slice(2, 4)


def score_candidate(path: Path, strike_side: str, support_side: str, contact_phase: float) -> dict:
    with np.load(path) as data:
        joints = _motion_array(data, "posed_joints")
        if joints.ndim != 3 or joints.shape[-1] != 3:
            raise ValueError(f"{path}: expected posed_joints [T,J,3], got {joints.shape}")
        names = _joint_names(joints.shape[1])
        index = {name: i for i, name in enumerate(names)}
        rotation_metrics = _rotation_smoothness(
            np.asarray(data["local_rot_mats"]) if "local_rot_mats" in data else np.empty((0,)),
            names,
            (
                "Hips", "Spine1", "Spine2", "Chest",
                "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
                "RightShoulder", "RightArm", "RightForeArm", "RightHand",
            ),
        )
        for required in ("Hips", "LeftHand", "RightHand"):
            if required not in index:
                raise ValueError(f"{path}: missing SOMA joint {required}")

        hips = joints[:, index["Hips"]]
        left = joints[:, index["LeftHand"]]
        right = joints[:, index["RightHand"]]
        strike = left if strike_side == "L" else right
        guard = right if strike_side == "L" else left

        strike_speed = np.linalg.norm(np.diff(strike, axis=0), axis=1)
        guard_speed = np.linalg.norm(np.diff(guard, axis=0), axis=1)
        impact = int(np.argmax(strike_speed)) + 1
        expected_impact = int(round(max(0.0, min(1.0, contact_phase)) * (len(strike) - 1)))
        timing_error = abs(impact - expected_impact)
        lo, hi = max(0, impact - 2), min(len(strike), impact + 3)

        strike_reach = np.linalg.norm(strike - hips, axis=1)
        guard_reach = np.linalg.norm(guard - hips, axis=1)
        side_dominance = float(strike_speed.max() - guard_speed.max())
        reach_gain = float(strike_reach[impact] - strike_reach[0])
        guard_excursion = float(np.max(np.linalg.norm(guard - guard[0], axis=1)))

        contacts = np.asarray(data["foot_contacts"]) if "foot_contacts" in data else None
        if contacts is not None and contacts.ndim == 3 and contacts.shape[0] == 1:
            contacts = contacts[0]
        support_contact = 0.0
        both_contact = 0.0
        if contacts is not None and contacts.ndim == 2 and contacts.shape[1] >= 4:
            support_contact = float(np.mean(contacts[lo:hi, _foot_contact_slice(support_side, contacts.shape[1])]))
            both_contact = float(np.mean(contacts[lo:hi, : min(6, contacts.shape[1])]))

        smooth_root = np.asarray(data["smooth_root_pos"]) if "smooth_root_pos" in data else hips
        if smooth_root.ndim == 3 and smooth_root.shape[0] == 1:
            smooth_root = smooth_root[0]
        root_path = smooth_root[:, [0, 2]]
        root_end = float(np.linalg.norm(root_path[-1] - root_path[0]))
        root_peak = float(np.max(np.linalg.norm(root_path - root_path[0], axis=1)))

        # A good fighting-game strike has a clear intended hand, real extension,
        # a mostly quiet guard hand, stable feet and bounded root travel.
        score = (
            float(strike_speed.max()) * 1.7
            + max(0.0, side_dominance) * 1.25
            + max(0.0, reach_gain) * 1.0
            + support_contact * 0.65
            + both_contact * 0.30
            - guard_excursion * 0.55
            - root_end * 0.60
            - max(0.0, root_peak - 0.38) * 1.10
            - timing_error * 0.08
            - rotation_metrics["rotationAccelerationRms"] * 1.35
            - max(0.0, rotation_metrics["maxRotationStepRad"] - 0.42) * 0.55
        )
        return {
            "npz": str(path),
            "bvh": str(path.with_suffix(".bvh")),
            "score": score,
            "impactFrame30Hz": impact,
            "expectedGameplayImpactFrame": expected_impact,
            "impactTimingErrorFrames": timing_error,
            "candidateKind": "constrained-refinement" if "_refine_" in path.stem else "text-exploration",
            "peakStrikeSpeed": float(strike_speed.max()),
            "sideDominance": side_dominance,
            "strikeReachGain": reach_gain,
            "guardHandExcursion": guard_excursion,
            "supportContactNearPeak": support_contact,
            "bothFeetContactNearPeak": both_contact,
            "rootEndTravel": root_end,
            "rootPeakTravel": root_peak,
            **rotation_metrics,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--presets", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    presets = json.loads(Path(args.presets).read_text())
    root = Path(args.root)
    result = {
        "version": "POLY_FIGHTER_KIMODO_STRIKE_SELECTION_V1",
        "model": presets["model"],
        "moves": {},
    }

    for move_id, spec in presets["moves"].items():
        candidates = [
            score_candidate(
                path,
                spec["strikeSide"],
                spec["supportSide"],
                float(spec.get("constraintProfile", {}).get("contactPhase", 0.5)),
            )
            for path in sorted((root / move_id).glob(f"{move_id}_*.npz"))
        ]
        if not candidates:
            raise FileNotFoundError(f"No Kimodo candidates found for {move_id}")
        candidates.sort(key=lambda item: item["score"], reverse=True)
        result["moves"][move_id] = {
            "action": spec["action"],
            "builder": spec["builder"],
            "selected": candidates[0],
            "candidates": candidates,
        }

    Path(args.output).write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
