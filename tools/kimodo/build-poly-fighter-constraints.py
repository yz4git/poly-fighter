#!/usr/bin/env python3
"""Build Kimodo constraints that lock POLY FIGHTER combat intent to gameplay time.

This is a two-pass authoring helper:
1. text-only Kimodo candidates establish a natural fighting pose vocabulary;
2. the best candidate is converted into sparse Kimodo constraints;
3. refinement generation keeps guard/contact/support-foot/root intent while
   allowing the diffusion model to regenerate anticipation and recovery.

The constraint file follows NVIDIA Kimodo's public JSON schema:
- fullbody keyframes use local joint axis-angle rotations + root translation,
- left/right hand/foot constraints reuse the same pose representation,
- root2d pins the canonical XZ path and heading.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import torch

from kimodo.geometry import matrix_to_axis_angle
from kimodo.skeleton.registry import build_skeleton


def _motion_array(data: Any, key: str) -> np.ndarray:
    value = np.asarray(data[key])
    if value.ndim >= 1 and value.shape[0] == 1 and key in {
        "posed_joints",
        "local_rot_mats",
        "root_positions",
        "smooth_root_pos",
        "global_root_heading",
    }:
        value = value[0]
    return value


def _axis_angles(local_rot_mats: np.ndarray) -> np.ndarray:
    return matrix_to_axis_angle(torch.from_numpy(local_rot_mats).float()).cpu().numpy()


def _clamp_vec2(value: np.ndarray, maximum: float) -> np.ndarray:
    out = np.asarray(value, dtype=np.float64).copy()
    length = float(np.linalg.norm(out))
    if maximum <= 0:
        return np.zeros(2, dtype=np.float64)
    if length > maximum and length > 1e-9:
        out *= maximum / length
    return out


def _effector_name(kind: str, side: str) -> str:
    limb = "Hand" if kind == "strike" else "Foot"
    return f"{'Left' if side == 'L' else 'Right'}{limb}"


def _constraint_type(kind: str, side: str) -> str:
    limb = "hand" if kind == "strike" else "foot"
    return f"{'left' if side == 'L' else 'right'}-{limb}"


def _support_type(side: str) -> str:
    return f"{'left' if side == 'L' else 'right'}-foot"


def _contact_source_frame(
    joints: np.ndarray,
    names: list[str],
    kind: str,
    strike_side: str,
    target_frame: int,
    search_radius: int,
) -> int:
    index = {name: i for i, name in enumerate(names)}
    effector = _effector_name(kind, strike_side)
    if effector not in index or "Hips" not in index:
        raise ValueError(f"Required SOMA joints missing for {effector}")
    positions = joints[:, index[effector]]
    hips = joints[:, index["Hips"]]
    velocity = np.zeros(len(positions), dtype=np.float64)
    if len(positions) > 1:
        velocity[1:] = np.linalg.norm(np.diff(positions, axis=0), axis=1)
    reach = np.linalg.norm(positions - hips, axis=1)
    lo = max(1, target_frame - search_radius)
    hi = min(len(positions) - 1, target_frame + search_radius)
    candidates = range(lo, hi + 1)
    if lo > hi:
        return max(0, min(len(positions) - 1, target_frame))

    speed_scale = max(1e-8, float(velocity[lo : hi + 1].max()))
    reach_slice = reach[lo : hi + 1]
    reach_min = float(reach_slice.min())
    reach_span = max(1e-8, float(reach_slice.max() - reach_min))
    return max(
        candidates,
        key=lambda frame: (
            velocity[frame] / speed_scale
            + 0.45 * ((reach[frame] - reach_min) / reach_span)
            - 0.035 * abs(frame - target_frame)
        ),
    )


def _pose_payload(
    local_axis_angle: np.ndarray,
    root_positions: np.ndarray,
    smooth_root_2d: np.ndarray,
    source_frames: list[int],
    destination_frames: list[int],
    root_targets: list[np.ndarray],
) -> dict[str, Any]:
    roots = []
    smooth = []
    rotations = []
    for src, target in zip(source_frames, root_targets):
        root = np.asarray(root_positions[src], dtype=np.float64).copy()
        root[[0, 2]] = target
        roots.append(root.tolist())
        smooth.append(np.asarray(target, dtype=np.float64).tolist())
        rotations.append(local_axis_angle[src].tolist())
    return {
        "frame_indices": destination_frames,
        "local_joints_rot": rotations,
        "root_positions": roots,
        "smooth_root_2d": smooth,
    }


def _build_one(
    motion_path: Path,
    spec: dict[str, Any],
    kind: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    with np.load(motion_path) as data:
        joints = _motion_array(data, "posed_joints")
        local_rot_mats = _motion_array(data, "local_rot_mats")
        root_positions = _motion_array(data, "root_positions")
        smooth_root = _motion_array(data, "smooth_root_pos")
        headings = (
            _motion_array(data, "global_root_heading")
            if "global_root_heading" in data
            else None
        )

    if joints.ndim != 3 or local_rot_mats.ndim != 4:
        raise ValueError(
            f"{motion_path}: unexpected motion shapes joints={joints.shape} local={local_rot_mats.shape}"
        )
    frame_count = len(joints)
    if frame_count < 8:
        raise ValueError(f"{motion_path}: motion is too short ({frame_count} frames)")

    skeleton = build_skeleton(joints.shape[1])
    names = list(skeleton.bone_order_names)
    local_axis_angle = _axis_angles(local_rot_mats)

    profile = spec.get("constraintProfile", {})
    contact_phase = float(profile.get("contactPhase", 0.5))
    target_contact = max(1, min(frame_count - 2, int(round(contact_phase * (frame_count - 1)))))
    search_radius = max(1, int(profile.get("impactSearchFrames", 4)))
    source_contact = _contact_source_frame(
        joints,
        names,
        kind,
        spec["strikeSide"],
        target_contact,
        search_radius,
    )

    max_root = float(profile.get("maxRootTravelM", 0.12))
    root_xz = np.asarray(smooth_root[:, [0, 2]], dtype=np.float64)
    root_origin = root_xz[0].copy()
    candidate_contact = _clamp_vec2(root_xz[source_contact] - root_origin, max_root)
    contact_root = candidate_contact
    start_root = np.zeros(2, dtype=np.float64)
    end_root = np.zeros(2, dtype=np.float64)

    # A short contact window is enough to plant the support foot without
    # flattening the authored weight transfer.
    support_half_window = max(1, int(profile.get("supportWindowFrames", 2)))
    support_frames = list(
        range(
            max(0, target_contact - support_half_window),
            min(frame_count - 1, target_contact + support_half_window) + 1,
        )
    )

    constraints: list[dict[str, Any]] = []

    # Full-body start/contact/end keyframes: this locks guard -> readable contact
    # silhouette -> guard at deterministic gameplay phases. Kimodo regenerates
    # the motion between these sparse anchors.
    fullbody_sources = [0, source_contact, frame_count - 1]
    fullbody_destinations = [0, target_contact, frame_count - 1]
    fullbody_roots = [start_root, contact_root, end_root]
    fullbody = {
        "type": "fullbody",
        **_pose_payload(
            local_axis_angle,
            root_positions,
            root_xz,
            fullbody_sources,
            fullbody_destinations,
            fullbody_roots,
        ),
    }
    constraints.append(fullbody)

    # Explicit contact end-effector constraint at the gameplay impact frame.
    contact_constraint = {
        "type": _constraint_type(kind, spec["strikeSide"]),
        **_pose_payload(
            local_axis_angle,
            root_positions,
            root_xz,
            [source_contact],
            [target_contact],
            [contact_root],
        ),
    }
    constraints.append(contact_constraint)

    # Repeat the chosen contact-pose support-foot target over a narrow interval.
    # EndEffectorConstraintSet also pins hips/root during these frames, producing
    # a deliberate plant around impact instead of a sliding foot.
    support_constraint = {
        "type": _support_type(spec["supportSide"]),
        **_pose_payload(
            local_axis_angle,
            root_positions,
            root_xz,
            [source_contact] * len(support_frames),
            support_frames,
            [contact_root] * len(support_frames),
        ),
    }
    constraints.append(support_constraint)

    # The gameplay fighter position owns gross movement. Root2D therefore keeps
    # the generated clip essentially in-place while allowing a small bounded
    # weight shift at impact.
    root_constraint: dict[str, Any] = {
        "type": "root2d",
        "frame_indices": [0, target_contact, frame_count - 1],
        "smooth_root_2d": [
            start_root.tolist(),
            contact_root.tolist(),
            end_root.tolist(),
        ],
    }
    if bool(profile.get("lockHeading", True)):
        # Kimodo canonical heading angle 0 faces +Z; heading is stored [cos, sin].
        root_constraint["global_root_heading"] = [[1.0, 0.0]] * 3
    elif headings is not None and len(headings) == frame_count:
        root_constraint["global_root_heading"] = [
            headings[0].tolist(),
            headings[source_contact].tolist(),
            headings[-1].tolist(),
        ]
    constraints.append(root_constraint)

    meta = {
        "version": "POLY_FIGHTER_KIMODO_CONSTRAINTS_V1",
        "sourceMotion": str(motion_path),
        "kind": kind,
        "action": spec["action"],
        "frameCount": frame_count,
        "targetContactFrame": target_contact,
        "targetContactPhase": contact_phase,
        "sourceContactFrame": source_contact,
        "strikeSide": spec["strikeSide"],
        "supportSide": spec["supportSide"],
        "contactEffector": _effector_name(kind, spec["strikeSide"]),
        "contactRootXZ": contact_root.tolist(),
        "maxRootTravelM": max_root,
        "supportFrames": support_frames,
        "lockHeading": bool(profile.get("lockHeading", True)),
        "constraintTypes": [constraint["type"] for constraint in constraints],
    }
    return constraints, meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--presets", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--kind", choices=["kick", "strike"], required=True)
    args = parser.parse_args()

    presets = json.loads(Path(args.presets).read_text())
    selection = json.loads(Path(args.selection).read_text())
    output_root = Path(args.root)
    manifest = {
        "version": "POLY_FIGHTER_KIMODO_CONSTRAINT_MANIFEST_V1",
        "kind": args.kind,
        "moves": {},
    }

    for move_id, spec in presets["moves"].items():
        selected = selection["moves"][move_id]["selected"]
        motion_path = Path(selected["npz"]).resolve()
        constraints, meta = _build_one(motion_path, spec, args.kind)
        move_dir = output_root / move_id
        move_dir.mkdir(parents=True, exist_ok=True)
        constraints_path = move_dir / f"{move_id}_constraints.json"
        meta_path = move_dir / f"{move_id}_constraints.meta.json"
        constraints_path.write_text(json.dumps(constraints, indent=2) + "\n")
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
        manifest["moves"][move_id] = {
            "constraints": str(constraints_path),
            "meta": str(meta_path),
            "source": str(motion_path),
            "targetContactFrame": meta["targetContactFrame"],
            "sourceContactFrame": meta["sourceContactFrame"],
        }

    manifest_path = output_root / "constraints.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
