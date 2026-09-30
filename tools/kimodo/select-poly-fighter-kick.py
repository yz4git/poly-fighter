#!/usr/bin/env python3
"""Rank Kimodo SOMA candidates for POLY FIGHTER grounded-kick ingestion.

Run inside a Kimodo environment. The score deliberately uses Kimodo's native
posed_joints, smooth_root_pos and foot_contacts channels before Blender
retargeting. Motion Foundry remains the final authority for contact height,
support-foot drift, knee plane and gameplay silhouette.
"""
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


def _names_for(joint_count: int) -> list[str]:
    skeleton = build_skeleton(joint_count)
    return list(skeleton.bone_order_names)


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


def _contact_channel(side: str, channels: int) -> slice:
    # somaskel30: [L heel, L toe, R heel, R toe]
    # somaskel77: [L heel, L toe, L toe-end, R heel, R toe, R toe-end]
    if channels >= 6:
        return slice(0, 3) if side == "L" else slice(3, 6)
    return slice(0, 2) if side == "L" else slice(2, 4)


def score_candidate(path: Path, strike_side: str, support_side: str, contact_phase: float) -> dict:
    with np.load(path) as data:
        joints = _motion_array(data, "posed_joints")
        if joints.ndim != 3 or joints.shape[-1] != 3:
            raise ValueError(f"{path}: expected posed_joints [T,J,3], got {joints.shape}")
        names = _names_for(joints.shape[1])
        index = {name: i for i, name in enumerate(names)}
        rotation_metrics = _rotation_smoothness(
            np.asarray(data["local_rot_mats"]) if "local_rot_mats" in data else np.empty((0,)),
            names,
            (
                "Hips", "Spine1", "Spine2", "Chest",
                "LeftLeg", "LeftShin", "LeftFoot",
                "RightLeg", "RightShin", "RightFoot",
                "LeftUpLeg", "RightUpLeg",
            ),
        )
        for required in ("Hips", "LeftFoot", "RightFoot"):
            if required not in index:
                raise ValueError(f"{path}: missing SOMA joint {required}")

        hips = joints[:, index["Hips"]]
        left = joints[:, index["LeftFoot"]]
        right = joints[:, index["RightFoot"]]
        strike = right if strike_side == "R" else left
        other = left if strike_side == "R" else right

        strike_velocity = np.linalg.norm(np.diff(strike, axis=0), axis=1)
        other_velocity = np.linalg.norm(np.diff(other, axis=0), axis=1)
        impact = int(np.argmax(strike_velocity)) + 1
        expected_impact = int(round(max(0.0, min(1.0, contact_phase)) * (len(strike) - 1)))
        timing_error = abs(impact - expected_impact)
        lo, hi = max(0, impact - 2), min(len(strike), impact + 3)

        strike_reach = np.linalg.norm(strike - hips, axis=1)
        other_reach = np.linalg.norm(other - hips, axis=1)
        side_dominance = float(strike_velocity.max() - other_velocity.max())
        reach_dominance = float(strike_reach.max() - other_reach.max())

        contacts = np.asarray(data["foot_contacts"]) if "foot_contacts" in data else None
        if contacts is not None and contacts.ndim == 3 and contacts.shape[0] == 1:
            contacts = contacts[0]
        support_contact = 0.0
        strike_contact = 0.0
        if contacts is not None and contacts.ndim == 2 and contacts.shape[1] >= 4:
            support_contact = float(np.mean(contacts[lo:hi, _contact_channel(support_side, contacts.shape[1])]))
            strike_contact = float(np.mean(contacts[lo:hi, _contact_channel(strike_side, contacts.shape[1])]))

        smooth_root = np.asarray(data["smooth_root_pos"]) if "smooth_root_pos" in data else hips
        if smooth_root.ndim == 3 and smooth_root.shape[0] == 1:
            smooth_root = smooth_root[0]
        root_path = smooth_root[:, [0, 2]]
        root_travel = float(np.linalg.norm(root_path[-1] - root_path[0]))
        root_peak = float(np.max(np.linalg.norm(root_path - root_path[0], axis=1)))

        # Prefer an unmistakable single striking leg, a planted support foot and
        # limited locomotor drift. Penalize the striking foot staying planted at
        # the detected kinetic peak.
        score = (
            float(strike_velocity.max()) * 1.6
            + max(0.0, side_dominance) * 1.2
            + max(0.0, reach_dominance) * 0.8
            + support_contact * 0.9
            - strike_contact * 0.35
            - root_travel * 0.7
            - max(0.0, root_peak - 0.45) * 1.2
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
            "peakStrikeSpeed": float(strike_velocity.max()),
            "sideDominance": side_dominance,
            "reachDominance": reach_dominance,
            "supportContactNearPeak": support_contact,
            "strikeContactNearPeak": strike_contact,
            "rootEndTravel": root_travel,
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
        "version": "POLY_FIGHTER_KIMODO_SELECTION_V1",
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
            "selected": candidates[0],
            "candidates": candidates,
        }

    Path(args.output).write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
